import { NextResponse } from "next/server";
import { getWorkflowSession } from "@matchbase/application";
import {
  getConsultantOutputV3ByRunId,
  savePdfReportLedger,
} from "@matchbase/data";
import { generateConsultantPdf } from "@matchbase/reporting";
import {
  GOLDEN_SCENARIO_V3_01,
  GOLDEN_SCENARIO_V3_02,
  GOLDEN_SCENARIO_V3_03,
  GOLDEN_SCENARIO_V3_04,
  type ConsultantResearchOutputV3,
} from "@matchbase/contracts";
import { getAppDatabasePool } from "../../../../../../../src/db-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GOLDEN_ALIAS_MAP: Record<string, string> = {
  "run-v3-golden-01": "00000000-0000-4000-8000-000000000401",
  "run-v3-golden-02": "00000000-0000-4000-8000-000000000402",
  "run-v3-golden-03": "00000000-0000-4000-8000-000000000403",
  "run-v3-golden-04": "00000000-0000-4000-8000-000000000404",
  "run-v3-golden-1": "00000000-0000-4000-8000-000000000401",
  "run-v3-golden-2": "00000000-0000-4000-8000-000000000402",
  "run-v3-golden-3": "00000000-0000-4000-8000-000000000403",
  "run-v3-golden-4": "00000000-0000-4000-8000-000000000404",
};

const GOLDEN_SCENARIO_MAP: Record<string, ConsultantResearchOutputV3> = {
  "00000000-0000-4000-8000-000000000401": GOLDEN_SCENARIO_V3_01,
  "00000000-0000-4000-8000-000000000402": GOLDEN_SCENARIO_V3_02,
  "00000000-0000-4000-8000-000000000403": GOLDEN_SCENARIO_V3_03,
  "00000000-0000-4000-8000-000000000404": GOLDEN_SCENARIO_V3_04,
};

export async function GET(
  _req: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await context.params;
    const effectiveRunId = GOLDEN_ALIAS_MAP[runId] ?? runId;
    const pool = getAppDatabasePool();
    const accountId = "a9442670-2db5-447f-8fb4-c71f6e16a893";

    // 1. Check active session
    let output = getWorkflowSession(effectiveRunId)?.output;

    // 2. Check DB
    if (!output) {
      output = await getConsultantOutputV3ByRunId(
        pool,
        accountId,
        effectiveRunId,
      );
    }

    // 3. If golden run ID or alias fallback
    if (!output && GOLDEN_SCENARIO_MAP[effectiveRunId]) {
      output = GOLDEN_SCENARIO_MAP[effectiveRunId];
    }

    if (!output) {
      return NextResponse.json(
        { error: `Consultant report output not found for runId: ${runId}` },
        { status: 404 },
      );
    }

    // Dynamic filename based on scenario report artifact or product
    const filename =
      output.report_artifact?.filename ??
      `MatchBASE_Consultant_Report_${effectiveRunId}.pdf`;

    // Dynamic page count
    const candidatesCount = output.supplier_candidates?.length ?? 0;
    const matrixPages =
      candidatesCount === 0 ? 1 : Math.ceil(candidatesCount / 5);
    const pageCount = 4 + matrixPages;

    // Generate PDF bytes
    const pdfBuffer = await generateConsultantPdf(output);

    // Persist to database ledger
    try {
      await savePdfReportLedger(pool, {
        account_id: accountId,
        run_id: effectiveRunId,
        output_id: output.research_run_id,
        filename,
        pdf_bytes: pdfBuffer,
        page_count: pageCount,
      });
    } catch (e) {
      console.warn("Could not save to pdf ledger:", e);
    }

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  } catch (err) {
    console.error("Error generating PDF:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
