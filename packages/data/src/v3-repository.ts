import { createHash, randomUUID } from "node:crypto";
import type { Queryable } from "./database.js";
import type {
  ConsultantResearchOutputV3,
  ProductClassificationRecord,
  SupplierEntityV3,
} from "@matchbase/contracts";

export interface SaveConsultantOutputV3Params {
  readonly account_id: string;
  readonly output: ConsultantResearchOutputV3;
}

export interface SavePdfReportLedgerParams {
  readonly account_id: string;
  readonly run_id: string;
  readonly output_id: string;
  readonly filename: string;
  readonly pdf_bytes: Buffer;
  readonly page_count: number;
}

export interface PdfReportLedgerRow {
  readonly report_id: string;
  readonly account_id: string;
  readonly run_id: string;
  readonly output_id: string;
  readonly filename: string;
  readonly pdf_sha256: Buffer;
  readonly file_size_bytes: number;
  readonly page_count: number;
  readonly landscape_orientation: boolean;
  readonly generated_at: string;
}

export async function saveProductClassification(
  db: Queryable,
  accountId: string,
  record: ProductClassificationRecord,
): Promise<void> {
  await db.query(
    `INSERT INTO product_classification (
      classification_id,
      account_id,
      scheme,
      code,
      version,
      jurisdiction,
      level,
      label,
      description,
      confidence,
      assigned_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (classification_id)
    DO UPDATE SET
      label = EXCLUDED.label,
      description = EXCLUDED.description,
      confidence = EXCLUDED.confidence,
      assigned_at = EXCLUDED.assigned_at;`,
    [
      record.classification_id,
      accountId,
      record.scheme,
      record.code,
      record.version,
      record.jurisdiction ?? null,
      record.level,
      record.label,
      record.description,
      record.confidence,
      record.assigned_at,
    ],
  );
}

export async function saveConsultantResearchExecution(
  db: Queryable,
  accountId: string,
  output: ConsultantResearchOutputV3,
): Promise<void> {
  const telemetry = output.telemetry;
  await db.query(
    `INSERT INTO consultant_research_execution (
      execution_id,
      account_id,
      run_id,
      user_profile_id,
      classification_id,
      lanes_executed,
      verification_loops_count,
      total_input_tokens,
      total_output_tokens,
      total_cost_usd,
      execution_latency_ms,
      synthesis_model_id,
      status,
      started_at,
      completed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT (execution_id)
    DO UPDATE SET
      total_input_tokens = EXCLUDED.total_input_tokens,
      total_output_tokens = EXCLUDED.total_output_tokens,
      total_cost_usd = EXCLUDED.total_cost_usd,
      execution_latency_ms = EXCLUDED.execution_latency_ms,
      status = EXCLUDED.status,
      completed_at = EXCLUDED.completed_at;`,
    [
      output.execution_id,
      accountId,
      output.research_run_id,
      output.user_profile_id,
      output.classification_id,
      telemetry.lanes_executed,
      telemetry.verification_loops_count,
      telemetry.total_input_tokens,
      telemetry.total_output_tokens,
      telemetry.total_cost_usd,
      telemetry.execution_latency_ms,
      telemetry.synthesis_model_id,
      "completed",
      telemetry.executed_at,
      output.generated_at,
    ],
  );
}

