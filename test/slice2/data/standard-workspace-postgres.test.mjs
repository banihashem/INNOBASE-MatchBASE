import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  acquireExecutionLease,
  admitRunWithinQuota,
  createPool,
  getMigrationStatus,
  migrateDown,
  migrateDownLatest,
  migrateUp,
} from "../../../packages/data/dist/index.js";

const databaseUrl = process.env.DATABASE_URL;
const postgresTest = databaseUrl ? test : test.skip;
const foundationUrl = new URL(
  "../../../packages/data/migrations/0001_slice_1_foundation.up.sql",
  import.meta.url,
);
const foundationDownUrl = new URL(
  "../../../packages/data/migrations/0001_slice_1_foundation.down.sql",
  import.meta.url,
);

function digest(value) {
  return createHash("sha256").update(value).digest();
}

async function installFoundationOnly(pool) {
  await pool.query(await readFile(foundationUrl, "utf8"));
  await pool.query(`
    CREATE TABLE IF NOT EXISTS matchbase_schema_migration (
      migration_id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    DELETE FROM matchbase_schema_migration;
    INSERT INTO matchbase_schema_migration (migration_id)
    VALUES ('0001_slice_1_foundation');
  `);
}

async function catalogSnapshot(pool) {
  const [columns, constraints, indexes, triggers, functions, comments] =
    await Promise.all([
      pool.query(`
        SELECT table_name, ordinal_position, column_name, data_type, udt_name,
               is_nullable, column_default
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name <> 'matchbase_schema_migration'
         ORDER BY table_name, ordinal_position`),
      pool.query(`
        SELECT c.conname, c.contype, c.conrelid::regclass::text AS relation,
               pg_get_constraintdef(c.oid, true) AS definition,
               c.condeferrable, c.condeferred
          FROM pg_constraint c
          JOIN pg_namespace n ON n.oid = c.connamespace
         WHERE n.nspname = 'public'
           AND c.conrelid <> 'matchbase_schema_migration'::regclass
         ORDER BY relation, c.conname`),
      pool.query(`
        SELECT tablename, indexname, indexdef
          FROM pg_indexes
         WHERE schemaname = 'public'
           AND tablename <> 'matchbase_schema_migration'
         ORDER BY tablename, indexname`),
      pool.query(`
        SELECT c.relname AS relation, t.tgname,
               pg_get_triggerdef(t.oid, true) AS definition
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND NOT t.tgisinternal
         ORDER BY c.relname, t.tgname`),
      pool.query(`
        SELECT p.proname, pg_get_functiondef(p.oid) AS definition
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname LIKE 'matchbase_%'
         ORDER BY p.proname`),
      pool.query(`
        SELECT c.relname, obj_description(c.oid, 'pg_class') AS comment
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'
           AND c.relname <> 'matchbase_schema_migration'
           AND obj_description(c.oid, 'pg_class') IS NOT NULL
         ORDER BY c.relname`),
    ]);
  return {
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    triggers: triggers.rows,
    functions: functions.rows,
    comments: comments.rows,
  };
}

