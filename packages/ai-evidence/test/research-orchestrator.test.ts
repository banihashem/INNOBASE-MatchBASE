import assert from "node:assert/strict";
import test from "node:test";
import {
  executeQualifiedResearch,
  RecordingFakeTransport,
  type LiveResearchAtomicLedger,
  type LiveResearchTerminalRecord,
  type ProviderTransport,
  type TransportRequest,
  type TransportResponse,
} from "../src/index.js";
import { qualifiedPolicy } from "./fixtures/research-route-policy.js";

type Result = Readonly<{ candidates: readonly string[] }>;

class MemoryLedger implements LiveResearchAtomicLedger<Result> {
  readonly records = new Map<string, LiveResearchTerminalRecord<Result>>();
  private readonly pending = new Map<
    string,
    {
      runId: string;
      ownershipToken: string;
      terminal: Promise<LiveResearchTerminalRecord<Result>>;
      resolve: (record: LiveResearchTerminalRecord<Result>) => void;
    }
  >();
  commits = 0;

  async reserveExecution(executionId: string, runId: string) {
    const terminal = this.records.get(executionId);
    if (terminal) {
      if (terminal.runId !== runId) throw new Error("execution run mismatch");
      return {
        state: "existing" as const,
        terminal: Promise.resolve(terminal),
      };
    }
    const pending = this.pending.get(executionId);
    if (pending) {
      if (pending.runId !== runId) throw new Error("execution run mismatch");
      return { state: "existing" as const, terminal: pending.terminal };
    }
    let resolve!: (record: LiveResearchTerminalRecord<Result>) => void;
    const waiting = new Promise<LiveResearchTerminalRecord<Result>>(
      (complete) => {
        resolve = complete;
      },
    );
    const ownershipToken = `OWNER:${executionId}`;
    this.pending.set(executionId, {
      runId,
      ownershipToken,
      terminal: waiting,
      resolve,
    });
    return { state: "acquired" as const, ownershipToken };
  }

  async commitTerminal(
    ownershipToken: string,
    record: LiveResearchTerminalRecord<Result>,
  ) {
    if (this.records.has(record.executionId)) {
      throw new Error("duplicate terminal commit");
    }
    const pending = this.pending.get(record.executionId);
    if (!pending || pending.ownershipToken !== ownershipToken) {
      throw new Error("terminal commit lacks execution ownership");
    }
    this.commits += 1;
    this.records.set(record.executionId, record);
    this.pending.delete(record.executionId);
    pending.resolve(record);
    return record;
  }
}

class DeferredTransport implements ProviderTransport {
  readonly requests: TransportRequest[] = [];
  private readonly gate: Promise<void>;
  private releaseGate!: () => void;
  private readonly started: Promise<void>;
  private markStarted!: () => void;

  constructor(private readonly response: TransportResponse) {
    this.gate = new Promise((resolve) => {
      this.releaseGate = resolve;
    });
    this.started = new Promise((resolve) => {
      this.markStarted = resolve;
    });
  }

  async waitUntilStarted(): Promise<void> {
    await this.started;
  }

  release(): void {
    this.releaseGate();
  }

  async send(request: TransportRequest): Promise<TransportResponse> {
    this.requests.push(request);
    this.markStarted();
    await this.gate;
    return this.response;
  }
}

const accounting = {
  state: "estimated",
  quantity: 1,
  unit: "request",
  amount: 0.0001,
  currency: "USD",
  pricingVersion: "fixture-pricing.v1",
  measurement: "estimated",
} as const;

const validateOutput = (body: unknown): Result => {
  const value = body as { candidates?: unknown };
  if (
    !value ||
    !Array.isArray(value.candidates) ||
    value.candidates.some((candidate) => typeof candidate !== "string") ||
    value.candidates.length > 3
  ) {
    throw new Error("closed output rejected");
  }
  return Object.freeze({ candidates: Object.freeze([...value.candidates]) });
};

const base = (ledger: MemoryLedger) => ({
  policy: qualifiedPolicy(),
  executionId: "EXEC-S3-001",
  runId: "RUN-S3-001",
  capturedAt: "2026-08-16T00:00:00.000Z",
  request: {
    canonicalLanguage: "en" as const,
    canonicalEnglishRequest:
      "Identify qualified industrial suppliers for the canonical requirements.",
    sanitizedEvidence: [
      {
        sourceId: "SRC-PUBLIC-001",
        canonicalUrl: "https://example.com/source",
        publisherDomain: "example.com",
        retrievedAt: "2026-08-15T00:00:00.000Z",
        contentSha256: "a".repeat(64),
        excerpt: "Public industrial evidence excerpt.",
      },
    ],
    outputSchema: { type: "object", additionalProperties: false },
  },
  ledger,
  circuit: { isRouteAvailable: async () => true },
  validateOutput,
  signal: new AbortController().signal,
  backoff: async () => undefined,
  now: () => "2026-08-16T00:00:01.000Z",
});

test("explicit fallback closes every priced attempt and commits one terminal result", async () => {
  const ledger = new MemoryLedger();
  const direct = new RecordingFakeTransport({
    status: 503,
    body: {},
    accounting,
  });
  const openrouter = new RecordingFakeTransport({
    status: 200,
    body: { candidates: ["A", "B"] },
    servedIdentity: {
      providerId: "google",
      modelId: "google/gemini-2.5-flash",
    },
    accounting,
  });
  const result = await executeQualifiedResearch({
    ...base(ledger),
    transports: { gemini_direct: direct, openrouter },
  });
  assert.equal(result.disposition, "complete");
  assert.equal(result.routes.length, 2);
  assert.equal(result.routes[0]?.failureCode, "route_failed");
  assert.equal(result.routes[0]?.snapshot.servedProviderId, null);
  assert.equal(result.routes[1]?.snapshot.terminalDisposition, "ok");
  assert.deepEqual(result.result, { candidates: ["A", "B"] });
  assert.equal(ledger.commits, 1);
  assert.equal(direct.requests.length, 1);
  assert.equal(openrouter.requests.length, 1);

  const replay = await executeQualifiedResearch({
    ...base(ledger),
    transports: {
      gemini_direct: new RecordingFakeTransport(new Error("must not run")),
      openrouter: new RecordingFakeTransport(new Error("must not run")),
    },
  });
  assert.equal(replay, result);
  assert.equal(ledger.commits, 1);
});

