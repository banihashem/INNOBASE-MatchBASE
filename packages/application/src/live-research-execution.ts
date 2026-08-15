import {
  createResearchRouteSnapshot,
  canonicalizeCandidateIdentity,
  executeProviderRequest,
  executeQualifiedResearch,
  resolveCandidateIdentities,
  resolveActiveResearchRoute,
  validateEvidenceGraph,
  validateEvidenceLineageLedger,
  type Backoff,
  type LiveResearchCircuitPolicy,
  type LiveResearchRouteRecord,
  type LiveResearchTerminalRecord,
  type ProviderAttemptOutcome,
  type ProviderTransport,
  type SanitizedResearchEvidence,
} from "@matchbase/ai-evidence";
import type {
  EvidenceGraphV1,
  EvidenceLineageLedgerV1,
  ResearchRoutePolicyV1,
} from "@matchbase/contracts";
import {
  inTransaction,
  type ConnectionPool,
  type Queryable,
} from "@matchbase/data";
import {
  sealUntrustedSource,
  secureFetch,
  SecureFetchDenied,
  type DnsResolver,
  type PinnedFetchTransport,
  type SecureFetchResult,
  type SourceAccessEvaluator,
} from "@matchbase/security";
import { createHash, randomUUID } from "node:crypto";

const sha = (value: string | Uint8Array): Buffer =>
  createHash("sha256").update(value).digest();
const json = (value: unknown): string => JSON.stringify(value);

interface ReservationRow {
  account_id: string;
  run_id: string;
  generation: number | string;
  state: "in_progress" | "terminal";
  lease_expires_at: Date;
  lease_active?: boolean;
  ownership_token_sha256: Buffer;
  execution_lease_slot: number | string;
  execution_lease_generation: number | string;
  terminal_record: unknown | null;
}

export interface ServerOwnedSourceDiscovery {
  discover(input: {
    policy: ResearchRoutePolicyV1;
    executionId: string;
    runId: string;
    capturedAt: string;
    canonicalEnglishRequest: string;
    signal: AbortSignal;
    assertOwnership: () => Promise<void>;
  }): Promise<{
    route: LiveResearchRouteRecord;
    sourceUrls: readonly string[];
  }>;
}

class SourceDiscoveryFailure extends Error {
  constructor(
    message: string,
    readonly route: LiveResearchRouteRecord,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class LiveResearchProcessInterrupted extends Error {}
export class LiveResearchCapacityUnavailable extends Error {}

interface SourceDiscoveryCheckpoint {
  readonly route: LiveResearchRouteRecord;
  readonly sourceUrls: readonly string[];
  readonly searchAttemptId: string;
}

function canonicalSourceUrls(value: readonly string[]): readonly string[] {
  if (
    value.length < 1 ||
    value.length > 10 ||
    new Set(value).size !== value.length
  )
    throw new Error("Server-owned source discovery returned invalid URLs.");
  for (const candidate of value) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new Error("Server-owned source discovery returned invalid URLs.");
    }
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      url.href !== candidate
    )
      throw new Error("Server-owned source discovery returned invalid URLs.");
  }
  return Object.freeze([...value]);
}

function validateSourceDiscoveryCheckpoint(
  value: unknown,
  runId: string,
  searchAttemptId: string,
): SourceDiscoveryCheckpoint {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Source-discovery checkpoint is invalid.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "route,sourceUrls")
    throw new Error("Source-discovery checkpoint is not closed.");
  const route = record.route as LiveResearchRouteRecord;
  if (
    !route ||
    route.failureCode !== null ||
    route.snapshot?.runId !== runId ||
    route.snapshot.terminalDisposition !== "ok" ||
    !Array.isArray(route.attempts) ||
    route.attempts.length < 1 ||
    route.attempts.some(
      (attempt) =>
        attempt.capabilityId !== "CAP-SEARCH" ||
        attempt.outcome !== "ok" ||
        attempt.costState === "unknown",
    )
  )
    throw new Error("Source-discovery checkpoint route is invalid.");
  if (!Array.isArray(record.sourceUrls))
    throw new Error("Source-discovery checkpoint URLs are invalid.");
  return Object.freeze({
    route,
    sourceUrls: canonicalSourceUrls(record.sourceUrls as string[]),
    searchAttemptId,
  });
}

export class GeminiServerOwnedSourceDiscovery implements ServerOwnedSourceDiscovery {
  constructor(private readonly transport: ProviderTransport) {}

