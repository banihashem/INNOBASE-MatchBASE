import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  buildSyntheticEvidenceGraph,
  projectDemoResult,
  runCanonicalizationWithinBudget,
  type CanonicalizationCapability,
  type CapabilityInvocationTelemetry,
} from "@matchbase/ai-evidence";
import type {
  CanonicalFieldV1,
  CanonicalRequestV1,
  EvidenceGraphV1,
} from "@matchbase/contracts";
import {
  acquireExecutionLease,
  admitRunWithinQuota,
  appendAuditEvent,
  inTransaction,
  releaseExecutionLease,
  ROLLING_QUOTA_LIMITS,
  type ConnectionPool,
  type TransactionClient,
} from "@matchbase/data";
import {
  ApplicationFault,
  TERMINAL_RUN_STATES,
  type CanonicalRevisionInput,
  type IntakeInput,
  type RequestContext,
  type ResultDisclosure,
  type RunStatus,
} from "./types.js";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function macroParameter(path: string): string {
  if (path.startsWith("supplier") || path.startsWith("producer")) {
    return "supplier_producer_profile";
  }
  if (path.startsWith("trade") || path.startsWith("commercial")) {
    return "trade_structure_commercial_execution";
  }
  return "product_specification";
}

function contradictionIds(fields: readonly CanonicalFieldV1[]): string[] {
  const valuesByPath = new Map<string, Set<string>>();
  for (const field of fields) {
    if (field.valueState !== "provided") continue;
    const comparisonPath = field.path.replace(
      /\.(?:alternative|conflict)$/u,
      "",
    );
    const values = valuesByPath.get(comparisonPath) ?? new Set<string>();
    values.add(field.canonicalValue.trim().toLocaleLowerCase("en"));
    valuesByPath.set(comparisonPath, values);
  }
  return [...valuesByPath.entries()]
    .filter(([, values]) => values.size > 1)
    .map(
      ([path]) =>
        `CON-${createHash("sha256").update(path).digest("hex").slice(0, 12)}`,
    )
    .sort();
}

function isEnglishCanonical(value: string): boolean {
  if (!value.trim() || !/[A-Za-z]/u.test(value)) return false;
  for (const character of value) {
    if (/\p{Letter}/u.test(character) && !/\p{Script=Latin}/u.test(character))
      return false;
  }
  return true;
}

interface ServiceOptions {
  pool: ConnectionPool;
  canonicalizer: CanonicalizationCapability;
  privacyKey: Uint8Array;
  canonicalizationBudgetMs?: number;
}

export class MatchBaseApplication {
  readonly pool: ConnectionPool;
  private readonly canonicalizer: CanonicalizationCapability;
  private readonly canonicalizationBudgetMs: number;
  private readonly privacyKey: Buffer;

  constructor(options: ServiceOptions) {
    this.pool = options.pool;
    this.canonicalizer = options.canonicalizer;
    if (options.privacyKey.byteLength < 32)
      throw new Error(
        "Application privacy key must contain at least 32 bytes.",
      );
    this.privacyKey = Buffer.from(options.privacyKey);
    this.canonicalizationBudgetMs = options.canonicalizationBudgetMs ?? 20_000;
  }