async function seedStandardOwner(pool) {
  const ids = {
    accountId: randomUUID(),
    ownerId: randomUUID(),
    grantorId: randomUUID(),
    requestId: randomUUID(),
    canonicalizationRunId: randomUUID(),
    canonicalId: randomUUID(),
    modelPolicyId: randomUUID(),
    scoringConfigId: randomUUID(),
    projectionVersionId: randomUUID(),
  };
  const version = Math.floor(Math.random() * 1_000_000_000) + 1;
  await pool.query(
    `INSERT INTO account (account_id, display_name, status)
     VALUES ($1, 'Standard owner', 'active')`,
    [ids.accountId],
  );
  await pool.query(
    `INSERT INTO app_user (user_id, account_id, google_sub, status)
     VALUES ($1,$3,$2,'active'),($4,$3,$5,'active')`,
    [
      ids.ownerId,
      `owner-${ids.ownerId}`,
      ids.accountId,
      ids.grantorId,
      `grantor-${ids.grantorId}`,
    ],
  );
  await pool.query(
    `INSERT INTO entitlement_grant
       (grant_id, account_id, user_id, tier, grant_actor_kind,
        granted_by_user_id, justification, effective_from)
     VALUES ($1,$2,$3,'standard','user',$4,'Slice 2 test',clock_timestamp()-interval '1 hour')`,
    [randomUUID(), ids.accountId, ids.ownerId, ids.grantorId],
  );
  await pool.query(
    `INSERT INTO model_policy_version
       (model_policy_version_id, version, capability_map, content_sha256, released_at)
     VALUES ($1,$2,'{}'::jsonb,$3,clock_timestamp())`,
    [ids.modelPolicyId, version, digest(`model-${ids.modelPolicyId}`)],
  );
  await pool.query(
    `INSERT INTO scoring_config_version
       (scoring_config_version_id, version, weights_bp, gate_definitions,
        content_sha256, released_at, product_owner_approval_ref,
        sme_approval_ref, evaluation_run_ref)
     VALUES ($1,$2,'{}'::jsonb,'{}'::jsonb,$3,clock_timestamp(),'po','sme','eval')`,
    [ids.scoringConfigId, version, digest(`score-${ids.scoringConfigId}`)],
  );
  await pool.query(
    `INSERT INTO projection_version
       (projection_version_id, version, definition, content_sha256, released_at)
     VALUES ($1,$2,'{}'::jsonb,$3,clock_timestamp())`,
    [
      ids.projectionVersionId,
      version,
      digest(`projection-${ids.projectionVersionId}`),
    ],
  );
  await pool.query(
    `INSERT INTO canonicalization_execution_run
       (canonicalization_run_id, account_id, user_id, subject_request_id,
        request_correlation_id, started_at)
     VALUES ($1,$2,$3,$4,$5,clock_timestamp())`,
    [
      ids.canonicalizationRunId,
      ids.accountId,
      ids.ownerId,
      ids.requestId,
      `s2-${ids.requestId}`,
    ],
  );
  await pool.query(
    `INSERT INTO sourcing_request
       (request_id, account_id, created_by_user_id, canonicalization_run_id,
        lifecycle_state)
     VALUES ($1,$2,$3,$4,'confirmed')`,
    [ids.requestId, ids.accountId, ids.ownerId, ids.canonicalizationRunId],
  );
  await pool.query(
    `INSERT INTO canonical_request_version
       (canonical_request_version_id, request_id, account_id, version,
        canonical_document, match_readiness, created_by_user_id)
     VALUES ($1,$2,$3,1,'{"product":"fixture"}'::jsonb,'ready',$4)`,
    [ids.canonicalId, ids.requestId, ids.accountId, ids.ownerId],
  );
  await pool.query(
    `INSERT INTO canonical_confirmation
       (confirmation_id, canonical_request_version_id, account_id,
        actor_user_id, accepted, confirmed_at)
     VALUES ($1,$2,$3,$4,true,clock_timestamp())`,
    [randomUUID(), ids.canonicalId, ids.accountId, ids.ownerId],
  );
  return ids;
}

function admissionInput(ids, index) {
  return {
    accountId: ids.accountId,
    userId: ids.ownerId,
    canonicalRequestVersionId: ids.canonicalId,
    idempotencyKeyHash: digest(`s2-key-${index}`),
    requestHash: digest(`s2-request-${index}`),
    modelPolicyVersionId: ids.modelPolicyId,
    scoringConfigVersionId: ids.scoringConfigId,
    correlationId: randomUUID(),
    deploymentId: "slice2-data-test",
  };
}