  async discover(input: {
    policy: ResearchRoutePolicyV1;
    executionId: string;
    runId: string;
    capturedAt: string;
    canonicalEnglishRequest: string;
    signal: AbortSignal;
    assertOwnership: () => Promise<void>;
  }): Promise<{
    route: LiveResearchRouteRecord;
    sourceUrls: readonly string[];
  }> {
    const definition = input.policy.routes
      .filter((route) => route.enabled && route.path === "gemini_direct")
      .sort((left, right) => left.fallbackPosition - right.fallbackPosition)[0];
    if (!definition)
      throw new Error(
        "Qualified direct source-discovery route is unavailable.",
      );
    const route = resolveActiveResearchRoute(
      input.policy,
      definition.routeId,
      input.capturedAt,
    );
    if (route.parameterPolicy.searchMode !== "provider_native_web_search")
      throw new Error("Direct source discovery lacks native web search.");
    await input.assertOwnership();
    const attempts: ProviderAttemptOutcome[] = [];
    let response: Awaited<ReturnType<typeof executeProviderRequest>>;
    try {
      response = await executeProviderRequest({
        capabilityId: "CAP-SEARCH",
        route: {
          routeId: route.routeId,
          providerId: "gemini_direct",
          modelId: route.requestedModelId,
          enabled: true,
          environment: input.policy.environment,
          realData: true,
          billingPath: "paid_verified",
          retentionPosture:
            route.dataHandling.retentionTrainingPosture === "verified_zdr"
              ? "zdr"
              : "no_training_30d_logs",
          dataHandlingEvidenceRefs: [...route.dataHandling.evidenceRefs],
          timeoutMs: route.parameterPolicy.timeoutMs,
          retry: {
            maxAttempts: route.parameterPolicy.maxAttempts,
            backoffMs: route.parameterPolicy.backoffMs,
          },
          requireParameters: true,
          allowFallbacks: false,
          capabilities: ["CAP-SEARCH", "CAP-STRUCTURED-GENERATION"],
        },
        transport: this.transport,
        signal: input.signal,
        onAttempt: (attempt) =>
          void attempts.push(Object.freeze({ ...attempt })),
        request: (signal) => ({
          url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(route.requestedModelId)}:generateContent`,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: json({
            model: route.requestedModelId,
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: `${input.canonicalEnglishRequest}\nReturn only canonical public HTTPS source URLs that materially support the request.`,
                  },
                ],
              },
            ],
            tools: [{ google_search: {} }],
            generationConfig: {
              responseMimeType: "application/json",
              responseJsonSchema: {
                type: "object",
                additionalProperties: false,
                required: ["sourceUrls"],
                properties: {
                  sourceUrls: {
                    type: "array",
                    minItems: 1,
                    maxItems: 10,
                    uniqueItems: true,
                    items: { type: "string", format: "uri" },
                  },
                },
              },
              maxOutputTokens: 1024,
              temperature: 0,
            },
          }),
          signal,
        }),
        validateResponse: (candidate) => {
          if (
            candidate.servedIdentity?.providerId !== route.providerId ||
            candidate.servedIdentity.modelId !== route.expectedServedModelId
          )
            throw new Error("Source-discovery served identity drifted.");
        },
      });
    } catch (error) {
      if (attempts.length === 0) throw error;
      throw new SourceDiscoveryFailure(
        input.signal.aborted
          ? "Source-discovery provider attempt was cancelled."
          : "Source-discovery provider attempt failed.",
        {
          snapshot: createResearchRouteSnapshot({
            policy: input.policy,
            route,
            snapshotId: `${input.executionId}:SOURCE-DISCOVERY:${route.routeId}`,
            runId: input.runId,
            servedProviderId: null,
            servedModelId: null,
            terminalDisposition: input.signal.aborted ? "cancelled" : "failed",
            capturedAt: input.capturedAt,
          }),
          attempts,
          failureCode: input.signal.aborted
            ? "source_discovery_cancelled"
            : "source_discovery_failed",
        },
        { cause: error },
      );
    }
    const body = response.body as { sourceUrls?: unknown };
    if (
      !body ||
      Object.keys(body).join(",") !== "sourceUrls" ||
      !Array.isArray(body.sourceUrls) ||
      body.sourceUrls.length < 1 ||
      body.sourceUrls.length > 10 ||
      body.sourceUrls.some(
        (url) => typeof url !== "string" || !url.startsWith("https://"),
      ) ||
      new Set(body.sourceUrls).size !== body.sourceUrls.length ||
      attempts.length < 1 ||
      attempts.some((attempt) => attempt.costState === "unknown")
    ) {
      throw new SourceDiscoveryFailure(
        "Source-discovery response is invalid or unreconciled.",
        {
          snapshot: createResearchRouteSnapshot({
            policy: input.policy,
            route,
            snapshotId: `${input.executionId}:SOURCE-DISCOVERY:${route.routeId}`,
            runId: input.runId,
            servedProviderId: null,
            servedModelId: null,
            terminalDisposition: "failed",
            capturedAt: input.capturedAt,
          }),
          attempts,
          failureCode: "source_discovery_invalid",
        },
      );
    }
    return {
      route: {
        snapshot: createResearchRouteSnapshot({
          policy: input.policy,
          route,
          snapshotId: `${input.executionId}:SOURCE-DISCOVERY:${route.routeId}`,
          runId: input.runId,
          servedProviderId: response.servedIdentity!.providerId,
          servedModelId: response.servedIdentity!.modelId,
          terminalDisposition: "ok",
          capturedAt: input.capturedAt,
        }),
        attempts,
        failureCode: null,
      },
      sourceUrls: Object.freeze([...body.sourceUrls]),
    };
  }
}

export class PostgresLiveResearchAtomicLedger {
  constructor(
    private readonly options: {
      pool: ConnectionPool;
      accountId: string;
      userId: string;
      policyId: string;
      leaseMs?: number;
      heartbeatMs?: number;
      pollMs?: number;
      waitMs?: number;
      now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private leaseMs(): number {
    const value = this.options.leaseMs ?? 120_000;
    if (!Number.isSafeInteger(value) || value < 40 || value > 600_000)
      throw new Error("Live research lease duration is invalid.");
    return value;
  }

  private heartbeatMs(): number {
    const value = this.options.heartbeatMs ?? 30_000;
    if (
      !Number.isSafeInteger(value) ||
      value < 10 ||
      value > 30_000 ||
      value * 4 > this.leaseMs()
    )
      throw new Error("Live research heartbeat duration is invalid.");
    return value;
  }

  private async terminal(
    executionId: string,
  ): Promise<LiveResearchTerminalRecord<EvidenceGraphV1> | null> {
    const result = await this.options.pool.query<{ terminal_record: unknown }>(
      `SELECT t.terminal_record
         FROM live_research_execution_reservation r
         JOIN live_research_terminal t ON t.live_research_terminal_id=r.terminal_id
        WHERE r.execution_id=$1 AND r.account_id=$2 AND r.state='terminal'`,
      [executionId, this.options.accountId],
    );
    return (
      (result.rows[0]
        ?.terminal_record as LiveResearchTerminalRecord<EvidenceGraphV1>) ??
      null
    );
  }

  private async waitForTerminal(
    executionId: string,
    runId: string,
  ): Promise<LiveResearchTerminalRecord<EvidenceGraphV1>> {
    const deadline = Date.now() + (this.options.waitMs ?? 30_000);
    while (Date.now() < deadline) {
      const terminal = await this.terminal(executionId);
      if (terminal) {
        if (terminal.runId !== runId)
          throw new Error(
            "Live research execution identity belongs to another run.",
          );
        return terminal;
      }
      const lease = await this.options.pool.query<{ lease_active: boolean }>(
        `SELECT lease_expires_at > $4::timestamptz AS lease_active
           FROM live_research_execution_reservation
          WHERE execution_id=$1 AND account_id=$2 AND run_id=$3`,
        [executionId, this.options.accountId, runId, this.now()],
      );
      if (!lease.rows[0]?.lease_active)
        throw new Error(
          "Live research execution lease expired; retry may reclaim it.",
        );
      await new Promise((resolve) =>
        setTimeout(resolve, this.options.pollMs ?? 20),
      );
    }
    throw new Error("Timed out waiting for the owned live research execution.");
  }

  async reserveExecution(executionId: string, runId: string) {
    const ownershipToken = randomUUID();
    const tokenHash = sha(ownershipToken);
    const leaseMs = this.leaseMs();
    const now = this.now();
    const state = await inTransaction(this.options.pool, async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [executionId],
      );
      const existing = await client.query<ReservationRow>(
        `SELECT r.account_id,r.run_id,r.generation,r.state,r.lease_expires_at,
                r.ownership_token_sha256,r.execution_lease_slot,
                r.execution_lease_generation,t.terminal_record
           FROM live_research_execution_reservation r
           LEFT JOIN live_research_terminal t ON t.live_research_terminal_id=r.terminal_id
          WHERE r.execution_id=$1 FOR UPDATE OF r`,
        [executionId],
      );
      const row = existing.rows[0];
      if (
        row &&
        (row.account_id !== this.options.accountId || row.run_id !== runId)
      )
        throw new Error(
          "Live research execution identity belongs to another run.",
        );
      if (row?.state === "terminal") return { state: "existing" as const };
      if (row && row.lease_expires_at > now)
        return { state: "existing" as const };

      const slot = await client.query<{
        slot_no: number;
        generation: number;
        run_id: string | null;
      }>(
        `SELECT slot_no,generation,run_id
           FROM execution_lease
          WHERE run_id IS NULL OR released_at IS NOT NULL OR expires_at <= $1
          ORDER BY slot_no
          FOR UPDATE SKIP LOCKED LIMIT 1`,
        [now],
      );
      const selected = slot.rows[0];
      if (!selected) return { state: "unavailable" as const };
      if (selected.run_id && selected.run_id !== runId) {
        await client.query(
          `UPDATE research_run
              SET state='failed_retryable',state_reason='lease_expired',started_at=NULL
            WHERE run_id=$1 AND state IN ('researching','scoring','cancelling')`,
          [selected.run_id],
        );
      }
      const acquiredSlot = await client.query<{
        slot_no: number;
        generation: number;
      }>(
        `UPDATE execution_lease
            SET run_id=$1,account_id=$2,owner_token_hash=$3,
                generation=generation+1,acquired_at=$5,renewed_at=$5,
                expires_at=$5::timestamptz+($4::int * interval '1 millisecond'),
                released_at=NULL,release_reason=NULL
          WHERE slot_no=$6
          RETURNING slot_no,generation`,
        [
          runId,
          this.options.accountId,
          tokenHash,
          leaseMs,
          now,
          selected.slot_no,
        ],
      );
      const globalLease = acquiredSlot.rows[0];
      if (!globalLease)
        throw new Error("Global live research execution slot was lost.");
      const runUpdated = await client.query(
        `UPDATE research_run
            SET state='researching',started_at=coalesce(started_at,$3)
          WHERE run_id=$1 AND account_id=$2
            AND research_mode='qualified_live_research'
            AND state IN ('queued','failed_retryable','researching')`,
        [runId, this.options.accountId, now],
      );
      if (runUpdated.rowCount !== 1)
        throw new Error("Qualified live research run is not claimable.");

      const reservationGeneration = row ? Number(row.generation) + 1 : 1;
      if (!Number.isSafeInteger(reservationGeneration))
        throw new Error("Live research reservation generation is invalid.");
      if (row) {
        await client.query(
          `UPDATE live_research_execution_reservation
              SET ownership_token_sha256=$4,generation=$5,
                  execution_lease_slot=$6,execution_lease_generation=$7,
                  lease_expires_at=$8::timestamptz+($9::int * interval '1 millisecond'),
                  claimed_at=$8,updated_at=$8
            WHERE execution_id=$1 AND account_id=$2 AND run_id=$3`,
          [
            executionId,
            this.options.accountId,
            runId,
            tokenHash,
            reservationGeneration,
            globalLease.slot_no,
            globalLease.generation,
            now,
            leaseMs,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO live_research_execution_reservation
             (execution_id,account_id,run_id,generation,ownership_token_sha256,state,
              execution_lease_slot,execution_lease_generation,lease_expires_at,claimed_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,'in_progress',$6,$7,
                   $8::timestamptz+($9::int * interval '1 millisecond'),$8,$8)`,
          [
            executionId,
            this.options.accountId,
            runId,
            reservationGeneration,
            tokenHash,
            globalLease.slot_no,
            globalLease.generation,
            now,
            leaseMs,
          ],
        );
      }
      await this.recordReservationEvent(
        client,
        executionId,
        runId,
        row ? "reclaimed_after_expiry" : "claimed",
        tokenHash,
        reservationGeneration,
      );
      return { state: "acquired" as const, generation: reservationGeneration };
    });
    return state.state === "acquired"
      ? ({ ...state, ownershipToken } as const)
      : state.state === "unavailable"
        ? (state as { state: "unavailable" })
        : ({
            state: state.state,
            terminal: this.waitForTerminal(executionId, runId),
          } as const);
  }

  async assertOwnership(
    ownershipToken: string,
    generation: number,
    executionId: string,
    runId: string,
    database: Queryable = this.options.pool,
  ): Promise<void> {
    const owned = await database.query(
      `SELECT 1 FROM live_research_execution_reservation r
         JOIN execution_lease e
           ON e.slot_no=r.execution_lease_slot
          AND e.generation=r.execution_lease_generation
          AND e.run_id=r.run_id AND e.account_id=r.account_id
          AND e.owner_token_hash=r.ownership_token_sha256
        WHERE r.execution_id=$1 AND r.account_id=$2 AND r.run_id=$3
          AND r.generation=$4 AND r.ownership_token_sha256=$5
          AND r.state='in_progress' AND r.lease_expires_at > $6::timestamptz
          AND e.released_at IS NULL AND e.expires_at > $6::timestamptz`,
      [
        executionId,
        this.options.accountId,
        runId,
        generation,
        sha(ownershipToken),
        this.now(),
      ],
    );
    if (owned.rowCount !== 1)
      throw new Error("Live research execution ownership was fenced.");
  }

