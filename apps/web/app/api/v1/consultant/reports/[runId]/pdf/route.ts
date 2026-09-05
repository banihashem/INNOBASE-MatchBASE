import { NextResponse } from "next/server";
import {
  ApplicationFault,
  authorizeConsultantRunResourceRead,
} from "@matchbase/application";
import { savePdfReportLedger } from "@matchbase/data";
import { generateConsultantPdf } from "@matchbase/reporting";
import { getAppDatabasePool } from "../../../../../../../src/db-client";
import { resolveRequestSession } from "../../../../../../../src/fetch-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
  });

  try {
    const { runId } = await context.params;
    const pool = getAppDatabasePool();

    // 1. Authenticate session & resolve request context
    let requestContext;
    try {
      requestContext = await resolveRequestSession(req);
    } catch (authError) {
      const fault =
        authError instanceof ApplicationFault
          ? authError
          : new ApplicationFault(
              401,
              "session-required",
              "MB-401-SESSION",
              "A valid session is required.",
            );
      return NextResponse.json(
        {
          error: fault.message,
          code: fault.code,
          status: fault.status,
        },
        { status: fault.status, headers },
      );
    }

    // 2. Authorize read access for Consultant run resource
    let authorized;
    try {
      authorized = await authorizeConsultantRunResourceRead({
        context: requestContext,
        runId,
        pool,
        resourceKind: "report_pdf",
      });
    } catch (authzError) {
      if (authzError instanceof ApplicationFault) {
        return NextResponse.json(
          {
            error: authzError.message,
            code: authzError.code,
            status: authzError.status,
          },
          { status: authzError.status, headers },
        );
      }
      throw authzError;
    }

    const { output, runId: effectiveRunId } = authorized;

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
        account_id: requestContext.accountId,
        run_id: effectiveRunId,
        output_id: output.research_run_id,
        filename,
        pdf_bytes: pdfBuffer,
        page_count: pageCount,
      });
    } catch (e) {
      console.warn("Could not save to pdf ledger:", e);
    }

    headers.set("Content-Type", "application/pdf");
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    headers.set("Content-Length", pdfBuffer.length.toString());

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error("Error generating PDF:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500, headers },
    );
  }
}
