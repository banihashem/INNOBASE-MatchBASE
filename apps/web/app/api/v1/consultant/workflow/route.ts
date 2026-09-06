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
  createConsultantDraftSession,
  getConsultantDraftSessionById,
  saveConsultantDraftSession,
  getActiveConsultantDraftSession,
  abandonConsultantDraftSession,
  getConsultantDraftSessionByRunId,
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

    // Action: Create New Independent Server Draft
    if (action === "create_draft") {
      const created = await createConsultantDraftSession(
        pool,
        context.accountId,
        context.userId,
      );
      return NextResponse.json({
        success: true,
        draft_id: created.draft_id,
        draft_version: created.draft_version,
      });
    }

    // Action: Save Draft Session with Optimistic Concurrency Check
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
      const expected_version =
        typeof body.expected_version === "number"
          ? body.expected_version
          : typeof body.draft_version === "number"
            ? body.draft_version
            : undefined;
      const draft_data = (body.draft_data as Record<string, unknown>) || {};

      const saved = await saveConsultantDraftSession(
        pool,
        {
          draft_id,
          account_id: context.accountId,
          user_profile_id: context.userId,
          tier: "consultant",
          current_run_id,
          snapshot_id,
          draft_version,
          status: "active",
          draft_data,
        },
        expected_version,
      );

      return NextResponse.json({
        success: true,
        draft_id: saved.draft_id,
        draft_version: saved.draft_version,
      });
    }

    // Action: Abandon Draft Session
    if (action === "abandon_draft") {
      const draft_id = body.draft_id as string;
      if (draft_id) {
        await abandonConsultantDraftSession(pool, context.accountId, draft_id);
      } else {
        await abandonConsultantDraftSession(
          pool,
          context.accountId,
          undefined,
          context.userId,
        );
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

    if (code === "MB-422-COHERENCE" || status === 422) {
      return NextResponse.json(
        {
          error: {
            code: "MB-422-COHERENCE",
            message:
              err instanceof Error
                ? err.message
                : "The request contains materially conflicting product requirements.",
            conflicts: (err as any)?.conflicts ?? [
              {
                fields: [
                  "product_requirement",
                  "technical_quality_trade_requirements",
                ],
                product_families: [
                  "industrial_water_heater",
                  "poultry_food_product",
                ],
                explanation:
                  err instanceof Error
                    ? err.message
                    : "Conflicting product requirements detected across intake fields.",
              },
            ],
            recoverable: true,
          },
        },
        { status: 422 },
      );
    }

    if (code === "MB-409-DRAFT-CONFLICT" || status === 409) {
      return NextResponse.json(
        {
          error: {
            code: "MB-409-DRAFT-CONFLICT",
            message:
              err instanceof Error
                ? err.message
                : "This draft was updated in another tab.",
            current_version: (err as any)?.current_version ?? 1,
            submitted_version: (err as any)?.submitted_version ?? 1,
            recoverable: true,
          },
        },
        { status: 409 },
      );
    }

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
  const draftIdParam = url.searchParams.get("draft_id");
  const listIncomplete = url.searchParams.get("incomplete");
  const getActiveDraft = url.searchParams.get("active_draft");

  // Retrieve specific server draft by ID
  if (draftIdParam) {
    const draft = await getConsultantDraftSessionById(
      pool,
      context.accountId,
      context.userId,
      draftIdParam,
    );
    if (!draft) {
      return NextResponse.json(
        { error: "Draft not found", code: "MB-404-DRAFT" },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, draft });
  }

  // Retrieve active server-scoped draft
  if (getActiveDraft === "true") {
    const draft = await getActiveConsultantDraftSession(
      pool,
      context.accountId,
      context.userId,
    );
    return NextResponse.json({ success: true, draft });
  }

  // List incomplete workflow sessions for account (excluding invalidated sessions)
  if (listIncomplete === "true") {
    const allSessions = await listConsultantWorkflowSessions(
      pool,
      context.accountId,
      20,
    );
    const sessions = allSessions.filter(
      (s) => !s.is_invalidated && s.current_state !== "invalidated",
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
      resourceKind: "run_detail",
    });

    // Lookup linked draft session
    const draft = await getConsultantDraftSessionByRunId(
      pool,
      context.accountId,
      authorized.runId,
    );

    // Try in-memory or workflow table session first
    const session = await getOrRestoreWorkflowSession(
      pool,
      context.accountId,
      authorized.runId,
    );
    if (session) {
      if (draft) {
        (session as any).draft_id = draft.draft_id;
        (session as any).draft_version = draft.draft_version;
      }
      return NextResponse.json({ success: true, session, draft });
    }

    // Output is authorized and present
    if (authorized.output) {
      return NextResponse.json({
        success: true,
        session: {
          run_id: authorized.runId,
          draft_id: draft?.draft_id ?? null,
          draft_version: draft?.draft_version ?? 1,
          state: "workflow_complete",
          revealed_count: authorized.output.supplier_candidates.length,
          output: authorized.output,
        },
        draft,
      });
    }

    // Workflow session present without output (in-progress run)
    if (authorized.session) {
      const restoredSession = {
        run_id: authorized.session.run_id,
        session_id: authorized.session.session_id,
        draft_id: draft?.draft_id ?? null,
        draft_version: draft?.draft_version ?? 1,
        state: authorized.session.current_state,
        intake: authorized.session.original_intake,
        step1_interpretation:
          authorized.session.approved_request_revision ??
          authorized.session.draft_revision,
        step2_advisory: authorized.session.advisory_output,
        step3_deep_prompt: authorized.session.deep_prompt_revision,
        revealed_count: 5,
        output: null,
      };
      return NextResponse.json({
        success: true,
        session: restoredSession,
        draft,
      });
    }

    return NextResponse.json(
      { error: "Session or output not found", code: "MB-404-NOT-FOUND" },
      { status: 404 },
    );
  } catch (readError) {
    if (readError instanceof ApplicationFault) {
      return NextResponse.json(
        {
          error: readError.message,
          code: readError.code,
          status: readError.status,
          details: (readError as any).headers ?? (readError as any).details,
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