  async lockOwnership(
    ownershipToken: string,
    generation: number,
    executionId: string,
    runId: string,
    client: Queryable,
  ): Promise<void> {
    const owned = await client.query(
      `SELECT 1 FROM live_research_execution_reservation r
         JOIN execution_lease e
           ON e.slot_no=r.execution_lease_slot
          AND e.generation=r.execution_lease_generation
          AND e.run_id=r.run_id AND e.account_id=r.account_id
          AND e.owner_token_hash=r.ownership_token_sha256
        WHERE r.execution_id=$1 AND r.account_id=$2 AND r.run_id=$3
          AND r.generation=$4 AND r.ownership_token_sha256=$5
          AND r.state='in_progress' AND r.lease_expires_at > $6::timestamptz
          AND e.released_at IS NULL AND e.expires_at > $6::timestamptz
        FOR UPDATE OF r,e`,
      [
        executionId,
        this.options.accountId,
        runId,
        generation,
        sha(ownershipToken),
        this.now(),
      ],
    );
    if (owned.rowCount !== 1)
      throw new Error("Live research persistence ownership was fenced.");
  }

  async renewOwnership(
    ownershipToken: string,
    generation: number,
    executionId: string,
    runId: string,
  ): Promise<void> {
    const now = this.now();
    const tokenHash = sha(ownershipToken);
    await inTransaction(this.options.pool, async (client) => {
      const reservation = await client.query<ReservationRow>(
        `SELECT account_id,run_id,generation,state,lease_expires_at,
                ownership_token_sha256,execution_lease_slot,
                execution_lease_generation,NULL::jsonb terminal_record
           FROM live_research_execution_reservation
          WHERE execution_id=$1 FOR UPDATE`,
        [executionId],
      );
      const row = reservation.rows[0];
      if (
        !row ||
        row.account_id !== this.options.accountId ||
        row.run_id !== runId ||
        String(row.generation) !== String(generation) ||
        row.state !== "in_progress" ||
        row.lease_expires_at <= now ||
        !row.ownership_token_sha256.equals(tokenHash)
      )
        throw new Error("Live research heartbeat lost execution ownership.");
      const global = await client.query(
        `UPDATE execution_lease
            SET renewed_at=$7,
                expires_at=$7::timestamptz+($6::int * interval '1 millisecond')
          WHERE slot_no=$1 AND run_id=$2 AND account_id=$3
            AND generation=$4 AND owner_token_hash=$5
            AND released_at IS NULL AND expires_at > $7
          RETURNING slot_no`,
        [
          Number(row.execution_lease_slot),
          runId,
          this.options.accountId,
          Number(row.execution_lease_generation),
          tokenHash,
          this.leaseMs(),
          now,
        ],
      );
      if (global.rowCount !== 1)
        throw new Error("Live research heartbeat lost its global slot.");
      await client.query(
        `UPDATE live_research_execution_reservation
            SET lease_expires_at=$6::timestamptz+($5::int * interval '1 millisecond'),
                updated_at=$6
          WHERE execution_id=$1 AND account_id=$2 AND run_id=$3
            AND generation=$4`,
        [
          executionId,
          this.options.accountId,
          runId,
          generation,
          this.leaseMs(),
          now,
        ],
      );
    });
  }

  startHeartbeat(
    ownershipToken: string,
    generation: number,
    executionId: string,
    runId: string,
    onOwnershipLost?: (error: Error) => void,
  ): { assertOwned: () => Promise<void>; stop: () => Promise<void> } {
    let stopped = false;
    let inFlight: Promise<void> = Promise.resolve();
    let failure: Error | undefined;
    const beat = () => {
      if (stopped || failure) return;
      inFlight = this.renewOwnership(
        ownershipToken,
        generation,
        executionId,
        runId,
      ).catch((error: unknown) => {
        failure =
          error instanceof Error
            ? error
            : new Error("Live research heartbeat failed.");
        onOwnershipLost?.(failure);
      });
    };
    const timer = setInterval(beat, this.heartbeatMs());
    timer.unref();
    return {
      assertOwned: async () => {
        await inFlight;
        if (failure) throw failure;
        await this.assertOwnership(
          ownershipToken,
          generation,
          executionId,
          runId,
        );
      },
      stop: async () => {
        stopped = true;
        clearInterval(timer);
        await inFlight;
      },
    };
  }

