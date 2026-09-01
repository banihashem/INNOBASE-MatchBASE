import type {
  ResearchRoutePolicyV1,
  ResearchRouteSnapshotV1,
} from "@matchbase/contracts";
import { createQualifiedGeminiDirectAdapter } from "./adapters/gemini-direct.js";
import { createQualifiedOpenRouterAdapter } from "./adapters/openrouter.js";
import {
  validateQualifiedResearchRequest,
  type QualifiedResearchRequest,
} from "./qualified-research-input.js";
import {
  createResearchRouteSnapshot,
  resolveActiveResearchRoute,
  validateResearchRoutePolicy,
} from "./research-route-policy.js";
import type {
  Backoff,
  ProviderAttemptOutcome,
  ProviderTransport,
} from "./transport.js";

export type LiveResearchTerminalDisposition =
  "complete" | "failed_retryable" | "failed" | "cancelled";

export interface LiveResearchRouteRecord {
  readonly snapshot: ResearchRouteSnapshotV1;
  readonly attempts: readonly ProviderAttemptOutcome[];
  readonly failureCode: string | null;
}

export interface LiveResearchTerminalRecord<TResult> {
  readonly schemaVersion: "live-research-terminal.v1";
  readonly executionId: string;
  readonly runId: string;
  readonly disposition: LiveResearchTerminalDisposition;
  readonly reasonCode: string;
  readonly routes: readonly LiveResearchRouteRecord[];
  readonly result: TResult | null;
  readonly completedAt: string;
}

export interface LiveResearchAtomicLedger<TResult> {
  reserveExecution(
    executionId: string,
    runId: string,
  ): Promise<
    | Readonly<{ state: "acquired"; ownershipToken: string }>
    | Readonly<{
        state: "existing";
        terminal: Promise<LiveResearchTerminalRecord<TResult>>;
      }>
  >;
  commitTerminal(
    ownershipToken: string,
    record: LiveResearchTerminalRecord<TResult>,
  ): Promise<LiveResearchTerminalRecord<TResult>>;
}

export interface LiveResearchCircuitPolicy {
  isRouteAvailable(
    routeId: string,
    at: string,
  ): Promise<boolean | LiveResearchCircuitProbe>;
}

export interface LiveResearchCircuitProbe {
  readonly signal: AbortSignal;
  assertOwnership(): Promise<void>;
  close(): void;
}

const terminalError = (message: string, record: unknown): Error =>
  Object.assign(new Error(message), { terminalRecord: record });

function exactText(value: string, label: string): string {
  if (!value || value !== value.trim()) throw new Error(`${label} is invalid.`);
  return value;
}

function costIsClosed(attempt: ProviderAttemptOutcome): boolean {
  return (
    attempt.costState === "priced" ||
    attempt.costState === "estimated" ||
    attempt.costState === "not_incurred"
  );
}

