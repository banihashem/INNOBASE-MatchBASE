import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import {
  acquireExecutionLease,
  admitRunWithinQuota,
  compensateQuotaCharge,
  createPool,
  migrateDown,
  migrateUp,
  recoverExpiredExecutionLeases,
  releaseExecutionLease,
  renewExecutionLease,
} from "../../../packages/data/dist/index.js";

const databaseUrl = process.env.DATABASE_URL;
const postgresTest = databaseUrl ? test : test.skip;

function digest(value) {
  return createHash("sha256").update(value).digest();
}

async function seedAdmissionFixture(pool, tier) {
  const ids = {
    accountId: randomUUID(),
    userId: randomUUID(),
    grantorUserId: randomUUID(),
    canonicalId: randomUUID(),
    requestId: randomUUID(),
    canonicalizationRunId: randomUUID(),
    modelPolicyId: randomUUID(),
    scoringConfigId: randomUUID(),
  };
  const version = Math.floor(Math.random() * 1_000_000_000) + 1;
  await pool.query(
    "INSERT INTO account (account_id, display_name, status) VALUES ($1, 'Test account', 'active')",
    [ids.accountId],
  );
  await pool.query(
    `INSERT INTO app_user (user_id, account_id, google_sub, email_verified, status)
       VALUES ($1, $2, $3, true, 'active'), ($4, $2, $5, true, 'active')`,
    [
      ids.userId,
      ids.accountId,
      `subject-${ids.userId}`,
      ids.grantorUserId,
      `grantor-${ids.grantorUserId}`,
    ],
  );
  await pool.query(
    `INSERT INTO entitlement_grant
       (grant_id, account_id, user_id, tier, grant_actor_kind, granted_by_user_id,
        justification, effective_from)
       VALUES ($1, $2, $3, $4, $5, $6, 'test entitlement', clock_timestamp() - interval '1 hour')`,
    [
      randomUUID(),
      ids.accountId,
      ids.userId,
      tier,
      tier === "demo" ? "system" : "user",
      tier === "demo" ? null : ids.grantorUserId,
    ],
  );
  await pool.query(
    `INSERT INTO model_policy_version
       (model_policy_version_id, version, capability_map, content_sha256, released_at)
       VALUES ($1, $2, '{}'::jsonb, $3, clock_timestamp())`,
    [ids.modelPolicyId, version, digest(`model-${ids.modelPolicyId}`)],
  );
  await pool.query(
    `INSERT INTO scoring_config_version
       (scoring_config_version_id, version, weights_bp, gate_definitions, content_sha256,
        released_at, product_owner_approval_ref, sme_approval_ref, evaluation_run_ref)
       VALUES ($1, $2, '{}'::jsonb, '{}'::jsonb, $3, clock_timestamp(), 'po-test', 'sme-test', 'eval-test')`,
    [ids.scoringConfigId, version, digest(`score-${ids.scoringConfigId}`)],
  );
  await pool.query(
    `INSERT INTO canonicalization_execution_run
       (canonicalization_run_id, account_id, user_id, subject_request_id,
        request_correlation_id, started_at)
     VALUES ($1,$2,$3,$4,$5,clock_timestamp())`,
    [
      ids.canonicalizationRunId,
      ids.accountId,
      ids.userId,
      ids.requestId,
      `fixture-${ids.requestId}`,
    ],
  );
  await pool.query(
    `INSERT INTO sourcing_request
       (request_id, account_id, created_by_user_id, canonicalization_run_id, lifecycle_state)
     VALUES ($1, $2, $3, $4, 'confirmed')`,
    [ids.requestId, ids.accountId, ids.userId, ids.canonicalizationRunId],
  );
  await pool.query(
    `INSERT INTO canonical_request_version
       (canonical_request_version_id, request_id, account_id, version, canonical_document,
        match_readiness, created_by_user_id)
       VALUES ($1, $2, $3, 1, '{"product":"fixture"}'::jsonb, 'ready', $4)`,
    [ids.canonicalId, ids.requestId, ids.accountId, ids.userId],
  );
  await pool.query(
    `INSERT INTO canonical_confirmation
       (confirmation_id, canonical_request_version_id, account_id, actor_user_id, accepted, confirmed_at)
       VALUES ($1, $2, $3, $4, true, clock_timestamp())`,
    [randomUUID(), ids.canonicalId, ids.accountId, ids.userId],
  );
  return ids;
}