  private async recordReservationEvent(
    client: Queryable,
    executionId: string,
    runId: string,
    eventType: "claimed" | "reclaimed_after_expiry" | "terminal_committed",
    tokenHash: Buffer,
    generation: number,
  ): Promise<void> {
    await client.query(
      `INSERT INTO live_research_execution_reservation_event
         (reservation_event_id,execution_id,account_id,run_id,event_type,
          generation,ownership_token_sha256,recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        randomUUID(),
        executionId,
        this.options.accountId,
        runId,
        eventType,
        generation,
        tokenHash,
        this.now(),
      ],
    );
  }

  async commitTerminal(
    ownershipToken: string,
    generation: number,
    record: LiveResearchTerminalRecord<EvidenceGraphV1>,
    sourceDiscovery?: Readonly<{
      canonicalEnglishRequest: string;
      resultCount: number;
    }>,
  ): Promise<LiveResearchTerminalRecord<EvidenceGraphV1>> {
    const tokenHash = sha(ownershipToken);
    return await inTransaction(this.options.pool, async (client) => {
      const reservation = await client.query<ReservationRow>(
        `SELECT account_id,run_id,generation,state,lease_expires_at,
                lease_expires_at > $2::timestamptz lease_active,
                ownership_token_sha256,execution_lease_slot,
                execution_lease_generation,NULL::jsonb terminal_record
           FROM live_research_execution_reservation
          WHERE execution_id=$1 FOR UPDATE`,
        [record.executionId, this.now()],
      );
      const row = reservation.rows[0];
      if (!row)
        throw new Error("Live research terminal reservation is unavailable.");
      if (
        row.account_id !== this.options.accountId ||
        row.run_id !== record.runId
      )
        throw new Error("Live research terminal ownership scope changed.");
      if (String(row.generation) !== String(generation))
        throw new Error("Live research terminal generation was fenced.");
      if (
        row.state !== "in_progress" ||
        !row.ownership_token_sha256.equals(tokenHash) ||
        !row.lease_active
      )
        throw new Error(
          "Live research terminal commit lacks active ownership.",
        );

      const policy = await client.query<{ policy_version: string }>(
        `SELECT policy_version FROM research_route_policy
          WHERE research_route_policy_id=$1 AND activation_state='qualified'`,
        [this.options.policyId],
      );
      if (!policy.rows[0])
        throw new Error("Qualified route policy is unavailable.");

      let terminalSearchAttemptId: string | null = null;
      let terminalSearchRoute: LiveResearchRouteRecord | null = null;
      for (const routeRecord of record.routes) {
        const snapshot = routeRecord.snapshot;
        if (snapshot.policyVersion !== policy.rows[0].policy_version)
          throw new Error(
            "Route snapshot policy does not match the qualified DB policy.",
          );
        await client.query(
          `INSERT INTO research_route_snapshot
             (research_route_snapshot_id,account_id,run_id,research_route_policy_id,
              snapshot_version,adapter_version,route_id,route_path,requested_provider,
              requested_model,expected_served_provider,expected_served_model,served_provider,
              served_model,terminal_disposition,capability_policy_version,
              parameter_policy_sha256,data_handling_evidence_version,fallback_position,
              qualification_state,captured_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'qualified',$20)`,
          [
            snapshot.snapshotId,
            this.options.accountId,
            record.runId,
            this.options.policyId,
            snapshot.schemaVersion,
            snapshot.adapterVersion,
            snapshot.routeId,
            snapshot.path,
            snapshot.providerId,
            snapshot.requestedModelId,
            snapshot.expectedServedProviderId,
            snapshot.expectedServedModelId,
            snapshot.servedProviderId,
            snapshot.servedModelId,
            snapshot.terminalDisposition,
            snapshot.capabilityPolicyVersion,
            sha(json(snapshot.parameterPolicy)),
            snapshot.dataHandlingEvidenceVersion,
            snapshot.fallbackPosition,
            snapshot.capturedAt,
          ],
        );
        let lastProviderAttemptId = "";
        for (const attempt of routeRecord.attempts) {
          lastProviderAttemptId = await this.persistProviderAttempt(
            client,
            record.runId,
            snapshot,
            attempt,
          );
        }
        if (
          routeRecord.attempts.some(
            (attempt) => attempt.capabilityId === "CAP-SEARCH",
          )
        ) {
          if (
            !sourceDiscovery ||
            !lastProviderAttemptId ||
            routeRecord.attempts.some(
              (attempt) => attempt.capabilityId !== "CAP-SEARCH",
            )
          )
            throw new Error(
              "Source-discovery terminal omitted its exact search lineage.",
            );
          terminalSearchAttemptId = await this.persistSearchAttempt(
            client,
            record.runId,
            lastProviderAttemptId,
            sourceDiscovery.canonicalEnglishRequest,
            routeRecord,
            sourceDiscovery.resultCount,
          );
          terminalSearchRoute = routeRecord;
        }
      }
      const persistedResult =
        record.result === null
          ? null
          : await this.persistEvidenceGraph(
              client,
              record.runId,
              record.result,
            );
      const persistedRecord =
        persistedResult === record.result
          ? record
          : Object.freeze({ ...record, result: persistedResult });

      const totals = await client.query<{
        provider_attempts: number;
        cost_events: number;
        amount: string;
        currencies: string[];
        pricing_versions: string[];
        has_unknown: boolean;
      }>(
        `SELECT count(pa.*)::int provider_attempts,
                count(ce.*)::int cost_events,
                coalesce(sum(ce.amount),0)::text amount,
                coalesce(array_agg(DISTINCT ce.currency_code) FILTER (WHERE ce.currency_code IS NOT NULL),'{}') currencies,
                coalesce(array_agg(DISTINCT ce.pricing_version) FILTER (WHERE ce.pricing_version IS NOT NULL),'{}') pricing_versions,
                coalesce(bool_or(ce.pricing_state IN ('unknown','unpriced')),false) has_unknown
           FROM provider_attempt pa
           LEFT JOIN cost_event ce ON ce.capability_attempt_id=pa.capability_attempt_id
          WHERE pa.account_id=$1 AND pa.run_id=$2`,
        [this.options.accountId, record.runId],
      );
      const total = totals.rows[0]!;
      const unknown =
        total.provider_attempts !== total.cost_events ||
        total.currencies.length > 1 ||
        total.has_unknown;
      const reconciliationState = unknown ? "blocked_unknown" : "closed";
      if (record.disposition === "complete" && reconciliationState !== "closed")
        throw new Error(
          "A complete live result requires closed cost reconciliation.",
        );
      await client.query(
        `INSERT INTO live_cost_reconciliation
           (live_cost_reconciliation_id,account_id,run_id,expected_provider_attempts,
            recorded_provider_attempts,recorded_cost_events,amount,currency_code,
            pricing_version,reconciliation_state,reconciled_at)
         VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,clock_timestamp())`,
        [
          randomUUID(),
          this.options.accountId,
          record.runId,
          total.provider_attempts,
          total.cost_events,
          unknown ? null : Number(total.amount),
          unknown ? null : (total.currencies[0] ?? "USD"),
          unknown
            ? null
            : `pricing-set:${sha(total.pricing_versions.sort().join("\0")).toString("hex").slice(0, 24)}`,
          reconciliationState,
        ],
      );
      const terminalId = randomUUID();
      const serializedResult =
        persistedRecord.result === null ? null : json(persistedRecord.result);
      await client.query(
        `INSERT INTO live_research_terminal
           (live_research_terminal_id,execution_id,account_id,run_id,disposition,
            reason_code,route_count,terminal_record,sanitized_result,result_sha256,completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`,
        [
          terminalId,
          record.executionId,
          this.options.accountId,
          record.runId,
          record.disposition,
          record.reasonCode,
          record.routes.length,
          json(persistedRecord),
          serializedResult,
          serializedResult === null ? null : sha(serializedResult),
          record.completedAt,
        ],
      );
      await client.query(
        `UPDATE live_research_execution_reservation
            SET state='terminal',terminal_id=$4,
                checkpoint_stage=CASE WHEN coalesce($5::uuid,search_attempt_id) IS NULL
                                      THEN 'terminal_no_source' ELSE 'terminal' END,
                source_discovery_record=coalesce($6::jsonb,source_discovery_record),
                search_attempt_id=coalesce($5::uuid,search_attempt_id),
                updated_at=clock_timestamp()
          WHERE execution_id=$1 AND account_id=$2 AND run_id=$3`,
        [
          record.executionId,
          this.options.accountId,
          record.runId,
          terminalId,
          terminalSearchAttemptId,
          terminalSearchRoute
            ? json({ route: terminalSearchRoute, sourceUrls: [] })
            : null,
        ],
      );
      const runState =
        record.disposition === "complete"
          ? "complete"
          : record.disposition === "failed_retryable"
            ? "failed_retryable"
            : record.disposition === "cancelled"
              ? "cancelled"
              : "failed";
      const runUpdated = await client.query(
        `UPDATE research_run
            SET state=$4,state_reason=$5,
                completed_at=CASE WHEN $4 IN ('complete','failed','cancelled')
                                  THEN $6::timestamptz ELSE NULL END,
                cancelled_at=CASE WHEN $4='cancelled' THEN $6::timestamptz ELSE NULL END
          WHERE account_id=$1 AND run_id=$2
            AND research_mode='qualified_live_research'
            AND state IN ('queued','researching','failed_retryable','cancelling')
            AND requested_by_user_id=$3`,
        [
          this.options.accountId,
          record.runId,
          this.options.userId,
          runState,
          record.reasonCode,
          record.completedAt,
        ],
      );
      if (runUpdated.rowCount !== 1)
        throw new Error("Qualified live research run lifecycle was not owned.");
      const released = await client.query(
        `UPDATE execution_lease
            SET released_at=coalesce(released_at,clock_timestamp()),
                release_reason=coalesce(release_reason,'live_research_terminal')
          WHERE slot_no=$1 AND run_id=$2 AND account_id=$3
            AND generation=$4 AND owner_token_hash=$5
          RETURNING slot_no`,
        [
          Number(row.execution_lease_slot),
          record.runId,
          this.options.accountId,
          Number(row.execution_lease_generation),
          tokenHash,
        ],
      );
      if (released.rowCount !== 1)
        throw new Error("Live research global slot release was fenced.");
      await this.recordReservationEvent(
        client,
        record.executionId,
        record.runId,
        "terminal_committed",
        tokenHash,
        generation,
      );
      return persistedRecord;
    });
  }

  private async persistProviderAttempt(
    client: Queryable,
    runId: string,
    snapshot: LiveResearchRouteRecord["snapshot"],
    attempt: ProviderAttemptOutcome,
  ): Promise<string> {
    const route = await client.query<{ provider_route_id: string }>(
      `SELECT r.provider_route_id FROM provider_route r
         JOIN provider_route_capability c
           ON c.provider_route_id=r.provider_route_id AND c.capability=$6
        WHERE r.route_id=$1 AND r.provider=$2 AND r.model_id=$3 AND r.environment=$4
          AND r.route_kind=$5 AND r.enabled
        ORDER BY r.created_at DESC LIMIT 1`,
      [
        attempt.routeId,
        attempt.providerId,
        attempt.modelId,
        attempt.environment,
        attempt.routeKind,
        attempt.capabilityId,
      ],
    );
    if (!route.rows[0])
      throw new Error("Exact enabled provider route is unavailable.");
    const capabilityAttemptId = randomUUID();
    const providerAttemptId = randomUUID();
    await client.query(
      `INSERT INTO capability_attempt
         (capability_attempt_id,run_id,account_id,user_id,capability,provider,
          model_id,environment,provider_route_id,outcome,started_at,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        capabilityAttemptId,
        runId,
        this.options.accountId,
        this.options.userId,
        attempt.capabilityId,
        attempt.providerId,
        attempt.modelId,
        attempt.environment,
        route.rows[0].provider_route_id,
        attempt.outcome,
        attempt.startedAt,
        attempt.completedAt,
      ],
    );
    await client.query(
      `INSERT INTO provider_call
         (provider_call_id,capability_attempt_id,run_id,account_id,user_id,capability,
          provider,model_id,environment,route_id,request_parameters,
          request_identifier_hash,called_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'{}'::jsonb,$11,$12)`,
      [
        randomUUID(),
        capabilityAttemptId,
        runId,
        this.options.accountId,
        this.options.userId,
        attempt.capabilityId,
        attempt.providerId,
        attempt.modelId,
        attempt.environment,
        attempt.routeId,
        sha(`${runId}:${attempt.routeId}:${attempt.attemptNumber}`),
        attempt.startedAt,
      ],
    );
    await client.query(
      `INSERT INTO provider_attempt
         (provider_attempt_id,account_id,run_id,research_route_snapshot_id,
          capability_attempt_id,attempt_number,outcome,requested_provider,
          requested_model,served_provider,served_model,started_at,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        providerAttemptId,
        this.options.accountId,
        runId,
        snapshot.snapshotId,
        capabilityAttemptId,
        attempt.attemptNumber,
        attempt.outcome,
        snapshot.providerId,
        snapshot.requestedModelId,
        attempt.servedProviderId ?? null,
        attempt.servedModelId ?? null,
        attempt.startedAt,
        attempt.completedAt,
      ],
    );
    const unknown = attempt.costState === "unknown";
    const notIncurred = attempt.costState === "not_incurred";
    await client.query(
      `INSERT INTO cost_event
           (cost_event_id,capability_attempt_id,run_id,account_id,user_id,capability,
            provider,model_id,environment,quantity,unit,amount,currency_code,
            pricing_basis,pricing_version,pricing_state,measurement_kind,occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        randomUUID(),
        capabilityAttemptId,
        runId,
        this.options.accountId,
        this.options.userId,
        attempt.capabilityId,
        attempt.providerId,
        attempt.modelId,
        attempt.environment,
        unknown || notIncurred ? 0 : attempt.costQuantity,
        unknown || notIncurred ? "request" : attempt.costUnit,
        unknown ? null : notIncurred ? 0 : attempt.costAmount,
        unknown ? null : notIncurred ? "USD" : attempt.costCurrency,
        unknown
          ? "provider_accounting_missing"
          : notIncurred
            ? "free_contract"
            : "provider_reported",
        unknown
          ? "unknown.v1"
          : notIncurred
            ? "not-incurred.v1"
            : attempt.pricingVersion,
        unknown ? "unknown" : notIncurred ? "explicit_zero" : "priced",
        unknown
          ? "estimated"
          : notIncurred
            ? "measured"
            : attempt.costMeasurement,
        attempt.completedAt,
      ],
    );
    await this.persistRouteHealthObservation(
      client,
      attempt,
      providerAttemptId,
    );
    return providerAttemptId;
  }

