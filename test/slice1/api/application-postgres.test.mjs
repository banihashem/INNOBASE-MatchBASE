import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { SOURCE_LANGUAGE_CANARIES } from "../../../config/source-language-canaries.mjs";

import {
  DeterministicFixtureCanonicalizer,
  DeterministicFixtureLanguageIdentifier,
  findRestrictedProjectionKeys,
} from "../../../packages/ai-evidence/dist/src/index.js";
import {
  ApplicationFault,
  MatchBaseApplication,
} from "../../../packages/application/dist/index.js";
import { createPool, migrateUp } from "../../../packages/data/dist/index.js";
import { scanPostgresForCanaries } from "../../../packages/security/dist/index.js";

const databaseUrl = process.env.DATABASE_URL;
const postgresTest = databaseUrl ? test : test.skip;
function digest(value) {
  return createHash("sha256").update(value).digest();
}

async function seedSubject(pool) {
  const ids = { accountId: randomUUID(), userId: randomUUID() };
  const version = Math.floor(Math.random() * 1_000_000_000) + 1;
  await pool.query(
    "INSERT INTO account (account_id, display_name, status) VALUES ($1,'API test','active')",
    [ids.accountId],
  );
  await pool.query(
    `INSERT INTO app_user (user_id, account_id, google_sub, email_verified, status)
     VALUES ($1,$2,$3,true,'active')`,
    [ids.userId, ids.accountId, `api-${ids.userId}`],
  );
  await pool.query(
    `INSERT INTO entitlement_grant
       (grant_id, account_id, user_id, tier, grant_actor_kind, justification, effective_from)
     VALUES ($1,$2,$3,'demo','system','api fixture',clock_timestamp())`,
    [randomUUID(), ids.accountId, ids.userId],
  );
  await pool.query(
    `INSERT INTO model_policy_version
       (model_policy_version_id, version, capability_map, content_sha256, released_at)
     VALUES ($1,$2,'{}'::jsonb,$3,clock_timestamp())`,
    [randomUUID(), version, digest(`model-${version}`)],
  );
  await pool.query(
    `INSERT INTO scoring_config_version
       (scoring_config_version_id, version, weights_bp, gate_definitions, content_sha256,
        released_at, product_owner_approval_ref, sme_approval_ref, evaluation_run_ref)
     VALUES ($1,$2,'{}'::jsonb,'{}'::jsonb,$3,clock_timestamp(),'po-api','sme-api','eval-api')`,
    [randomUUID(), version, digest(`score-${version}`)],
  );
  return ids;
}

function context(ids) {
  return {
    accountId: ids.accountId,
    userId: ids.userId,
    tier: "demo",
    adminSubRoles: [],
    correlationId: randomUUID(),
    deploymentId: "slice1-api-test",
  };
}

function telemetryAttempt(overrides = {}) {
  const timestamp = new Date().toISOString();
  return {
    attemptId: randomUUID(),
    capabilityId: "CAP-TRANSLATE",
    providerId: "synthetic_fixture",
    routeId: "RT-ADVERSARIAL-TRANSLATE-V1",
    modelId: "injected-canonicalizer-v1",
    environment: "test",
    routeKind: "synthetic_fixture",
    dataHandlingPosture: "synthetic_fixture",
    timeoutMs: 20_000,
    configuredMaxAttempts: 3,
    configuredBackoffMs: 25,
    allowFallbacks: false,
    attemptNumber: 1,
    fallback: false,
    retryBackoffMs: 0,
    startedAt: timestamp,
    completedAt: timestamp,
    outcome: "ok",
    quantity: 1,
    unit: "attempt",
    amount: 0,
    currency: "USD",
    pricingBasis: "synthetic_fixture",
    pricingVersion: "fixture-pricing.v1",
    pricingState: "explicit_zero",
    measurement: "measured",
    ...overrides,
  };
}