export async function saveConsultantOutputV3(
  db: Queryable,
  params: SaveConsultantOutputV3Params,
): Promise<void> {
  const { account_id, output } = params;

  // 1. Ensure classification exists
  await saveProductClassification(
    db,
    account_id,
    output.primary_classification,
  );

  // 2. Ensure execution record exists
  await saveConsultantResearchExecution(db, account_id, output);

  // 3. Save primary consultant_output_v3 document
  const payloadJson = JSON.stringify(output);
  const docSha256 = createHash("sha256").update(payloadJson, "utf8").digest();

  await db.query(
    `INSERT INTO consultant_output_v3 (
      output_id,
      account_id,
      run_id,
      execution_id,
      classification_id,
      user_profile_id,
      schema_version,
      schema_contract_version,
      title,
      subtitle,
      generated_at,
      as_of_date,
      research_mode,
      research_status,
      target_candidates_count,
      total_candidates_found,
      document_payload,
      document_sha256
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    ON CONFLICT (account_id, run_id)
    DO UPDATE SET
      title = EXCLUDED.title,
      subtitle = EXCLUDED.subtitle,
      document_payload = EXCLUDED.document_payload,
      document_sha256 = EXCLUDED.document_sha256,
      total_candidates_found = EXCLUDED.total_candidates_found;`,
    [
      output.research_run_id, // using run_id as output_id for 1:1 mapping
      account_id,
      output.research_run_id,
      output.execution_id,
      output.classification_id,
      output.user_profile_id,
      output.schema_version,
      output.schema_contract_version,
      output.title,
      output.subtitle ?? null,
      output.generated_at,
      output.as_of_date,
      output.research_mode,
      output.research_status,
      output.target_candidates_count,
      output.total_candidates_found,
      payloadJson,
      docSha256,
    ],
  );

  // 4. Save individual supplier entities for fast querying / filtering
  for (const supp of output.supplier_candidates) {
    await db.query(
      `INSERT INTO consultant_supplier_entity_v3 (
        entity_id,
        account_id,
        run_id,
        candidate_id,
        legal_name,
        trading_name,
        brand_names,
        aliases,
        parent_entity_id,
        supplier_type,
        manufacturer_status,
        country_of_registration,
        headquarters_address,
        website,
        primary_domain,
        rank,
        compatibility_score,
        fit_band,
        evidence_confidence,
        identity_confidence,
        data_completeness,
        raw_entity_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      ON CONFLICT (account_id, run_id, candidate_id)
      DO UPDATE SET
        legal_name = EXCLUDED.legal_name,
        trading_name = EXCLUDED.trading_name,
        rank = EXCLUDED.rank,
        compatibility_score = EXCLUDED.compatibility_score,
        fit_band = EXCLUDED.fit_band,
        data_completeness = EXCLUDED.data_completeness,
        raw_entity_json = EXCLUDED.raw_entity_json;`,
      [
        randomUUID(),
        account_id,
        output.research_run_id,
        supp.candidate_id,
        supp.legal_name,
        supp.trading_name ?? null,
        supp.brand_names,
        supp.aliases,
        supp.parent_entity_id ?? null,
        supp.supplier_type,
        supp.manufacturer_status,
        supp.country_of_registration,
        supp.headquarters_address,
        supp.website,
        supp.primary_domain,
        supp.assessment.rank,
        supp.assessment.compatibility_score,
        supp.assessment.fit_band,
        supp.assessment.evidence_confidence,
        supp.assessment.identity_confidence,
        supp.assessment.data_completeness,
        JSON.stringify(supp),
      ],
    );
  }
}

export async function getConsultantOutputV3ByRunId(
  db: Queryable,
  accountId: string,
  runId: string,
): Promise<ConsultantResearchOutputV3 | null> {
  const result = await db.query<{
    document_payload: string | Record<string, unknown>;
  }>(
    `SELECT document_payload
     FROM consultant_output_v3
     WHERE account_id = $1 AND run_id = $2;`,
    [accountId, runId],
  );
  if (result.rows.length === 0) return null;
  const payload = result.rows[0]!.document_payload;
  if (typeof payload === "string") {
    return JSON.parse(payload) as ConsultantResearchOutputV3;
  }
  return payload as unknown as ConsultantResearchOutputV3;
}

export async function getConsultantSupplierEntitiesV3(
  db: Queryable,
  accountId: string,
  runId: string,
): Promise<readonly SupplierEntityV3[]> {
  const result = await db.query<{
    raw_entity_json: string | Record<string, unknown>;
  }>(
    `SELECT raw_entity_json
     FROM consultant_supplier_entity_v3
     WHERE account_id = $1 AND run_id = $2
     ORDER BY rank ASC;`,
    [accountId, runId],
  );
  return result.rows.map((row) => {
    if (typeof row.raw_entity_json === "string") {
      return JSON.parse(row.raw_entity_json) as SupplierEntityV3;
    }
    return row.raw_entity_json as unknown as SupplierEntityV3;
  });
}

export async function savePdfReportLedger(
  db: Queryable,
  params: SavePdfReportLedgerParams,
): Promise<PdfReportLedgerRow> {
  const { account_id, run_id, output_id, filename, pdf_bytes, page_count } =
    params;
  const report_id = output_id;
  const pdf_sha256 = createHash("sha256").update(pdf_bytes).digest();
  const file_size_bytes = pdf_bytes.length;

  const res = await db.query<PdfReportLedgerRow>(
    `INSERT INTO consultant_pdf_report_ledger (
      report_id,
      account_id,
      run_id,
      output_id,
      filename,
      pdf_sha256,
      file_size_bytes,
      page_count,
      landscape_orientation
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
    ON CONFLICT (account_id, run_id)
    DO UPDATE SET
      filename = EXCLUDED.filename,
      pdf_sha256 = EXCLUDED.pdf_sha256,
      file_size_bytes = EXCLUDED.file_size_bytes,
      page_count = EXCLUDED.page_count,
      generated_at = clock_timestamp()
    RETURNING *;`,
    [
      report_id,
      account_id,
      run_id,
      output_id,
      filename,
      pdf_sha256,
      file_size_bytes,
      page_count,
    ],
  );

  return res.rows[0]!;
}

export async function getPdfReportLedgerByRunId(
  db: Queryable,
  accountId: string,
  runId: string,
): Promise<PdfReportLedgerRow | null> {
  const res = await db.query<PdfReportLedgerRow>(
    `SELECT * FROM consultant_pdf_report_ledger WHERE account_id = $1 AND run_id = $2;`,
    [accountId, runId],
  );
  return res.rows[0] ?? null;
}