  private async persistRouteHealthObservation(
    client: Queryable,
    attempt: ProviderAttemptOutcome,
    providerAttemptId: string,
  ): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${attempt.environment}:${attempt.routeId}`,
    ]);
    const previous = await client.query<{
      consecutive_failures: number;
      circuit_disposition: "closed" | "open" | "half_open";
    }>(
      `SELECT consecutive_failures,circuit_disposition
         FROM research_route_health_observation
        WHERE route_id=$1 AND environment=$2
        ORDER BY observed_at DESC,research_route_health_observation_id DESC
        LIMIT 1 FOR UPDATE`,
      [attempt.routeId, attempt.environment],
    );
    const priorFailures = Number(previous.rows[0]?.consecutive_failures ?? 0);
    const success = attempt.outcome === "ok";
    const cancelled = attempt.outcome === "cancelled";
    const consecutiveFailures = success
      ? 0
      : cancelled
        ? priorFailures
        : priorFailures + 1;
    const observation = success
      ? "success"
      : cancelled
        ? "cancelled"
        : attempt.outcome === "timeout"
          ? "timeout"
          : "transient_failure";
    const circuitDisposition = success
      ? "closed"
      : cancelled
        ? (previous.rows[0]?.circuit_disposition ?? "closed") === "half_open"
          ? "open"
          : (previous.rows[0]?.circuit_disposition ?? "closed")
        : consecutiveFailures >= 3 ||
            previous.rows[0]?.circuit_disposition === "half_open"
          ? "open"
          : "closed";
    await client.query(
      `INSERT INTO research_route_health_observation
         (research_route_health_observation_id,route_id,environment,observation,
          consecutive_failures,circuit_disposition,source_attempt_id,observed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())`,
      [
        randomUUID(),
        attempt.routeId,
        attempt.environment,
        observation,
        consecutiveFailures,
        circuitDisposition,
        providerAttemptId,
      ],
    );
  }

  private async persistSearchAttempt(
    client: Queryable,
    runId: string,
    providerAttemptId: string,
    canonicalEnglishRequest: string,
    routeRecord: LiveResearchRouteRecord,
    resultCount: number,
  ): Promise<string> {
    if (
      routeRecord.attempts.length === 0 ||
      routeRecord.attempts.some(
        (attempt) => attempt.capabilityId !== "CAP-SEARCH",
      ) ||
      !Number.isSafeInteger(resultCount) ||
      resultCount < 0 ||
      resultCount > 10
    )
      throw new Error("Source-discovery search lineage is invalid.");
    const successful =
      routeRecord.failureCode === null &&
      routeRecord.snapshot.terminalDisposition === "ok" &&
      routeRecord.attempts.every(
        (attempt) =>
          attempt.outcome === "ok" && attempt.costState !== "unknown",
      );
    if (successful !== resultCount > 0)
      throw new Error("Source-discovery outcome contradicts its result count.");
    const lastAttempt = routeRecord.attempts.at(-1)!;
    const hasUnknown = routeRecord.attempts.some(
      (attempt) => attempt.costState === "unknown",
    );
    const allNotIncurred = routeRecord.attempts.every(
      (attempt) => attempt.costState === "not_incurred",
    );
    const outcome = successful
      ? "ok"
      : hasUnknown
        ? "blocked"
        : lastAttempt.outcome === "cancelled"
          ? "cancelled"
          : lastAttempt.outcome === "timeout"
            ? "timeout"
            : "provider_error";
    const costState = hasUnknown
      ? "unknown"
      : allNotIncurred
        ? "not_incurred"
        : routeRecord.attempts.some(
              (attempt) => attempt.costState === "estimated",
            )
          ? "estimated"
          : "priced";
    const searchAttemptId = randomUUID();
    await client.query(
      `INSERT INTO search_attempt
         (search_attempt_id,account_id,run_id,provider_attempt_id,
          query_digest_hmac_sha256,search_capability,outcome,result_count,
          cost_state,started_at,completed_at)
       VALUES($1,$2,$3,$4,$5,'provider_native_source_discovery',$6,$7,$8,$9,$10)`,
      [
        searchAttemptId,
        this.options.accountId,
        runId,
        providerAttemptId,
        sha(canonicalEnglishRequest),
        outcome,
        resultCount,
        costState,
        routeRecord.attempts[0]!.startedAt,
        lastAttempt.completedAt,
      ],
    );
    return searchAttemptId;
  }

  async persistSourceDiscovery(
    ownershipToken: string,
    generation: number,
    executionId: string,
    runId: string,
    canonicalEnglishRequest: string,
    routeRecord: LiveResearchRouteRecord,
    resultCount: number,
    sourceUrls: readonly string[],
  ): Promise<string> {
    if (
      routeRecord.failureCode !== null ||
      routeRecord.snapshot.runId !== runId ||
      routeRecord.snapshot.terminalDisposition !== "ok" ||
      routeRecord.attempts.length === 0 ||
      routeRecord.attempts.some(
        (attempt) =>
          attempt.outcome !== "ok" || attempt.costState === "unknown",
      )
    )
      throw new Error(
        "Source discovery did not close its route and cost ledger.",
      );
    return await inTransaction(this.options.pool, async (client) => {
      await this.lockOwnership(
        ownershipToken,
        generation,
        executionId,
        runId,
        client,
      );
      const snapshot = routeRecord.snapshot;
      await client.query(
        `INSERT INTO research_route_snapshot
           (research_route_snapshot_id,account_id,run_id,research_route_policy_id,
            snapshot_version,adapter_version,route_id,route_path,requested_provider,
            requested_model,expected_served_provider,expected_served_model,
            served_provider,served_model,terminal_disposition,capability_policy_version,
            parameter_policy_sha256,data_handling_evidence_version,fallback_position,
            qualification_state,captured_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                $17,$18,$19,'qualified',$20)`,
        [
          snapshot.snapshotId,
          this.options.accountId,
          runId,
          this.options.policyId,
          snapshot.schemaVersion,
          snapshot.adapterVersion,
          snapshot.routeId,
          snapshot.path,
          snapshot.providerId,
          snapshot.requestedModelId,
          snapshot.expectedServedProviderId,
          snapshot.expectedServedModelId,
          snapshot.servedProviderId,
          snapshot.servedModelId,
          snapshot.terminalDisposition,
          snapshot.capabilityPolicyVersion,
          sha(json(snapshot.parameterPolicy)),
          snapshot.dataHandlingEvidenceVersion,
          snapshot.fallbackPosition,
          snapshot.capturedAt,
        ],
      );
      let providerAttemptId = "";
      for (const attempt of routeRecord.attempts) {
        providerAttemptId = await this.persistProviderAttempt(
          client,
          runId,
          snapshot,
          attempt,
        );
      }
      const searchAttemptId = await this.persistSearchAttempt(
        client,
        runId,
        providerAttemptId,
        canonicalEnglishRequest,
        routeRecord,
        resultCount,
      );
      const checkpoint = json({
        route: routeRecord,
        sourceUrls: canonicalSourceUrls(sourceUrls),
      });
      const updated = await client.query(
        `UPDATE live_research_execution_reservation
            SET checkpoint_stage='source_discovered',
                source_discovery_record=$6::jsonb,search_attempt_id=$7,updated_at=$8
          WHERE execution_id=$1 AND account_id=$2 AND run_id=$3
            AND generation=$4 AND ownership_token_sha256=$5
            AND state='in_progress' AND checkpoint_stage='reserved'`,
        [
          executionId,
          this.options.accountId,
          runId,
          generation,
          sha(ownershipToken),
          checkpoint,
          searchAttemptId,
          this.now(),
        ],
      );
      if (updated.rowCount !== 1)
        throw new Error("Source-discovery checkpoint ownership was fenced.");
      await this.assertOwnership(
        ownershipToken,
        generation,
        executionId,
        runId,
        client,
      );
      return searchAttemptId;
    });
  }

  async loadSourceDiscoveryCheckpoint(
    ownershipToken: string,
    generation: number,
    executionId: string,
    runId: string,
  ): Promise<SourceDiscoveryCheckpoint | null> {
    await this.assertOwnership(ownershipToken, generation, executionId, runId);
    const result = await this.options.pool.query<{
      checkpoint_stage: string;
      source_discovery_record: unknown | null;
      search_attempt_id: string | null;
    }>(
      `SELECT checkpoint_stage,source_discovery_record,search_attempt_id
         FROM live_research_execution_reservation
        WHERE execution_id=$1 AND account_id=$2 AND run_id=$3
          AND generation=$4 AND ownership_token_sha256=$5 AND state='in_progress'`,
      [
        executionId,
        this.options.accountId,
        runId,
        generation,
        sha(ownershipToken),
      ],
    );
    const row = result.rows[0];
    if (!row)
      throw new Error("Source-discovery checkpoint ownership was fenced.");
    if (row.checkpoint_stage === "reserved") return null;
    if (
      row.checkpoint_stage !== "source_discovered" ||
      !row.source_discovery_record ||
      !row.search_attempt_id
    )
      throw new Error("Source-discovery checkpoint state is invalid.");
    return validateSourceDiscoveryCheckpoint(
      row.source_discovery_record,
      runId,
      row.search_attempt_id,
    );
  }

  private async persistEvidenceGraph(
    client: Queryable,
    runId: string,
    graph: EvidenceGraphV1,
  ): Promise<EvidenceGraphV1> {
    validateEvidenceGraph(graph);
    if (graph.runId !== runId)
      throw new Error("Live evidence graph belongs to another run.");
    const sources = await client.query<{
      evidence_item_id: string;
      canonical_url: string;
      content_sha256: Buffer;
      bounded_extract: string;
    }>(
      `SELECT p.evidence_item_id,s.canonical_url,s.content_sha256,s.bounded_extract
         FROM live_source_provenance p
         JOIN source_document s
           ON s.account_id=p.account_id AND s.run_id=p.run_id
          AND s.source_document_id=p.source_document_id
        WHERE p.account_id=$1 AND p.run_id=$2 AND p.source_disposition='accepted'`,
      [this.options.accountId, runId],
    );
    const sourceByEvidence = new Map(
      sources.rows.map((source) => [source.evidence_item_id, source]),
    );
    for (const evidence of graph.evidence) {
      const source = sourceByEvidence.get(evidence.evidenceId);
      if (
        evidence.sourceKind !== "external_url" ||
        evidence.verificationDisposition !== "accepted" ||
        !source ||
        source.canonical_url !== evidence.url ||
        source.content_sha256.toString("hex") !== evidence.contentSha256 ||
        source.bounded_extract !== evidence.extract
      )
        throw new Error(
          "Live evidence output is not exactly bound to a fetched source.",
        );
    }
    const identityResolutions = resolveCandidateIdentities({
      accountId: this.options.accountId,
      runId,
      candidates: graph.candidates,
    });
    if (
      identityResolutions.some(
        (resolution) => resolution.reasonCode === "canonical_hash_collision",
      )
    ) {
      throw new Error("Candidate identity hash collision was rejected.");
    }
    const identityByCandidate = new Map(
      identityResolutions.map((resolution) => [
        resolution.candidateId,
        resolution,
      ]),
    );
    const eligible = new Set(
      graph.eligibleCandidateIds.filter(
        (candidateId) =>
          identityByCandidate.get(candidateId)?.disposition === "distinct",
      ),
    );
    const persistedGraph: EvidenceGraphV1 = {
      ...graph,
      eligibleCandidateIds: graph.eligibleCandidateIds.filter((candidateId) =>
        eligible.has(candidateId),
      ),
    };
    const values: EvidenceLineageLedgerV1["values"] = graph.claims.flatMap(
      (claim) =>
        claim.evidenceIds.map((evidenceId) => ({
          valueId: randomUUID(),
          accountId: this.options.accountId,
          runId,
          candidateId: claim.candidateId,
          claimId: claim.claimId,
          evidenceId,
          fieldId: "claim_assertion",
          valueSha256: sha(claim.text).toString("hex"),
        })),
    );
    const candidateById = new Map(
      graph.candidates.map((candidate) => [candidate.candidateId, candidate]),
    );
    const drivers: EvidenceLineageLedgerV1["drivers"] = values.flatMap(
      (value) => {
        const candidate = candidateById.get(value.candidateId);
        if (!candidate)
          throw new Error("Evidence value candidate lineage is unavailable.");
        const dimensions = Object.keys(candidate.dimensionScores).sort();
        return (
          dimensions.length > 0 ? dimensions : ["overall_compatibility"]
        ).map((dimensionId) => ({
          driverId: randomUUID(),
          accountId: this.options.accountId,
          runId,
          candidateId: value.candidateId,
          claimId: value.claimId,
          valueId: value.valueId,
          evidenceId: value.evidenceId,
          dimensionId,
          direction: "supports" as const,
        }));
      },
    );
    const lineageLedger: EvidenceLineageLedgerV1 = {
      schemaVersion: "evidence-lineage-ledger.v1",
      accountId: this.options.accountId,
      runId,
      values,
      drivers,
      identityResolutions,
    };
    validateEvidenceLineageLedger(persistedGraph, lineageLedger);
    for (const [index, candidate] of graph.candidates.entries()) {
      await client.query(
        `INSERT INTO candidate
           (candidate_id,run_id,account_id,canonical_name,country_code,
            deterministic_rank,eligible)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          candidate.candidateId,
          runId,
          this.options.accountId,
          candidate.displayName,
          candidate.countryCode,
          index + 1,
          eligible.has(candidate.candidateId),
        ],
      );
    }
    for (const candidate of graph.candidates) {
      const identity = identityByCandidate.get(candidate.candidateId);
      if (!identity)
        throw new Error("Candidate identity resolution is unavailable.");
      await client.query(
        `INSERT INTO candidate_identity_resolution
           (candidate_identity_resolution_id,account_id,run_id,candidate_id,
             canonical_identity,canonical_identity_sha256,duplicate_of_candidate_id,disposition,
             resolver_version,reason_code,resolved_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp())`,
        [
          randomUUID(),
          this.options.accountId,
          runId,
          candidate.candidateId,
          canonicalizeCandidateIdentity(candidate),
          Buffer.from(identity.canonicalIdentitySha256, "hex"),
          identity.mergedIntoCandidateId,
          identity.disposition,
          identity.resolverVersion,
          identity.reasonCode,
        ],
      );
    }
    for (const claim of graph.claims) {
      await client.query(
        `INSERT INTO claim
           (claim_id,run_id,account_id,candidate_id,assertion_text,
            decision_bearing,verification_status)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          claim.claimId,
          runId,
          this.options.accountId,
          claim.candidateId,
          claim.text,
          claim.decisionBearing,
          claim.verificationStatus,
        ],
      );
      for (const evidenceId of claim.evidenceIds) {
        await client.query(
          `INSERT INTO claim_evidence
             (claim_id,evidence_item_id,account_id,relation,support_locator)
           VALUES($1,$2,$3,'supports',$4::jsonb)`,
          [
            claim.claimId,
            evidenceId,
            this.options.accountId,
            json({ extraction_version: "untrusted-source-boundary.v1" }),
          ],
        );
      }
    }
    for (const value of lineageLedger.values) {
      await client.query(
        `INSERT INTO evidence_value
           (evidence_value_id,account_id,run_id,candidate_id,claim_id,
            evidence_item_id,field_id,value_sha256,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp())`,
        [
          value.valueId,
          value.accountId,
          value.runId,
          value.candidateId,
          value.claimId,
          value.evidenceId,
          value.fieldId,
          Buffer.from(value.valueSha256, "hex"),
        ],
      );
    }
    for (const driver of lineageLedger.drivers) {
      await client.query(
        `INSERT INTO evidence_driver
           (evidence_driver_id,account_id,run_id,candidate_id,claim_id,
            evidence_value_id,evidence_item_id,dimension_id,direction,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp())`,
        [
          driver.driverId,
          driver.accountId,
          driver.runId,
          driver.candidateId,
          driver.claimId,
          driver.valueId,
          driver.evidenceId,
          driver.dimensionId,
          driver.direction,
        ],
      );
    }
    const serialized = json(persistedGraph);
    const outcome = eligible.size > 0 ? "candidates" : "no_responsible_match";
    await client.query(
      `INSERT INTO run_result
         (run_id,account_id,outcome,eligible_count,considered_count,scarcity,
          limitations_text,complete_result_document,result_sha256,assembled_at)
       VALUES($1,$2,$3,$4,$5,NULL,$6,$7::jsonb,$8,clock_timestamp())`,
      [
        runId,
        this.options.accountId,
        outcome,
        eligible.size,
        persistedGraph.candidates.length,
        "Unsupported claims are withheld; live evidence remains source-bound.",
        serialized,
        sha(serialized),
      ],
    );
    for (const [index, candidate] of graph.candidates.entries()) {
      await client.query(
        `INSERT INTO result_candidate
           (run_id,candidate_id,account_id,rank,eligible,rationale_short,
            exclusion_reason_code)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          runId,
          candidate.candidateId,
          this.options.accountId,
          index + 1,
          eligible.has(candidate.candidateId),
          candidate.rationaleShort,
          eligible.has(candidate.candidateId)
            ? null
            : identityByCandidate.get(candidate.candidateId)?.disposition ===
                "duplicate"
              ? "duplicate_identity"
              : identityByCandidate.get(candidate.candidateId)?.disposition ===
                  "rejected_ambiguous"
                ? "ambiguous_identity"
                : "not_eligible",
        ],
      );
    }
    return persistedGraph;
  }
}

