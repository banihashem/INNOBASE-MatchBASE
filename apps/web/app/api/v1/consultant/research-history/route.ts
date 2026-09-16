import { NextResponse } from "next/server";
import {
  ApplicationFault,
  authorizeConsultantRunResourceRead,
  getOrRestoreWorkflowSession,
  getConsultantResearchHistory,
} from "@matchbase/application";
import {
  createLinkedResearchRenewal,
  ExecutionIntegrityFault,
  hashResearchAuthority,
} from "@matchbase/data";
import { getAppDatabasePool } from "../../../../../src/db-client";
import { resolveRequestSession } from "../../../../../src/fetch-runtime";
import { readBoundedRequestBody } from "../../../../../src/bounded-request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const headers = { "Cache-Control": "private, no-store" };

function invalid(message: string): never {
  throw new ApplicationFault(
    400,
    "research-history-command",
    "MB-400-RESEARCH-HISTORY",
    message,
  );
}
async function access(request: Request, runId: string, unsafe: boolean) {
  const context = await resolveRequestSession(request, undefined, unsafe);
  if (!uuid.test(runId)) invalid("A valid research request is required.");
  const pool = getAppDatabasePool();
  await authorizeConsultantRunResourceRead({
    context,
    pool,
    runId,
    resourceKind: "research_history",
  });
  const session = await getOrRestoreWorkflowSession(
    pool,
    context.accountId,
    runId,
  );
  if (
    !session ||
    session.account_id !== context.accountId ||
    session.user_profile_id !== context.userId
  )
    throw new ApplicationFault(
      404,
      "research-not-found",
      "MB-404-RESEARCH",
      "Research was not found in this profile.",
    );
  return { context, pool, session };
}
function failure(error: unknown) {
  const known =
    error instanceof ApplicationFault ||
    error instanceof ExecutionIntegrityFault;
  return NextResponse.json(
    {
      error: known
        ? error.message
        : "Research history is temporarily unavailable. No new research has started.",
      code: known ? error.code : "MB-503-RESEARCH-HISTORY",
    },
    { status: known ? error.status : 503, headers },
  );
}

export async function GET(request: Request) {
  try {
    const runId = new URL(request.url).searchParams.get("run_id") ?? "";
    const { pool, session } = await access(request, runId, false);
    return NextResponse.json(
      await getConsultantResearchHistory(pool, session),
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      const decoded: unknown = JSON.parse(
        await readBoundedRequestBody(request, 8192),
      );
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
        invalid("The renewal command is invalid.");
      body = decoded as Record<string, unknown>;
    } catch {
      invalid("A valid bounded renewal command is required.");
    }
    const runId = typeof body.run_id === "string" ? body.run_id : "";
    const { context, pool, session } = await access(request, runId, true);
    if (
      body.action !== "renew" ||
      typeof body.expected_generation !== "number" ||
      !Number.isSafeInteger(body.expected_generation) ||
      body.expected_generation < 0 ||
      typeof body.idempotency_key !== "string" ||
      !uuid.test(body.idempotency_key)
    )
      invalid(
        "Renewal requires the current history generation and a unique command identifier.",
      );
    if (
      !session.approved_request_revision ||
      !session.step3_deep_prompt?.is_approved
    )
      throw new ApplicationFault(
        409,
        "renewal-preparation",
        "MB-409-RESEARCH-RENEWAL",
        "Complete the request and research-plan approvals before renewal.",
      );
    const child = await createLinkedResearchRenewal(
      pool,
      { account_id: context.accountId, user_profile_id: context.userId },
      {
        parent_run_id: runId,
        expected_generation: body.expected_generation,
        idempotency_key: body.idempotency_key,
        expected_request_hash: hashResearchAuthority(
          session.approved_request_revision,
        ),
        expected_prompt_hash: hashResearchAuthority(session.step3_deep_prompt),
        compatibility_version: "renewal.v1",
      },
    );
    return NextResponse.json(
      {
        success: true,
        run_id: child.run_id,
        root_id: child.logical_request_root_id,
        generation: child.generation,
        replayed: child.replayed,
        workflow_url: `/consultant/workflow?run_id=${encodeURIComponent(child.run_id)}`,
        requires_cost_approval: true,
      },
      { status: child.replayed ? 200 : 201, headers },
    );
  } catch (error) {
    return failure(error);
  }
}
