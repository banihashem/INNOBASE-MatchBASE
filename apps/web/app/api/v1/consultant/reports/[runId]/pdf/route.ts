import { NextResponse } from "next/server";
import {
  ApplicationFault,
  authorizeConsultantRunResourceRead,
  assertConsultantOutputReadRights,
} from "@matchbase/application";
import { parseConsultantResearchOutputV3 } from "@matchbase/contracts";
import {
  getResearchRoundForExecution,
  savePdfReportLedger,
  ExecutionIntegrityFault,
} from "@matchbase/data";
import {
  generateConsultantPdfArtifact,
  ConsultantPdfRendererUnavailableError,
  ConsultantReportLanguageError,
} from "@matchbase/reporting";
import { getAppDatabasePool } from "../../../../../../../src/db-client";
import { resolveRequestSession } from "../../../../../../../src/fetch-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRangeHeader(
  rangeHeader: string,
  totalLength: number,
): { start: number; end: number } | "malformed" | "unsatisfiable" {
  if (!rangeHeader.startsWith("bytes=")) {
    return "malformed";
  }
  const rangePart = rangeHeader.slice(6).trim();
  if (rangePart.includes(",")) {
    return "malformed";
  }
  const parts = rangePart.split("-");
  if (parts.length !== 2) {
    return "malformed";
  }
  const startStr = parts[0]!.trim();
  const endStr = parts[1]!.trim();

  if (startStr === "" && endStr === "") {
    return "malformed";
  }

  // Suffix byte range: bytes=-500
  if (startStr === "") {
    const suffix = parseInt(endStr, 10);
    if (isNaN(suffix) || suffix < 0) return "malformed";
    if (suffix === 0) return "unsatisfiable";
    const start = Math.max(0, totalLength - suffix);
    return { start, end: totalLength - 1 };
  }

  const start = parseInt(startStr, 10);
  if (isNaN(start) || start < 0) return "malformed";

  // Open-ended byte range: bytes=500-
  if (endStr === "") {
    if (start >= totalLength) return "unsatisfiable";
    return { start, end: totalLength - 1 };
  }

  // Explicit bounded byte range: bytes=0-499
  const end = parseInt(endStr, 10);
  if (isNaN(end) || end < 0 || start > end) return "malformed";
  if (start >= totalLength) return "unsatisfiable";
  return { start, end: Math.min(end, totalLength - 1) };
}

async function handlePdfRequest(
  req: Request,
  context: { params: Promise<{ runId: string }> },
  isHead: boolean,
): Promise<Response> {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    Pragma: "no-cache",
    Vary: "Cookie, Authorization",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
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
        resourceKind: "research_history",
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

    const { runId: effectiveRunId } = authorized;
    const ownerAccountId =
      authorized.owner_account_id ?? requestContext.accountId;
    const ownerProfileId =
      authorized.owner_user_profile_id ?? requestContext.userId;
    let output;
    const execution = new URL(req.url).searchParams.get("execution_id");
    if (execution) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          execution,
        )
      )
        return NextResponse.json(
          { error: "Invalid execution ID." },
          { status: 400, headers },
        );
      const saved = await getResearchRoundForExecution(
        pool,
        ownerAccountId,
        execution,
      );
      if (
        !saved?.output ||
        saved.run_id !== effectiveRunId ||
        saved.account_id !== ownerAccountId ||
        saved.user_profile_id !== ownerProfileId ||
        saved.execution_id !== execution
      )
        return NextResponse.json(
          { error: "Saved round report not found." },
          { status: 404, headers },
        );
      output = parseConsultantResearchOutputV3(saved.output);
      if (
        output.research_run_id !== effectiveRunId ||
        output.execution_id !== execution ||
        output.user_profile_id !== ownerProfileId ||
        output.classification_id !== saved.classification_id
      )
        return NextResponse.json(
          { error: "Saved round report not found." },
          { status: 404, headers },
        );
    } else {
      const current = await authorizeConsultantRunResourceRead({
        context: requestContext,
        runId: effectiveRunId,
        pool,
        resourceKind: "report_pdf",
      });
      output = current.output;
    }
    await assertConsultantOutputReadRights(pool, ownerAccountId, output);

    // Dynamic filename based on scenario report artifact or product
    const filename =
      output.report_artifact?.filename ??
      `MatchBASE_Consultant_Report_${effectiveRunId}.pdf`;

    // Generate or retrieve PDF bytes via single-flight renderer
    let pdfBuffer: Buffer;
    let pageCount: number;
    try {
      const artifact = await generateConsultantPdfArtifact(output);
      pdfBuffer = artifact.bytes;
      pageCount = artifact.pageCount;
    } catch (renderError) {
      console.error("Consultant PDF generation failed:", renderError);
      if (
        renderError instanceof ConsultantPdfRendererUnavailableError ||
        renderError instanceof ConsultantReportLanguageError
      ) {
        return NextResponse.json(
          {
            error: renderError.message,
            code: renderError.code,
            status: renderError.status,
          },
          { status: renderError.status, headers },
        );
      }
      return NextResponse.json(
        {
          error:
            "Consultant PDF renderer is currently unavailable. Please retry shortly.",
          code: "MB-503-PDF-RENDERER-UNAVAILABLE",
          status: 503,
        },
        { status: 503, headers },
      );
    }

    await assertConsultantOutputReadRights(pool, ownerAccountId, output);
    // Persist to database ledger (best-effort)
    try {
      await savePdfReportLedger(pool, {
        account_id: ownerAccountId,
        run_id: effectiveRunId,
        output_id: output.research_run_id,
        filename,
        pdf_bytes: pdfBuffer,
        page_count: pageCount,
      });
    } catch (e) {
      console.warn("Could not save to pdf ledger:", e);
    }
    await assertConsultantOutputReadRights(pool, ownerAccountId, output);

    const totalLength = pdfBuffer.length;
    headers.set("Content-Type", "application/pdf");
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);

    // 3. Handle Range Requests (RFC 7233)
    const rangeHeader = req.headers.get("range");
    if (rangeHeader) {
      const parsedRange = parseRangeHeader(rangeHeader, totalLength);
      if (parsedRange === "malformed" || parsedRange === "unsatisfiable") {
        headers.set("Content-Range", `bytes */${totalLength}`);
        return new Response(null, {
          status: 416,
          headers,
        });
      }

      const { start, end } = parsedRange;
      const chunkSize = end - start + 1;
      headers.set("Content-Range", `bytes ${start}-${end}/${totalLength}`);
      headers.set("Content-Length", chunkSize.toString());

      return new Response(
        isHead ? null : new Uint8Array(pdfBuffer.subarray(start, end + 1)),
        {
          status: 206,
          headers,
        },
      );
    }

    // 4. Standard Full GET / HEAD Response (200 OK)
    headers.set("Content-Length", totalLength.toString());

    return new Response(isHead ? null : new Uint8Array(pdfBuffer), {
      status: 200,
      headers,
    });
  } catch (err) {
    if (
      err instanceof ExecutionIntegrityFault ||
      err instanceof ApplicationFault
    )
      return NextResponse.json(
        { error: err.message, code: err.code, status: err.status },
        { status: err.status, headers },
      );
    console.error("Error serving PDF:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500, headers },
    );
  }
}

export async function GET(
  req: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  return handlePdfRequest(req, context, false);
}

export async function HEAD(
  req: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  return handlePdfRequest(req, context, true);
}
