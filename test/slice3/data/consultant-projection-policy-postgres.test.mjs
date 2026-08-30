import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import {
  createPool,
  bindConsultantProjectionPolicyAtResultProduction,
  consultantProjectionConfigCanonicalJson,
  consultantProjectionConfigSha256,
  DEFAULT_CONSULTANT_PROJECTION_CONFIG,
  inTransaction,
  migrateUp,
  readConsultantProjectionPolicy,
} from "../../../packages/data/dist/index.js";

const databaseUrl = process.env.DATABASE_URL;
const postgresTest = databaseUrl ? test : test.skip;

const digest = (value) => createHash("sha256").update(value).digest();

postgresTest(
  "Consultant soft-cap bindings survive rotation and reject corrupt historical releases",
  async () => {
    const databaseName = `matchbase_task137_consultant_${randomUUID().replaceAll("-", "")}`;
    const control = createPool({ connectionString: databaseUrl, max: 1 });
    let isolated;
    try {
      await control.query(`CREATE DATABASE ${databaseName}`);
      const url = new URL(databaseUrl);
      url.pathname = `/${databaseName}`;
      isolated = createPool({ connectionString: url.toString(), max: 2 });
      await migrateUp(isolated);

      const ids = {
        account: randomUUID(),
        owner: randomUUID(),
        grantor: randomUUID(),
        request: randomUUID(),
        canonicalization: randomUUID(),
        canonical: randomUUID(),
        model: randomUUID(),
        scoring: randomUUID(),
        run: randomUUID(),
      };
      const version = Math.floor(Math.random() * 1_000_000_000) + 10;
      await isolated.query(
        "INSERT INTO account(account_id,display_name,status) VALUES($1,'Consultant test','active')",
        [ids.account],
      );
      await isolated.query(
        `INSERT INTO app_user(user_id,account_id,google_sub,status)
       VALUES($1,$3,$2,'active'),($4,$3,$5,'active')`,
        [
          ids.owner,
          `owner-${ids.owner}`,
          ids.account,
          ids.grantor,
          `grantor-${ids.grantor}`,
        ],
      );
      await isolated.query(
        `INSERT INTO model_policy_version
         (model_policy_version_id,version,capability_map,content_sha256,released_at)
       VALUES($1,$2,'{}'::jsonb,$3,clock_timestamp())`,
        [ids.model, version, digest("model")],
      );
      await isolated.query(
        `INSERT INTO scoring_config_version
         (scoring_config_version_id,version,weights_bp,gate_definitions,content_sha256,
          released_at,product_owner_approval_ref,sme_approval_ref,evaluation_run_ref)
       VALUES($1,$2,'{}'::jsonb,'{}'::jsonb,$3,clock_timestamp(),'po','sme','eval')`,
        [ids.scoring, version, digest("scoring")],
      );
      await isolated.query(
        `INSERT INTO canonicalization_execution_run
         (canonicalization_run_id,account_id,user_id,subject_request_id,
          request_correlation_id,started_at)
       VALUES($1,$2,$3,$4,'task137-policy-test',clock_timestamp())`,
        [ids.canonicalization, ids.account, ids.owner, ids.request],
      );
      await isolated.query(
        `INSERT INTO sourcing_request
         (request_id,account_id,created_by_user_id,canonicalization_run_id,lifecycle_state)
       VALUES($1,$2,$3,$4,'confirmed')`,
        [ids.request, ids.account, ids.owner, ids.canonicalization],
      );
      await isolated.query(
        `INSERT INTO canonical_request_version
         (canonical_request_version_id,request_id,account_id,version,canonical_document,
          match_readiness,created_by_user_id)
       VALUES($1,$2,$3,1,'{}'::jsonb,'ready',$4)`,
        [ids.canonical, ids.request, ids.account, ids.owner],
      );
      await isolated.query(
        `INSERT INTO canonical_confirmation
         (confirmation_id,canonical_request_version_id,account_id,actor_user_id,accepted,confirmed_at)
       VALUES($1,$2,$3,$4,true,clock_timestamp())`,
        [randomUUID(), ids.canonical, ids.account, ids.owner],
      );
      await isolated.query(
        `INSERT INTO research_run
         (run_id,account_id,canonical_request_version_id,requested_by_user_id,
          tier_at_submission,state,model_policy_version_id,scoring_config_version_id,
          idempotency_key_hash,queued_at,completed_at)
       VALUES($1,$2,$3,$4,'consultant','complete',$5,$6,$7,
              clock_timestamp(),clock_timestamp())`,
        [
          ids.run,
          ids.account,
          ids.canonical,
          ids.owner,
          ids.model,
          ids.scoring,
          digest("run-key"),
        ],
      );
      await isolated.query(
        `INSERT INTO run_result
         (run_id,account_id,outcome,eligible_count,considered_count,limitations_text,
          complete_result_document,result_sha256,assembled_at)
       VALUES($1,$2,'candidates',4,4,'fixture','{}'::jsonb,$3,clock_timestamp())`,
        [ids.run, ids.account, digest("result")],
      );

      const historicalRelease = {
        configId: randomUUID(),
        version: "consultant-soft-cap.historical-7.v1",
        softCap: 7,
        contentSha256: consultantProjectionConfigSha256(7),
      };
      await isolated.query(
        `INSERT INTO consultant_projection_config_release
           (config_id,version,definition,soft_cap,content_sha256,released_at)
         VALUES($1,$2,$3::jsonb,$4,$5,clock_timestamp())`,
        [
          historicalRelease.configId,
          historicalRelease.version,
          consultantProjectionConfigCanonicalJson(historicalRelease.softCap),
          historicalRelease.softCap,
          historicalRelease.contentSha256,
        ],
      );
      await inTransaction(isolated, (client) =>
        bindConsultantProjectionPolicyAtResultProduction(client, {
          accountId: ids.account,
          runId: ids.run,
          release: historicalRelease,
        }),
      );

      const rotatedRunId = randomUUID();
      await isolated.query(
        `INSERT INTO research_run
           (run_id,account_id,canonical_request_version_id,requested_by_user_id,
            tier_at_submission,state,model_policy_version_id,scoring_config_version_id,
            idempotency_key_hash,queued_at,completed_at)
         SELECT $1,account_id,canonical_request_version_id,requested_by_user_id,
                tier_at_submission,state,model_policy_version_id,scoring_config_version_id,
                $2,queued_at,completed_at
           FROM research_run WHERE account_id=$3 AND run_id=$4`,
        [rotatedRunId, digest("rotated-run-key"), ids.account, ids.run],
      );
      await isolated.query(
        `INSERT INTO run_result
           (run_id,account_id,outcome,eligible_count,considered_count,limitations_text,
            complete_result_document,result_sha256,assembled_at)
         SELECT $1,account_id,outcome,eligible_count,considered_count,limitations_text,
                complete_result_document,result_sha256,assembled_at
           FROM run_result WHERE account_id=$2 AND run_id=$3`,
        [rotatedRunId, ids.account, ids.run],
      );
      await inTransaction(isolated, (client) =>
        bindConsultantProjectionPolicyAtResultProduction(client, {
          accountId: ids.account,
          runId: rotatedRunId,
          release: DEFAULT_CONSULTANT_PROJECTION_CONFIG,
        }),
      );

      const historicalPolicy = await inTransaction(isolated, (client) =>
        readConsultantProjectionPolicy(client, {
          accountId: ids.account,
          runId: ids.run,
        }),
      );
      const rotatedPolicy = await inTransaction(isolated, (client) =>
        readConsultantProjectionPolicy(client, {
          accountId: ids.account,
          runId: rotatedRunId,
        }),
      );
      assert.equal(historicalPolicy.softCap, 7);
      assert.equal(historicalPolicy.configId, historicalRelease.configId);
      assert.equal(rotatedPolicy.softCap, 20);
      assert.equal(
        rotatedPolicy.configId,
        DEFAULT_CONSULTANT_PROJECTION_CONFIG.configId,
      );
      assert.ok(
        rotatedPolicy.configContentSha256.equals(
          DEFAULT_CONSULTANT_PROJECTION_CONFIG.contentSha256,
        ),
      );
      await assert.rejects(
        isolated.query(
          "UPDATE consultant_result_projection_policy SET soft_cap=20 WHERE account_id=$1 AND run_id=$2",
          [ids.account, ids.run],
        ),
        (error) => error.code === "55000",
      );
      const corruptRunId = randomUUID();
      const corruptConfigId = randomUUID();
      const corruptDigest = Buffer.alloc(32, 8);
      await isolated.query(
        `INSERT INTO consultant_projection_config_release
           (config_id,version,definition,soft_cap,content_sha256,released_at)
         VALUES($1,'consultant-soft-cap.corrupt-8.v1',$2::jsonb,8,$3,clock_timestamp())`,
        [
          corruptConfigId,
          consultantProjectionConfigCanonicalJson(8),
          corruptDigest,
        ],
      );
      await isolated.query(
        `INSERT INTO research_run
           (run_id,account_id,canonical_request_version_id,requested_by_user_id,
            tier_at_submission,state,model_policy_version_id,scoring_config_version_id,
            idempotency_key_hash,queued_at,completed_at)
         SELECT $1,account_id,canonical_request_version_id,requested_by_user_id,
                tier_at_submission,state,model_policy_version_id,scoring_config_version_id,
                $2,queued_at,completed_at
           FROM research_run WHERE account_id=$3 AND run_id=$4`,
        [corruptRunId, digest("corrupt-run-key"), ids.account, ids.run],
      );
      await isolated.query(
        `INSERT INTO run_result
           (run_id,account_id,outcome,eligible_count,considered_count,limitations_text,
            complete_result_document,result_sha256,assembled_at)
         SELECT $1,account_id,outcome,eligible_count,considered_count,limitations_text,
                complete_result_document,result_sha256,assembled_at
           FROM run_result WHERE account_id=$2 AND run_id=$3`,
        [corruptRunId, ids.account, ids.run],
      );
      await isolated.query(
        `INSERT INTO consultant_result_projection_policy
           (account_id,run_id,config_id,config_version,soft_cap,config_content_sha256)
         VALUES($1,$2,$3,'consultant-soft-cap.corrupt-8.v1',8,$4)`,
        [ids.account, corruptRunId, corruptConfigId, corruptDigest],
      );
      await assert.rejects(
        inTransaction(isolated, (client) =>
          readConsultantProjectionPolicy(client, {
            accountId: ids.account,
            runId: corruptRunId,
          }),
        ),
        /configuration drifted/iu,
      );
      await assert.rejects(
        isolated.query(
          "UPDATE consultant_projection_config_release SET soft_cap=21 WHERE config_id=$1",
          [DEFAULT_CONSULTANT_PROJECTION_CONFIG.configId],
        ),
        (error) => error.code === "55000",
      );
    } finally {
      await isolated?.end();
      await control
        .query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`,
          [databaseName],
        )
        .catch(() => undefined);
      await control
        .query(`DROP DATABASE IF EXISTS ${databaseName}`)
        .catch(() => undefined);
      await control.end();
    }
  },
);