export class LiveResearchExecutionService {
  constructor(
    private readonly options: {
      pool: ConnectionPool;
      accountId: string;
      userId: string;
      policyId: string;
      resolver: DnsResolver;
      accessEvaluator: SourceAccessEvaluator;
      fetchTransport: PinnedFetchTransport;
      sourceDiscovery: ServerOwnedSourceDiscovery;
      providerTransports: Readonly<{
        gemini_direct: ProviderTransport;
        openrouter: ProviderTransport;
      }>;
      circuit: LiveResearchCircuitPolicy;
      validateOutput: (body: unknown) => EvidenceGraphV1;
      backoff?: Backoff;
      phaseObserver?: (
        phase:
          "source_discovered" | "fetch_persistence_locked" | "source_persisted",
        detail?: string,
      ) => void | Promise<void>;
      ledgerTiming?: Readonly<{
        leaseMs: number;
        heartbeatMs: number;
        pollMs?: number;
        waitMs?: number;
        now?: () => Date;
      }>;
    },
  ) {}

  async execute(input: {
    policy: ResearchRoutePolicyV1;
    executionId: string;
    runId: string;
    capturedAt: string;
    outputSchema: Readonly<Record<string, unknown>>;
    signal: AbortSignal;
  }): Promise<LiveResearchTerminalRecord<EvidenceGraphV1>> {
    const canonical = await this.options.pool.query<{ canonical_text: string }>(
      `SELECT v.canonical_document->>'canonical_text' canonical_text
         FROM research_run r
         JOIN canonical_request_version v
           ON v.account_id=r.account_id
          AND v.canonical_request_version_id=r.canonical_request_version_id
        WHERE r.account_id=$1 AND r.run_id=$2 AND v.match_readiness <> 'not_ready'
          AND EXISTS (SELECT 1 FROM canonical_confirmation c
                       WHERE c.canonical_request_version_id=v.canonical_request_version_id
                         AND c.accepted)`,
      [this.options.accountId, input.runId],
    );
    const canonicalEnglishRequest = canonical.rows[0]?.canonical_text;
    if (!canonicalEnglishRequest)
      throw new Error(
        "Confirmed canonical English research input is unavailable.",
      );
    const ledger = new PostgresLiveResearchAtomicLedger({
      pool: this.options.pool,
      accountId: this.options.accountId,
      userId: this.options.userId,
      policyId: this.options.policyId,
      ...this.options.ledgerTiming,
    });
    const reservation = await ledger.reserveExecution(
      input.executionId,
      input.runId,
    );
    if (reservation.state === "unavailable")
      throw new LiveResearchCapacityUnavailable(
        "Global live research execution capacity is unavailable.",
      );
    if (reservation.state === "existing") return await reservation.terminal;
    const ownershipToken = reservation.ownershipToken;
    const generation = reservation.generation;
    const operationController = new AbortController();
    const abortOperation = () => operationController.abort(input.signal.reason);
    if (input.signal.aborted) abortOperation();
    else input.signal.addEventListener("abort", abortOperation, { once: true });
    const heartbeat = ledger.startHeartbeat(
      ownershipToken,
      generation,
      input.executionId,
      input.runId,
      (error) => operationController.abort(error),
    );
    try {
      await heartbeat.assertOwned();
      const existingDiscovery = await ledger.loadSourceDiscoveryCheckpoint(
        ownershipToken,
        generation,
        input.executionId,
        input.runId,
      );
      let sourceUrls: readonly string[];
      let searchAttemptId: string;
      if (existingDiscovery) {
        sourceUrls = existingDiscovery.sourceUrls;
        searchAttemptId = existingDiscovery.searchAttemptId;
      } else {
        const sourceRouteDefinition = input.policy.routes
          .filter((route) => route.enabled && route.path === "gemini_direct")
          .sort(
            (left, right) => left.fallbackPosition - right.fallbackPosition,
          )[0];
        if (!sourceRouteDefinition)
          throw new Error(
            "Qualified direct source-discovery route is unavailable.",
          );
        const sourceRoute = resolveActiveResearchRoute(
          input.policy,
          sourceRouteDefinition.routeId,
          input.capturedAt,
        );
        const sourceCircuitAdmission =
          await this.options.circuit.isRouteAvailable(
            sourceRoute.routeId,
            input.capturedAt,
          );
        if (!sourceCircuitAdmission) {
          const circuitOpenRoute: LiveResearchRouteRecord = {
            snapshot: createResearchRouteSnapshot({
              policy: input.policy,
              route: sourceRoute,
              snapshotId: `${input.executionId}:SOURCE-DISCOVERY:${sourceRoute.routeId}`,
              runId: input.runId,
              servedProviderId: null,
              servedModelId: null,
              terminalDisposition: "failed",
              capturedAt: input.capturedAt,
            }),
            attempts: [],
            failureCode: "source_discovery_circuit_open",
          };
          await ledger.commitTerminal(ownershipToken, generation, {
            schemaVersion: "live-research-terminal.v1",
            executionId: input.executionId,
            runId: input.runId,
            disposition: "failed_retryable",
            reasonCode: "source_discovery_circuit_open",
            routes: [circuitOpenRoute],
            result: null,
            completedAt: new Date().toISOString(),
          });
          throw new Error("Source-discovery circuit is open.");
        }
        const sourceCircuitProbe =
          typeof sourceCircuitAdmission === "object"
            ? sourceCircuitAdmission
            : undefined;
        const sourceSignal = sourceCircuitProbe
          ? AbortSignal.any([
              operationController.signal,
              sourceCircuitProbe.signal,
            ])
          : operationController.signal;
        let discovery: Awaited<
          ReturnType<ServerOwnedSourceDiscovery["discover"]>
        >;
        try {
          await sourceCircuitProbe?.assertOwnership();
          discovery = await this.options.sourceDiscovery.discover({
            policy: input.policy,
            executionId: input.executionId,
            runId: input.runId,
            capturedAt: input.capturedAt,
            canonicalEnglishRequest,
            signal: sourceSignal,
            assertOwnership: heartbeat.assertOwned,
          });
          await sourceCircuitProbe?.assertOwnership();
        } catch (error) {
          const failedRoute =
            error instanceof SourceDiscoveryFailure ? [error.route] : [];
          await ledger.commitTerminal(
            ownershipToken,
            generation,
            {
              schemaVersion: "live-research-terminal.v1",
              executionId: input.executionId,
              runId: input.runId,
              disposition: operationController.signal.aborted
                ? "cancelled"
                : "failed_retryable",
              reasonCode: operationController.signal.aborted
                ? "cancelled"
                : "source_discovery_failed",
              routes: failedRoute,
              result: null,
              completedAt: new Date().toISOString(),
            },
            failedRoute.length === 0
              ? undefined
              : { canonicalEnglishRequest, resultCount: 0 },
          );
          throw error;
        } finally {
          sourceCircuitProbe?.close();
        }
        try {
          sourceUrls = canonicalSourceUrls(discovery.sourceUrls);
        } catch (error) {
          const failedRoute: LiveResearchRouteRecord = {
            snapshot: {
              ...discovery.route.snapshot,
              servedProviderId: null,
              servedModelId: null,
              terminalDisposition: "failed",
            },
            attempts: discovery.route.attempts,
            failureCode: "source_discovery_invalid",
          };
          await ledger.commitTerminal(
            ownershipToken,
            generation,
            {
              schemaVersion: "live-research-terminal.v1",
              executionId: input.executionId,
              runId: input.runId,
              disposition: "failed_retryable",
              reasonCode: "source_discovery_invalid",
              routes: [failedRoute],
              result: null,
              completedAt: new Date().toISOString(),
            },
            { canonicalEnglishRequest, resultCount: 0 },
          );
          throw error;
        }
        await heartbeat.assertOwned();
        searchAttemptId = await ledger.persistSourceDiscovery(
          ownershipToken,
          generation,
          input.executionId,
          input.runId,
          canonicalEnglishRequest,
          discovery.route,
          sourceUrls.length,
          sourceUrls,
        );
        await this.options.phaseObserver?.("source_discovered");
      }
      const fetchInput = {
        runId: input.runId,
        searchAttemptId,
        capturedAt: input.capturedAt,
      };
      const sanitizedEvidence: SanitizedResearchEvidence[] = [];
      try {
        for (const url of sourceUrls) {
          await heartbeat.assertOwned();
          const checkpoint = await this.loadPersistedSource(
            input.runId,
            searchAttemptId,
            url,
            ledger,
            ownershipToken,
            generation,
            input.executionId,
          );
          if (checkpoint.disposition === "denied")
            throw new Error("A checkpointed secure fetch was denied.");
          if (checkpoint.disposition === "accepted") {
            sanitizedEvidence.push(checkpoint.evidence);
            continue;
          }
          let fetched: SecureFetchResult;
          try {
            fetched = await secureFetch({
              url,
              resolver: this.options.resolver,
              accessEvaluator: this.options.accessEvaluator,
              transport: this.options.fetchTransport,
              signal: operationController.signal,
            });
          } catch (error) {
            if (error instanceof SecureFetchDenied)
              await this.persistFetchAttempts(
                { ...fetchInput, sourceRequestUrl: url },
                error.attempts,
                null,
                ledger,
                ownershipToken,
                generation,
                input.executionId,
              );
            throw error;
          }
          const persistedSource = await this.persistFetchAttempts(
            { ...fetchInput, sourceRequestUrl: url },
            fetched.attempts,
            fetched,
            ledger,
            ownershipToken,
            generation,
            input.executionId,
          );
          const sealed = sealUntrustedSource(fetched.body);
          const excerpt = sealed.normalizedText.slice(0, 4000).trim();
          if (!excerpt)
            throw new Error("Fetched evidence produced no safe excerpt.");
          sanitizedEvidence.push({
            sourceId: persistedSource.evidenceItemId,
            canonicalUrl: fetched.canonicalUrl,
            contentSha256: fetched.contentSha256.toLowerCase(),
            excerpt,
          });
          await this.options.phaseObserver?.("source_persisted", url);
        }
      } catch (error) {
        if (error instanceof LiveResearchProcessInterrupted) throw error;
        await ledger.commitTerminal(ownershipToken, generation, {
          schemaVersion: "live-research-terminal.v1",
          executionId: input.executionId,
          runId: input.runId,
          disposition: operationController.signal.aborted
            ? "cancelled"
            : "failed",
          reasonCode: operationController.signal.aborted
            ? "cancelled"
            : "secure_fetch_failed",
          routes: [],
          result: null,
          completedAt: new Date().toISOString(),
        });
        throw error;
      }
      const fencedTransport = (
        transport: ProviderTransport,
      ): ProviderTransport => ({
        send: async (request) => {
          await heartbeat.assertOwned();
          return await transport.send(request);
        },
      });
      return await executeQualifiedResearch({
        policy: input.policy,
        executionId: input.executionId,
        runId: input.runId,
        capturedAt: input.capturedAt,
        request: {
          canonicalLanguage: "en",
          canonicalEnglishRequest,
          sanitizedEvidence,
          outputSchema: input.outputSchema,
        },
        transports: {
          gemini_direct: fencedTransport(
            this.options.providerTransports.gemini_direct,
          ),
          openrouter: fencedTransport(
            this.options.providerTransports.openrouter,
          ),
        },
        ledger: {
          reserveExecution: async (executionId, runId) => {
            if (executionId !== input.executionId || runId !== input.runId)
              throw new Error("Pre-reserved execution identity changed.");
            await heartbeat.assertOwned();
            return { state: "acquired" as const, ownershipToken };
          },
          commitTerminal: async (token, record) =>
            await ledger.commitTerminal(token, generation, record),
        },
        circuit: {
          isRouteAvailable: async (routeId, at) => {
            await heartbeat.assertOwned();
            return await this.options.circuit.isRouteAvailable(routeId, at);
          },
        },
        validateOutput: (body) => {
          const graph = this.options.validateOutput(body);
          validateEvidenceGraph(graph);
          if (graph.runId !== input.runId)
            throw new Error("Live evidence graph belongs to another run.");
          const sourceById = new Map(
            sanitizedEvidence.map((source) => [source.sourceId, source]),
          );
          if (
            graph.evidence.some((evidence) => {
              const source = sourceById.get(evidence.evidenceId);
              return (
                evidence.sourceKind !== "external_url" ||
                evidence.verificationDisposition !== "accepted" ||
                !source ||
                evidence.url !== source.canonicalUrl ||
                evidence.contentSha256 !== source.contentSha256 ||
                evidence.extract !== source.excerpt
              );
            })
          )
            throw new Error(
              "Live evidence graph is not exactly bound to sanitized sources.",
            );
          return graph;
        },
        signal: operationController.signal,
        ...(this.options.backoff ? { backoff: this.options.backoff } : {}),
      });
    } finally {
      input.signal.removeEventListener("abort", abortOperation);
      operationController.abort();
      await heartbeat.stop();
    }
  }

