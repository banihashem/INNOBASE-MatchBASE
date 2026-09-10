import { NextResponse } from "next/server";
import { scheduleConsultantWorkflowAcceleration } from "../../../../../src/consultant-job-dispatch";
import {
  ApplicationFault,
  authorizeConsultantRunResourceRead,
  submitConsultantIntake,
  retryConsultantIntakeInterpretation,
  approveInterpretationStep,
  approveDeepPromptStep,
  queueConsultantWorkflowStep,
  runNextConsultantWorkflowJob,
  revealMoreCandidates,
  getWorkflowSession,
  getOrRestoreWorkflowSession,
} from "@matchbase/application";
import {
  listConsultantWorkflowSessions,
  createConsultantDraftSession,
  getConsultantDraftSessionById,
  saveConsultantDraftSession,
  listActiveConsultantDraftSessions,
  abandonConsultantDraftSession,
  getConsultantDraftSessionByRunId,
  failExpiredConsultantWorkflowJobs,
  getConsultantWorkflowActivity,
  listConsultantResearchSummaries,
  stopConsultantResearch,
} from "@matchbase/data";
import { suggestInterpretationCorrection } from "@matchbase/application";
import { validateStep1RequirementFidelity } from "@matchbase/contracts";
import { getAppDatabasePool } from "../../../../../src/db-client";
import { resolveRequestSession } from "../../../../../src/fetch-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  const pool = getAppDatabasePool();

  // 1. Authenticate session & resolve request context
  let context;
  try {
    context = await resolveRequestSession(req, undefined, true);
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

    // MB-UX-PILOT-001 L01: authorize profile ownership before any run mutation.
    if (
      [
        "approve_step1",
        "approve_step3",
        "stop_research",
        "execute_research",
        "retry_workflow",
        "reveal_more",
      ].includes(action)
    ) {
      if (
        typeof body.run_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          body.run_id,
        )
      ) {
        return NextResponse.json(
          { error: "A valid run_id is required.", code: "MB-400-RUN-REQUIRED" },
          { status: 400 },
        );
      }
      await authorizeConsultantRunResourceRead({
        context,
        runId: body.run_id,
        pool,
        resourceKind: "run_detail",
      });
    }

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

    // Action: Clone Conflicting Draft as New Independent Draft Atomically (N03)
    if (action === "clone_draft") {
      const draft_data = (body.draft_data as Record<string, unknown>) || {};
      const newDraftId = crypto.randomUUID();
      const saved = await saveConsultantDraftSession(
        pool,
        {
          draft_id: newDraftId,
          account_id: context.accountId,
          user_profile_id: context.userId,
          tier: "consultant",
          current_run_id: null,
          snapshot_id: null,
          draft_version: 1,
          status: "active",
          draft_data,
        },
        undefined,
      );
      return NextResponse.json({
        success: true,
        draft_id: saved.draft_id,
        draft_version: saved.draft_version,
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
      if (current_run_id) {
        await authorizeConsultantRunResourceRead({
          context,
          runId: current_run_id,
          pool,
          resourceKind: "run_detail",
        });
      }
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
        const ownedDraft = await getConsultantDraftSessionById(
          pool,
          context.accountId,
          context.userId,
          draft_id,
        );
        if (!ownedDraft)
          return NextResponse.json(
            { error: "Draft not found", code: "MB-404-DRAFT" },
            { status: 404 },
          );
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
      const draftId = body.draft_id;
      const draftVersion = body.draft_version;
      if (
        typeof draftId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          draftId,
        ) ||
        typeof draftVersion !== "number" ||
        !Number.isSafeInteger(draftVersion) ||
        draftVersion < 1
      )
        return NextResponse.json(
          {
            error:
              "Submit a saved draft with its current draft_id and draft_version.",
            code: "MB-400-DRAFT-REQUIRED",
          },
          { status: 400 },
        );
      const product_requirement =
        (body.product_requirement as string) ||
        (body.productRequirement as string) ||
        "";
      const technical_compliance =
        (body.technical_compliance as string) ||
        (body.technicalCompliance as string) ||
        "";
      const order_profile =
        (body.order_profile as string) || (body.orderProfile as string) || "";

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
        {
          mode: body.mode === "demonstration" ? "demonstration" : "live",
          draft: { draft_id: draftId, expected_version: draftVersion },
        },
      );

      return NextResponse.json({ success: true, session });
    }

    if (action === "retry_interpretation") {
      if (
        typeof body.run_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          body.run_id,
        )
      )
        return NextResponse.json(
          { error: "A valid run_id is required.", code: "MB-400-RUN-REQUIRED" },
          { status: 400 },
        );
      const session = await retryConsultantIntakeInterpretation(
        pool,
        context.accountId,
        context.userId,
        body.run_id,
      );
      return NextResponse.json({ success: true, session });
    }

    // Action: Validate Step 1 Requirement Fidelity
    if (action === "validate_step1_fidelity") {
      const intake = body.intake as {
        product_requirement: string;
        technical_compliance: string;
        order_profile: string;
      };
      const translation = (body.translation as string) || "";

      const fidelity = validateStep1RequirementFidelity(intake, {
        english_translation: translation,
      });

      return NextResponse.json({ success: true, fidelity });
    }

    if (action === "suggest_step1_correction") {
      if (
        typeof body.run_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          body.run_id,
        ) ||
        typeof body.translation !== "string" ||
        !body.translation.trim() ||
        body.translation.length > 24000
      )
        return NextResponse.json(
          {
            error:
              "A saved run and an interpretation of 1–24000 characters are required.",
            code: "MB-400-CORRECTION-INPUT",
          },
          { status: 400 },
        );
      const correction = await suggestInterpretationCorrection(
        pool,
        context.accountId,
        context.userId,
        body.run_id,
        body.translation,
      );
      return NextResponse.json({ success: true, correction });
    }

    if (action === "approve_step1") {
      const run_id = body.run_id as string;
      const edited_translation =
        typeof body.edited_translation === "string"
          ? body.edited_translation
          : ((body.interpretation as any)?.english_translation as
              string | undefined);

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

      try {
        const session = await approveInterpretationStep(
          run_id,
          edited_translation,
          pool,
          { defer_generation: true },
        );
        const job = await queueConsultantWorkflowStep(pool, run_id, "prepare");
        if (job.status === "queued")
          scheduleConsultantWorkflowAcceleration(() =>
            runNextConsultantWorkflowJob(pool, job.job_id),
          );
        return NextResponse.json(
          {
            success: true,
            processing: job.status === "queued" || job.status === "running",
            session,
          },
          { status: 202 },
        );
      } catch (err: any) {
        if (
          err instanceof ApplicationFault ||
          err?.code === "MB-422-FIDELITY-FAILED"
        ) {
          return NextResponse.json(
            {
              error: err.message,
              code: err.code || "MB-422-FIDELITY-FAILED",
              status: err.status || 422,
            },
            { status: err.status || 422 },
          );
        }
        throw err;
      }
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

    if (action === "stop_research") {
      const runId = body.run_id as string;
      const executionId = String(body.execution_id ?? "");
      const uuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuid.test(runId) || !uuid.test(executionId)) {
        return NextResponse.json(
          { error: "A valid run and execution ID are required." },
          { status: 400 },
        );
      }
      const outcome = await stopConsultantResearch(
        pool,
        context.accountId,
        runId,
        executionId,
      );
      if (outcome === "not_found") {
        return NextResponse.json(
          { error: "Research not found." },
          { status: 404 },
        );
      }
      if (outcome === "stale" || outcome === "not_running") {
        return NextResponse.json(
          {
            error:
              "This execution is no longer running. Reload its current status.",
          },
          { status: 409 },
        );
      }
      const session = await getOrRestoreWorkflowSession(
        pool,
        context.accountId,
        runId,
      );
      return NextResponse.json({ success: true, outcome, session });
    }

    // Action: Execute Research
    if (action === "execute_research") {
      const run_id = body.run_id as string;

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

      const job = await queueConsultantWorkflowStep(pool, run_id, "research");
      if (job.status === "queued")
        scheduleConsultantWorkflowAcceleration(() =>
          runNextConsultantWorkflowJob(pool, job.job_id),
        );
      const session = getWorkflowSession(run_id);
      return NextResponse.json(
        {
          success: true,
          processing: job.status === "queued" || job.status === "running",
          session,
        },
        { status: 202 },
      );
    }

    if (action === "retry_workflow") {
      const run_id = body.run_id as string;
      const session = await getOrRestoreWorkflowSession(
        pool,
        context.accountId,
        run_id,
      );
      if (
        !session?.retry_action ||
        session.retry_action === "interpretation" ||
        session.state !== "workflow_failed"
      ) {
        return NextResponse.json(
          {
            error: "No failed execution is available to retry.",
            code: "MB-409-NO-RETRY",
          },
          { status: 409 },
        );
      }
      const job = await queueConsultantWorkflowStep(
        pool,
        run_id,
        session.retry_action,
        true,
      );
      scheduleConsultantWorkflowAcceleration(() =>
        runNextConsultantWorkflowJob(pool, job.job_id),
      );
      return NextResponse.json(
        { success: true, processing: true, session },
        { status: 202 },
      );
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
    const recovery = Object.fromEntries(
      ["run_id", "execution_id", "draft_id", "draft_version", "retry_action"]
        .filter((key) => (err as any)?.[key] !== undefined)
        .map((key) => [key, (err as any)[key]]),
    );

    if (code === "MB-422-COHERENCE") {
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

    if (code === "MB-409-DRAFT-CONFLICT") {
      const currentVersion = (err as any)?.current_version ?? 1;
      const submittedVersion = (err as any)?.submitted_version ?? 1;
      return NextResponse.json(
        {
          ...recovery,
          code: "MB-409-DRAFT-CONFLICT",
          current_version: currentVersion,
          submitted_version: submittedVersion,
          recoverable: true,
          error: {
            code: "MB-409-DRAFT-CONFLICT",
            message:
              err instanceof Error
                ? err.message
                : "This draft was updated in another tab.",
            current_version: currentVersion,
            submitted_version: submittedVersion,
            recoverable: true,
          },
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        code,
        ...recovery,
      },
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

  if (url.searchParams.get("history") === "true") {
    await failExpiredConsultantWorkflowJobs(pool);
    const items = await listConsultantResearchSummaries(
      pool,
      context.accountId,
    );
    return NextResponse.json({ success: true, items });
  }

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

  // Retrieve active server-scoped drafts
  if (getActiveDraft === "true") {
    const drafts = await listActiveConsultantDraftSessions(
      pool,
      context.accountId,
      context.userId,
      20,
    );
    // Find active draft that has non-empty requirements, or fallback to the latest
    const primaryDraft =
      drafts.find((d) => {
        const data = d.draft_data as any;
        return (
          data?.productRequirement?.trim() ||
          data?.technicalCompliance?.trim() ||
          data?.orderProfile?.trim()
        );
      }) ||
      drafts[0] ||
      null;
    return NextResponse.json({ success: true, draft: primaryDraft, drafts });
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
    await failExpiredConsultantWorkflowJobs(pool);
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
      const activity = await getConsultantWorkflowActivity(
        pool,
        context.accountId,
        authorized.runId,
        session.execution_id,
      );
      return NextResponse.json({
        success: true,
        session: { ...session, activity },
        draft,
      });
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
          revealed_count: Math.min(
            5,
            authorized.output.supplier_candidates.length,
          ),
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
