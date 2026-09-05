import { NextResponse } from "next/server";
import {
  ApplicationFault,
  authorizeConsultantRunResourceRead,
  submitConsultantIntake,
  approveInterpretationStep,
  approveDeepPromptStep,
  executeConsultantWorkflowResearch,
  revealMoreCandidates,
  getWorkflowSession,
  getOrRestoreWorkflowSession,
} from "@matchbase/application";
import {
  listConsultantWorkflowSessions,
  saveConsultantDraftSession,
  getActiveConsultantDraftSession,
  abandonConsultantDraftSession,
} from "@matchbase/data";
import { getAppDatabasePool } from "../../../../../src/db-client";
import { resolveRequestSession } from "../../../../../src/fetch-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const pool = getAppDatabasePool();

  // 1. Authenticate session & resolve request context
  let context;
  try {
    context = await resolveRequestSession(req);
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
      { error: fault.message, code: fault.code, status: fault.status },
      { status: fault.status },
    );
  }

  // 2. Authorize consultant tier
  const isConsultant = context.tier === "consultant";
  const isSuperAdmin =
    context.tier === "admin" &&
    Array.isArray(context.adminSubRoles) &&
    context.adminSubRoles.includes("super_admin");

  if (!isConsultant && !isSuperAdmin) {
    return NextResponse.json(
      {
        error:
          "Access denied. Consultant research workflow requires consultant tier entitlement.",
        code: "MB-403-FORBIDDEN",
        status: 403,
      },
      { status: 403 },
    );
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = body.action as string;

    // Action: Save Draft Session
    if (action === "save_draft") {
      const UUID_REGEX =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const rawDraftId = body.draft_id as string;
      const draft_id =
        rawDraftId && UUID_REGEX.test(rawDraftId)
          ? rawDraftId
          : crypto.randomUUID();
      const current_run_id = (body.current_run_id as string) || null;
      const snapshot_id = (body.snapshot_id as string) || null;
      const draft_version =
        typeof body.draft_version === "number" ? body.draft_version : 1;
      const draft_data = (body.draft_data as Record<string, unknown>) || {};

      await saveConsultantDraftSession(pool, {
        draft_id,
        account_id: context.accountId,
        user_profile_id: context.userId,
        tier: "consultant",
        current_run_id,
        snapshot_id,
        draft_version,
        status: "active",
        draft_data,
      });

      return NextResponse.json({ success: true, draft_id, draft_version });
    }

    // Action: Abandon Draft Session
    if (action === "abandon_draft") {
      const draft_id = body.draft_id as string;
      if (draft_id) {
        await abandonConsultantDraftSession(pool, context.accountId, draft_id);
      }
      return NextResponse.json({ success: true });
    }

    // Action: Submit Intake
    if (action === "submit_intake") {
      const product_requirement = (body.product_requirement as string) || "";
      const technical_compliance = (body.technical_compliance as string) || "";
      const order_profile = (body.order_profile as string) || "";

      if (!product_requirement.trim()) {
        return NextResponse.json(
          {
            error: "Product requirement is mandatory.",
            code: "MB-400-INTAKE-REQUIRED",
          },
          { status: 400 },
        );
      }

      const session = await submitConsultantIntake(
        {
          user_profile_id: context.userId,
          account_id: context.accountId,
          product_requirement,
          technical_compliance,
          order_profile,
        },
        pool,
      );

      // Save server-side draft linked to the created session
      if (body.draft_id) {
        await saveConsultantDraftSession(pool, {
          draft_id: body.draft_id as string,
          account_id: context.accountId,
          user_profile_id: context.userId,
          tier: "consultant",
          current_run_id: session.run_id,
          draft_version:
            typeof body.draft_version === "number" ? body.draft_version + 1 : 1,
          status: "submitted",
          draft_data: {
            product_requirement,
            technical_compliance,
            order_profile,
          },
        });
      }

      return NextResponse.json({ success: true, session });
    }

    // Action: Approve Step 1 Interpretation
    if (action === "approve_step1") {
      const run_id = body.run_id as string;
      const edited_translation = body.edited_translation as string | undefined;

      // Verify session ownership
      const existingSession = await getOrRestoreWorkflowSession(
        pool,
        context.accountId,
        run_id,
      );
      if (!existingSession) {
        return NextResponse.json(
          { error: "Session not found", code: "MB-404-SESSION" },
          { status: 404 },
        );
      }

      const session = await approveInterpretationStep(
        run_id,
        edited_translation,
        pool,
      );
      return NextResponse.json({ success: true, session });
    }

    // Action: Approve Step 3 Deep Prompt
    if (action === "approve_step3") {
      const run_id = body.run_id as string;
      const edited_prompt = body.edited_prompt as string | undefined;

      // Verify session ownership
      const existingSession = await getOrRestoreWorkflowSession(
        pool,
        context.accountId,
        run_id,
      );
      if (!existingSession) {
        return NextResponse.json(
          { error: "Session not found", code: "MB-404-SESSION" },
          { status: 404 },
        );
      }

      const session = await approveDeepPromptStep(run_id, edited_prompt, pool);
      return NextResponse.json({ success: true, session });
    }

    // Action: Execute Research
    if (action === "execute_research") {
      const run_id = body.run_id as string;
      const mode =
        (body.mode as "live" | "demonstration" | "hybrid") || "demonstration";

      // Verify session ownership
      const existingSession = await getOrRestoreWorkflowSession(
        pool,
        context.accountId,
        run_id,
      );
      if (!existingSession) {
        return NextResponse.json(
          { error: "Session not found", code: "MB-404-SESSION" },
          { status: 404 },
        );
      }

      const output = await executeConsultantWorkflowResearch(pool, run_id, {
        mode,
      });
      const session = getWorkflowSession(run_id);
      return NextResponse.json({ success: true, session, output });
    }

    // Action: Reveal More Candidates
    if (action === "reveal_more") {
      const run_id = body.run_id as string;
      const increment = typeof body.increment === "number" ? body.increment : 5;

      // Verify session ownership
      const existingSession = await getOrRestoreWorkflowSession(
        pool,
        context.accountId,
        run_id,
      );
      if (!existingSession) {
        return NextResponse.json(
          { error: "Session not found", code: "MB-404-SESSION" },
          { status: 404 },
        );
      }

      const count = await revealMoreCandidates(run_id, increment, pool);
      const session = getWorkflowSession(run_id);
      return NextResponse.json({
        success: true,
        revealed_count: count,
        session,
      });
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}`, code: "MB-400-UNKNOWN-ACTION" },
      { status: 400 },
    );
  } catch (err) {
    console.error("Error in consultant workflow API:", err);
    const status = (err as any)?.status || 500;
    const code = (err as any)?.code || "MB-500-INTERNAL";
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), code },
      { status },
    );
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const pool = getAppDatabasePool();

  // 1. Authenticate session & resolve request context
  let context;
  try {
    context = await resolveRequestSession(req);
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
      { error: fault.message, code: fault.code, status: fault.status },
      { status: fault.status },
    );
  }

  // 2. Authorize consultant tier
  const isConsultant = context.tier === "consultant";
  const isSuperAdmin =
    context.tier === "admin" &&
    Array.isArray(context.adminSubRoles) &&
    context.adminSubRoles.includes("super_admin");

  if (!isConsultant && !isSuperAdmin) {
    return NextResponse.json(
      {
        error:
          "Access denied. Consultant research workflow requires consultant tier entitlement.",
        code: "MB-403-FORBIDDEN",
        status: 403,
      },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const runId = url.searchParams.get("run_id");
  const listIncomplete = url.searchParams.get("incomplete");
  const getActiveDraft = url.searchParams.get("active_draft");

  // Retrieve active server-scoped draft
  if (getActiveDraft === "true") {
    const draft = await getActiveConsultantDraftSession(
      pool,
      context.accountId,
      context.userId,
    );
    return NextResponse.json({ success: true, draft });
  }

  // List incomplete workflow sessions for account
  if (listIncomplete === "true") {
    const sessions = await listConsultantWorkflowSessions(
      pool,
      context.accountId,
      20,
    );
    return NextResponse.json({ success: true, sessions });
  }

  if (!runId) {
    return NextResponse.json(
      { error: "run_id parameter required", code: "MB-400-RUN-REQUIRED" },
      { status: 400 },
    );
  }

  // Authorize run read access
  try {
    const authorized = await authorizeConsultantRunResourceRead({
      context,
      runId,
      pool,
      resourceKind: "run_result",
    });

    // Try in-memory or workflow table session first
    const session = await getOrRestoreWorkflowSession(
      pool,
      context.accountId,
      authorized.runId,
    );
    if (session) {
      return NextResponse.json({ success: true, session });
    }

    // Output is authorized and present
    return NextResponse.json({
      success: true,
      session: {
        run_id: authorized.runId,
        state: "workflow_complete",
        revealed_count: authorized.output.supplier_candidates.length,
        output: authorized.output,
      },
    });
  } catch (readError) {
    if (readError instanceof ApplicationFault) {
      return NextResponse.json(
        {
          error: readError.message,
          code: readError.code,
          status: readError.status,
        },
        { status: readError.status },
      );
    }
    return NextResponse.json(
      { error: "Session or output not found", code: "MB-404-NOT-FOUND" },
      { status: 404 },
    );
  }
}