postgresTest(
  "Slice 2 PostgreSQL migration and Standard data invariants",
  async (t) => {
    const pool = createPool({ connectionString: databaseUrl, max: 20 });
    try {
      await migrateDown(pool);
      const residual = await pool.query(
        "SELECT to_regclass('public.account') IS NOT NULL AS present",
      );
      if (residual.rows[0].present) {
        await pool.query(await readFile(foundationDownUrl, "utf8"));
      }
      await installFoundationOnly(pool);
      const foundationCatalog = await catalogSnapshot(pool);
      assert.deepEqual(await getMigrationStatus(pool), {
        latestMigrationId: "0010_p4_live_pipeline_extraction_v2",
        appliedMigrationIds: ["0001_slice_1_foundation"],
        pendingMigrationIds: [
          "0002_slice_2_standard_workspace",
          "0003_slice_3_live_research",
          "0004_task_105_security_alert",
          "0005_task_137_live_pipeline_identity",
          "0006_task_137_consultant_projection",
          "0007_p4_audit_artifact_foundation",
          "0008_p4_google_risc_receiver",
          "0009_p4_google_risc_retention",
          "0010_p4_live_pipeline_extraction_v2",
        ],
        unknownMigrationIds: [],
        ready: false,
      });
      assert.equal(await migrateUp(pool), true);
      assert.equal((await getMigrationStatus(pool)).ready, true);
      assert.equal(await migrateUp(pool), false);

      const ids = await seedStandardOwner(pool);

      await t.test(
        "requires explicit confirmation below the versioned category threshold",
        async () => {
          const packId = randomUUID();
          const packVersionId = randomUUID();
          await pool.query(
            `INSERT INTO domain_pack
           (domain_pack_id, pack_key, display_name_english)
         VALUES ($1,'food_processing','Food processing')`,
            [packId],
          );
          await pool.query(
            `INSERT INTO domain_pack_version
           (domain_pack_version_id, domain_pack_id, version, category_code,
            category_confidence_threshold, definition, content_sha256,
            lifecycle_state, released_at)
         VALUES ($1,$2,1,'food_processing',0.800,'{}'::jsonb,$3,'active',clock_timestamp())`,
            [packVersionId, packId, digest("pack-v1")],
          );

          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            await client.query(
              `INSERT INTO request_domain_pack_activation
             (activation_id, account_id, owner_user_id,
              canonical_request_version_id, domain_pack_version_id,
              resolved_category_code, category_confidence, category_confirmed,
              activation_token_hash, expires_at)
           VALUES ($1,$2,$3,$4,$5,'food_processing',0.799,false,$6,
                   clock_timestamp()+interval '5 minutes')`,
              [
                randomUUID(),
                ids.accountId,
                ids.ownerId,
                ids.canonicalId,
                packVersionId,
                digest("rejected-activation"),
              ],
            );
            await assert.rejects(
              client.query("COMMIT"),
              (error) => error.code === "23514",
            );
          } finally {
            await client.query("ROLLBACK").catch(() => undefined);
            client.release();
          }

          const activationId = randomUUID();
          await pool.query(
            `INSERT INTO request_domain_pack_activation
           (activation_id, account_id, owner_user_id,
            canonical_request_version_id, domain_pack_version_id,
            resolved_category_code, category_confidence, category_confirmed,
            activation_token_hash, expires_at)
         VALUES ($1,$2,$3,$4,$5,'food_processing',0.799,true,$6,
                 clock_timestamp()+interval '5 minutes')`,
            [
              activationId,
              ids.accountId,
              ids.ownerId,
              ids.canonicalId,
              packVersionId,
              digest("accepted-activation"),
            ],
          );
          await assert.rejects(
            pool.query(
              "UPDATE request_domain_pack_activation SET category_confirmed=false WHERE activation_id=$1",
              [activationId],
            ),
            (error) => error.code === "55000",
          );
        },
      );

      await t.test(
        "enforces typed not-applicable state and tenant-owner compound keys",
        async () => {
          await assert.rejects(
            pool.query(
              `INSERT INTO request_field
             (field_id, canonical_request_version_id, account_id, macro_parameter,
              field_key, value_state, canonical_value, canonical_locator)
           VALUES ($1,$2,$3,'product_specification','certification',
                   'not_applicable',NULL,'product.certification')`,
              [randomUUID(), ids.canonicalId, ids.accountId],
            ),
            (error) => error.code === "23514",
          );
          await pool.query(
            `INSERT INTO request_field
           (field_id, canonical_request_version_id, account_id, macro_parameter,
            field_key, value_state, canonical_value, canonical_locator,
            value_type, not_applicable_reason)
         VALUES ($1,$2,$3,'product_specification','certification',
                 'not_applicable',NULL,'product.certification','text',
                 'The field does not apply to this category.')`,
            [randomUUID(), ids.canonicalId, ids.accountId],
          );

          const foreignAccount = randomUUID();
          const foreignUser = randomUUID();
          await pool.query(
            "INSERT INTO account (account_id,display_name,status) VALUES ($1,'Foreign','active')",
            [foreignAccount],
          );
          await pool.query(
            `INSERT INTO app_user (user_id,account_id,google_sub,status)
         VALUES ($1,$2,$3,'active')`,
            [foreignUser, foreignAccount, `foreign-${foreignUser}`],
          );
          await assert.rejects(
            pool.query(
              `INSERT INTO conditional_requirement
             (conditional_requirement_id, account_id, owner_user_id,
              canonical_request_version_id, condition_english,
              required_result_english, requirement_level, validation_locator,
              validation_digest_hmac_sha256, validation_key_id)
           VALUES ($1,$2,$3,$4,'If regulated','Approval is mandatory',
                   'mandatory','bytes:0-12',$5,'test-key')`,
              [
                randomUUID(),
                foreignAccount,
                foreignUser,
                ids.canonicalId,
                digest("proof"),
              ],
            ),
            (error) => error.code === "23503",
          );
        },
      );

      const admissions = [];
      await t.test(
        "admits exactly five Standard submissions in 168 hours",
        async () => {
          for (let index = 0; index < 6; index += 1) {
            admissions.push(
              await admitRunWithinQuota(pool, admissionInput(ids, index)),
            );
          }
          assert.deepEqual(
            admissions.map((entry) => entry.disposition),
            [
              "accepted",
              "accepted",
              "accepted",
              "accepted",
              "accepted",
              "quota_exceeded",
            ],
          );
          assert.equal(admissions[4].remaining, 0);
          assert.ok(admissions[5].nextCapacityAt);
        },
      );

      await t.test(
        "never allocates more than three global leases",
        async () => {
          const accepted = admissions.filter(
            (entry) => entry.disposition === "accepted",
          );
          const context = {
            accountId: ids.accountId,
            actorUserId: ids.ownerId,
            correlationId: randomUUID(),
            deploymentId: "slice2-data-test",
          };
          const leases = await Promise.all(
            accepted.map((entry) =>
              acquireExecutionLease(
                pool,
                entry.runId,
                digest(`lease-${entry.runId}`),
                60_000,
                context,
              ),
            ),
          );
          assert.equal(leases.filter(Boolean).length, 3);
          const active = await pool.query(
            "SELECT count(*)::int AS count FROM execution_lease WHERE run_id IS NOT NULL AND released_at IS NULL",
          );
          assert.equal(active.rows[0].count, 3);
        },
      );

      await t.test(
        "requires exact immutable six-dimension score and evidence lineage",
        async () => {
          const runId = admissions[0].runId;
          const candidateId = randomUUID();
          const scoreId = randomUUID();
          await pool.query(
            `INSERT INTO candidate
           (candidate_id,run_id,account_id,canonical_name,deterministic_rank,eligible)
         VALUES ($1,$2,$3,'Fixture Organization',1,true)`,
            [candidateId, runId, ids.accountId],
          );
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            await client.query(
              `INSERT INTO candidate_score
             (candidate_score_id,account_id,run_id,candidate_id,
              compatibility_score,fit_band,displayed_band,evidence_confidence,
              scoring_config_version_id,scored_at)
           VALUES ($1,$2,$3,$4,78,'strong','strong','medium',$5,clock_timestamp())`,
              [scoreId, ids.accountId, runId, candidateId, ids.scoringConfigId],
            );
            const dimensions = [
              ["category_product_fit", 25],
              ["compliance_certification_fit", 20],
              ["volume_capacity_fit", 15],
              ["price_tier_fit", 15],
              ["positioning_brand_fit", 15],
              ["geographic_reach_fit", 10],
            ];
            for (const [dimension, weight] of dimensions) {
              await client.query(
                `INSERT INTO candidate_dimension_score
               (candidate_score_id,account_id,dimension,score,weight_percent,
                critical,rationale_english)
             VALUES ($1,$2,$3,78,$4,false,'Deterministic fixture rationale.')`,
                [scoreId, ids.accountId, dimension, weight],
              );
            }
            await client.query("COMMIT");
          } finally {
            await client.query("ROLLBACK").catch(() => undefined);
            client.release();
          }
          await assert.rejects(
            pool.query(
              "UPDATE candidate_score SET compatibility_score=79 WHERE candidate_score_id=$1",
              [scoreId],
            ),
            (error) => error.code === "55000",
          );

          const evidenceId = randomUUID();
          const supportId = randomUUID();
          await pool.query(
            `INSERT INTO evidence_item
           (evidence_item_id,run_id,account_id,source_kind,local_fixture_id,title,
            publisher_domain,retrieved_at,content_sha256,verification_disposition,
            accessed_at,source_tier,extracted_support,extracted_support_locator,
            freshness_policy_version,volatility_class,required_corroboration)
         VALUES ($1,$2,$3,'synthetic_fixture','fixture://s2/evidence/1',
                 'Synthetic fixture evidence','fixture.invalid',clock_timestamp(),$4,
                 'synthetic',clock_timestamp(),'fixture','English support text',
                 '{"start":0,"end":20}'::jsonb,'v1','low',1)`,
            [evidenceId, runId, ids.accountId, digest("evidence")],
          );
          await pool.query(
            `INSERT INTO evidence_support
           (evidence_support_id,account_id,run_id,evidence_item_id,
            verification_status,freshness_status,corroboration_status,
            extracted_support_start,extracted_support_end,assessed_at,policy_version)
         VALUES ($1,$2,$3,$4,'verified','fresh','satisfied',0,20,
                 clock_timestamp(),'v1')`,
            [supportId, ids.accountId, runId, evidenceId],
          );
          await assert.rejects(
            pool.query(
              "DELETE FROM evidence_support WHERE evidence_support_id=$1",
              [supportId],
            ),
            (error) => error.code === "55000",
          );
        },
      );

      await t.test(
        "keeps projection, audit, quota, and source-language evidence append-only",
        async () => {
          const runId = admissions[0].runId;
          const scarcityAnalysisId = randomUUID();
          const persistedReducingConstraints = [
            {
              constraint_id: "STD-CON-MANDATORY-CERTIFICATION",
              eliminated_count: 1,
            },
            {
              constraint_id: "STD-CON-MINIMUM-CAPACITY",
              eliminated_count: 1,
            },
          ];
          const persistedRelaxations = ["STD-CON-MINIMUM-CAPACITY"];
          await pool.query(
            `INSERT INTO run_result
               (run_id,account_id,outcome,eligible_count,considered_count,
                scarcity,limitations_text,complete_result_document,
                result_sha256,assembled_at)
             VALUES ($1,$2,'scarcity',1,3,'{"state":"one"}'::jsonb,
                     'Synthetic fixture limitations.',
                     '{"schema_version":"standard-evidence-graph.v1"}'::jsonb,
                     $3,clock_timestamp())`,
            [runId, ids.accountId, digest(`result-${runId}`)],
          );
          await pool.query(
            `INSERT INTO scarcity_analysis
               (scarcity_analysis_id,account_id,run_id,outcome,
                unmet_constraints,permitted_relaxations,analysis_english)
             VALUES ($1,$2,$3,'scarcity',$4::jsonb,$5::jsonb,
                     'Fewer than three candidates met all mandatory constraints.')`,
            [
              scarcityAnalysisId,
              ids.accountId,
              runId,
              JSON.stringify(persistedReducingConstraints),
              JSON.stringify(persistedRelaxations),
            ],
          );
          const persistedScarcity = await pool.query(
            `SELECT outcome,unmet_constraints,permitted_relaxations
               FROM scarcity_analysis
              WHERE scarcity_analysis_id=$1 AND account_id=$2 AND run_id=$3`,
            [scarcityAnalysisId, ids.accountId, runId],
          );
          assert.deepEqual(persistedScarcity.rows[0], {
            outcome: "scarcity",
            unmet_constraints: persistedReducingConstraints,
            permitted_relaxations: persistedRelaxations,
          });
          await assert.rejects(
            pool.query(
              `UPDATE scarcity_analysis
                  SET permitted_relaxations='[]'::jsonb
                WHERE scarcity_analysis_id=$1`,
              [scarcityAnalysisId],
            ),
            (error) => error.code === "55000",
          );
          await assert.rejects(
            pool.query(
              "DELETE FROM scarcity_analysis WHERE scarcity_analysis_id=$1",
              [scarcityAnalysisId],
            ),
            (error) => error.code === "55000",
          );
          const scarcityAfterRejectedMutations = await pool.query(
            `SELECT outcome,unmet_constraints,permitted_relaxations
               FROM scarcity_analysis
              WHERE scarcity_analysis_id=$1`,
            [scarcityAnalysisId],
          );
          assert.deepEqual(
            scarcityAfterRejectedMutations.rows[0],
            persistedScarcity.rows[0],
          );
          const projectionServingId = randomUUID();
          await pool.query(
            `INSERT INTO projection_serving
           (projection_serving_id,account_id,subject_user_id,tier,resource_kind,
            resource_id,projection_version_id,fields_released,item_count,
            request_correlation_id,request_id,run_id)
         VALUES ($1,$2,$3,'standard','research_run',$4,$5,
                 ARRAY['run_id','state'],0,$6,$7,$4)`,
            [
              projectionServingId,
              ids.accountId,
              ids.ownerId,
              runId,
              ids.projectionVersionId,
              randomUUID(),
              ids.requestId,
            ],
          );
          await assert.rejects(
            pool.query(
              "UPDATE projection_serving SET item_count=1 WHERE projection_serving_id=$1",
              [projectionServingId],
            ),
            (error) => error.code === "55000",
          );
          const sourceColumns = await pool.query(`
        SELECT table_name,column_name
          FROM information_schema.columns
         WHERE table_schema='public'
           AND (column_name ILIKE '%source_text%'
             OR column_name ILIKE '%original_text%')
           AND column_name <> 'digest_hmac_sha256'
         ORDER BY table_name,column_name`);
          assert.deepEqual(sourceColumns.rows, []);
          const cost = await pool.query(
            "SELECT count(*)::int AS count FROM cost_event WHERE account_id=$1",
            [ids.accountId],
          );
          assert.equal(cost.rows[0].count, 0);
          const quota = await pool.query(
            "SELECT count(*)::int AS count FROM quota_ledger WHERE account_id=$1 AND entry_kind='charge'",
            [ids.accountId],
          );
          assert.equal(quota.rows[0].count, 5);
        },
      );

      assert.equal(
        await migrateDownLatest(pool),
        "0010_p4_live_pipeline_extraction_v2",
      );
      assert.equal(
        await migrateDownLatest(pool),
        "0009_p4_google_risc_retention",
      );
      assert.equal(
        await migrateDownLatest(pool),
        "0008_p4_google_risc_receiver",
      );
      assert.equal(
        await migrateDownLatest(pool),
        "0007_p4_audit_artifact_foundation",
      );
      assert.equal(
        await migrateDownLatest(pool),
        "0006_task_137_consultant_projection",
      );
      assert.equal(
        await migrateDownLatest(pool),
        "0005_task_137_live_pipeline_identity",
      );
      assert.equal(
        await migrateDownLatest(pool),
        "0004_task_105_security_alert",
      );
      assert.equal(await migrateDownLatest(pool), "0003_slice_3_live_research");
      assert.equal(
        await migrateDownLatest(pool),
        "0002_slice_2_standard_workspace",
      );
      const postDownCatalog = await catalogSnapshot(pool);
      assert.deepEqual(postDownCatalog, foundationCatalog);
      const status = await getMigrationStatus(pool);
      assert.deepEqual(status.appliedMigrationIds, ["0001_slice_1_foundation"]);
      assert.equal(status.ready, false);
      const foundationUsable = await pool.query(
        "SELECT count(*)::int AS count FROM account WHERE account_id=$1",
        [ids.accountId],
      );
      assert.equal(foundationUsable.rows[0].count, 1);
      assert.equal(await migrateUp(pool), true);
      assert.equal((await getMigrationStatus(pool)).ready, true);
    } finally {
      await pool.end();
    }
  },
);
