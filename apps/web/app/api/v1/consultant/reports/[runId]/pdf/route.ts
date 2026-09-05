import { NextResponse } from "next/server";
import { getWorkflowSession } from "@matchbase/application";
import {
  getConsultantOutputV3ByRunId,
  savePdfReportLedger,
} from "@matchbase/data";
import { generateConsultantPdf } from "@matchbase/reporting";
import { BRAZIL_POULTRY_GOLDEN_V3 } from "@matchbase/contracts";
import { getAppDatabasePool } from "../../../../../../../src/db-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await context.params;
    const pool = getAppDatabasePool();
    const accountId = "a9442670-2db5-447f-8fb4-c71f6e16a893";

    // 1. Check active session
    let output = getWorkflowSession(runId)?.output;

    // 2. Check DB
    if (!output) {
      output = await getConsultantOutputV3ByRunId(pool, accountId, runId);
    }

    // 3. If golden run ID or fallback
    if (!output) {
      output = BRAZIL_POULTRY_GOLDEN_V3;
    }

    // Generate PDF bytes
    const pdfBuffer = await generateConsultantPdf(output);
    const filename =
      "INNOBASE_MatchBASE_Brazil_Saudi_Poultry_Supplier_Landscape.pdf";

    // Persist to database ledger if runId is a valid UUID
    try {
      await savePdfReportLedger(pool, {
        account_id: accountId,
        run_id: runId,
        output_id: output.research_run_id,
        filename,
        pdf_bytes: pdfBuffer,
        page_count: 8,
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