test("atomic reservation gives concurrent same-key execution one provider owner", async () => {
  const ledger = new MemoryLedger();
  const direct = new DeferredTransport({
    status: 200,
    body: { candidates: ["A"] },
    servedIdentity: {
      providerId: "google",
      modelId: "gemini-2.5-flash",
    },
    accounting,
  });
  const blockedFallback = new RecordingFakeTransport(new Error("must not run"));
  const first = executeQualifiedResearch({
    ...base(ledger),
    transports: {
      gemini_direct: direct,
      openrouter: blockedFallback,
    },
  });
  await direct.waitUntilStarted();
  const second = executeQualifiedResearch({
    ...base(ledger),
    transports: {
      gemini_direct: new RecordingFakeTransport(new Error("must not run")),
      openrouter: blockedFallback,
    },
  });
  await Promise.resolve();
  assert.equal(direct.requests.length, 1);
  assert.equal(blockedFallback.requests.length, 0);
  direct.release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(secondResult, firstResult);
  assert.equal(ledger.commits, 1);
  assert.equal(direct.requests.length, 1);
});

test("unknown attempt cost blocks fallback and commits a truthful terminal failure", async () => {
  const ledger = new MemoryLedger();
  const openrouter = new RecordingFakeTransport({
    status: 200,
    body: { candidates: ["must not run"] },
    servedIdentity: {
      providerId: "google",
      modelId: "google/gemini-2.5-flash",
    },
    accounting,
  });
  const result = await executeQualifiedResearch({
    ...base(ledger),
    transports: {
      gemini_direct: new RecordingFakeTransport(
        new Error("ambiguous network failure"),
      ),
      openrouter,
    },
  });
  assert.equal(result.disposition, "failed");
  assert.equal(result.reasonCode, "cost_unknown");
  assert.equal(result.routes.length, 1);
  assert.equal(openrouter.requests.length, 0);
  assert.equal(ledger.commits, 1);
});

test("preflight cancellation records no provider call and one cancelled terminal", async () => {
  const ledger = new MemoryLedger();
  const controller = new AbortController();
  controller.abort();
  const transport = new RecordingFakeTransport(new Error("must not run"));
  const result = await executeQualifiedResearch({
    ...base(ledger),
    signal: controller.signal,
    transports: { gemini_direct: transport, openrouter: transport },
  });
  assert.equal(result.disposition, "cancelled");
  assert.equal(result.routes[0]?.attempts.length, 0);
  assert.equal(transport.requests.length, 0);
  assert.equal(ledger.commits, 1);
});

test("in-flight cancellation closes even when the provider transport ignores abort", async () => {
  const ledger = new MemoryLedger();
  const controller = new AbortController();
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const ignored: ProviderTransport = {
    async send() {
      markStarted();
      return await new Promise(() => undefined);
    },
  };
  const pending = executeQualifiedResearch({
    ...base(ledger),
    signal: controller.signal,
    transports: {
      gemini_direct: ignored,
      openrouter: new RecordingFakeTransport(new Error("must not run")),
    },
  });
  await started;
  controller.abort();
  const terminal = await pending;
  assert.equal(terminal.disposition, "cancelled");
  assert.equal(terminal.reasonCode, "cancelled");
  assert.equal(terminal.routes[0]?.attempts[0]?.outcome, "cancelled");
  assert.equal(ledger.commits, 1);
});

test("circuit-open primary route falls through without fabricating an attempt", async () => {
  const ledger = new MemoryLedger();
  const direct = new RecordingFakeTransport(new Error("must not run"));
  const openrouter = new RecordingFakeTransport({
    status: 200,
    body: { candidates: [] },
    servedIdentity: {
      providerId: "google",
      modelId: "google/gemini-2.5-flash",
    },
    accounting,
  });
  const result = await executeQualifiedResearch({
    ...base(ledger),
    circuit: {
      isRouteAvailable: async (routeId) => !routeId.includes("GEMINI-DIRECT"),
    },
    transports: { gemini_direct: direct, openrouter },
  });
  assert.equal(result.disposition, "complete");
  assert.equal(result.routes[0]?.failureCode, "circuit_open");
  assert.equal(result.routes[0]?.attempts.length, 0);
  assert.equal(direct.requests.length, 0);
});

test("invalid result schema fails terminally without synthetic substitution", async () => {
  const ledger = new MemoryLedger();
  await assert.rejects(
    executeQualifiedResearch({
      ...base(ledger),
      transports: {
        gemini_direct: new RecordingFakeTransport({
          status: 200,
          body: { candidates: ["A", "B", "C", "D"] },
          servedIdentity: {
            providerId: "google",
            modelId: "gemini-2.5-flash",
          },
          accounting,
        }),
        openrouter: new RecordingFakeTransport(new Error("must not run")),
      },
    }),
    /schema validation failed/iu,
  );
  assert.equal(
    ledger.records.get("EXEC-S3-001")?.reasonCode,
    "schema_violation",
  );
  assert.equal(ledger.commits, 1);
});