async function grantTier(pool, ids, tier, effectiveFrom) {
  await pool.query(
    `INSERT INTO entitlement_grant
       (grant_id, account_id, user_id, tier, grant_actor_kind, granted_by_user_id,
        justification, effective_from)
       VALUES ($1, $2, $3, $4, 'user', $5, 'test tier transition', $6)`,
    [
      randomUUID(),
      ids.accountId,
      ids.userId,
      tier,
      ids.grantorUserId,
      effectiveFrom,
    ],
  );
}

async function quotaChargeCount(pool, accountId) {
  const charged = await pool.query(
    `SELECT count(*)::int AS count
       FROM quota_ledger
      WHERE account_id = $1 AND entry_kind = 'charge'`,
    [accountId],
  );
  return charged.rows[0].count;
}

function admissionInput(ids, label) {
  return {
    accountId: ids.accountId,
    userId: ids.userId,
    canonicalRequestVersionId: ids.canonicalId,
    idempotencyKeyHash: digest(`idempotency-${label}`),
    requestHash: digest(`request-${label}`),
    modelPolicyVersionId: ids.modelPolicyId,
    scoringConfigVersionId: ids.scoringConfigId,
    correlationId: randomUUID(),
    deploymentId: "slice1-data-test",
  };
}

postgresTest(
  "PostgreSQL 18 foundation, quota, leases, recovery, and immutability",
  async (t) => {
    const pool = createPool({ connectionString: databaseUrl, max: 20 });
    try {
      await migrateDown(pool);
      assert.equal(await migrateUp(pool), true);
      assert.equal(await migrateUp(pool), false);

      await t.test(
        "requires PostgreSQL 18 and installs exactly three slots",
        async () => {
          const version = await pool.query("SHOW server_version_num");
          assert.ok(Number(version.rows[0].server_version_num) >= 180000);
          const slots = await pool.query(
            "SELECT slot_no FROM execution_lease ORDER BY slot_no",
          );
          assert.deepEqual(
            slots.rows.map((row) => row.slot_no),
            [1, 2, 3],
          );
        },
      );

      await t.test(
        "enforces Demo, Standard, and Consultant rolling-window limits under contention",
        async () => {
          const cases = [
            { tier: "demo", limit: 3 },
            { tier: "standard", limit: 5 },
            { tier: "consultant", limit: 20 },
          ];

          for (const { tier, limit } of cases) {
            const fixture = await seedAdmissionFixture(pool, tier);
            const inputs = Array.from({ length: limit + 3 }, (_, index) =>
              admissionInput(fixture, `${tier}-${index}`),
            );
            const results = await Promise.all(
              inputs.map((input) => admitRunWithinQuota(pool, input)),
            );
            const accepted = results.filter(
              (result) => result.disposition === "accepted",
            );
            const denied = results.filter(
              (result) => result.disposition === "quota_exceeded",
            );

            assert.equal(accepted.length, limit, `${tier} accepted count`);
            assert.equal(denied.length, 3, `${tier} denied count`);
            assert.equal(
              await quotaChargeCount(pool, fixture.accountId),
              limit,
            );
            assert.ok(
              results.every(
                (result) => result.tier === tier && result.limit === limit,
              ),
            );

            const denial = denied[0];
            assert.match(denial.nextCapacityAt, /Z$/);
            const expected = await pool.query(
              `SELECT min(q.charged_at + interval '168 hours') AS next_capacity_at
                 FROM quota_ledger q
                WHERE q.account_id = $1
                  AND q.entry_kind = 'charge'
                  AND NOT EXISTS (
                    SELECT 1 FROM quota_ledger c
                     WHERE c.compensates_entry_id = q.quota_entry_id
                  )`,
              [fixture.accountId],
            );
            assert.equal(
              denial.nextCapacityAt,
              expected.rows[0].next_capacity_at.toISOString(),
              `${tier} exact UTC next-capacity`,
            );
          }
        },
      );

      await t.test(
        "uses the strict (t-168h,t] window and the effective tier at submission",
        async () => {
          const boundary = await pool.query(
            `WITH anchor AS (
               SELECT '2026-08-14T12:00:00.000Z'::timestamptz AS t
             ), samples(label, charged_at) AS (
               VALUES
                 ('before_lower', '2026-08-07T11:59:59.999Z'::timestamptz),
                 ('exact_lower',  '2026-08-07T12:00:00.000Z'::timestamptz),
                 ('inside_lower', '2026-08-07T12:00:00.001Z'::timestamptz),
                 ('exact_upper',  '2026-08-14T12:00:00.000Z'::timestamptz),
                 ('after_upper',  '2026-08-14T12:00:00.001Z'::timestamptz)
             )
             SELECT array_agg(label ORDER BY charged_at) AS included
               FROM samples, anchor
              WHERE charged_at > t - interval '168 hours'
                AND charged_at <= t`,
          );
          assert.deepEqual(boundary.rows[0].included, [
            "inside_lower",
            "exact_upper",
          ]);

          const fixture = await seedAdmissionFixture(pool, "demo");
          await pool.query(
            `UPDATE entitlement_grant
                SET effective_from = clock_timestamp() - interval '3 hours'
              WHERE account_id = $1 AND user_id = $2`,
            [fixture.accountId, fixture.userId],
          );

          const demo = await admitRunWithinQuota(
            pool,
            admissionInput(fixture, "tier-demo"),
          );
          assert.equal(demo.disposition, "accepted");
          assert.equal(demo.tier, "demo");
          assert.equal(demo.limit, 3);

          await grantTier(
            pool,
            fixture,
            "consultant",
            new Date(Date.now() - 2 * 60 * 60 * 1_000),
          );
          const upgraded = await admitRunWithinQuota(
            pool,
            admissionInput(fixture, "tier-consultant"),
          );
          assert.equal(upgraded.disposition, "accepted");
          assert.equal(upgraded.tier, "consultant");
          assert.equal(upgraded.limit, 20);

          await grantTier(
            pool,
            fixture,
            "standard",
            new Date(Date.now() - 60 * 60 * 1_000),
          );
          const downgraded = await admitRunWithinQuota(
            pool,
            admissionInput(fixture, "tier-standard"),
          );
          assert.equal(downgraded.disposition, "accepted");
          assert.equal(downgraded.tier, "standard");
          assert.equal(downgraded.limit, 5);

          const persisted = await pool.query(
            `SELECT tier_at_submission
               FROM research_run
              WHERE run_id = ANY($1::uuid[])
              ORDER BY queued_at`,
            [[demo.runId, upgraded.runId, downgraded.runId]],
          );
          assert.deepEqual(
            persisted.rows.map((row) => row.tier_at_submission),
            ["demo", "consultant", "standard"],
          );
        },
      );

      await t.test(
        "does not charge idempotent retries, provider retries, or fallback attempts",
        async () => {
          const fixture = await seedAdmissionFixture(pool, "demo");
          const input = admissionInput(fixture, "retry-fallback");
          const admitted = await admitRunWithinQuota(pool, input);
          assert.equal(admitted.disposition, "accepted");

          const replay = await admitRunWithinQuota(pool, input);
          assert.equal(replay.disposition, "replayed");
          assert.equal(replay.runId, admitted.runId);

          const routeIds = [randomUUID(), randomUUID()];
          await pool.query(
            `INSERT INTO provider_route
               (provider_route_id, route_id, capability, provider, model_id,
                environment, route_kind, data_handling_posture, timeout_ms,
                max_attempts, retry_policy, config_version, enabled)
             VALUES
               ($1, $2, 'discovery', 'synthetic_fixture', 'fixture-retry', 'test',
                'synthetic_fixture', 'synthetic_fixture', 1000, 2, '{}'::jsonb, 'v1', true),
               ($3, $4, 'discovery', 'synthetic_fixture', 'fixture-fallback', 'test',
                'synthetic_fixture', 'synthetic_fixture', 1000, 1, '{}'::jsonb, 'v1', true)`,
            [
              routeIds[0],
              `retry-${routeIds[0]}`,
              routeIds[1],
              `fallback-${routeIds[1]}`,
            ],
          );

          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            for (const [index, outcome] of ["provider_error", "ok"].entries()) {
              const attemptId = randomUUID();
              const routeId = routeIds[index];
              const modelId =
                index === 0 ? "fixture-retry" : "fixture-fallback";
              await client.query(
                `INSERT INTO capability_attempt
                   (capability_attempt_id, run_id, account_id, user_id, capability,
                    provider, model_id, environment, provider_route_id, outcome,
                    started_at, completed_at)
                 VALUES ($1,$2,$3,$4,'discovery','synthetic_fixture',$5,'test',$6,$7,
                         clock_timestamp(),clock_timestamp())`,
                [
                  attemptId,
                  admitted.runId,
                  fixture.accountId,
                  fixture.userId,
                  modelId,
                  routeId,
                  outcome,
                ],
              );
              await client.query(
                `INSERT INTO provider_call
                   (provider_call_id, capability_attempt_id, run_id, account_id, user_id,
                    capability, provider, model_id, environment, route_id,
                    request_parameters, called_at)
                 VALUES ($1,$2,$3,$4,$5,'discovery','synthetic_fixture',$6,'test',$7,
                         '{}'::jsonb,clock_timestamp())`,
                [
                  randomUUID(),
                  attemptId,
                  admitted.runId,
                  fixture.accountId,
                  fixture.userId,
                  modelId,
                  index === 0
                    ? `retry-${routeIds[0]}`
                    : `fallback-${routeIds[1]}`,
                ],
              );
              await client.query(
                `INSERT INTO cost_event
                   (cost_event_id, capability_attempt_id, run_id, account_id, user_id,
                    capability, provider, model_id, environment, quantity, unit,
                    amount, currency_code, pricing_basis, pricing_version,
                    pricing_state, measurement_kind, occurred_at)
                 VALUES ($1,$2,$3,$4,$5,'discovery','synthetic_fixture',$6,'test',0,
                         'request',0,'USD','synthetic_fixture','v1','explicit_zero',
                         'measured',clock_timestamp())`,
                [
                  randomUUID(),
                  attemptId,
                  admitted.runId,
                  fixture.accountId,
                  fixture.userId,
                  modelId,
                ],
              );
            }
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }

          assert.equal(await quotaChargeCount(pool, fixture.accountId), 1);
          const attempts = await pool.query(
            `SELECT count(*)::int AS count
               FROM capability_attempt
              WHERE account_id = $1 AND run_id = $2`,
            [fixture.accountId, admitted.runId],
          );
          assert.equal(attempts.rows[0].count, 2);

          const compensationId = await compensateQuotaCharge(pool, {
            accountId: fixture.accountId,
            userId: fixture.userId,
            runId: admitted.runId,
            reasonCode: "test.retry_without_charge",
            correlationId: randomUUID(),
            deploymentId: "slice1-data-test",
          });
          const replacement = await admitRunWithinQuota(
            pool,
            admissionInput(fixture, "retry-fallback-replacement"),
          );
          assert.equal(replacement.disposition, "accepted");
          await assert.rejects(
            pool.query(
              "UPDATE quota_ledger SET reason_code = 'tampered' WHERE quota_entry_id = $1",
              [compensationId],
            ),
            (error) => error.code === "55000",
          );
          await assert.rejects(
            pool.query("DELETE FROM quota_ledger WHERE quota_entry_id = $1", [
              compensationId,
            ]),
            (error) => error.code === "55000",
          );

          await assert.rejects(
            admitRunWithinQuota(pool, {
              ...input,
              requestHash: digest("different-request"),
            }),
            /different request hash/,
          );
        },
      );

      await t.test(
        "grants only three global leases to six contenders and recovers expiry",
        async () => {
          const fixture = await seedAdmissionFixture(pool, "consultant");
          const admissions = await Promise.all(
            Array.from({ length: 6 }, (_, index) =>
              admitRunWithinQuota(
                pool,
                admissionInput(fixture, `lease-${index}`),
              ),
            ),
          );
          const runIds = admissions.map((result) => {
            assert.equal(result.disposition, "accepted");
            return result.runId;
          });
          const tokens = runIds.map((runId) => digest(`owner-${runId}`));
          const context = {
            accountId: fixture.accountId,
            actorUserId: fixture.userId,
            correlationId: randomUUID(),
            deploymentId: "slice1-data-test",
          };
          const leases = await Promise.all(
            runIds.map((runId, index) =>
              acquireExecutionLease(
                pool,
                runId,
                tokens[index],
                60_000,
                context,
              ),
            ),
          );
          const acquired = leases
            .map((lease, index) => ({ lease, index }))
            .filter(({ lease }) => lease !== null);
          assert.equal(acquired.length, 3);
          assert.deepEqual(
            new Set(acquired.map(({ lease }) => lease.slot)).size,
            3,
          );

          const first = acquired[0];
          assert.ok(
            await renewExecutionLease(
              pool,
              runIds[first.index],
              tokens[first.index],
              60_000,
            ),
          );
          assert.equal(
            await renewExecutionLease(
              pool,
              runIds[first.index],
              digest("wrong-owner"),
              60_000,
            ),
            null,
          );
          assert.equal(
            await acquireExecutionLease(
              pool,
              runIds[first.index],
              digest("wrong-owner"),
              60_000,
              context,
            ),
            null,
          );

          assert.equal(
            await releaseExecutionLease(
              pool,
              runIds[first.index],
              tokens[first.index],
              "test_handoff",
              context,
            ),
            true,
          );
          const waitingIndex = leases.findIndex((lease) => lease === null);
          assert.ok(
            await acquireExecutionLease(
              pool,
              runIds[waitingIndex],
              tokens[waitingIndex],
              60_000,
              context,
            ),
          );

          const expiring = acquired[1];
          await pool.query(
            "UPDATE execution_lease SET expires_at = acquired_at + interval '1 millisecond' WHERE run_id = $1",
            [runIds[expiring.index]],
          );
          const recovered = await recoverExpiredExecutionLeases(
            pool,
            randomUUID(),
            "slice1-data-test",
          );
          assert.ok(recovered.includes(runIds[expiring.index]));
          const state = await pool.query(
            "SELECT state FROM research_run WHERE run_id = $1",
            [runIds[expiring.index]],
          );
          assert.equal(state.rows[0].state, "failed_retryable");
          assert.ok(
            await acquireExecutionLease(
              pool,
              runIds[expiring.index],
              digest("recovered-owner"),
              60_000,
              context,
            ),
          );

          await pool.query(
            `UPDATE research_run
                SET state = 'cancelled', cancelled_at = clock_timestamp()
              WHERE run_id = ANY($1::uuid[])
                AND state NOT IN ('complete','no_responsible_match','failed','cancelled','superseded')`,
            [runIds],
          );
          const active = await pool.query(
            "SELECT count(*)::int AS count FROM execution_lease WHERE released_at IS NULL AND run_id IS NOT NULL",
          );
          assert.equal(active.rows[0].count, 0);
        },
      );

      await t.test(
        "releases and reacquires a global slot for every terminal run state",
        async () => {
          const terminalStates = [
            "complete",
            "no_responsible_match",
            "failed",
            "cancelled",
            "superseded",
          ];

          for (const terminalState of terminalStates) {
            const fixture = await seedAdmissionFixture(pool, "consultant");
            const admitted = await admitRunWithinQuota(
              pool,
              admissionInput(fixture, `terminal-${terminalState}`),
            );
            assert.equal(admitted.disposition, "accepted");
            const owner = digest(`terminal-owner-${admitted.runId}`);
            const context = {
              accountId: fixture.accountId,
              actorUserId: fixture.userId,
              correlationId: randomUUID(),
              deploymentId: "slice1-data-test",
            };
            const lease = await acquireExecutionLease(
              pool,
              admitted.runId,
              owner,
              60_000,
              context,
            );
            assert.ok(lease);

            await pool.query(
              `UPDATE research_run
                  SET state = $2,
                      completed_at = CASE WHEN $2 IN ('complete','no_responsible_match','failed','superseded')
                                          THEN clock_timestamp() ELSE completed_at END,
                      cancelled_at = CASE WHEN $2 = 'cancelled'
                                          THEN clock_timestamp() ELSE cancelled_at END
                WHERE run_id = $1`,
              [admitted.runId, terminalState],
            );
            const released = await pool.query(
              `SELECT slot_no, released_at, release_reason
                 FROM execution_lease
                WHERE run_id = $1`,
              [admitted.runId],
            );
            assert.equal(released.rowCount, 1);
            assert.ok(released.rows[0].released_at instanceof Date);
            assert.equal(
              released.rows[0].release_reason,
              `terminal_state:${terminalState}`,
            );

            const replacement = await admitRunWithinQuota(
              pool,
              admissionInput(fixture, `replacement-${terminalState}`),
            );
            assert.equal(replacement.disposition, "accepted");
            const replacementLease = await acquireExecutionLease(
              pool,
              replacement.runId,
              digest(`replacement-owner-${replacement.runId}`),
              60_000,
              context,
            );
            assert.ok(replacementLease);
            assert.equal(replacementLease.slot, lease.slot);
            await pool.query(
              `UPDATE research_run
                  SET state = 'cancelled', cancelled_at = clock_timestamp()
                WHERE run_id = $1`,
              [replacement.runId],
            );
          }
        },
      );

      await t.test(
        "rejects missing and dimension-mismatched capability ledgers at commit",
        async () => {
          const fixture = await seedAdmissionFixture(pool, "consultant");
          const admitted = await admitRunWithinQuota(
            pool,
            admissionInput(fixture, "ledger-integrity"),
          );
          assert.equal(admitted.disposition, "accepted");
          const providerRouteId = randomUUID();
          const routeId = `ledger-integrity-${providerRouteId}`;
          await pool.query(
            `INSERT INTO provider_route
               (provider_route_id, route_id, capability, provider, model_id, environment,
                route_kind, data_handling_posture, timeout_ms, max_attempts, retry_policy,
                config_version, enabled)
             VALUES ($1,$2,'CAP-SEARCH','synthetic_fixture','ledger-fixture-v1','test',
                     'synthetic_fixture','synthetic_fixture',1000,1,'{}'::jsonb,'v1',true)`,
            [providerRouteId, routeId],
          );
          const insertAttempt = async (client, attemptId) => {
            await client.query(
              `INSERT INTO capability_attempt
                 (capability_attempt_id, run_id, account_id, user_id, capability, provider,
                  model_id, environment, provider_route_id, outcome, started_at, completed_at)
               VALUES ($1,$2,$3,$4,'CAP-SEARCH','synthetic_fixture','ledger-fixture-v1',
                       'test',$5,'ok',clock_timestamp(),clock_timestamp())`,
              [
                attemptId,
                admitted.runId,
                fixture.accountId,
                fixture.userId,
                providerRouteId,
              ],
            );
          };
          const assertCommitRejected = async (write) => {
            const client = await pool.connect();
            try {
              await client.query("BEGIN");
              await write(client);
              await assert.rejects(
                client.query("COMMIT"),
                (error) => error.code === "23514",
              );
            } finally {
              await client.query("ROLLBACK").catch(() => undefined);
              client.release();
            }
          };
          await assertCommitRejected(async (client) => {
            await insertAttempt(client, randomUUID());
          });
          await assertCommitRejected(async (client) => {
            const attemptId = randomUUID();
            await insertAttempt(client, attemptId);
            await client.query(
              `INSERT INTO provider_call
                 (provider_call_id, capability_attempt_id, run_id, account_id, user_id,
                  capability, provider, model_id, environment, route_id, called_at)
               VALUES ($1,$2,$3,$4,$5,'CAP-TRANSLATE','synthetic_fixture',
                       'ledger-fixture-v1','test',$6,clock_timestamp())`,
              [
                randomUUID(),
                attemptId,
                admitted.runId,
                fixture.accountId,
                fixture.userId,
                routeId,
              ],
            );
            await client.query(
              `INSERT INTO cost_event
                 (cost_event_id, capability_attempt_id, run_id, account_id, user_id,
                  capability, provider, model_id, environment, quantity, unit, amount,
                  currency_code, pricing_basis, pricing_version, pricing_state,
                  measurement_kind, occurred_at)
               VALUES ($1,$2,$3,$4,$5,'CAP-SEARCH','synthetic_fixture','ledger-fixture-v1',
                       'test',1,'attempt',0,'USD','synthetic_fixture','v1','explicit_zero',
                       'measured',clock_timestamp())`,
              [
                randomUUID(),
                attemptId,
                admitted.runId,
                fixture.accountId,
                fixture.userId,
              ],
            );
          });
          await assert.rejects(
            pool.query(
              `INSERT INTO capability_attempt
                 (capability_attempt_id, account_id, user_id, capability, provider, model_id,
                  environment, provider_route_id, outcome, started_at, completed_at)
               VALUES ($1,$2,$3,'CAP-SEARCH','synthetic_fixture','ledger-fixture-v1','test',
                       $4,'ok',clock_timestamp(),clock_timestamp())`,
              [
                randomUUID(),
                fixture.accountId,
                fixture.userId,
                providerRouteId,
              ],
            ),
            (error) => error.code === "23514",
          );
        },
      );

      await t.test("audit records reject mutation and deletion", async () => {
        const audit = await pool.query(
          "SELECT audit_id FROM audit_event ORDER BY occurred_at LIMIT 1",
        );
        assert.ok(audit.rows[0]);
        await assert.rejects(
          pool.query(
            "UPDATE audit_event SET detail = '{}'::jsonb WHERE audit_id = $1",
            [audit.rows[0].audit_id],
          ),
          (error) => error.code === "55000",
        );
        await assert.rejects(
          pool.query("DELETE FROM audit_event WHERE audit_id = $1", [
            audit.rows[0].audit_id,
          ]),
          (error) => error.code === "55000",
        );
      });

      assert.equal(await migrateDown(pool), true);
      const removed = await pool.query(
        "SELECT to_regclass('public.account') AS account_table",
      );
      assert.equal(removed.rows[0].account_table, null);
      assert.equal(await migrateUp(pool), true);
    } finally {
      await pool.end();
    }
  },
);
