import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import {
  createLiveResearchPipelineIdentity,
  LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA,
  PostgresLiveResearchAtomicLedger,
} from "../../packages/application/dist/index.js";
import {
  admitRunWithinQuota,
  createPool,
  migrateDown,
  migrateUp,
} from "../../packages/data/dist/index.js";

const databaseUrl = process.env.DATABASE_URL;
const postgresTest = databaseUrl ? test : test.skip;
const digest = (value) => createHash("sha256").update(value).digest();
const digestHex = (value) => digest(value).toString("hex");

postgresTest(
  "pipeline identity remains fail-closed across PostgreSQL drift and races",
  async (context) => {
    const pool = createPool({ connectionString: databaseUrl, max: 8 });
    try {
      await migrateDown(pool);
      await migrateUp(pool);

      const accountId = randomUUID();
      const userId = randomUUID();
      const grantorId = randomUUID();
      const modelPolicyId = randomUUID();
      const scoringConfigId = randomUUID();
      const routePolicyId = randomUUID();
      const version = Math.floor(Math.random() * 1_000_000_000) + 1;
      const routePolicyVersion = "pipeline-identity-postgres.v1";
      const originalHashes = {
        model: digest("pipeline-identity-model-policy"),
        route: digest("pipeline-identity-route-policy"),
        scoring: digest("pipeline-identity-scoring-config"),
      };

      await pool.query(
        "INSERT INTO account(account_id,display_name,status) VALUES($1,'Pipeline identity qualification','active')",
        [accountId],
      );
      await pool.query(
        `INSERT INTO app_user(user_id,account_id,google_sub,status)
         VALUES($1,$2,$3,'active'),($4,$2,$5,'active')`,
        [
          userId,
          accountId,
          `pipeline-owner-${userId}`,
          grantorId,
          `pipeline-grantor-${grantorId}`,
        ],
      );
      await pool.query(
        `INSERT INTO entitlement_grant
           (grant_id,account_id,user_id,tier,grant_actor_kind,granted_by_user_id,
            justification,effective_from)
         VALUES($1,$2,$3,'consultant','user',$4,
                'Pipeline identity PostgreSQL qualification',clock_timestamp()-interval '1 hour')`,
        [randomUUID(), accountId, userId, grantorId],
      );
      await pool.query(
        `INSERT INTO model_policy_version
           (model_policy_version_id,version,capability_map,content_sha256,released_at)
         VALUES($1,$2,'{}',$3,clock_timestamp())`,
        [modelPolicyId, version, originalHashes.model],
      );
      await pool.query(
        `INSERT INTO scoring_config_version
           (scoring_config_version_id,version,weights_bp,gate_definitions,
            content_sha256,released_at,product_owner_approval_ref,sme_approval_ref,
            evaluation_run_ref)
         VALUES($1,$2,'{}','{}',$3,clock_timestamp(),'po','sme','evaluation')`,
        [scoringConfigId, version, originalHashes.scoring],
      );
      await pool.query(
        `INSERT INTO research_route_policy
           (research_route_policy_id,schema_version,policy_version,environment,
            activation_state,official_evidence,qualification_budget,content_sha256)
         VALUES($1,'research-route-policy.v1',$2,'test','qualified',
                '["direct","openrouter"]',
                '{"max_calls":2,"max_cost_usd":1}',$3)`,
        [routePolicyId, routePolicyVersion, originalHashes.route],
      );

      const pipelineIdentity = createLiveResearchPipelineIdentity({
        outputSchema: LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA,
        researchRoutePolicyId: routePolicyId,
        routePolicyVersion,
        routePolicyCanonicalSha256: originalHashes.route.toString("hex"),
        modelPolicyVersionId: modelPolicyId,
        modelPolicyVersion: String(version),
        modelPolicyContentSha256: originalHashes.model.toString("hex"),
        scoringConfigVersionId: scoringConfigId,
        scoringConfigVersion: String(version),
        scoringConfigContentSha256: originalHashes.scoring.toString("hex"),
      });

      const seedRun = async (label) => {
        const requestId = randomUUID();
        const canonicalizationRunId = randomUUID();
        const canonicalRequestVersionId = randomUUID();
        await pool.query(
          `INSERT INTO canonicalization_execution_run
             (canonicalization_run_id,account_id,user_id,subject_request_id,
              request_correlation_id,started_at)
           VALUES($1,$2,$3,$4,$5,clock_timestamp())`,
          [canonicalizationRunId, accountId, userId, requestId, randomUUID()],
        );
        await pool.query(
          `INSERT INTO sourcing_request
             (request_id,account_id,created_by_user_id,canonicalization_run_id,
              lifecycle_state)
           VALUES($1,$2,$3,$4,'confirmed')`,
          [requestId, accountId, userId, canonicalizationRunId],
        );
        await pool.query(
          `INSERT INTO canonical_request_version
             (canonical_request_version_id,request_id,account_id,version,
              canonical_document,match_readiness,created_by_user_id)
           VALUES($1,$2,$3,1,$4::jsonb,'ready',$5)`,
          [
            canonicalRequestVersionId,
            requestId,
            accountId,
            JSON.stringify({
              schema_version: "canonical-request.v1",
              canonical_text: `Pipeline identity fixture ${label}`,
            }),
            userId,
          ],
        );
        await pool.query(
          `INSERT INTO canonical_confirmation
             (confirmation_id,canonical_request_version_id,account_id,
              actor_user_id,accepted,confirmed_at)
           VALUES($1,$2,$3,$4,true,clock_timestamp())`,
          [randomUUID(), canonicalRequestVersionId, accountId, userId],
        );
        const admission = await admitRunWithinQuota(pool, {
          accountId,
          userId,
          canonicalRequestVersionId,
          idempotencyKeyHash: digest(`pipeline-identity-idempotency:${label}`),
          requestHash: digest(`pipeline-identity-request:${label}`),
          modelPolicyVersionId: modelPolicyId,
          scoringConfigVersionId: scoringConfigId,
          correlationId: randomUUID(),
          deploymentId: "pipeline-identity-postgres-qualification",
        });
        assert.equal(admission.disposition, "accepted");
        await pool.query(
          `UPDATE research_run SET research_mode='qualified_live_research'
            WHERE account_id=$1 AND run_id=$2 AND state='queued'`,
          [accountId, admission.runId],
        );
        return admission.runId;
      };

      const ledger = (identity, now, leaseMs = 1_000) =>
        new PostgresLiveResearchAtomicLedger({
          pool,
          accountId,
          userId,
          policyId: routePolicyId,
          pipelineIdentity: identity,
          leaseMs,
          heartbeatMs: 30,
          waitMs: 200,
          ...(now ? { now } : {}),
        });

      await context.test(
        "SQL rejects missing, wrong-type, and wrong-digest pipeline identities",
        async () => {
          const runId = await seedRun("sql-shape");
          const lease = await pool.query(
            "SELECT slot_no FROM execution_lease ORDER BY slot_no LIMIT 1",
          );
          const insert = async (executionId, identity) =>
            await pool.query(
              `INSERT INTO live_research_execution_reservation
                 (execution_id,account_id,run_id,generation,
                  ownership_token_sha256,state,execution_lease_slot,
                  execution_lease_generation,pipeline_identity_record,
                  lease_expires_at,claimed_at,updated_at)
               VALUES($1,$2,$3,1,$4,'in_progress',$5,1,$6::jsonb,
                      clock_timestamp()+interval '1 minute',clock_timestamp(),
                      clock_timestamp())`,
              [
                executionId,
                accountId,
                runId,
                digest(executionId),
                lease.rows[0].slot_no,
                JSON.stringify(identity),
              ],
            );
          const invalidIdentities = [
            [
              "missing-key",
              Object.fromEntries(
                Object.entries(pipelineIdentity).filter(
                  ([key]) => key !== "scoringConfigContentSha256",
                ),
              ),
            ],
            ["wrong-type", { ...pipelineIdentity, modelPolicyVersion: 1 }],
            [
              "malformed-digest",
              {
                ...pipelineIdentity,
                routePolicyCanonicalSha256: "g".repeat(64),
              },
            ],
            [
              "wrong-schema-digest",
              {
                ...pipelineIdentity,
                outputSchemaCanonicalSha256: "0".repeat(64),
              },
            ],
          ];
          for (const [label, identity] of invalidIdentities)
            await assert.rejects(
              insert(`EXEC-SQL-${label.toUpperCase()}`, identity),
              /live_research_pipeline_identity_closed/iu,
            );
          const stored = await pool.query(
            `SELECT count(*)::int count
               FROM live_research_execution_reservation WHERE run_id=$1`,
            [runId],
          );
          assert.equal(stored.rows[0].count, 0);
        },
      );

      await context.test(
        "real reservation rejects an invalid first pin before transport",
        async () => {
          const runId = await seedRun("invalid-first-pin");
          let transportCalls = 0;
          const invalidFirstPin = {
            ...pipelineIdentity,
            modelPolicyContentSha256: digestHex("forged-first-pin"),
          };
          await assert.rejects(async () => {
            const reservation = await ledger(invalidFirstPin).reserveExecution(
              "EXEC-INVALID-FIRST-PIN",
              runId,
            );
            if (reservation.state === "acquired")
              await ledger(invalidFirstPin).withPipelineIdentityAdmission(
                reservation.ownershipToken,
                reservation.generation,
                "EXEC-INVALID-FIRST-PIN",
                runId,
                async () => {
                  transportCalls += 1;
                },
              );
          }, /drifted at modelPolicyContentSha256/iu);
          assert.equal(transportCalls, 0);
          const stored = await pool.query(
            `SELECT count(*)::int count
               FROM live_research_execution_reservation WHERE run_id=$1`,
            [runId],
          );
          assert.equal(stored.rows[0].count, 0);
        },
      );

      await context.test(
        "same-version authoritative content drift is rejected by the database",
        async () => {
          const runId = await seedRun("same-version-drift");
          const ownedLedger = ledger(pipelineIdentity);
          const reservation = await ownedLedger.reserveExecution(
            "EXEC-SAME-VERSION-DRIFT",
            runId,
          );
          assert.equal(reservation.state, "acquired");
          if (reservation.state !== "acquired") return;
          const cases = [
            {
              field: "modelPolicyContentSha256",
              table: "model_policy_version",
              idColumn: "model_policy_version_id",
              id: modelPolicyId,
            },
            {
              field: "scoringConfigContentSha256",
              table: "scoring_config_version",
              idColumn: "scoring_config_version_id",
              id: scoringConfigId,
            },
          ];
          let transportCalls = 0;
          for (const drift of cases) {
            await assert.rejects(
              pool.query(
                `UPDATE ${drift.table} SET content_sha256=$1 WHERE ${drift.idColumn}=$2`,
                [digest(`same-version-drift:${drift.field}`), drift.id],
              ),
              /pinned live pipeline material is immutable/iu,
            );
            await ownedLedger.withPipelineIdentityAdmission(
              reservation.ownershipToken,
              reservation.generation,
              "EXEC-SAME-VERSION-DRIFT",
              runId,
              async () => {
                transportCalls += 1;
              },
            );
            const unchangedVersion = await pool.query(
              `SELECT version::text version FROM ${drift.table} WHERE ${drift.idColumn}=$1`,
              [drift.id],
            );
            assert.equal(unchangedVersion.rows[0].version, String(version));
          }
          assert.equal(transportCalls, 2);
          let routeTransportCalls = 0;
          await assert.rejects(
            pool.query(
              `UPDATE research_route_policy SET content_sha256=$1
                WHERE research_route_policy_id=$2`,
              [digest("same-version-route-policy-drift"), routePolicyId],
            ),
            /research_route_policy is append-only/iu,
          );
          assert.equal(routeTransportCalls, 0);
        },
      );

      await context.test(
        "crash reclaim preserves immutable identity and admits transport",
        async () => {
          const runId = await seedRun("crash-reclaim-drift");
          let fakeNow = new Date();
          const firstLedger = ledger(pipelineIdentity, () => fakeNow, 120);
          const abandoned = await firstLedger.reserveExecution(
            "EXEC-CRASH-RECLAIM-DRIFT",
            runId,
          );
          assert.equal(abandoned.state, "acquired");
          fakeNow = new Date(fakeNow.getTime() + 121);
          await assert.rejects(
            pool.query(
              `UPDATE model_policy_version SET content_sha256=$1
                WHERE model_policy_version_id=$2`,
              [digest("crash-reclaim-same-version-drift"), modelPolicyId],
            ),
            /pinned live pipeline material is immutable/iu,
          );
          let transportCalls = 0;
          const recoveryLedger = ledger(pipelineIdentity, () => fakeNow);
          const recovered = await recoveryLedger.reserveExecution(
            "EXEC-CRASH-RECLAIM-DRIFT",
            runId,
          );
          assert.equal(recovered.state, "acquired");
          if (recovered.state === "acquired")
            await recoveryLedger.withPipelineIdentityAdmission(
              recovered.ownershipToken,
              recovered.generation,
              "EXEC-CRASH-RECLAIM-DRIFT",
              runId,
              async () => {
                transportCalls += 1;
              },
            );
          assert.equal(transportCalls, 1);
          const reservation = await pool.query(
            `SELECT generation::int generation,
                    (SELECT count(*)::int FROM live_research_execution_reservation_event
                      WHERE run_id=$1 AND event_type='reclaimed_after_expiry') reclaims
               FROM live_research_execution_reservation WHERE run_id=$1`,
            [runId],
          );
          assert.deepEqual(reservation.rows[0], { generation: 2, reclaims: 1 });
        },
      );

      await context.test(
        "pinned authoritative rows are immutable without transport locks",
        async () => {
          const runId = await seedRun("authoritative-race");
          const ownedLedger = ledger(pipelineIdentity);
          const reservation = await ownedLedger.reserveExecution(
            "EXEC-AUTHORITATIVE-RACE",
            runId,
          );
          assert.equal(reservation.state, "acquired");
          if (reservation.state !== "acquired") return;

          await assert.rejects(
            pool.query(
              `UPDATE scoring_config_version SET content_sha256=$1
                WHERE scoring_config_version_id=$2`,
              [digest("updater-wins-race"), scoringConfigId],
            ),
            /pinned live pipeline material is immutable/iu,
          );

          let releaseTransport;
          let transportStarted;
          const transportGate = new Promise((resolve) => {
            releaseTransport = resolve;
          });
          const started = new Promise((resolve) => {
            transportStarted = resolve;
          });
          let transportCalls = 0;
          const admittedTransport = ownedLedger.withPipelineIdentityAdmission(
            reservation.ownershipToken,
            reservation.generation,
            "EXEC-AUTHORITATIVE-RACE",
            runId,
            async () => {
              transportCalls += 1;
              transportStarted();
              await transportGate;
              return "transport-complete";
            },
          );
          await started;
          await assert.rejects(
            pool.query(
              `UPDATE model_policy_version SET content_sha256=$1
                WHERE model_policy_version_id=$2`,
              [digest("transport-holds-share-lock"), modelPolicyId],
            ),
            /pinned live pipeline material is immutable/iu,
          );
          assert.equal(transportCalls, 1);
          releaseTransport();
          assert.equal(await admittedTransport, "transport-complete");

          let subsequentCalls = 0;
          await ownedLedger.withPipelineIdentityAdmission(
            reservation.ownershipToken,
            reservation.generation,
            "EXEC-AUTHORITATIVE-RACE",
            runId,
            async () => {
              subsequentCalls += 1;
            },
          );
          assert.equal(subsequentCalls, 1);
        },
      );
    } finally {
      await migrateDown(pool).catch(() => undefined);
      await pool.end();
    }
  },
);