  async readiness(): Promise<boolean> {
    try {
      const result = await this.pool.query<{ ready: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM matchbase_schema_migration
            WHERE migration_id = '0001_slice_1_foundation'
         ) AS ready`,
      );
      return result.rows[0]?.ready === true;
    } catch {
      return false;
    }
  }

  async me(context: RequestContext): Promise<Record<string, unknown>> {
    const limit =
      context.tier === "admin" ? null : ROLLING_QUOTA_LIMITS[context.tier];
    const quota = await this.pool.query<{
      used: number;
      next_capacity_at: Date | null;
    }>(
      `SELECT count(*)::int AS used,
              min(q.charged_at + interval '168 hours') AS next_capacity_at
         FROM quota_ledger q
        WHERE q.account_id = $1
          AND q.entry_kind = 'charge'
          AND q.charged_at > clock_timestamp() - interval '168 hours'
          AND NOT EXISTS (
            SELECT 1 FROM quota_ledger c WHERE c.compensates_entry_id = q.quota_entry_id
          )`,
      [context.accountId],
    );
    const used = quota.rows[0]?.used ?? 0;
    const identity = await this.pool.query<{ display_name: string }>(
      "SELECT display_name FROM account WHERE account_id = $1",
      [context.accountId],
    );
    const execution = await this.pool.query<{ active: number }>(
      `SELECT count(*)::int AS active FROM execution_lease
        WHERE run_id IS NOT NULL AND expires_at > clock_timestamp()`,
    );
    return {
      display_name: identity.rows[0]?.display_name ?? "Demo account",
      subject: { user_id: context.userId, account_id: context.accountId },
      tier: context.tier,
      admin_sub_roles: [...context.adminSubRoles],
      quota: {
        limit,
        used,
        remaining: limit === null ? null : Math.max(0, limit - used),
        next_capacity_at: asIso(quota.rows[0]?.next_capacity_at ?? null),
        window_hours: 168,
      },
      execution: {
        active: execution.rows[0]?.active ?? 0,
        capacity: 3,
      },
    };
  }

  async createRequest(
    context: RequestContext,
    idempotencyKey: string,
    input: IntakeInput,
  ): Promise<Record<string, unknown>> {
    if (context.tier === "admin") {
      throw new ApplicationFault(
        403,
        "tier-not-entitled",
        "MB-403-TIER",
        "Not entitled.",
      );
    }
    const keyHash = sha256(idempotencyKey);
    const requestHash = createHmac("sha256", this.privacyKey)
      .update(JSON.stringify(input), "utf8")
      .digest();
    const prior = await this.readIdempotency(
      context,
      "/api/v1/requests",
      keyHash,
      requestHash,
    );
    if (prior) return prior;

    const requestId = randomUUID();
    const canonicalizationRunId = randomUUID();
    await inTransaction(this.pool, (client) =>
      client.query(
        `INSERT INTO canonicalization_execution_run
           (canonicalization_run_id, account_id, user_id, subject_request_id,
            request_correlation_id, started_at)
         VALUES ($1,$2,$3,$4,$5,clock_timestamp())`,
        [
          canonicalizationRunId,
          context.accountId,
          context.userId,
          requestId,
          context.correlationId,
        ],
      ),
    );
    const emittedTelemetry: CapabilityInvocationTelemetry[] = [];
    const telemetry = {
      record: async (event: CapabilityInvocationTelemetry) => {
        await inTransaction(this.pool, (client) =>
          this.persistCapabilityTelemetry(
            client,
            context,
            canonicalizationRunId,
            event,
          ),
        );
        emittedTelemetry.push(event);
      },
    };
    let canonical: CanonicalRequestV1;
    try {
      canonical = await runCanonicalizationWithinBudget(
        this.canonicalizer,
        {
          requestId,
          sourceText: input.sourceText,
          fixtureCanonicalText: input.fixtureCanonicalText,
          fixtureCanonicalFields: input.fixtureCanonicalFields,
          presentedFields: input.presentedFields,
        },
        telemetry,
        this.canonicalizationBudgetMs,
      );
      this.assertCanonicalProvenanceMatchesTelemetry(
        canonical,
        emittedTelemetry,
      );
    } catch {
      throw new ApplicationFault(
        503,
        "canonicalisation-unavailable",
        "MB-503-CANON",
        "Canonicalisation is temporarily unavailable.",
        true,
        { "Retry-After": "5" },
      );
    }
    return inTransaction(this.pool, async (client) => {
      await client.query(
        "SELECT 1 FROM account WHERE account_id = $1 FOR UPDATE",
        [context.accountId],
      );
      const raced = await this.readIdempotency(
        context,
        "/api/v1/requests",
        keyHash,
        requestHash,
        client,
      );
      if (raced) return raced;
      const canonicalVersionId = randomUUID();
      await this.persistCanonicalVersion(client, context, {
        requestId,
        canonicalVersionId,
        version: 1,
        canonical,
        parentVersionId: null,
        canonicalizationRunId,
      });
      const response = this.canonicalResponse(
        requestId,
        canonicalVersionId,
        canonical,
      );
      await client.query(
        `INSERT INTO idempotency_record
           (idempotency_record_id, account_id, subject_user_id, route, key_hash, request_hash,
            response_status, response_body, result_resource_id, created_at, expires_at)
         VALUES ($1,$2,$3,'/api/v1/requests',$4,$5,201,$6::jsonb,$7,clock_timestamp(),
                 clock_timestamp() + interval '24 hours')`,
        [
          randomUUID(),
          context.accountId,
          context.userId,
          keyHash,
          requestHash,
          JSON.stringify(response),
          requestId,
        ],
      );
      await appendAuditEvent(client, {
        accountId: context.accountId,
        actorUserId: context.userId,
        actorTier: context.tier,
        eventType: "request.canonicalised",
        resourceKind: "sourcing_request",
        resourceId: requestId,
        outcome: "allow",
        correlationId: context.correlationId,
        deploymentId: context.deploymentId,
        detail: {
          canonicalVersion: 1,
          sourceLanguageTag: canonical.language.bcp47,
        },
      });
      return response;
    });
  }

  async getRequest(
    context: RequestContext,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    const result = await this.pool.query<{
      request_id: string;
      current_version: number;
      lifecycle_state: string;
      canonical_request_version_id: string;
      canonical_document: Record<string, unknown>;
      match_readiness: string;
      source_language_tag: string;
      source_language_confidence: string;
      accepted: boolean | null;
    }>(
      `SELECT r.request_id, r.current_version, r.lifecycle_state,
              v.canonical_request_version_id, v.canonical_document, v.match_readiness,
              l.source_language_tag, l.source_language_confidence::text,
              (SELECT c.accepted FROM canonical_confirmation c
                WHERE c.canonical_request_version_id = v.canonical_request_version_id
                ORDER BY c.confirmed_at DESC LIMIT 1) AS accepted
         FROM sourcing_request r
         JOIN canonical_request_version v ON v.request_id = r.request_id AND v.version = r.current_version
         JOIN canonical_language_record l USING (canonical_request_version_id)
        WHERE r.request_id = $1 AND r.account_id = $2 AND r.created_by_user_id = $3`,
      [requestId, context.accountId, context.userId],
    );
    const row = result.rows[0];
    if (!row) throw this.notVisible();
    return {
      request_id: row.request_id,
      current_version: row.current_version,
      lifecycle_state: row.lifecycle_state,
      canonical_version_id: row.canonical_request_version_id,
      canonical: row.canonical_document,
      match_readiness: row.match_readiness,
      source_language_tag: row.source_language_tag,
      source_language_confidence: Number(row.source_language_confidence),
      confirmed: row.accepted === true,
    };
  }

  async assertRequestVisible(
    context: RequestContext,
    requestId: string,
  ): Promise<void> {
    const visible = await this.pool.query(
      `SELECT 1
         FROM sourcing_request
        WHERE request_id = $1 AND account_id = $2 AND created_by_user_id = $3`,
      [requestId, context.accountId, context.userId],
    );
    if (visible.rowCount !== 1) throw this.notVisible();
  }

  async createVersion(
    context: RequestContext,
    requestId: string,
    input: CanonicalRevisionInput,
  ): Promise<Record<string, unknown>> {
    if (
      !isEnglishCanonical(input.canonicalText) ||
      input.fields.some(
        (field) =>
          field.canonicalValue.length > 2_000 ||
          !isEnglishCanonical(field.canonicalValue),
      )
    ) {
      throw new ApplicationFault(
        422,
        "schema-violation",
        "MB-422-SCHEMA",
        "Canonical English content is invalid.",
      );
    }
    return inTransaction(this.pool, async (client) => {
      const owner = await client.query<{
        current_version: number;
        canonical_request_version_id: string;
      }>(
        `SELECT r.current_version, v.canonical_request_version_id
           FROM sourcing_request r
           JOIN canonical_request_version v ON v.request_id = r.request_id AND v.version = r.current_version
          WHERE r.request_id = $1 AND r.account_id = $2 AND r.created_by_user_id = $3 FOR UPDATE OF r`,
        [requestId, context.accountId, context.userId],
      );
      const row = owner.rows[0];
      if (!row) throw this.notVisible();
      const version = row.current_version + 1;
      const canonicalVersionId = randomUUID();
      const contradictions = contradictionIds(input.fields);
      const canonical: CanonicalRequestV1 = {
        schemaVersion: "canonical-request.v1",
        requestId,
        canonicalVersionId,
        version,
        canonicalLanguage: "en",
        canonicalText: input.canonicalText,
        language: {
          bcp47: "en",
          confidence: 1,
          detectorId: "user-correction",
          detectorVersion: "1",
        },
        fields: input.fields,
        protectedSpans: [],
        provenance: [],
        originalTextDigest: {
          algorithm: "HMAC-SHA-256",
          keyId: "revision-no-source",
          rawDigest: createHmac("sha256", this.privacyKey)
            .update(input.canonicalText)
            .digest("hex"),
          normalizedDigest: createHmac("sha256", this.privacyKey)
            .update(input.canonicalText.normalize("NFC"))
            .digest("hex"),
          byteLength: Buffer.byteLength(input.canonicalText),
        },
        readiness: contradictions.length > 0 ? "not_ready" : "ready",
        contradictionIds: contradictions,
      };
      await this.persistCanonicalVersion(client, context, {
        requestId,
        canonicalVersionId,
        version,
        canonical,
        parentVersionId: row.canonical_request_version_id,
        createRequest: false,
      });
      if (contradictions.length === 0) {
        await client.query(
          `UPDATE canonical_contradiction c
              SET resolution = jsonb_build_object('resolved_by_version_id', $2::text),
                  resolved_by_user_id = $3,
                  resolved_at = clock_timestamp()
             FROM canonical_request_version prior
            WHERE c.canonical_request_version_id = prior.canonical_request_version_id
              AND prior.request_id = $1
              AND prior.canonical_request_version_id <> $2
              AND c.resolved_at IS NULL`,
          [requestId, canonicalVersionId, context.userId],
        );
      }
      await client.query(
        "UPDATE sourcing_request SET current_version = $2, lifecycle_state = 'canonicalised' WHERE request_id = $1",
        [requestId, version],
      );
      await appendAuditEvent(client, {
        accountId: context.accountId,
        actorUserId: context.userId,
        actorTier: context.tier,
        eventType: "request.version.created",
        resourceKind: "sourcing_request",
        resourceId: requestId,
        outcome: "allow",
        correlationId: context.correlationId,
        deploymentId: context.deploymentId,
        detail: { version },
      });
      return this.canonicalResponse(requestId, canonicalVersionId, canonical);
    });
  }

  async confirmVersion(
    context: RequestContext,
    requestId: string,
    version: number,
    accepted: boolean,
  ): Promise<Record<string, unknown>> {
    return inTransaction(this.pool, async (client) => {
      const visible = await client.query<{
        canonical_request_version_id: string;
        match_readiness: string;
      }>(
        `SELECT v.canonical_request_version_id, v.match_readiness
           FROM canonical_request_version v
           JOIN sourcing_request r ON r.request_id = v.request_id
          WHERE r.request_id = $1 AND r.account_id = $2 AND r.created_by_user_id = $3 AND v.version = $4`,
        [requestId, context.accountId, context.userId, version],
      );
      const row = visible.rows[0];
      if (!row) throw this.notVisible();
      if (accepted && row.match_readiness !== "ready") {
        throw new ApplicationFault(
          422,
          "unresolved-contradiction",
          "MB-422-CONTRADICTION",
          "The canonical request is not ready.",
        );
      }
      await client.query(
        `INSERT INTO canonical_confirmation
           (confirmation_id, canonical_request_version_id, account_id, actor_user_id, accepted, confirmed_at)
         VALUES ($1,$2,$3,$4,$5,clock_timestamp())`,
        [
          randomUUID(),
          row.canonical_request_version_id,
          context.accountId,
          context.userId,
          accepted,
        ],
      );
      if (accepted) {
        await client.query(
          "UPDATE sourcing_request SET lifecycle_state = 'confirmed' WHERE request_id = $1",
          [requestId],
        );
      }
      const auditId = await appendAuditEvent(client, {
        accountId: context.accountId,
        actorUserId: context.userId,
        actorTier: context.tier,
        eventType: "request.confirmed",
        resourceKind: "sourcing_request",
        resourceId: requestId,
        outcome: accepted ? "allow" : "deny",
        correlationId: context.correlationId,
        deploymentId: context.deploymentId,
        detail: { version, accepted },
      });
      return {
        request_id: requestId,
        version,
        accepted,
        readiness: row.match_readiness,
        audit_id: auditId,
      };
    });
  }

  async submitRun(
    context: RequestContext,
    idempotencyKey: string,
    input: { requestId: string; version: number },
  ): Promise<Record<string, unknown>> {
    const configuration = await this.ensureConfigurationVersions();
    const version = await this.pool.query<{
      canonical_request_version_id: string;
      match_readiness: string;
      confirmed: boolean;
    }>(
      `SELECT v.canonical_request_version_id, v.match_readiness,
              EXISTS (SELECT 1 FROM canonical_confirmation c
                       WHERE c.canonical_request_version_id = v.canonical_request_version_id
                         AND c.accepted = true) AS confirmed
         FROM canonical_request_version v
         JOIN sourcing_request r ON r.request_id = v.request_id
        WHERE r.request_id = $1 AND r.account_id = $2 AND r.created_by_user_id = $3 AND v.version = $4`,
      [input.requestId, context.accountId, context.userId, input.version],
    );
    const canonical = version.rows[0];
    if (!canonical) throw this.notVisible();
    if (canonical.match_readiness !== "ready" || !canonical.confirmed) {
      throw new ApplicationFault(
        422,
        "unresolved-contradiction",
        "MB-422-CONTRADICTION",
        "The canonical request is not ready.",
      );
    }
    const result = await admitRunWithinQuota(this.pool, {
      accountId: context.accountId,
      userId: context.userId,
      canonicalRequestVersionId: canonical.canonical_request_version_id,
      idempotencyKeyHash: sha256(idempotencyKey),
      requestHash: sha256(JSON.stringify(input)),
      modelPolicyVersionId: configuration.modelPolicyVersionId,
      scoringConfigVersionId: configuration.scoringConfigVersionId,
      correlationId: context.correlationId,
      deploymentId: context.deploymentId,
    });
    if (result.disposition === "quota_exceeded") {
      await inTransaction(this.pool, (client) =>
        appendAuditEvent(client, {
          accountId: context.accountId,
          actorUserId: context.userId,
          actorTier: context.tier,
          eventType: "run.quota.denied",
          resourceKind: "quota_ledger",
          outcome: "deny",
          correlationId: context.correlationId,
          deploymentId: context.deploymentId,
          detail: {
            limit: result.limit,
            used: result.used,
            nextCapacityAt: result.nextCapacityAt,
          },
        }),
      );
      throw new ApplicationFault(
        429,
        "quota-exceeded",
        "MB-429-QUOTA",
        "Rolling quota exceeded.",
        true,
        {
          "Retry-After": String(
            Math.max(
              1,
              Math.ceil(
                (Date.parse(result.nextCapacityAt) - Date.now()) / 1000,
              ),
            ),
          ),
          "MB-RateLimit-Limit": String(result.limit),
          "MB-RateLimit-Remaining": "0",
          "MB-RateLimit-Reset": result.nextCapacityAt,
        },
      );
    }
    return {
      run_id: result.runId,
      state: "queued",
      poll_after_ms: 10_000,
      status_url: `/api/v1/runs/${result.runId}`,
      quota: {
        limit: result.limit,
        used: result.used,
        remaining: result.remaining,
        next_capacity_at: result.nextCapacityAt,
      },
      idempotent_replay: result.disposition === "replayed",
    };
  }

  async listRuns(
    context: RequestContext,
    cursor?: string,
  ): Promise<Record<string, unknown>> {
    let cursorDate: Date | null = null;
    let cursorRunId: string | null = null;
    if (cursor) {
      try {
        const [encoded, suppliedMac, extra] = cursor.split(".");
        if (!encoded || !suppliedMac || extra) throw new Error();
        const expectedMac = createHmac("sha256", this.privacyKey)
          .update(encoded, "utf8")
          .digest();
        const actualMac = Buffer.from(suppliedMac, "base64url");
        if (
          actualMac.length !== expectedMac.length ||
          !timingSafeEqual(actualMac, expectedMac)
        )
          throw new Error();
        const payload = JSON.parse(
          Buffer.from(encoded, "base64url").toString("utf8"),
        ) as Record<string, unknown>;
        if (
          payload.accountId !== context.accountId ||
          payload.userId !== context.userId ||
          typeof payload.queuedAt !== "string" ||
          typeof payload.runId !== "string"
        )
          throw new Error();
        cursorDate = new Date(payload.queuedAt);
        cursorRunId = payload.runId;
        if (Number.isNaN(cursorDate.getTime())) throw new Error();
      } catch {
        throw new ApplicationFault(
          400,
          "invalid-cursor",
          "MB-400-CURSOR",
          "Invalid cursor.",
        );
      }
    }
    const result = await this.pool.query<{
      run_id: string;
      state: string;
      queued_at: Date;
    }>(
      `SELECT run_id, state, queued_at FROM research_run
        WHERE account_id = $1 AND requested_by_user_id = $2
          AND ($3::timestamptz IS NULL OR (queued_at, run_id) < ($3, $4::uuid))
        ORDER BY queued_at DESC, run_id DESC LIMIT 21`,
      [context.accountId, context.userId, cursorDate, cursorRunId],
    );
    const hasMore = result.rows.length > 20;
    const items = result.rows.slice(0, 20).map((row) => ({
      run_id: row.run_id,
      state: row.state,
      queued_at: row.queued_at.toISOString(),
    }));
    const last = items.at(-1);
    let nextCursor: string | null = null;
    if (hasMore && last) {
      const encoded = Buffer.from(
        JSON.stringify({
          accountId: context.accountId,
          userId: context.userId,
          queuedAt: last.queued_at,
          runId: last.run_id,
        }),
      ).toString("base64url");
      const mac = createHmac("sha256", this.privacyKey)
        .update(encoded, "utf8")
        .digest("base64url");
      nextCursor = `${encoded}.${mac}`;
    }
    return {
      items,
      next_cursor: nextCursor,
    };
  }

  async recordDisclosure(
    context: RequestContext,
    eventType: string,
    resourceKind: string,
    resourceId?: string,
  ): Promise<string> {
    return inTransaction(this.pool, (client) =>
      appendAuditEvent(client, {
        accountId: context.accountId,
        actorUserId: context.userId,
        actorTier: context.tier,
        eventType,
        resourceKind,
        ...(resourceId ? { resourceId } : {}),
        outcome: "allow",
        correlationId: context.correlationId,
        deploymentId: context.deploymentId,
        detail: { disclosureCommittedBeforeResponse: true },
      }),
    );
  }

  async getRunStatus(
    context: RequestContext,
    runId: string,
  ): Promise<RunStatus> {
    const result = await this.pool.query<{
      run_id: string;
      state: string;
      request_id: string;
      version: number;
      queued_at: Date;
      started_at: Date | null;
      completed_at: Date | null;
    }>(
      `SELECT rr.run_id, rr.state, v.request_id, v.version, rr.queued_at, rr.started_at, rr.completed_at
         FROM research_run rr
         JOIN canonical_request_version v USING (canonical_request_version_id)
        WHERE rr.run_id = $1 AND rr.account_id = $2 AND rr.requested_by_user_id = $3`,
      [runId, context.accountId, context.userId],
    );
    const row = result.rows[0];
    if (!row) throw this.notVisible();
    const terminal = TERMINAL_RUN_STATES.has(row.state);
    const researching = ["researching", "scoring"].includes(row.state);
    const phase =
      row.state === "queued"
        ? "queued"
        : row.state === "scoring"
          ? "scoring"
          : researching
            ? "evidence_collection"
            : row.state;
    const pollAfter =
      terminal || row.state === "restricted"
        ? null
        : row.state === "queued"
          ? 10_000
          : 2_000;
    const progress = terminal
      ? 100
      : row.state === "queued"
        ? null
        : row.state === "scoring"
          ? 80
          : 35;
    return {
      run_id: row.run_id,
      request_id: row.request_id,
      canonical_request_version: row.version,
      state: row.state,
      phase,
      phase_label: terminal
        ? "Processing finished"
        : row.state === "queued"
          ? "Queued for execution"
          : "Collecting and verifying evidence",
      progress: {
        steps_completed: progress === null ? 0 : Math.floor(progress / 20),
        steps_total_planned: 5,
        monotonic_sequence: progress ?? 0,
        percent_complete: progress,
      },
      started_at: asIso(row.started_at),
      updated_at: asIso(row.completed_at ?? row.started_at ?? row.queued_at)!,
      estimated_completion_at: null,
      poll_after_ms: pollAfter,
      terminal,
      result_available: ["complete", "no_responsible_match"].includes(
        row.state,
      ),
      projection_version: 1,
      links: {
        self: `/api/v1/runs/${runId}`,
        result: ["complete", "no_responsible_match"].includes(row.state)
          ? `/api/v1/runs/${runId}/result`
          : null,
        cancel: `/api/v1/runs/${runId}/cancellation`,
      },
    };
  }

  async getRunResult(
    context: RequestContext,
    runId: string,
  ): Promise<ResultDisclosure> {
    return inTransaction(this.pool, async (client) => {
      const result = await client.query<{
        state: string;
        complete_result_document: EvidenceGraphV1 | null;
      }>(
        `SELECT rr.state, rs.complete_result_document
           FROM research_run rr LEFT JOIN run_result rs USING (run_id)
          WHERE rr.run_id = $1 AND rr.account_id = $2 AND rr.requested_by_user_id = $3 FOR SHARE OF rr`,
        [runId, context.accountId, context.userId],
      );
      const row = result.rows[0];
      if (!row) throw this.notVisible();
      if (
        !["complete", "no_responsible_match"].includes(row.state) ||
        !row.complete_result_document
      ) {
        throw new ApplicationFault(
          409,
          "run-not-complete",
          "MB-409-RUN",
          "Run result is not available.",
          true,
        );
      }
      const projection = projectDemoResult(row.complete_result_document);
      const fields = [
        "run_id",
        "outcome",
        "scarcity",
        "candidates",
        "unmet_mandatory_constraints",
        "limitations_notice",
        "projection_version",
      ];
      const projectionVersion = await client.query<{
        projection_version_id: string;
      }>(
        `INSERT INTO projection_version
           (projection_version_id, version, definition, content_sha256, released_at)
         VALUES ($1,1,'{"tier":"demo","allowlist":"demo-projection.v1"}'::jsonb,$2,clock_timestamp())
         ON CONFLICT (version) DO UPDATE SET version = EXCLUDED.version
         RETURNING projection_version_id`,
        [randomUUID(), sha256("demo-projection.v1")],
      );
      const projectionVersionId =
        projectionVersion.rows[0]!.projection_version_id;
      const auditId = await appendAuditEvent(client, {
        accountId: context.accountId,
        actorUserId: context.userId,
        actorTier: context.tier,
        eventType: "result.projected",
        resourceKind: "research_run",
        resourceId: runId,
        outcome: "allow",
        projectionVersionId,
        fieldsReleased: fields,
        correlationId: context.correlationId,
        deploymentId: context.deploymentId,
        detail: { projectionVersion: 1 },
      });
      await client.query(
        `INSERT INTO projection_serving
           (projection_serving_id, account_id, subject_user_id, tier, resource_kind, resource_id,
            projection_version_id, fields_released, item_count, served_at, request_correlation_id)
         VALUES ($1,$2,$3,$4,'research_run',$5,$6,$7,$8,clock_timestamp(),$9)`,
        [
          randomUUID(),
          context.accountId,
          context.userId,
          context.tier,
          runId,
          projectionVersionId,
          fields,
          projection.candidates.length,
          context.correlationId,
        ],
      );
      return { body: projection, auditId };
    });
  }

  async cancelRun(
    context: RequestContext,
    runId: string,
  ): Promise<Record<string, unknown>> {
    return inTransaction(this.pool, async (client) => {
      const run = await client.query<{ state: string }>(
        "SELECT state FROM research_run WHERE run_id = $1 AND account_id = $2 AND requested_by_user_id = $3 FOR UPDATE",
        [runId, context.accountId, context.userId],
      );
      const state = run.rows[0]?.state;
      if (!state) throw this.notVisible();
      if (!TERMINAL_RUN_STATES.has(state)) {
        await client.query(
          `UPDATE research_run SET state = 'cancelled', state_reason = 'user_cancelled', cancelled_at = clock_timestamp()
            WHERE run_id = $1`,
          [runId],
        );
      }
      await appendAuditEvent(client, {
        accountId: context.accountId,
        actorUserId: context.userId,
        actorTier: context.tier,
        eventType: "run.cancelled",
        resourceKind: "research_run",
        resourceId: runId,
        outcome: "allow",
        correlationId: context.correlationId,
        deploymentId: context.deploymentId,
        detail: { priorState: state },
      });
      return {
        run_id: runId,
        state: state === "cancelled" ? state : "cancelled",
        cancellation_accepted: true,
      };
    });
  }

  async executeSyntheticRun(
    context: RequestContext,
    runId: string,
    fixtureCase: "zero" | "one" | "two" | "three" | "many",
  ): Promise<boolean> {
    const ownerToken = sha256(randomUUID());
    const lease = await acquireExecutionLease(
      this.pool,
      runId,
      ownerToken,
      60_000,
      {
        accountId: context.accountId,
        actorUserId: context.userId,
        correlationId: context.correlationId,
        deploymentId: context.deploymentId,
      },
    );
    if (!lease) return false;
    try {
      const graph = buildSyntheticEvidenceGraph(runId, fixtureCase);
      await this.persistSyntheticResult(context, graph);
      return true;
    } catch (error) {
      await inTransaction(this.pool, async (client) => {
        await client.query(
          "UPDATE research_run SET state = 'failed', state_reason = 'synthetic_execution_failed', completed_at = clock_timestamp() WHERE run_id = $1",
          [runId],
        );
        await appendAuditEvent(client, {
          accountId: context.accountId,
          actorUserId: context.userId,
          actorTier: context.tier,
          eventType: "run.failed",
          resourceKind: "research_run",
          resourceId: runId,
          outcome: "error",
          correlationId: context.correlationId,
          deploymentId: context.deploymentId,
          detail: { reasonCode: "synthetic_execution_failed" },
        });
      });
      await releaseExecutionLease(
        this.pool,
        runId,
        ownerToken,
        "execution_failed",
        {
          accountId: context.accountId,
          actorUserId: context.userId,
          correlationId: context.correlationId,
          deploymentId: context.deploymentId,
        },
      ).catch(() => false);
      throw error;
    }
  }

  private async persistSyntheticResult(
    context: RequestContext,
    graph: EvidenceGraphV1,
  ): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await client.query(
        "UPDATE research_run SET state = 'scoring' WHERE run_id = $1 AND account_id = $2",
        [graph.runId, context.accountId],
      );
      const route = await client.query<{ provider_route_id: string }>(
        `INSERT INTO provider_route
           (provider_route_id, route_id, capability, provider, model_id, environment, route_kind,
            data_handling_posture, timeout_ms, max_attempts, retry_policy, config_version, enabled)
         VALUES ($1,'RT-SYNTHETIC-FIXTURE-V1','CAP-SEARCH','synthetic_fixture','fixture-research-v1',
                 'test','synthetic_fixture','synthetic_fixture',1000,1,'{"backoff_ms":[]}'::jsonb,'slice1.v1',true)
         ON CONFLICT (route_id, config_version) DO UPDATE SET enabled = EXCLUDED.enabled
         RETURNING provider_route_id`,
        [randomUUID()],
      );
      const routeId = route.rows[0]!.provider_route_id;
      await appendAuditEvent(client, {
        accountId: context.accountId,
        actorUserId: context.userId,
        actorTier: context.tier,
        eventType: "provider.route.selected",
        resourceKind: "provider_route",
        resourceId: routeId,
        outcome: "allow",
        correlationId: context.correlationId,
        deploymentId: context.deploymentId,
        detail: {
          routeId: "RT-SYNTHETIC-FIXTURE-V1",
          capability: "CAP-SEARCH",
          provider: "synthetic_fixture",
          dataHandlingPosture: "synthetic_fixture",
        },
      });
      const attemptId = randomUUID();
      await client.query(
        `INSERT INTO capability_attempt
           (capability_attempt_id, run_id, account_id, user_id, capability, provider, model_id,
            environment, provider_route_id, outcome, started_at, completed_at)
         VALUES ($1,$2,$3,$4,'CAP-SEARCH','synthetic_fixture','fixture-research-v1','test',$5,'ok',
                 clock_timestamp(),clock_timestamp())`,
        [attemptId, graph.runId, context.accountId, context.userId, routeId],
      );
      await client.query(
        `INSERT INTO provider_call
           (provider_call_id, capability_attempt_id, run_id, account_id, user_id, capability,
            step_key, provider, model_id, environment, route_id, request_parameters,
            input_tokens, output_tokens, latency_ms, called_at)
         VALUES ($1,$2,$3,$4,$5,'CAP-SEARCH','fixture_research','synthetic_fixture',
                 'fixture-research-v1','test','RT-SYNTHETIC-FIXTURE-V1',
                 '{"fixture":true}'::jsonb,0,0,0,clock_timestamp())`,
        [
          randomUUID(),
          attemptId,
          graph.runId,
          context.accountId,
          context.userId,
        ],
      );
      await client.query(
        `INSERT INTO cost_event
           (cost_event_id, capability_attempt_id, run_id, account_id, user_id, capability, provider,
            model_id, environment, quantity, unit, amount, currency_code, pricing_basis,
            pricing_version, pricing_state, measurement_kind, occurred_at)
         VALUES ($1,$2,$3,$4,$5,'CAP-SEARCH','synthetic_fixture','fixture-research-v1','test',1,
                 'invocation',0,'USD','synthetic_fixture','slice1.v1','explicit_zero','measured',clock_timestamp())`,
        [
          randomUUID(),
          attemptId,
          graph.runId,
          context.accountId,
          context.userId,
        ],
      );

      const evidenceIds = new Map<string, string>();
      for (const evidence of graph.evidence) {
        const id = randomUUID();
        evidenceIds.set(evidence.evidenceId, id);
        await client.query(
          `INSERT INTO evidence_item
             (evidence_item_id, run_id, account_id, source_kind, local_fixture_id, title,
              publisher_domain, retrieved_at, content_sha256, verification_disposition)
           VALUES ($1,$2,$3,'synthetic_fixture',$4,$5,$6,$7,$8,'synthetic')`,
          [
            id,
            graph.runId,
            context.accountId,
            evidence.evidenceId,
            evidence.title,
            evidence.publisherDomain,
            evidence.retrievedAt,
            Buffer.from(evidence.contentSha256, "hex"),
          ],
        );
      }
      const candidateIds = new Map<string, string>();
      for (const candidate of graph.candidates) {
        const id = randomUUID();
        candidateIds.set(candidate.candidateId, id);
        await client.query(
          `INSERT INTO candidate
             (candidate_id, run_id, account_id, canonical_name, country_code, deterministic_rank, eligible)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            id,
            graph.runId,
            context.accountId,
            candidate.displayName,
            candidate.countryCode,
            candidateIds.size,
            graph.eligibleCandidateIds.includes(candidate.candidateId),
          ],
        );
      }
      for (const claim of graph.claims) {
        const claimId = randomUUID();
        await client.query(
          `INSERT INTO claim
             (claim_id, run_id, account_id, candidate_id, assertion_text, decision_bearing, verification_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            claimId,
            graph.runId,
            context.accountId,
            candidateIds.get(claim.candidateId),
            claim.text,
            claim.decisionBearing,
            claim.verificationStatus,
          ],
        );
        for (const evidenceId of claim.evidenceIds) {
          await client.query(
            `INSERT INTO claim_evidence
               (claim_id, evidence_item_id, account_id, relation, support_locator)
             VALUES ($1,$2,$3,'supports','{"fixture":true}'::jsonb)`,
            [claimId, evidenceIds.get(evidenceId), context.accountId],
          );
        }
      }
      const resultOutcome =
        graph.eligibleCandidateIds.length === 0
          ? "no_responsible_match"
          : "candidates";
      await client.query(
        `INSERT INTO run_result
           (run_id, account_id, outcome, eligible_count, considered_count, scarcity,
            limitations_text, complete_result_document, result_sha256, assembled_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,clock_timestamp())`,
        [
          graph.runId,
          context.accountId,
          resultOutcome,
          graph.eligibleCandidateIds.length,
          graph.candidates.length,
          JSON.stringify({ eligible_count: graph.eligibleCandidateIds.length }),
          "Synthetic evaluation data only.",
          JSON.stringify(graph),
          sha256(JSON.stringify(graph)),
        ],
      );
      for (const candidateId of graph.eligibleCandidateIds) {
        const rank = graph.eligibleCandidateIds.indexOf(candidateId) + 1;
        await client.query(
          `INSERT INTO result_candidate (run_id, candidate_id, account_id, rank, eligible, rationale_short)
           VALUES ($1,$2,$3,$4,true,$5)`,
          [
            graph.runId,
            candidateIds.get(candidateId),
            context.accountId,
            rank,
            graph.candidates.find(
              (candidate) => candidate.candidateId === candidateId,
            )?.rationaleShort,
          ],
        );
      }
      await appendAuditEvent(client, {
        accountId: context.accountId,
        actorUserId: context.userId,
        actorTier: context.tier,
        eventType: "run.completed",
        resourceKind: "research_run",
        resourceId: graph.runId,
        outcome: "allow",
        correlationId: context.correlationId,
        deploymentId: context.deploymentId,
        detail: {
          fixture: true,
          eligibleCandidates: graph.eligibleCandidateIds.length,
        },
      });
      await client.query(
        `UPDATE research_run SET state = $2, completed_at = clock_timestamp()
          WHERE run_id = $1`,
        [
          graph.runId,
          graph.eligibleCandidateIds.length === 0
            ? "no_responsible_match"
            : "complete",
        ],
      );
    });
  }

  private async ensureConfigurationVersions(): Promise<{
    modelPolicyVersionId: string;
    scoringConfigVersionId: string;
  }> {
    return inTransaction(this.pool, async (client) => {
      const model = await client.query<{ model_policy_version_id: string }>(
        "SELECT model_policy_version_id FROM model_policy_version ORDER BY version DESC LIMIT 1",
      );
      const scoring = await client.query<{ scoring_config_version_id: string }>(
        "SELECT scoring_config_version_id FROM scoring_config_version ORDER BY version DESC LIMIT 1",
      );
      if (!model.rows[0] || !scoring.rows[0]) {
        throw new ApplicationFault(
          503,
          "dependency-unavailable",
          "MB-503-CONFIG",
          "Required configuration is unavailable.",
          true,
        );
      }
      return {
        modelPolicyVersionId: model.rows[0].model_policy_version_id,
        scoringConfigVersionId: scoring.rows[0].scoring_config_version_id,
      };
    });
  }

  private async readIdempotency(
    context: RequestContext,
    route: string,
    keyHash: Buffer,
    requestHash: Buffer,
    queryable: ConnectionPool | TransactionClient = this.pool,
  ): Promise<Record<string, unknown> | null> {
    const result = await queryable.query<{
      request_hash: Buffer;
      response_body: Record<string, unknown>;
    }>(
      `SELECT request_hash, response_body FROM idempotency_record
        WHERE account_id = $1 AND subject_user_id = $2
          AND route = $3 AND key_hash = $4 AND expires_at > clock_timestamp()`,
      [context.accountId, context.userId, route, keyHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (!row.request_hash.equals(requestHash)) {
      throw new ApplicationFault(
        422,
        "idempotency-key-reuse",
        "MB-422-IDEMPOTENCY",
        "Idempotency key was reused.",
      );
    }
    return { ...row.response_body, idempotent_replay: true };
  }

  private async persistCapabilityTelemetry(
    client: TransactionClient,
    context: RequestContext,
    canonicalizationRunId: string,
    event: CapabilityInvocationTelemetry,
  ): Promise<void> {
    const allowedOutcomes = new Set([
      "ok",
      "schema_violation",
      "refusal",
      "provider_error",
      "timeout",
      "circuit_open",
      "cancelled",
    ]);
    const nonEmpty = (value: unknown): value is string =>
      typeof value === "string" && value.trim().length > 0;
    const startedAt = new Date(event.startedAt);
    const completedAt = new Date(event.completedAt);
    if (
      !nonEmpty(event.attemptId) ||
      !nonEmpty(event.capabilityId) ||
      !nonEmpty(event.providerId) ||
      !nonEmpty(event.routeId) ||
      !nonEmpty(event.modelId) ||
      !["gemini_direct", "openrouter", "synthetic_fixture"].includes(
        event.providerId,
      ) ||
      !["local", "test", "staging", "production"].includes(event.environment) ||
      !["real_data", "synthetic_fixture"].includes(event.routeKind) ||
      ![
        "synthetic_fixture",
        "zdr_verified",
        "paid_no_training",
        "unknown",
      ].includes(event.dataHandlingPosture) ||
      !Number.isInteger(event.timeoutMs) ||
      event.timeoutMs < 1 ||
      !Number.isInteger(event.configuredMaxAttempts) ||
      event.configuredMaxAttempts < 1 ||
      event.configuredMaxAttempts > 10 ||
      !Number.isInteger(event.configuredBackoffMs) ||
      event.configuredBackoffMs < 0 ||
      typeof event.allowFallbacks !== "boolean" ||
      !allowedOutcomes.has(event.outcome) ||
      !Number.isInteger(event.attemptNumber) ||
      event.attemptNumber < 1 ||
      event.attemptNumber > 10 ||
      !Number.isInteger(event.retryBackoffMs) ||
      event.retryBackoffMs < 0 ||
      !Number.isFinite(startedAt.valueOf()) ||
      !Number.isFinite(completedAt.valueOf()) ||
      completedAt < startedAt ||
      !Number.isFinite(event.quantity) ||
      event.quantity < 0 ||
      !nonEmpty(event.unit) ||
      !nonEmpty(event.pricingBasis) ||
      !nonEmpty(event.pricingVersion)
    ) {
      throw new Error("Capability telemetry is malformed.");
    }
    if (
      event.providerId === "synthetic_fixture" &&
      !(
        (event.environment === "local" || event.environment === "test") &&
        event.routeKind === "synthetic_fixture" &&
        event.dataHandlingPosture === "synthetic_fixture" &&
        event.amount === 0 &&
        event.currency === "USD" &&
        event.pricingBasis === "synthetic_fixture" &&
        event.pricingState === "explicit_zero"
      )
    ) {
      throw new Error(
        "Synthetic capability telemetry has invalid pricing attribution.",
      );
    }
    if (
      event.providerId !== "synthetic_fixture" &&
      (event.routeKind !== "real_data" ||
        event.dataHandlingPosture === "synthetic_fixture" ||
        event.dataHandlingPosture === "unknown")
    ) {
      throw new Error(
        "Real-data capability telemetry has unverified routing attribution.",
      );
    }
    if (
      event.amount !== "unknown" &&
      (!Number.isFinite(event.amount) || event.amount < 0)
    ) {
      throw new Error("Capability telemetry amount is malformed.");
    }
    const route = await client.query<{ provider_route_id: string }>(
      `INSERT INTO provider_route
         (provider_route_id, route_id, capability, provider, model_id, environment, route_kind,
          data_handling_posture, timeout_ms, max_attempts, retry_policy, config_version, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'runtime-telemetry.v1',true)
       ON CONFLICT (route_id, config_version) DO UPDATE
         SET enabled = EXCLUDED.enabled
       WHERE provider_route.capability = EXCLUDED.capability
         AND provider_route.provider = EXCLUDED.provider
         AND provider_route.model_id = EXCLUDED.model_id
         AND provider_route.environment = EXCLUDED.environment
         AND provider_route.route_kind = EXCLUDED.route_kind
         AND provider_route.data_handling_posture = EXCLUDED.data_handling_posture
         AND provider_route.timeout_ms = EXCLUDED.timeout_ms
         AND provider_route.max_attempts = EXCLUDED.max_attempts
         AND provider_route.retry_policy = EXCLUDED.retry_policy
       RETURNING provider_route_id`,
      [
        randomUUID(),
        event.routeId,
        event.capabilityId,
        event.providerId,
        event.modelId,
        event.environment,
        event.routeKind,
        event.dataHandlingPosture,
        event.timeoutMs,
        event.configuredMaxAttempts,
        JSON.stringify({
          max_attempts: event.configuredMaxAttempts,
          backoff_ms: event.configuredBackoffMs,
          allow_fallbacks: event.allowFallbacks,
        }),
      ],
    );
    const providerRouteId = route.rows[0]?.provider_route_id;
    if (!providerRouteId)
      throw new Error(
        "Capability route attribution does not match its registry row.",
      );
    await client.query(
      `INSERT INTO capability_attempt
         (capability_attempt_id, canonicalization_run_id, account_id, user_id, capability,
          provider, model_id, environment, provider_route_id, outcome, started_at, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        event.attemptId,
        canonicalizationRunId,
        context.accountId,
        context.userId,
        event.capabilityId,
        event.providerId,
        event.modelId,
        event.environment,
        providerRouteId,
        event.outcome,
        event.startedAt,
        event.completedAt,
      ],
    );
    await client.query(
      `INSERT INTO provider_call
         (provider_call_id, capability_attempt_id, canonicalization_run_id, account_id, user_id,
          capability, step_key, provider, model_id, environment, route_id, request_parameters,
          latency_ms, called_at)
       VALUES ($1,$2,$3,$4,$5,$6,'canonicalization',$7,$8,$9,$10,$11::jsonb,$12,$13)`,
      [
        randomUUID(),
        event.attemptId,
        canonicalizationRunId,
        context.accountId,
        context.userId,
        event.capabilityId,
        event.providerId,
        event.modelId,
        event.environment,
        event.routeId,
        JSON.stringify({
          attempt_number: event.attemptNumber,
          fallback: event.fallback,
          retry_backoff_ms: event.retryBackoffMs,
        }),
        completedAt.valueOf() - startedAt.valueOf(),
        event.startedAt,
      ],
    );
    await client.query(
      `INSERT INTO cost_event
         (cost_event_id, capability_attempt_id, canonicalization_run_id, account_id, user_id,
          capability, provider, model_id, environment, quantity, unit, amount, currency_code,
          pricing_basis, pricing_version, pricing_state, measurement_kind, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        randomUUID(),
        event.attemptId,
        canonicalizationRunId,
        context.accountId,
        context.userId,
        event.capabilityId,
        event.providerId,
        event.modelId,
        event.environment,
        event.quantity,
        event.unit,
        event.amount === "unknown" ? null : event.amount,
        event.currency,
        event.pricingBasis,
        event.pricingVersion,
        event.pricingState,
        event.measurement,
        event.completedAt,
      ],
    );
    const reconciled = await client.query<{ matched: number }>(
      `SELECT count(*)::int AS matched
         FROM capability_attempt a
         JOIN provider_call p USING (capability_attempt_id)
         JOIN cost_event c USING (capability_attempt_id)
         JOIN provider_route r ON r.provider_route_id = a.provider_route_id
        WHERE a.capability_attempt_id = $1
          AND p.account_id = a.account_id AND c.account_id = a.account_id
          AND p.user_id = a.user_id AND c.user_id = a.user_id
          AND p.run_id IS NOT DISTINCT FROM a.run_id
          AND c.run_id IS NOT DISTINCT FROM a.run_id
          AND p.canonicalization_run_id IS NOT DISTINCT FROM a.canonicalization_run_id
          AND c.canonicalization_run_id IS NOT DISTINCT FROM a.canonicalization_run_id
          AND p.capability = a.capability AND c.capability = a.capability
          AND p.provider = a.provider AND c.provider = a.provider
          AND p.model_id = a.model_id AND c.model_id = a.model_id
          AND p.environment = a.environment AND c.environment = a.environment
          AND p.route_id = r.route_id`,
      [event.attemptId],
    );
    if (reconciled.rows[0]?.matched !== 1)
      throw new Error("Capability telemetry ledger reconciliation failed.");
  }

  private assertCanonicalProvenanceMatchesTelemetry(
    canonical: CanonicalRequestV1,
    telemetry: readonly CapabilityInvocationTelemetry[],
  ): void {
    const successful = telemetry.filter((event) => event.outcome === "ok");
    if (successful.length === 0)
      throw new Error("Canonicalization emitted no successful telemetry.");
    const provenanceByAttempt = new Map(
      canonical.provenance.map((item) => [item.attemptId, item]),
    );
    for (const event of successful) {
      const provenance = provenanceByAttempt.get(event.attemptId);
      if (
        !provenance ||
        provenance.capabilityId !== event.capabilityId ||
        provenance.providerId !== event.providerId ||
        provenance.routeId !== event.routeId ||
        provenance.modelId !== event.modelId ||
        provenance.startedAt !== event.startedAt ||
        provenance.completedAt !== event.completedAt
      ) {
        throw new Error(
          "Canonical provenance does not match emitted telemetry.",
        );
      }
    }
  }

  private async persistCanonicalVersion(
    client: TransactionClient,
    context: RequestContext,
    input: {
      requestId: string;
      canonicalVersionId: string;
      version: number;
      canonical: CanonicalRequestV1;
      parentVersionId: string | null;
      canonicalizationRunId?: string;
      createRequest?: boolean;
    },
  ): Promise<void> {
    if (input.createRequest !== false) {
      await client.query(
        `INSERT INTO sourcing_request
           (request_id, account_id, created_by_user_id, canonicalization_run_id,
            current_version, lifecycle_state)
         VALUES ($1,$2,$3,$4,1,'canonicalised')`,
        [
          input.requestId,
          context.accountId,
          context.userId,
          input.canonicalizationRunId,
        ],
      );
    }
    await client.query(
      `INSERT INTO canonical_request_version
         (canonical_request_version_id, request_id, account_id, version, canonical_document,
          protected_spans, match_readiness, parent_version_id, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)`,
      [
        input.canonicalVersionId,
        input.requestId,
        context.accountId,
        input.version,
        JSON.stringify({
          schema_version: input.canonical.schemaVersion,
          canonical_text: input.canonical.canonicalText,
          fields: input.canonical.fields,
        }),
        JSON.stringify(input.canonical.protectedSpans),
        input.canonical.readiness,
        input.parentVersionId,
        context.userId,
      ],
    );
    await client.query(
      `INSERT INTO canonical_language_record
         (canonical_request_version_id, account_id, source_language_tag, source_language_confidence,
          canonical_language_tag, detected_at)
       VALUES ($1,$2,$3,$4,'en',clock_timestamp())`,
      [
        input.canonicalVersionId,
        context.accountId,
        input.canonical.language.bcp47,
        input.canonical.language.confidence,
      ],
    );
    for (const field of input.canonical.fields) {
      const fieldId = randomUUID();
      await client.query(
        `INSERT INTO request_field
           (field_id, canonical_request_version_id, account_id, macro_parameter, field_key,
            value_state, canonical_value, canonical_locator)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [
          fieldId,
          input.canonicalVersionId,
          context.accountId,
          macroParameter(field.path),
          field.path,
          field.valueState,
          JSON.stringify(field.canonicalValue),
          field.path,
        ],
      );
      await client.query(
        `INSERT INTO canonical_field_provenance
           (field_id, account_id, origin, source_language_tag, recorded_at)
         VALUES ($1,$2,$3,$4,clock_timestamp())`,
        [
          fieldId,
          context.accountId,
          field.languageOrigin === "translated"
            ? "translated"
            : input.version > 1
              ? "user_corrected"
              : "entered_english",
          input.canonical.language.bcp47,
        ],
      );
    }
    await client.query(
      `INSERT INTO original_text_digest
         (canonical_request_version_id, account_id, digest_hmac_sha256, key_id)
       VALUES ($1,$2,$3,$4)`,
      [
        input.canonicalVersionId,
        context.accountId,
        Buffer.from(input.canonical.originalTextDigest.rawDigest, "hex"),
        input.canonical.originalTextDigest.keyId,
      ],
    );
    for (const provenance of input.canonical.provenance) {
      await client.query(
        `INSERT INTO transformation_provenance
           (transformation_provenance_id, canonical_request_version_id, account_id,
            capability_attempt_id, stage,
            capability, provider, model_id, route_id, config_version, data_handling_posture,
            output_sha256, transformed_at)
         VALUES ($1,$2,$3,$4,'canonicalisation',$5,$6,$7,$8,$9,'synthetic_fixture',$10,$11)`,
        [
          randomUUID(),
          input.canonicalVersionId,
          context.accountId,
          provenance.attemptId,
          provenance.capabilityId,
          provenance.providerId,
          provenance.modelId,
          provenance.routeId,
          provenance.configVersion,
          sha256(input.canonical.canonicalText),
          provenance.completedAt,
        ],
      );
    }
    for (const contradictionId of input.canonical.contradictionIds) {
      await client.query(
        `INSERT INTO canonical_contradiction
           (contradiction_id, canonical_request_version_id, account_id, blocking, alternatives)
         VALUES ($1,$2,$3,true,$4::jsonb)`,
        [
          randomUUID(),
          input.canonicalVersionId,
          context.accountId,
          JSON.stringify({ stable_id: contradictionId }),
        ],
      );
    }
  }

  private canonicalResponse(
    requestId: string,
    canonicalVersionId: string,
    canonical: CanonicalRequestV1,
  ): Record<string, unknown> {
    return {
      request_id: requestId,
      canonical_version_id: canonicalVersionId,
      version: canonical.version,
      canonical_language: "en",
      canonical_text: canonical.canonicalText,
      source_language_tag: canonical.language.bcp47,
      source_language_confidence: canonical.language.confidence,
      fields: canonical.fields.map((field: CanonicalFieldV1) => ({
        ...field,
        was_translated: field.languageOrigin === "translated",
      })),
      protected_spans: canonical.protectedSpans,
      match_readiness: canonical.readiness,
      contradictions: canonical.contradictionIds,
      confirmed: false,
    };
  }

  private notVisible(): ApplicationFault {
    return new ApplicationFault(
      403,
      "resource-not-visible",
      "MB-403-RESOURCE",
      "Resource is not visible.",
    );
  }
}