  private async persistFetchAttempts(
    input: {
      runId: string;
      searchAttemptId: string;
      sourceRequestUrl: string;
      capturedAt: string;
    },
    attempts: SecureFetchResult["attempts"],
    fetched: SecureFetchResult | null,
    ledger: PostgresLiveResearchAtomicLedger,
    ownershipToken: string,
    generation: number,
    executionId: string,
  ): Promise<{ sourceDocumentId: string; evidenceItemId: string }> {
    return await inTransaction(this.options.pool, async (client) => {
      await ledger.lockOwnership(
        ownershipToken,
        generation,
        executionId,
        input.runId,
        client,
      );
      await this.options.phaseObserver?.(
        "fetch_persistence_locked",
        input.sourceRequestUrl,
      );
      let acceptedFetchAttemptId: string | null = null;
      for (const [index, attempt] of attempts.entries()) {
        const fetchAttemptId = randomUUID();
        const finalAccepted =
          fetched !== null &&
          index === attempts.length - 1 &&
          attempt.decision === "accepted";
        await client.query(
          `INSERT INTO fetch_attempt
             (fetch_attempt_id,account_id,run_id,search_attempt_id,policy_version,
              source_request_url,canonical_url,publisher_domain,resolved_address_hashes,redirect_hop,
              decision,reason_code,http_status,content_type,compressed_bytes,
              decompressed_bytes,content_sha256,robots_disposition,started_at,completed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)`,
          [
            fetchAttemptId,
            this.options.accountId,
            input.runId,
            input.searchAttemptId,
            attempt.policyVersion,
            input.sourceRequestUrl,
            attempt.canonicalUrl,
            attempt.hostname,
            json(
              attempt.resolvedAddresses.map((address) =>
                sha(address).toString("hex"),
              ),
            ),
            attempt.redirectHop,
            attempt.decision,
            attempt.reason,
            attempt.status,
            finalAccepted ? fetched.contentType : null,
            attempt.compressedBytes,
            attempt.decompressedBytes,
            finalAccepted ? Buffer.from(fetched.contentSha256, "hex") : null,
            attempt.robotsDisposition,
            input.capturedAt,
          ],
        );
        if (finalAccepted) acceptedFetchAttemptId = fetchAttemptId;
      }
      if (!fetched) {
        await ledger.assertOwnership(
          ownershipToken,
          generation,
          executionId,
          input.runId,
          client,
        );
        return { sourceDocumentId: "", evidenceItemId: "" };
      }
      if (!acceptedFetchAttemptId)
        throw new Error("Secure fetch omitted a final accepted attempt.");
      const sealed = sealUntrustedSource(fetched.body);
      const excerpt = sealed.normalizedText.slice(0, 4000).trim();
      const sourceDocumentId = randomUUID();
      const evidenceItemId = randomUUID();
      await client.query(
        `INSERT INTO source_document
           (source_document_id,account_id,run_id,fetch_attempt_id,canonical_url,
            normalized_domain,content_type,content_sha256,bounded_extract,
            bounded_extract_sha256,extraction_version,active_content_removed,
            untrusted_data_only,retrieved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'untrusted-source-boundary.v1',true,true,$11)`,
        [
          sourceDocumentId,
          this.options.accountId,
          input.runId,
          acceptedFetchAttemptId,
          fetched.canonicalUrl,
          fetched.publisherDomain,
          fetched.contentType,
          Buffer.from(fetched.contentSha256, "hex"),
          excerpt,
          sha(excerpt),
          input.capturedAt,
        ],
      );
      await client.query(
        `INSERT INTO evidence_item
           (evidence_item_id,run_id,account_id,source_kind,url,title,publisher_domain,
            retrieved_at,content_sha256,verification_disposition)
         VALUES ($1,$2,$3,'external_url',$4,$5,$6,$7,$8,'verified')`,
        [
          evidenceItemId,
          input.runId,
          this.options.accountId,
          fetched.canonicalUrl,
          fetched.publisherDomain,
          fetched.publisherDomain,
          input.capturedAt,
          Buffer.from(fetched.contentSha256, "hex"),
        ],
      );
      await client.query(
        `INSERT INTO live_source_provenance
           (live_source_provenance_id,account_id,run_id,evidence_item_id,
            fetch_attempt_id,source_document_id,canonical_url,normalized_domain,
            extraction_method,extraction_version,bounded_excerpt_sha256,
            source_disposition,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'deterministic_text_boundary',
                 'untrusted-source-boundary.v1',$9,'accepted',$10)`,
        [
          randomUUID(),
          this.options.accountId,
          input.runId,
          evidenceItemId,
          acceptedFetchAttemptId,
          sourceDocumentId,
          fetched.canonicalUrl,
          fetched.publisherDomain,
          sha(excerpt),
          input.capturedAt,
        ],
      );
      await ledger.assertOwnership(
        ownershipToken,
        generation,
        executionId,
        input.runId,
        client,
      );
      return { sourceDocumentId, evidenceItemId };
    });
  }

