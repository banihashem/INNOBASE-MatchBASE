#!/usr/bin/env node
import { createHash } from "node:crypto";
import { GOLDEN_SCENARIOS_V3 } from "../packages/contracts/dist/src/index.js";
import { standardCompleteResultDocumentSha256 } from "../packages/application/dist/index.js";

const databaseUrl =
  process.env.MATCHBASE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://matchbase_test:local-synthetic-db-only@127.0.0.1:55432/matchbase_slice1";

console.log("=== Seeding Consultant Output V3 (4 Golden UAT Scenarios) ===");
console.log(`Connecting to: ${databaseUrl.replace(/:[^:@]+@/, ":***@")}`);

let pg;
try {
  pg = (await import("pg")).default;
} catch {
  pg = (await import("../packages/data/node_modules/pg/lib/index.js")).default;
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

try {
  await client.query("BEGIN");

  const accountId = "a9442670-2db5-447f-8fb4-c71f6e16a893";
  const userId = "2efd403d-823e-4b3f-9fe8-fe3f800c460e";
  const modelPolicyVersionId = "10000000-0000-4000-8000-000000000001";
  const scoringConfigVersionId = "20000000-0000-4000-8000-000000000001";
  const consultantConfigId = "00000000-0000-4000-8000-000000000620";
  const consultantConfigVersion = "consultant-soft-cap.default-20.v1";
  const consultantConfigSha = Buffer.from(
    "3822131148bb2ff21d0cb81d7f1056a0a235c5d3aef58fca446a124a35e850f9",
    "hex",
  );

  for (let idx = 0; idx < GOLDEN_SCENARIOS_V3.length; idx++) {
    const scenario = GOLDEN_SCENARIOS_V3[idx];
    const num = String(idx + 1).padStart(2, "0");
    const runId = scenario.research_run_id;
    const executionId = scenario.execution_id;
    const classificationId = scenario.classification_id;

    const requestId = `00000000-0000-4000-8000-0000000008${num}`;
    const canonicalRunId = `00000000-0000-4000-8000-0000000009${num}`;
    const canonicalVersionId = `00000000-0000-4000-8000-0000000007${num}`;
    const confirmationId = `00000000-0000-4000-8000-0000000006${num}`;

    // 1. Canonicalization execution run
    await client.query(
      `INSERT INTO canonicalization_execution_run
         (canonicalization_run_id, account_id, user_id, subject_request_id, request_correlation_id, started_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
       ON CONFLICT (account_id, canonicalization_run_id) DO NOTHING`,
      [
        canonicalRunId,
        accountId,
        userId,
        requestId,
        `corr-v3-golden-${num}`,
        scenario.generated_at,
      ],
    );

    // 2. Sourcing request
    await client.query(
      `INSERT INTO sourcing_request
         (request_id, account_id, created_by_user_id, canonicalization_run_id, current_version, lifecycle_state, created_at)
       VALUES ($1, $2, $3, $4, 1, 'confirmed', $5::timestamptz)
       ON CONFLICT (account_id, request_id) DO NOTHING`,
      [requestId, accountId, userId, canonicalRunId, scenario.generated_at],
    );

    // 3. Canonical request version
    const requestDocJson = JSON.stringify(scenario.request_snapshot);
    await client.query(
      `INSERT INTO canonical_request_version
         (canonical_request_version_id, request_id, account_id, version, canonical_language,
          canonical_document, match_readiness, created_by_user_id, created_at)
       VALUES ($1, $2, $3, 1, 'en', $4::jsonb, 'ready', $5, $6::timestamptz)
       ON CONFLICT (account_id, canonical_request_version_id) DO NOTHING`,
      [
        canonicalVersionId,
        requestId,
        accountId,
        requestDocJson,
        userId,
        scenario.generated_at,
      ],
    );

    // 4. Canonical confirmation
    await client.query(
      `INSERT INTO canonical_confirmation
         (confirmation_id, canonical_request_version_id, account_id, actor_user_id, accepted, confirmed_at)
       VALUES ($1, $2, $3, $4, true, $5::timestamptz)
       ON CONFLICT (canonical_request_version_id, actor_user_id, confirmed_at) DO NOTHING`,
      [
        confirmationId,
        canonicalVersionId,
        accountId,
        userId,
        scenario.generated_at,
      ],
    );

    // 5. Research run
    const state =
      scenario.research_status === "no_strong_match"
        ? "no_responsible_match"
        : "complete";
    const idempotencyHash = createHash("sha256")
      .update(`consultant-golden-v3-run-${num}`)
      .digest();

    await client.query(
      `INSERT INTO research_run
         (run_id, account_id, canonical_request_version_id, requested_by_user_id,
          tier_at_submission, state, model_policy_version_id, scoring_config_version_id,
          idempotency_key_hash, queued_at, started_at, completed_at)
       VALUES ($1, $2, $3, $4, 'consultant', $5, $6, $7, $8, $9::timestamptz, $9::timestamptz, $9::timestamptz)
       ON CONFLICT (run_id) DO UPDATE
       SET state = $5,
           tier_at_submission = 'consultant',
           canonical_request_version_id = $3,
           completed_at = $9::timestamptz`,
      [
        runId,
        accountId,
        canonicalVersionId,
        userId,
        state,
        modelPolicyVersionId,
        scoringConfigVersionId,
        idempotencyHash,
        scenario.generated_at,
      ],
    );

    // 6. Run result
    const payloadJson = JSON.stringify(scenario);
    const docSha256 = standardCompleteResultDocumentSha256(scenario);
    const outcome =
      scenario.research_status === "no_strong_match"
        ? "no_responsible_match"
        : "candidates";
    const eligibleCount = scenario.supplier_candidates.length;
    const consideredCount = scenario.target_candidates_count ?? 20;
    const limitationsText =
      (scenario.limitations_and_disclosures &&
        scenario.limitations_and_disclosures[0]?.description) ??
      "Consultant research advisory boundary";

    await client.query(
      `INSERT INTO run_result
         (run_id, account_id, outcome, eligible_count, considered_count, limitations_text,
          complete_result_document, result_sha256, assembled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::timestamptz)
       ON CONFLICT (run_id) DO UPDATE
       SET complete_result_document = $7::jsonb,
           result_sha256 = $8,
           outcome = $3,
           eligible_count = $4,
           considered_count = $5,
           limitations_text = $6,
           assembled_at = $9::timestamptz`,
      [
        runId,
        accountId,
        outcome,
        eligibleCount,
        consideredCount,
        limitationsText,
        payloadJson,
        docSha256,
        scenario.generated_at,
      ],
    );

    // 7. Consultant projection policy
    await client.query(
      `INSERT INTO consultant_result_projection_policy
         (account_id, run_id, config_id, config_version, soft_cap, config_content_sha256)
       VALUES ($1, $2, $3, $4, 20, $5)
       ON CONFLICT (account_id, run_id) DO NOTHING`,
      [
        accountId,
        runId,
        consultantConfigId,
        consultantConfigVersion,
        consultantConfigSha,
      ],
    );

    // 8. Product classification
    const pc = scenario.primary_classification;
    await client.query(
      `INSERT INTO product_classification (
        classification_id, account_id, scheme, code, version, jurisdiction, level, label, description, confidence, assigned_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (classification_id) DO UPDATE SET
        label = EXCLUDED.label;`,
      [
        pc.classification_id,
        accountId,
        pc.scheme,
        pc.code,
        pc.version,
        pc.jurisdiction ?? null,
        pc.level,
        pc.label,
        pc.description,
        pc.confidence,
        pc.assigned_at,
      ],
    );

    // 9. Consultant research execution
    const telem = scenario.telemetry;
    await client.query(
      `INSERT INTO consultant_research_execution (
        execution_id, account_id, run_id, user_profile_id, classification_id,
        lanes_executed, verification_loops_count, total_input_tokens, total_output_tokens,
        total_cost_usd, execution_latency_ms, synthesis_model_id, status, started_at, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (execution_id) DO UPDATE SET
        status = EXCLUDED.status;`,
      [
        executionId,
        accountId,
        runId,
        userId,
        classificationId,
        telem.lanes_executed,
        telem.verification_loops_count,
        telem.total_input_tokens,
        telem.total_output_tokens,
        telem.total_cost_usd,
        telem.execution_latency_ms,
        telem.synthesis_model_id,
        "completed",
        telem.executed_at,
        scenario.generated_at,
      ],
    );

    // 10. Consultant output v3
    await client.query(
      `INSERT INTO consultant_output_v3 (
        output_id, account_id, run_id, execution_id, classification_id, user_profile_id,
        schema_version, schema_contract_version, title, subtitle, generated_at, as_of_date,
        research_mode, research_status, target_candidates_count, total_candidates_found,
        document_payload, document_sha256
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (account_id, run_id) DO UPDATE SET
        document_payload = EXCLUDED.document_payload,
        document_sha256 = EXCLUDED.document_sha256,
        research_mode = EXCLUDED.research_mode,
        research_status = EXCLUDED.research_status,
        total_candidates_found = EXCLUDED.total_candidates_found,
        title = EXCLUDED.title,
        subtitle = EXCLUDED.subtitle;`,
      [
        runId,
        accountId,
        runId,
        executionId,
        classificationId,
        userId,
        scenario.schema_version,
        scenario.schema_contract_version,
        scenario.title,
        scenario.subtitle ?? null,
        scenario.generated_at,
        scenario.as_of_date,
        scenario.research_mode,
        scenario.research_status,
        scenario.target_candidates_count,
        scenario.total_candidates_found,
        payloadJson,
        docSha256,
      ],
    );

    // 11. Supplier entities
    for (const s of scenario.supplier_candidates) {
      const hash = createHash("md5")
        .update(`${runId}:${s.candidate_id}`)
        .digest("hex");
      const entityId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      await client.query(
        `INSERT INTO consultant_supplier_entity_v3 (
          entity_id, account_id, run_id, candidate_id, legal_name, trading_name,
          brand_names, aliases, parent_entity_id, supplier_type, manufacturer_status,
          country_of_registration, headquarters_address, website, primary_domain,
          rank, compatibility_score, fit_band, evidence_confidence, identity_confidence,
          data_completeness, raw_entity_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        ON CONFLICT (account_id, run_id, candidate_id) DO UPDATE SET
          compatibility_score = EXCLUDED.compatibility_score,
          raw_entity_json = EXCLUDED.raw_entity_json;`,
        [
          entityId,
          accountId,
          runId,
          s.candidate_id,
          s.legal_name,
          s.trading_name ?? null,
          s.brand_names,
          s.aliases,
          s.parent_entity_id ?? null,
          s.supplier_type,
          s.manufacturer_status,
          s.country_of_registration,
          s.headquarters_address,
          s.website,
          s.primary_domain,
          s.assessment.rank,
          s.assessment.compatibility_score,
          s.assessment.fit_band,
          s.assessment.evidence_confidence,
          s.assessment.identity_confidence,
          s.assessment.data_completeness,
          JSON.stringify(s),
        ],
      );
    }

    // 12. Consultant workflow session (resumable record)
    await client.query(
      `INSERT INTO consultant_workflow_session (
        session_id, account_id, run_id, user_profile_id, current_state,
        original_intake, draft_revision, approved_request_revision, advisory_output,
        deep_prompt_revision, approvals, classification, execution_id, last_checkpoint
      ) VALUES ($1, $2, $3, $4, 'workflow_complete', $5, $6, $7, $8, $9, $10, $11, $12, 'workflow_complete')
      ON CONFLICT (account_id, run_id) DO UPDATE SET
        current_state = 'workflow_complete',
        updated_at = clock_timestamp();`,
      [
        runId,
        accountId,
        runId,
        userId,
        JSON.stringify(scenario.request_snapshot),
        JSON.stringify({
          revision_id: crypto.randomUUID(),
          english_translation: scenario.request_snapshot.product_name,
          created_at: scenario.generated_at,
        }),
        JSON.stringify({
          revision_id: crypto.randomUUID(),
          english_translation: scenario.request_snapshot.product_name,
          product_category: scenario.request_snapshot.primary_query_type,
          product_name: scenario.request_snapshot.product_name,
          approved_at: scenario.generated_at,
        }),
        JSON.stringify({
          loop1_trade_lane: "Trade corridor verified",
          loop2_regulatory: "Regulatory framework reconciled",
          loop3_supply_structure: "Supply architecture mapped",
          sources: [],
        }),
        JSON.stringify({
          prompt_text: scenario.title,
          is_approved: true,
        }),
        JSON.stringify([
          { step: "step1", approved_at: scenario.generated_at },
          { step: "step3", approved_at: scenario.generated_at },
        ]),
        JSON.stringify(scenario.primary_classification),
        executionId,
      ],
    );

    console.log(
      `✔ Seeded V3 scenario: ${scenario.title} (${scenario.research_run_id}, candidates: ${scenario.supplier_candidates.length})`,
    );
  }

  await client.query("COMMIT");
  console.log("=== V3 Golden Scenarios Seeding completed successfully! ===");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Failed to seed database:", err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