function injectedCanonical(input, successfulAttempt) {
  return {
    schemaVersion: "canonical-request.v1",
    requestId: input.requestId,
    canonicalVersionId: `CAN-${successfulAttempt.attemptId}`,
    version: 1,
    canonicalLanguage: "en",
    canonicalText: input.fixtureCanonicalText,
    language: {
      bcp47: "en",
      confidence: 1,
      detectorId: "injected-no-language-id",
      detectorVersion: "1",
    },
    fields: input.fixtureCanonicalFields,
    protectedSpans: [],
    provenance: [
      {
        attemptId: successfulAttempt.attemptId,
        capabilityId: successfulAttempt.capabilityId,
        providerId: successfulAttempt.providerId,
        routeId: successfulAttempt.routeId,
        modelId: successfulAttempt.modelId,
        promptVersion: "fixture-canonicalization.v1",
        configVersion: "injected.v1",
        retentionPosture: "not_applicable",
        startedAt: successfulAttempt.startedAt,
        completedAt: successfulAttempt.completedAt,
        outcome: "ok",
      },
    ],
    originalTextDigest: {
      algorithm: "HMAC-SHA-256",
      keyId: "injected-source-free-v1",
      rawDigest: digest(`raw-${input.requestId}`).toString("hex"),
      normalizedDigest: digest(`normalized-${input.requestId}`).toString("hex"),
      byteLength: Buffer.byteLength(input.sourceText),
    },
    readiness: "ready",
    contradictionIds: [],
  };
}