  private async loadPersistedSource(
    runId: string,
    searchAttemptId: string,
    canonicalUrl: string,
    ledger: PostgresLiveResearchAtomicLedger,
    ownershipToken: string,
    generation: number,
    executionId: string,
  ): Promise<
    | { disposition: "none" }
    | { disposition: "denied" }
    | { disposition: "accepted"; evidence: SanitizedResearchEvidence }
  > {
    return await inTransaction(this.options.pool, async (client) => {
      await ledger.assertOwnership(
        ownershipToken,
        generation,
        executionId,
        runId,
        client,
      );
      const accepted = await client.query<{
        evidence_item_id: string;
        canonical_url: string;
        content_sha256: Buffer;
        bounded_extract: string;
      }>(
        `SELECT p.evidence_item_id,s.canonical_url,s.content_sha256,s.bounded_extract
           FROM fetch_attempt f
           JOIN source_document s
             ON s.account_id=f.account_id AND s.run_id=f.run_id
            AND s.fetch_attempt_id=f.fetch_attempt_id
           JOIN live_source_provenance p
             ON p.account_id=s.account_id AND p.run_id=s.run_id
            AND p.source_document_id=s.source_document_id
          WHERE f.account_id=$1 AND f.run_id=$2 AND f.search_attempt_id=$3
            AND f.source_request_url=$4 AND f.decision='accepted'
            AND p.source_disposition='accepted'
          ORDER BY f.redirect_hop DESC LIMIT 1`,
        [this.options.accountId, runId, searchAttemptId, canonicalUrl],
      );
      const source = accepted.rows[0];
      if (source)
        return {
          disposition: "accepted" as const,
          evidence: Object.freeze({
            sourceId: source.evidence_item_id,
            canonicalUrl: source.canonical_url,
            contentSha256: source.content_sha256.toString("hex"),
            excerpt: source.bounded_extract,
          }),
        };
      const denied = await client.query(
        `SELECT 1 FROM fetch_attempt
          WHERE account_id=$1 AND run_id=$2 AND search_attempt_id=$3
            AND source_request_url=$4 AND decision='denied' LIMIT 1`,
        [this.options.accountId, runId, searchAttemptId, canonicalUrl],
      );
      return denied.rowCount === 1
        ? { disposition: "denied" as const }
        : { disposition: "none" as const };
    });
  }
}
