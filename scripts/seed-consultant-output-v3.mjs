#!/usr/bin/env node
import { createHash } from "node:crypto";
import { BRAZIL_POULTRY_GOLDEN_V3 } from "../packages/contracts/dist/src/index.js";

const databaseUrl =
  process.env.MATCHBASE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://matchbase_test:local-synthetic-db-only@127.0.0.1:55432/matchbase_slice1";

console.log(
  "=== Seeding Consultant Output V3 (Brazil Poultry 20 Suppliers) ===",
);
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
  const runId = BRAZIL_POULTRY_GOLDEN_V3.research_run_id;
  const executionId = BRAZIL_POULTRY_GOLDEN_V3.execution_id;
  const classificationId = BRAZIL_POULTRY_GOLDEN_V3.classification_id;

  // 2. Insert product_classification
  const pc = BRAZIL_POULTRY_GOLDEN_V3.primary_classification;
  await client.query(
    `INSERT INTO product_classification (
      classification_id, account_id, scheme, code, version, jurisdiction, level, label, description, confidence, assigned_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (account_id, scheme, code, version) DO UPDATE SET
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
  console.log(`✔ Seeded product_classification: ${pc.code} (${pc.scheme})`);

  // 3. Insert consultant_research_execution
  const telem = BRAZIL_POULTRY_GOLDEN_V3.telemetry;
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
      BRAZIL_POULTRY_GOLDEN_V3.generated_at,
    ],
  );
  console.log(`✔ Seeded consultant_research_execution: ${executionId}`);

  // 4. Insert consultant_output_v3
  const payloadJson = JSON.stringify(BRAZIL_POULTRY_GOLDEN_V3);
  const docSha = createHash("sha256").update(payloadJson, "utf8").digest();
  await client.query(
    `INSERT INTO consultant_output_v3 (
      output_id, account_id, run_id, execution_id, classification_id, user_profile_id,
      schema_version, schema_contract_version, title, subtitle, generated_at, as_of_date,
      research_mode, research_status, target_candidates_count, total_candidates_found,
      document_payload, document_sha256
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    ON CONFLICT (account_id, run_id) DO UPDATE SET
      document_payload = EXCLUDED.document_payload,
      document_sha256 = EXCLUDED.document_sha256;`,
    [
      runId,
      accountId,
      runId,
      executionId,
      classificationId,
      userId,
      BRAZIL_POULTRY_GOLDEN_V3.schema_version,
      BRAZIL_POULTRY_GOLDEN_V3.schema_contract_version,
      BRAZIL_POULTRY_GOLDEN_V3.title,
      BRAZIL_POULTRY_GOLDEN_V3.subtitle ?? null,
      BRAZIL_POULTRY_GOLDEN_V3.generated_at,
      BRAZIL_POULTRY_GOLDEN_V3.as_of_date,
      BRAZIL_POULTRY_GOLDEN_V3.research_mode,
      BRAZIL_POULTRY_GOLDEN_V3.research_status,
      BRAZIL_POULTRY_GOLDEN_V3.target_candidates_count,
      BRAZIL_POULTRY_GOLDEN_V3.total_candidates_found,
      payloadJson,
      docSha,
    ],
  );
  console.log(`✔ Seeded consultant_output_v3: ${runId}`);

  // 5. Insert all 20 consultant_supplier_entity_v3
  for (const s of BRAZIL_POULTRY_GOLDEN_V3.supplier_candidates) {
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
        s.supplier_entity_id,
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
  console.log(`✔ Seeded 20 consultant_supplier_entity_v3 candidate records.`);

  await client.query("COMMIT");
  console.log("=== Seeding completed successfully! ===");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Failed to seed database:", err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
