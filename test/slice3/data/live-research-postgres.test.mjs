import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  admitRunWithinQuota,
  createPool,
  migrateDown,
  migrateUp,
} from "../../../packages/data/dist/index.js";

const databaseUrl = process.env.DATABASE_URL;
const postgresTest = databaseUrl ? test : test.skip;
const digest = (value) => createHash("sha256").update(value).digest();

postgresTest(
  "Slice 3 live-research ledgers are exact, tenant-bound, and immutable",
  async () => {
    const pool = createPool({ connectionString: databaseUrl, max: 8 });
    try {
      await migrateDown(pool);
      await migrateUp(pool);
      const accountId = randomUUID();
      const userId = randomUUID();
      const grantorId = randomUUID();
      const requestId = randomUUID();
      const canonicalizationId = randomUUID();
      const canonicalId = randomUUID();
      const modelPolicyId = randomUUID();
      const scoringId = randomUUID();
      const version = Math.floor(Math.random() * 1_000_000_000) + 1;
      await pool.query(
        "INSERT INTO account(account_id,display_name,status) VALUES($1,'Slice 3','active')",
        [accountId],
      );
      await pool.query(
        `INSERT INTO app_user(user_id,account_id,google_sub,status)
       VALUES($1,$2,$3,'active'),($4,$2,$5,'active')`,
        [
          userId,
          accountId,
          `owner-${userId}`,
          grantorId,
          `grantor-${grantorId}`,
        ],
      );
      await pool.query(
        `INSERT INTO entitlement_grant(grant_id,account_id,user_id,tier,grant_actor_kind,granted_by_user_id,justification,effective_from)
       VALUES($1,$2,$3,'demo','user',$4,'Slice 3 fixture',clock_timestamp()-interval '1 hour')`,
        [randomUUID(), accountId, userId, grantorId],
      );
      await pool.query(
        `INSERT INTO model_policy_version(model_policy_version_id,version,capability_map,content_sha256,released_at)
       VALUES($1,$2,'{}',$3,clock_timestamp())`,
        [modelPolicyId, version, digest("model-policy")],
      );
      await pool.query(
        `INSERT INTO scoring_config_version(scoring_config_version_id,version,weights_bp,gate_definitions,content_sha256,released_at,product_owner_approval_ref,sme_approval_ref,evaluation_run_ref)
       VALUES($1,$2,'{}','{}',$3,clock_timestamp(),'po','sme','evaluation')`,
        [scoringId, version, digest("scoring")],
      );
      await pool.query(
        `INSERT INTO canonicalization_execution_run(canonicalization_run_id,account_id,user_id,subject_request_id,request_correlation_id,started_at)
       VALUES($1,$2,$3,$4,$5,clock_timestamp())`,
        [canonicalizationId, accountId, userId, requestId, randomUUID()],
      );
      await pool.query(
        `INSERT INTO sourcing_request(request_id,account_id,created_by_user_id,canonicalization_run_id,lifecycle_state)
       VALUES($1,$2,$3,$4,'confirmed')`,
        [requestId, accountId, userId, canonicalizationId],
      );
      await pool.query(
        `INSERT INTO canonical_request_version(canonical_request_version_id,request_id,account_id,version,canonical_document,match_readiness,created_by_user_id)
       VALUES($1,$2,$3,1,'{"product":"benign fixture"}','ready',$4)`,
        [canonicalId, requestId, accountId, userId],
      );
      await pool.query(
        `INSERT INTO canonical_confirmation(confirmation_id,canonical_request_version_id,account_id,actor_user_id,accepted,confirmed_at)
       VALUES($1,$2,$3,$4,true,clock_timestamp())`,
        [randomUUID(), canonicalId, accountId, userId],
      );
      const admission = await admitRunWithinQuota(pool, {
        accountId,
        userId,
        canonicalRequestVersionId: canonicalId,
        idempotencyKeyHash: digest("slice3-idempotency"),
        requestHash: digest("slice3-request"),
        modelPolicyVersionId: modelPolicyId,
        scoringConfigVersionId: scoringId,
        correlationId: randomUUID(),
        deploymentId: "slice3-data-test",
      });
      assert.equal(admission.disposition, "accepted");
      const runId = admission.runId;
      const policyId = randomUUID();
      const snapshotId = randomUUID();
      const providerRouteId = randomUUID();
      const capabilityAttemptId = randomUUID();
      const providerCallId = randomUUID();
      const costEventId = randomUUID();
      const providerAttemptId = randomUUID();
      const searchAttemptId = randomUUID();
      const fetchAttemptId = randomUUID();
      const evidenceId = randomUUID();
      const sourceDocumentId = randomUUID();
      const candidateId = randomUUID();
      await pool.query(
        `INSERT INTO research_route_policy(research_route_policy_id,schema_version,policy_version,environment,activation_state,official_evidence,qualification_budget)
       VALUES($1,'research-route-policy.v1','slice3-fixture.v1','test','blocked','[]','{"max_calls":2,"max_cost_usd":1}')`,
        [policyId],
      );
      await pool.query(
        `INSERT INTO research_route_snapshot(research_route_snapshot_id,account_id,run_id,research_route_policy_id,snapshot_version,adapter_version,route_id,route_path,requested_provider,requested_model,expected_served_provider,expected_served_model,served_provider,served_model,terminal_disposition,capability_policy_version,parameter_policy_sha256,data_handling_evidence_version,fallback_position,qualification_state,captured_at)
       VALUES($1,$2,$3,$4,'research-route-snapshot.v1','adapter.v1','gemini-direct-fixture','gemini_direct','google','gemini-3.6-flash','google','gemini-3.6-flash','google','gemini-3.6-flash','ok','slice3-fixture.v1',$5,'official-evidence.v1',0,'fixture_only',clock_timestamp())`,
        [snapshotId, accountId, runId, policyId, digest("parameters")],
      );
      await pool.query(
        `INSERT INTO provider_route(provider_route_id,route_id,capability,provider,model_id,environment,route_kind,data_handling_posture,timeout_ms,max_attempts,retry_policy,config_version,enabled)
       VALUES($1,'slice3-fixture','CAP-SEARCH','synthetic_fixture','slice3-fixture-v1','test','synthetic_fixture','synthetic_fixture',1000,1,'{}','slice3.v1',true)`,
        [providerRouteId],
      );
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO capability_attempt(capability_attempt_id,run_id,account_id,user_id,capability,provider,model_id,environment,provider_route_id,outcome,started_at,completed_at)
         VALUES($1,$2,$3,$4,'CAP-SEARCH','synthetic_fixture','slice3-fixture-v1','test',$5,'ok',clock_timestamp(),clock_timestamp())`,
          [capabilityAttemptId, runId, accountId, userId, providerRouteId],
        );
        await client.query(
          `INSERT INTO provider_call(provider_call_id,capability_attempt_id,run_id,account_id,user_id,capability,step_key,provider,model_id,environment,route_id,request_parameters,input_tokens,output_tokens,cached_input_tokens,latency_ms,request_identifier_hash,called_at)
         VALUES($1,$2,$3,$4,$5,'CAP-SEARCH','slice3_fixture','synthetic_fixture','slice3-fixture-v1','test','slice3-fixture','{}',0,0,0,0,$6,clock_timestamp())`,
          [
            providerCallId,
            capabilityAttemptId,
            runId,
            accountId,
            userId,
            digest("request"),
          ],
        );
        await client.query(
          `INSERT INTO cost_event(cost_event_id,capability_attempt_id,run_id,account_id,user_id,capability,provider,model_id,environment,quantity,unit,amount,currency_code,pricing_basis,pricing_version,pricing_state,measurement_kind,occurred_at)
         VALUES($1,$2,$3,$4,$5,'CAP-SEARCH','synthetic_fixture','slice3-fixture-v1','test',1,'invocation',0,'USD','synthetic_fixture','slice3.v1','explicit_zero','measured',clock_timestamp())`,
          [costEventId, capabilityAttemptId, runId, accountId, userId],
        );
        await client.query(
          `INSERT INTO provider_attempt(provider_attempt_id,account_id,run_id,research_route_snapshot_id,capability_attempt_id,attempt_number,outcome,requested_provider,requested_model,served_provider,served_model,response_sha256,started_at,completed_at)
         VALUES($1,$2,$3,$4,$5,1,'ok','google','gemini-3.6-flash','google','gemini-3.6-flash',$6,clock_timestamp(),clock_timestamp())`,
          [
            providerAttemptId,
            accountId,
            runId,
            snapshotId,
            capabilityAttemptId,
            digest("response"),
          ],
        );
        await client.query("COMMIT");
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
      await pool.query(
        `INSERT INTO search_attempt(search_attempt_id,account_id,run_id,provider_attempt_id,query_digest_hmac_sha256,search_capability,outcome,result_count,cost_state,started_at,completed_at)
       VALUES($1,$2,$3,$4,$5,'grounded_web_search','ok',1,'estimated',clock_timestamp(),clock_timestamp())`,
        [searchAttemptId, accountId, runId, providerAttemptId, digest("query")],
      );
      await pool.query(
        `INSERT INTO fetch_attempt(fetch_attempt_id,account_id,run_id,search_attempt_id,source_request_url,policy_version,canonical_url,publisher_domain,resolved_address_hashes,redirect_hop,decision,reason_code,http_status,content_type,compressed_bytes,decompressed_bytes,content_sha256,robots_disposition,started_at,completed_at)
       VALUES($1,$2,$3,$4,'https://evidence.example.org/source','secure-fetch-policy.v1','https://evidence.example.org/source','evidence.example.org','["sha256:fixture"]',0,'accepted','fetched',200,'text/html',100,100,$5,'allowed',clock_timestamp(),clock_timestamp())`,
        [fetchAttemptId, accountId, runId, searchAttemptId, digest("content")],
      );
      await pool.query(
        `INSERT INTO source_document(source_document_id,account_id,run_id,fetch_attempt_id,canonical_url,normalized_domain,content_type,content_sha256,bounded_extract,bounded_extract_sha256,extraction_version,active_content_removed,untrusted_data_only,retrieved_at)
       VALUES($1,$2,$3,$4,'https://evidence.example.org/source','evidence.example.org','text/html',$5,'Bounded English support',$6,'slice3-extract.v1',true,true,clock_timestamp())`,
        [
          sourceDocumentId,
          accountId,
          runId,
          fetchAttemptId,
          digest("content"),
          digest("Bounded English support"),
        ],
      );
      await pool.query(
        `INSERT INTO evidence_item(evidence_item_id,run_id,account_id,source_kind,url,title,publisher_domain,retrieved_at,content_sha256,verification_disposition,accessed_at,source_tier,extracted_support,extracted_support_locator,freshness_policy_version,volatility_class,required_corroboration)
       VALUES($1,$2,$3,'external_url','https://evidence.example.org/source','Fixture public evidence','evidence.example.org',clock_timestamp(),$4,'verified',clock_timestamp(),'primary','Bounded English support','{"start":0,"end":23}','slice3.v1','medium',1)`,
        [evidenceId, runId, accountId, digest("content")],
      );
      await pool.query(
        `INSERT INTO candidate(candidate_id,run_id,account_id,canonical_name,country_code,deterministic_rank,eligible)
       VALUES($1,$2,$3,'Fixture Organization','AE',1,true)`,
        [candidateId, runId, accountId],
      );
      await pool.query(
        `INSERT INTO candidate_identity_resolution(candidate_identity_resolution_id,account_id,run_id,candidate_id,canonical_identity,canonical_identity_sha256,disposition,resolver_version,reason_code,resolved_at)
       VALUES($1,$2,$3,$4,'name=fixture organization|country=AE',$5,'distinct','candidate-identity-resolver.v1','unique_canonical_identity',clock_timestamp())`,
        [
          randomUUID(),
          accountId,
          runId,
          candidateId,
          digest("fixture organization|AE"),
        ],
      );
      const sourceId = randomUUID();
      await pool.query(
        `INSERT INTO live_source_provenance(live_source_provenance_id,account_id,run_id,evidence_item_id,fetch_attempt_id,source_document_id,canonical_url,normalized_domain,extraction_method,extraction_version,bounded_excerpt_sha256,source_disposition,created_at)
       VALUES($1,$2,$3,$4,$5,$6,'https://evidence.example.org/source','evidence.example.org','deterministic_text','v1',$7,'accepted',clock_timestamp())`,
        [
          sourceId,
          accountId,
          runId,
          evidenceId,
          fetchAttemptId,
          sourceDocumentId,
          digest("Bounded English support"),
        ],
      );
      await pool.query(
        `INSERT INTO live_cost_reconciliation(live_cost_reconciliation_id,account_id,run_id,expected_provider_attempts,recorded_provider_attempts,recorded_cost_events,amount,currency_code,pricing_version,reconciliation_state,reconciled_at)
       VALUES($1,$2,$3,1,1,1,0,'USD','slice3-fixture.v1','closed',clock_timestamp())`,
        [randomUUID(), accountId, runId],
      );
      await pool.query(
        `INSERT INTO live_research_terminal(live_research_terminal_id,execution_id,account_id,run_id,disposition,reason_code,route_count,terminal_record,sanitized_result,result_sha256,completed_at)
       VALUES($1,'slice3-execution-fixture',$2,$3,'complete','completed',1,'{"schemaVersion":"live-research-terminal.v1","executionId":"slice3-execution-fixture","routes":[],"result":{"candidates":[]}}'::jsonb,'{"candidates":[]}'::jsonb,$4,clock_timestamp())`,
        [randomUUID(), accountId, runId, digest('{"candidates":[]}')],
      );
      await pool.query(
        `INSERT INTO research_route_health_observation(research_route_health_observation_id,route_id,environment,observation,consecutive_failures,circuit_disposition,source_attempt_id,observed_at)
       VALUES($1,'gemini-direct-fixture','test','success',0,'closed',$2,clock_timestamp())`,
        [randomUUID(), providerAttemptId],
      );
      await assert.rejects(
        pool.query(
          "UPDATE research_route_snapshot SET served_model='other' WHERE research_route_snapshot_id=$1",
          [snapshotId],
        ),
        (error) => error.code === "55000",
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO live_qualification_evidence(live_qualification_evidence_id,research_route_policy_id,route_id,qualification_state,requested_provider,requested_model,served_provider,served_model,benign_fixture_id,sanitized_evidence,evidence_sha256,cost_state,recorded_at)
         VALUES($1,$2,'route','passed','google','gemini-3.6-flash','google','gemini-3.6-flash','fixture','{"secret_free":true}',$3,'unknown',clock_timestamp())`,
          [randomUUID(), policyId, digest("qualification")],
        ),
        (error) => error.code === "23514",
      );
      const counts = await pool.query(
        `SELECT
         (SELECT count(*)::int FROM provider_attempt WHERE run_id=$1) provider_attempts,
         (SELECT count(*)::int FROM search_attempt WHERE run_id=$1) search_attempts,
         (SELECT count(*)::int FROM fetch_attempt WHERE run_id=$1) fetch_attempts,
         (SELECT count(*)::int FROM live_source_provenance WHERE run_id=$1) sources,
         (SELECT count(*)::int FROM source_document WHERE run_id=$1) documents,
         (SELECT count(*)::int FROM candidate_identity_resolution WHERE run_id=$1) identities,
         (SELECT count(*)::int FROM live_cost_reconciliation WHERE run_id=$1) reconciliations,
         (SELECT count(*)::int FROM live_research_terminal WHERE run_id=$1) terminals`,
        [runId],
      );
      assert.deepEqual(counts.rows[0], {
        provider_attempts: 1,
        search_attempts: 1,
        fetch_attempts: 1,
        sources: 1,
        documents: 1,
        identities: 1,
        reconciliations: 1,
        terminals: 1,
      });
    } finally {
      await migrateDown(pool).catch(() => undefined);
      await pool.end();
    }
  },
);