export async function executeQualifiedResearch<TResult>(input: {
  readonly policy: ResearchRoutePolicyV1;
  readonly executionId: string;
  readonly runId: string;
  readonly capturedAt: string;
  readonly request: QualifiedResearchRequest;
  readonly transports: Readonly<{
    gemini_direct: ProviderTransport;
    openrouter: ProviderTransport;
  }>;
  readonly ledger: LiveResearchAtomicLedger<TResult>;
  readonly circuit: LiveResearchCircuitPolicy;
  readonly validateOutput: (body: unknown) => TResult;
  readonly signal: AbortSignal;
  readonly backoff?: Backoff;
  readonly now?: () => string;
}): Promise<LiveResearchTerminalRecord<TResult>> {
  const executionId = exactText(input.executionId, "executionId");
  const runId = exactText(input.runId, "runId");
  const policy = validateResearchRoutePolicy(input.policy);
  const request = validateQualifiedResearchRequest(input.request);
  if (policy.liveActivation !== "enabled") {
    throw new Error("Research live activation is blocked.");
  }
  const reservation = await input.ledger.reserveExecution(executionId, runId);
  if (reservation.state === "existing") {
    const existing = await reservation.terminal;
    if (existing.executionId !== executionId || existing.runId !== runId) {
      throw new Error(
        "Live research execution identity belongs to another run.",
      );
    }
    return existing;
  }
  const ownershipToken = exactText(
    reservation.ownershipToken,
    "ownershipToken",
  );
  const now = input.now ?? (() => new Date().toISOString());
  const records: LiveResearchRouteRecord[] = [];
  let terminalCommitted = false;
  const commit = async (
    disposition: LiveResearchTerminalDisposition,
    reasonCode: string,
    result: TResult | null,
  ): Promise<LiveResearchTerminalRecord<TResult>> => {
    if (terminalCommitted)
      throw new Error("Terminal record was already committed.");
    terminalCommitted = true;
    return await input.ledger.commitTerminal(ownershipToken, {
      schemaVersion: "live-research-terminal.v1",
      executionId,
      runId,
      disposition,
      reasonCode,
      routes: records.map((record) => ({
        ...record,
        attempts: [...record.attempts],
      })),
      result,
      completedAt: now(),
    });
  };

  const routes = [...policy.routes]
    .filter((route) => route.enabled)
    .sort((left, right) => left.fallbackPosition - right.fallbackPosition);
  for (const routeDefinition of routes) {
    const route = resolveActiveResearchRoute(
      policy,
      routeDefinition.routeId,
      input.capturedAt,
    );
    const attempts: ProviderAttemptOutcome[] = [];
    if (input.signal.aborted) {
      records.push({
        snapshot: createResearchRouteSnapshot({
          policy,
          route,
          snapshotId: `${executionId}:${route.routeId}`,
          runId,
          servedProviderId: null,
          servedModelId: null,
          terminalDisposition: "cancelled",
          capturedAt: input.capturedAt,
        }),
        attempts,
        failureCode: "cancelled_before_route",
      });
      return await commit("cancelled", "cancelled", null);
    }
    const circuitAdmission = await input.circuit.isRouteAvailable(
      route.routeId,
      input.capturedAt,
    );
    if (!circuitAdmission) {
      records.push({
        snapshot: createResearchRouteSnapshot({
          policy,
          route,
          snapshotId: `${executionId}:${route.routeId}`,
          runId,
          servedProviderId: null,
          servedModelId: null,
          terminalDisposition: "failed",
          capturedAt: input.capturedAt,
        }),
        attempts,
        failureCode: "circuit_open",
      });
      continue;
    }
    const onAttempt = async (attempt: ProviderAttemptOutcome) => {
      attempts.push(Object.freeze({ ...attempt }));
    };
    const circuitProbe =
      typeof circuitAdmission === "object" ? circuitAdmission : undefined;
    const routeSignal = circuitProbe
      ? AbortSignal.any([input.signal, circuitProbe.signal])
      : input.signal;
    try {
      await circuitProbe?.assertOwnership();
      const execution = {
        runId,
        snapshotId: `${executionId}:${route.routeId}`,
        capturedAt: input.capturedAt,
      };
      const adapter =
        route.path === "gemini_direct"
          ? createQualifiedGeminiDirectAdapter({
              policy,
              routeId: route.routeId,
              activatedAt: input.capturedAt,
              transport: input.transports.gemini_direct,
              onAttempt,
              ...(input.backoff ? { backoff: input.backoff } : {}),
            })
          : createQualifiedOpenRouterAdapter({
              policy,
              routeId: route.routeId,
              activatedAt: input.capturedAt,
              transport: input.transports.openrouter,
              onAttempt,
              ...(input.backoff ? { backoff: input.backoff } : {}),
            });
      const response = await adapter.generateStructured(
        request,
        execution,
        routeSignal,
      );
      await circuitProbe?.assertOwnership();
      if (
        attempts.length === 0 ||
        attempts.some((attempt) => !costIsClosed(attempt))
      ) {
        records.push({
          snapshot: response.routeSnapshot,
          attempts,
          failureCode: "cost_unreconciled",
        });
        const terminal = await commit("failed", "cost_unreconciled", null);
        throw terminalError("Live research cost did not reconcile.", terminal);
      }
      let result: TResult;
      try {
        result = input.validateOutput(response.body);
      } catch (error) {
        records.push({
          snapshot: response.routeSnapshot,
          attempts,
          failureCode: "schema_violation",
        });
        const terminal = await commit("failed", "schema_violation", null);
        throw terminalError(
          `Live research output schema validation failed: ${
            error instanceof Error ? error.message : "unknown validation fault"
          }`,
          terminal,
        );
      }
      records.push({
        snapshot: response.routeSnapshot,
        attempts,
        failureCode: null,
      });
      return await commit("complete", "completed", result);
    } catch (error) {
      if (terminalCommitted) throw error;
      const cancelled = input.signal.aborted;
      const costUnknown = attempts.some((attempt) => !costIsClosed(attempt));
      records.push({
        snapshot: createResearchRouteSnapshot({
          policy,
          route,
          snapshotId: `${executionId}:${route.routeId}`,
          runId,
          servedProviderId: null,
          servedModelId: null,
          terminalDisposition: cancelled ? "cancelled" : "failed",
          capturedAt: input.capturedAt,
        }),
        attempts,
        failureCode: cancelled
          ? "cancelled"
          : costUnknown
            ? "cost_unknown"
            : "route_failed",
      });
      if (cancelled) return await commit("cancelled", "cancelled", null);
      if (costUnknown) {
        return await commit("failed", "cost_unknown", null);
      }
    } finally {
      circuitProbe?.close();
    }
  }
  return await commit("failed_retryable", "qualified_routes_exhausted", null);
}