postgresTest(
  "authenticated Demo application path persists only canonical English and discloses projection",
  async () => {
    const pool = createPool({ connectionString: databaseUrl, max: 12 });
    try {
      await migrateUp(pool);
      const ids = await seedSubject(pool);
      const app = new MatchBaseApplication({
        pool,
        canonicalizer: new DeterministicFixtureCanonicalizer({
          digestKey: digest("application-test-digest-key-material"),
          digestKeyId: "api-test-v1",
          languageIdentifier: new DeterministicFixtureLanguageIdentifier(),
        }),
        privacyKey: digest("application-privacy-key-material"),
      });
      const sourceCanary = String.fromCodePoint(
        0x0631,
        0x0648,
        0x063a,
        0x0646,
        0x0020,
        0x0632,
        0x06cc,
        0x062a,
        0x0648,
        0x0646,
        0x0020,
        0x062a,
        0x0635,
        0x0641,
        0x06cc,
        0x0647,
        0x0020,
        0x0634,
        0x062f,
        0x0647,
        0x0020,
        0x0628,
        0x0631,
        0x0627,
        0x06cc,
        0x0020,
        0x0635,
        0x0627,
        0x062f,
        0x0631,
        0x0627,
        0x062a,
      );
      const intake = {
        sourceText: sourceCanary,
        fixtureCanonicalText: "Refined olive oil for export",
        fixtureCanonicalFields: [
          {
            fieldId: "product-name",
            path: "product.name",
            valueState: "provided",
            languageOrigin: "translated",
            canonicalValue: "Refined olive oil",
          },
        ],
        presentedFields: ["product-name"],
      };
      const timeoutContext = context(ids);
      const timeoutApp = new MatchBaseApplication({
        pool,
        canonicalizer: {
          capabilityId: "CAP-TRANSLATE",
          canonicalize: async (_input, _signal, telemetry) => {
            await telemetry.record(telemetryAttempt({ outcome: "timeout" }));
            return await new Promise(() => undefined);
          },
        },
        privacyKey: digest("application-timeout-privacy-key-material"),
        canonicalizationBudgetMs: 5,
      });
      await assert.rejects(
        timeoutApp.createRequest(
          timeoutContext,
          "canonical-timeout-attempt-key",
          intake,
        ),
        (error) => error instanceof ApplicationFault && error.status === 503,
      );
      const failureContext = context(ids);
      const failureApp = new MatchBaseApplication({
        pool,
        canonicalizer: {
          capabilityId: "CAP-TRANSLATE",
          canonicalize: async (_input, _signal, telemetry) => {
            await telemetry.record(
              telemetryAttempt({ outcome: "provider_error" }),
            );
            throw new Error("synthetic provider failure without source");
          },
        },
        privacyKey: digest("application-failure-privacy-key-material"),
      });
      await assert.rejects(
        failureApp.createRequest(
          failureContext,
          "canonical-failure-attempt-key",
          intake,
        ),
        (error) => error instanceof ApplicationFault && error.status === 503,
      );
      const created = await app.createRequest(
        context(ids),
        "request-idempotency-0001",
        intake,
      );
      const liveContext = context(ids);
      const liveApp = new MatchBaseApplication({
        pool,
        canonicalizer: {
          capabilityId: "CAP-TRANSLATE",
          canonicalize: async (input, _signal, telemetry) => {
            const successful = telemetryAttempt({
              providerId: "gemini_direct",
              routeId: "RT-GEMINI-DIRECT-CANONICALIZE-V1",
              modelId: "gemini-3.6-flash",
              environment: "staging",
              routeKind: "real_data",
              dataHandlingPosture: "paid_no_training",
              configuredMaxAttempts: 1,
              configuredBackoffMs: 0,
              amount: "unknown",
              pricingBasis: "provider_usage_unpriced",
              pricingVersion: "gemini-3.6-canonicalization.2026-08-30",
              pricingState: "unpriced",
            });
            await telemetry.record(successful);
            return injectedCanonical(input, successful);
          },
        },
        privacyKey: digest("application-live-privacy-key-material"),
      });
      await liveApp.createRequest(
        liveContext,
        "canonical-live-posture-key",
        intake,
      );
      for (const [index, canary] of SOURCE_LANGUAGE_CANARIES.entries()) {
        await app.createRequest(
          context(ids),
          `four-language-canary-${String(index).padStart(2, "0")}-key`,
          { ...intake, sourceText: canary },
        );
        await assert.doesNotReject(
          scanPostgresForCanaries(pool, SOURCE_LANGUAGE_CANARIES),
        );
      }
      const retryContext = context(ids);
      const retryApp = new MatchBaseApplication({
        pool,
        canonicalizer: {
          capabilityId: "CAP-TRANSLATE",
          canonicalize: async (input, _signal, telemetry) => {
            await telemetry.record(
              telemetryAttempt({ outcome: "provider_error" }),
            );
            await telemetry.record(
              telemetryAttempt({
                attemptNumber: 2,
                outcome: "provider_error",
                retryBackoffMs: 25,
              }),
            );
            const successful = telemetryAttempt({
              attemptNumber: 3,
              retryBackoffMs: 25,
            });
            await telemetry.record(successful);
            return injectedCanonical(input, successful);
          },
        },
        privacyKey: digest("application-retry-privacy-key-material"),
      });
      await retryApp.createRequest(
        retryContext,
        "canonical-multi-retry-key",
        intake,
      );
      const adversarialRows = await pool.query(
        `SELECT x.request_correlation_id, a.capability, a.outcome,
                (p.request_parameters->>'attempt_number')::int AS attempt_number,
                (p.request_parameters->>'retry_backoff_ms')::int AS retry_backoff_ms
           FROM canonicalization_execution_run x
           JOIN capability_attempt a USING (canonicalization_run_id, account_id)
           JOIN provider_call p USING (capability_attempt_id)
          WHERE x.request_correlation_id = ANY($1::text[])
          ORDER BY x.request_correlation_id, attempt_number`,
        [
          [
            timeoutContext.correlationId,
            failureContext.correlationId,
            retryContext.correlationId,
          ],
        ],
      );
      const byCorrelation = (correlationId) =>
        adversarialRows.rows.filter(
          (row) => row.request_correlation_id === correlationId,
        );
      assert.deepEqual(
        byCorrelation(timeoutContext.correlationId).map((row) => [
          row.capability,
          row.outcome,
        ]),
        [["CAP-TRANSLATE", "timeout"]],
      );
      assert.deepEqual(
        byCorrelation(failureContext.correlationId).map((row) => [
          row.capability,
          row.outcome,
        ]),
        [["CAP-TRANSLATE", "provider_error"]],
      );
      assert.deepEqual(
        byCorrelation(retryContext.correlationId).map((row) => [
          row.capability,
          row.outcome,
          row.attempt_number,
          row.retry_backoff_ms,
        ]),
        [
          ["CAP-TRANSLATE", "provider_error", 1, 0],
          ["CAP-TRANSLATE", "provider_error", 2, 25],
          ["CAP-TRANSLATE", "ok", 3, 25],
        ],
      );
      const canonicalAttemptReconciliation = await pool.query(
        `SELECT a.outcome, count(*)::int AS attempts,
                count(p.provider_call_id)::int AS calls,
                count(c.cost_event_id)::int AS costs,
                count(*) FILTER (
                  WHERE c.amount = 0 AND c.pricing_state = 'explicit_zero'
                    AND c.pricing_basis = 'synthetic_fixture'
                )::int AS exact_zero_costs,
                count(*) FILTER (
                  WHERE a.provider = 'gemini_direct' AND c.amount IS NULL
                    AND c.pricing_state = 'unpriced'
                    AND c.pricing_basis = 'provider_usage_unpriced'
                )::int AS live_unpriced_costs,
                bool_and(p.request_parameters ? 'attempt_number'
                  AND p.request_parameters->>'fallback' = 'false') AS attributed
           FROM capability_attempt a
           LEFT JOIN provider_call p USING (capability_attempt_id)
           LEFT JOIN cost_event c USING (capability_attempt_id)
          WHERE a.account_id = $1
            AND a.capability IN ('CAP-LANGUAGE-ID','CAP-TRANSLATE')
          GROUP BY a.outcome`,
        [ids.accountId],
      );
      const attemptOutcomes = new Map(
        canonicalAttemptReconciliation.rows.map((row) => [row.outcome, row]),
      );
      assert.equal(attemptOutcomes.get("timeout")?.attempts, 1);
      assert.equal(attemptOutcomes.get("provider_error")?.attempts, 3);
      assert.equal(attemptOutcomes.get("ok")?.attempts, 12);
      for (const row of canonicalAttemptReconciliation.rows) {
        assert.equal(row.calls, row.attempts);
        assert.equal(row.costs, row.attempts);
        assert.equal(
          row.exact_zero_costs + row.live_unpriced_costs,
          row.attempts,
        );
        assert.equal(row.attributed, true);
      }
      const provenanceReconciliation = await pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (
                  WHERE t.capability_attempt_id IS NULL
                     OR t.capability <> a.capability
                     OR t.provider <> a.provider
                     OR t.model_id <> a.model_id
                     OR t.route_id <> r.route_id
                     OR t.data_handling_posture <> r.data_handling_posture
                )::int AS mismatched
           FROM transformation_provenance t
           LEFT JOIN capability_attempt a
             ON a.capability_attempt_id = t.capability_attempt_id
            AND a.account_id = t.account_id
           LEFT JOIN provider_route r ON r.provider_route_id = a.provider_route_id
          WHERE t.account_id = $1`,
        [ids.accountId],
      );
      assert.equal(provenanceReconciliation.rows[0].total, 12);
      assert.equal(provenanceReconciliation.rows[0].mismatched, 0);
      const liveProvenance = await pool.query(
        `SELECT t.data_handling_posture, t.provider, t.model_id, t.route_id
           FROM canonicalization_execution_run x
           JOIN sourcing_request s USING (canonicalization_run_id, account_id)
           JOIN canonical_request_version v ON v.request_id = s.request_id AND v.version = 1
           JOIN transformation_provenance t USING (canonical_request_version_id, account_id)
          WHERE x.request_correlation_id = $1`,
        [liveContext.correlationId],
      );
      assert.deepEqual(liveProvenance.rows, [
        {
          data_handling_posture: "paid_no_training",
          provider: "gemini_direct",
          model_id: "gemini-3.6-flash",
          route_id: "RT-GEMINI-DIRECT-CANONICALIZE-V1",
        },
      ]);
      const requestInvariant = await pool.query(
        `SELECT x.request_correlation_id, count(s.request_id)::int AS requests
           FROM canonicalization_execution_run x
           LEFT JOIN sourcing_request s
             ON s.account_id = x.account_id
            AND s.canonicalization_run_id = x.canonicalization_run_id
          WHERE x.request_correlation_id = ANY($1::text[])
          GROUP BY x.request_correlation_id`,
        [
          [
            timeoutContext.correlationId,
            failureContext.correlationId,
            retryContext.correlationId,
          ],
        ],
      );
      const requestsByCorrelation = new Map(
        requestInvariant.rows.map((row) => [
          row.request_correlation_id,
          row.requests,
        ]),
      );
      assert.equal(requestsByCorrelation.get(timeoutContext.correlationId), 0);
      assert.equal(requestsByCorrelation.get(failureContext.correlationId), 0);
      assert.equal(requestsByCorrelation.get(retryContext.correlationId), 1);
      const contradictionRequest = await app.createRequest(
        context(ids),
        "contradiction-lineage-request-key",
        { ...intake, sourceText: SOURCE_LANGUAGE_CANARIES[0] },
      );
      const forged = await app.createVersion(
        context(ids),
        contradictionRequest.request_id,
        {
          canonicalText: "Synthetic corrected request",
          readiness: "ready",
          fields: [
            {
              fieldId: "conflict-a",
              path: "product.quantity",
              valueState: "provided",
              languageOrigin: "entered_in_english",
              canonicalValue: "Ten units",
            },
            {
              fieldId: "conflict-b",
              path: "product.quantity.alternative",
              valueState: "provided",
              languageOrigin: "entered_in_english",
              canonicalValue: "Twenty units",
            },
          ],
        },
      );
      assert.equal(forged.match_readiness, "not_ready");
      assert.equal(forged.contradictions.length, 1);
      await assert.rejects(
        app.confirmVersion(
          context(ids),
          contradictionRequest.request_id,
          forged.version,
          true,
        ),
        (error) => error instanceof ApplicationFault && error.status === 422,
      );
      const corrected = await app.createVersion(
        context(ids),
        contradictionRequest.request_id,
        {
          canonicalText: "Synthetic corrected request",
          readiness: "not_ready",
          fields: [
            {
              fieldId: "resolved",
              path: "product.quantity",
              valueState: "provided",
              languageOrigin: "entered_in_english",
              canonicalValue: "Ten units",
            },
          ],
        },
      );
      assert.equal(corrected.match_readiness, "ready");
      const lineage = await pool.query(
        `SELECT count(*)::int AS count FROM canonical_contradiction
          WHERE account_id = $1 AND resolved_at IS NOT NULL
            AND resolution->>'resolved_by_version_id' = $2`,
        [ids.accountId, corrected.canonical_version_id],
      );
      assert.equal(lineage.rows[0].count, 1);
      assert.equal(created.canonical_language, "en");
      assert.equal(created.source_language_tag, "fa");
      assert.equal(created.match_readiness, "ready");
      assert.equal(created.confirmed, false);

      const persisted = await pool.query(
        `SELECT v.canonical_document::text AS canonical, d.digest_hmac_sha256,
              l.source_language_tag, p.provider, p.model_id, p.route_id
         FROM canonical_request_version v
         JOIN original_text_digest d USING (canonical_request_version_id)
         JOIN canonical_language_record l USING (canonical_request_version_id)
         JOIN transformation_provenance p USING (canonical_request_version_id)
        WHERE v.canonical_request_version_id = $1`,
        [created.canonical_version_id],
      );
      assert.equal(persisted.rows[0].canonical.includes(sourceCanary), false);
      assert.equal(persisted.rows[0].source_language_tag, "fa");
      assert.equal(persisted.rows[0].digest_hmac_sha256.length, 32);
      assert.equal(persisted.rows[0].provider, "synthetic_fixture");

      await assert.rejects(
        app.submitRun(context(ids), "run-idempotency-before-confirm", {
          requestId: created.request_id,
          version: 1,
        }),
        (error) => error instanceof ApplicationFault && error.status === 422,
      );
      await app.confirmVersion(context(ids), created.request_id, 1, true);
      const submitted = await app.submitRun(
        context(ids),
        "run-idempotency-after-confirm",
        {
          requestId: created.request_id,
          version: 1,
        },
      );
      assert.equal(submitted.state, "queued");
      const preRunAttribution = await pool.query(
        `SELECT count(*)::int AS count
           FROM research_run rr
           JOIN canonical_request_version v
             ON v.canonical_request_version_id = rr.canonical_request_version_id
            AND v.account_id = rr.account_id
           JOIN sourcing_request s
             ON s.request_id = v.request_id
            AND s.account_id = v.account_id
           JOIN canonicalization_execution_run x
             ON x.canonicalization_run_id = s.canonicalization_run_id
            AND x.account_id = s.account_id
          WHERE rr.run_id = $1
            AND rr.account_id = $2
            AND rr.requested_by_user_id = x.user_id
            AND x.subject_request_id = s.request_id`,
        [submitted.run_id, ids.accountId],
      );
      assert.equal(preRunAttribution.rows[0].count, 1);
      const queuedStatus = await app.getRunStatus(
        context(ids),
        submitted.run_id,
      );
      assert.equal(queuedStatus.progress.percent_complete, null);
      assert.equal(queuedStatus.progress.monotonic_sequence, 0);
      const replay = await app.submitRun(
        context(ids),
        "run-idempotency-after-confirm",
        {
          requestId: created.request_id,
          version: 1,
        },
      );
      assert.equal(replay.run_id, submitted.run_id);
      assert.equal(replay.idempotent_replay, true);

      assert.equal(
        await app.executeSyntheticRun(context(ids), submitted.run_id, "many"),
        true,
      );
      const runStatus = await app.getRunStatus(context(ids), submitted.run_id);
      assert.equal(runStatus.state, "complete");
      assert.equal(runStatus.terminal, true);
      assert.equal(runStatus.result_available, true);
      assert.equal("counts" in runStatus, false);
      const sessionAfterTerminal = await app.me(context(ids));
      assert.deepEqual(sessionAfterTerminal.execution, {
        active: 0,
        capacity: 3,
      });

      const disclosure = await app.getRunResult(context(ids), submitted.run_id);
      assert.equal(disclosure.body.candidates.length, 3);
      assert.deepEqual(findRestrictedProjectionKeys(disclosure.body), []);
      const hidden = await pool.query(
        "SELECT eligible_count, complete_result_document FROM run_result WHERE run_id = $1",
        [submitted.run_id],
      );
      assert.equal(hidden.rows[0].eligible_count, 4);
      assert.equal(
        hidden.rows[0].complete_result_document.candidates.length,
        4,
      );
      const verification = await pool.query(
        `SELECT array_agg(DISTINCT verification_status ORDER BY verification_status) AS statuses
           FROM claim WHERE run_id = $1`,
        [submitted.run_id],
      );
      assert.deepEqual(verification.rows[0].statuses, ["synthetic"]);
      const audit = await pool.query(
        "SELECT count(*)::int AS count FROM audit_event WHERE audit_id = $1 AND event_type = 'result.projected'",
        [disclosure.auditId],
      );
      assert.equal(audit.rows[0].count, 1);
      const lifecycleAudit = await pool.query(
        `SELECT event_type FROM audit_event
          WHERE account_id = $1 AND event_type IN
            ('run.queued','provider.route.selected','run.completed','result.projected')`,
        [ids.accountId],
      );
      assert.deepEqual(
        new Set(lifecycleAudit.rows.map((row) => row.event_type)),
        new Set([
          "run.queued",
          "provider.route.selected",
          "run.completed",
          "result.projected",
        ]),
      );

      await app.submitRun(context(ids), "quota-fill-second-run", {
        requestId: created.request_id,
        version: 1,
      });
      await app.submitRun(context(ids), "quota-fill-third-run", {
        requestId: created.request_id,
        version: 1,
      });
      await assert.rejects(
        app.submitRun(context(ids), "quota-denial-fourth-run", {
          requestId: created.request_id,
          version: 1,
        }),
        (error) => error instanceof ApplicationFault && error.status === 429,
      );
      const quotaDenialAudit = await pool.query(
        `SELECT count(*)::int AS count FROM audit_event
          WHERE account_id = $1 AND event_type = 'run.quota.denied' AND outcome = 'deny'`,
        [ids.accountId],
      );
      assert.equal(quotaDenialAudit.rows[0].count, 1);

      const other = await seedSubject(pool);
      const sameAccountOther = {
        accountId: other.accountId,
        userId: randomUUID(),
      };
      await pool.query(
        `INSERT INTO app_user (user_id, account_id, google_sub, email_verified, status)
         VALUES ($1,$2,$3,true,'active')`,
        [
          sameAccountOther.userId,
          other.accountId,
          `same-account-${sameAccountOther.userId}`,
        ],
      );
      await pool.query(
        `INSERT INTO entitlement_grant
           (grant_id, account_id, user_id, tier, grant_actor_kind, granted_by_user_id,
            justification, effective_from)
         VALUES ($1,$2,$3,'demo','user',$4,'same-account IDOR fixture',clock_timestamp())`,
        [randomUUID(), other.accountId, sameAccountOther.userId, other.userId],
      );
      const firstSameAccountRequest = await app.createRequest(
        context(other),
        "request-idempotency-0001",
        {
          ...intake,
          sourceText: "First same-account subject source",
          fixtureCanonicalText: "First same-account canonical request",
        },
      );
      await app.confirmVersion(
        context(other),
        firstSameAccountRequest.request_id,
        1,
        true,
      );
      const firstSameAccountRun = await app.submitRun(
        context(other),
        "run-idempotency-after-confirm",
        { requestId: firstSameAccountRequest.request_id, version: 1 },
      );
      const otherSubjectContext = {
        ...context(sameAccountOther),
        tier: "demo",
      };
      const otherSubjectRequest = await app.createRequest(
        otherSubjectContext,
        "request-idempotency-0001",
        {
          ...intake,
          sourceText: "Distinct same-account subject source",
          fixtureCanonicalText: "Distinct same-account canonical request",
        },
      );
      assert.notEqual(
        otherSubjectRequest.request_id,
        firstSameAccountRequest.request_id,
      );
      await app.confirmVersion(
        otherSubjectContext,
        otherSubjectRequest.request_id,
        1,
        true,
      );
      const otherSubjectRun = await app.submitRun(
        otherSubjectContext,
        "run-idempotency-after-confirm",
        { requestId: otherSubjectRequest.request_id, version: 1 },
      );
      assert.notEqual(otherSubjectRun.run_id, firstSameAccountRun.run_id);
      const subjectBoundIdempotency = await pool.query(
        `SELECT route, count(DISTINCT subject_user_id)::int AS subjects
           FROM idempotency_record
          WHERE account_id = $1 AND key_hash IN ($2, $3)
          GROUP BY route`,
        [
          other.accountId,
          digest("request-idempotency-0001"),
          digest("run-idempotency-after-confirm"),
        ],
      );
      assert.deepEqual(
        new Map(
          subjectBoundIdempotency.rows.map((row) => [row.route, row.subjects]),
        ),
        new Map([
          ["/api/v1/requests", 2],
          ["/api/v1/runs", 2],
        ]),
      );
      await assert.rejects(
        app.getRequest(context(other), created.request_id),
        (error) =>
          error instanceof ApplicationFault &&
          error.status === 403 &&
          error.typeSuffix === "resource-not-visible",
      );
      for (const invisibleContext of [
        context(other),
        context(sameAccountOther),
      ]) {
        for (const operation of [
          () => app.getRequest(invisibleContext, created.request_id),
          () => app.getRunStatus(invisibleContext, submitted.run_id),
          () => app.getRunResult(invisibleContext, submitted.run_id),
          () => app.cancelRun(invisibleContext, submitted.run_id),
        ]) {
          await assert.rejects(
            operation(),
            (error) =>
              error instanceof ApplicationFault &&
              error.status === 403 &&
              error.typeSuffix === "resource-not-visible",
          );
        }
      }

      const configuration = await pool.query(
        `SELECT
           (SELECT model_policy_version_id FROM model_policy_version ORDER BY version DESC LIMIT 1) AS model_id,
           (SELECT scoring_config_version_id FROM scoring_config_version ORDER BY version DESC LIMIT 1) AS scoring_id`,
      );
      for (let index = 0; index < 21; index += 1) {
        await pool.query(
          `INSERT INTO research_run
             (run_id, account_id, canonical_request_version_id, requested_by_user_id,
              tier_at_submission, state, model_policy_version_id, scoring_config_version_id,
              idempotency_key_hash, queued_at)
           VALUES ($1,$2,$3,$4,'demo','cancelled',$5,$6,$7,
                   clock_timestamp() - ($8::text || ' seconds')::interval)`,
          [
            randomUUID(),
            ids.accountId,
            created.canonical_version_id,
            ids.userId,
            configuration.rows[0].model_id,
            configuration.rows[0].scoring_id,
            digest(`cursor-run-${index}`),
            index + 1,
          ],
        );
      }
      const list = await app.listRuns(context(ids));
      assert.equal(typeof list.next_cursor, "string");
      await assert.doesNotReject(app.listRuns(context(ids), list.next_cursor));
      await assert.rejects(
        app.listRuns(context(other), list.next_cursor),
        (error) => error instanceof ApplicationFault && error.status === 400,
      );
      await assert.rejects(
        app.listRuns(context(ids), `${list.next_cursor}tampered`),
        (error) => error instanceof ApplicationFault && error.status === 400,
      );
    } finally {
      await pool.end();
    }
  },
);
