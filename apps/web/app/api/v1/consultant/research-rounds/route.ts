import { NextResponse } from "next/server";
import { scheduleConsultantWorkflowAcceleration } from "../../../../../src/consultant-job-dispatch";
import {
  ApplicationFault,
  authorizeConsultantRunResourceRead,
  getOrRestoreWorkflowSession,
  getResearchRoundReview,
  researchRequestHash,
  summarizeResearchCosts,
  buildResearchRoundPlan,
  configuredResearchTierAvailability,
  researchModelChoices,
  runNextConsultantWorkflowJob,
} from "@matchbase/application";
import {
  ResearchRoundFault,
  listResearchRounds,
  readConsultantCostEvents,
  saveResearchQuote,
  approveResearchQuote,
} from "@matchbase/data";
import { getAppDatabasePool } from "../../../../../src/db-client";
import { resolveRequestSession } from "../../../../../src/fetch-runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function access(req: Request, runId: string, unsafe = false) {
  const context = await resolveRequestSession(req, undefined, unsafe);
  const pool = getAppDatabasePool();
  if (!uuid.test(runId))
    throw new ResearchRoundFault(
      400,
      "MB-400-RUN",
      "A valid research ID is required.",
    );
  await authorizeConsultantRunResourceRead({
    context,
    runId,
    pool,
    resourceKind: "run_detail",
  });
  const session = await getOrRestoreWorkflowSession(
    pool,
    context.accountId,
    runId,
  );
  if (!session || session.user_profile_id !== context.userId)
    throw new ResearchRoundFault(404, "MB-404-ROUND", "Research not found.");
  if (!session.step3_deep_prompt?.is_approved)
    throw new ResearchRoundFault(
      409,
      "MB-409-APPROVAL",
      "Approve the research plan in Section 2 first.",
    );
  return { context, pool, session };
}
function failure(error: unknown) {
  const known =
    error instanceof ResearchRoundFault || error instanceof ApplicationFault;
  return NextResponse.json(
    {
      error: known
        ? error.message
        : "Research costs could not be loaded. No new round has started.",
      code: known ? error.code : "MB-503-ROUND",
    },
    { status: known ? error.status : 503 },
  );
}
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const runId = url.searchParams.get("run_id") ?? "";
    const { context, pool, session } = await access(req, runId);
    // Model discovery reads current account eligibility and prices; it creates no quote.
    if (url.searchParams.get("view") === "model_choices")
      return NextResponse.json(
        {
          choices:
            session.mode === "demonstration"
              ? []
              : await researchModelChoices({ for_followup: true }),
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    const [rounds, events] = await Promise.all([
      listResearchRounds(pool, context.accountId, runId),
      readConsultantCostEvents(pool, context.accountId, runId),
    ]);
    const selected = url.searchParams.get("round_id");
    const selectedRound = selected
      ? rounds.find((r) => r.round_id === selected)
      : undefined;
    const output = selectedRound?.output;
    if (selected && !output)
      throw new ResearchRoundFault(
        404,
        "MB-404-ROUND",
        "Saved round result not found.",
      );
    const completed = rounds.filter((r) => r.status === "completed");
    const latest = [...completed].sort(
      (a, b) => b.round_number - a.round_number,
    )[0];
    const latestReview = latest
      ? await getResearchRoundReview(pool, latest)
      : null;
    const selectedReview =
      selectedRound && output
        ? selectedRound.round_id === latest?.round_id
          ? latestReview
          : await getResearchRoundReview(pool, selectedRound)
        : null;
    return NextResponse.json({
      costs: summarizeResearchCosts(events, session.mode === "demonstration"),
      rounds: rounds.map(
        ({
          output: _output,
          continuation: _continuation,
          account_id: _account,
          run_id: _run,
          ...view
        }) => view,
      ),
      next_round: Math.max(0, ...completed.map((r) => r.round_number)) + 1,
      research_review: latestReview,
      ...(session.mode === "demonstration"
        ? {}
        : { research_tiers: configuredResearchTierAvailability() }),
      ...(output
        ? {
            output: {
              ...output,
              ...(selectedReview ? { research_review: selectedReview } : {}),
            },
          }
        : {}),
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const runId = typeof body.run_id === "string" ? body.run_id : "";
    const { context, pool, session } = await access(req, runId, true);
    if (body.action === "approve") {
      const quoteId = typeof body.quote_id === "string" ? body.quote_id : "";
      if (!uuid.test(quoteId))
        throw new ResearchRoundFault(
          400,
          "MB-400-ROUND",
          "A valid quote is required.",
        );
      const result = await approveResearchQuote(
        pool,
        context.accountId,
        context.userId,
        runId,
        quoteId,
        researchRequestHash(session),
      );
      const job = result.job;
      if (job?.status === "queued")
        scheduleConsultantWorkflowAcceleration(() =>
          runNextConsultantWorkflowJob(pool, job.job_id),
        );
      return NextResponse.json({ success: true, ...result }, { status: 202 });
    }
    if (body.action !== "quote")
      throw new ResearchRoundFault(400, "MB-400-ROUND", "Unsupported action.");
    if (body.depth !== "simple" && body.depth !== "deep")
      throw new ResearchRoundFault(
        400,
        "MB-400-DEPTH",
        "Choose simple or deep research.",
      );
    if (
      body.research_tier !== undefined &&
      body.research_tier !== "default" &&
      body.research_tier !== "advanced" &&
      body.research_tier !== "ultra"
    )
      throw new ResearchRoundFault(
        400,
        "MB-400-RESEARCH-TIER",
        "Choose Default, Advanced or Ultra research.",
      );
    const rounds = await listResearchRounds(pool, context.accountId, runId);
    const parent = rounds
      .filter((r) => r.status === "completed")
      .sort((a, b) => b.round_number - a.round_number)[0];
    if ((parent?.round_number ?? 0) >= 5)
      throw new ResearchRoundFault(
        409,
        "MB-409-ROUND-LIMIT",
        "Five research rounds are complete. No further round is available.",
      );
    if (rounds.some((r) => r.status === "approved"))
      throw new ResearchRoundFault(
        409,
        "MB-409-ROUND-ACTIVE",
        "A round is already active.",
      );
    const gaps = parent?.continuation?.remaining_gaps;
    let followUp: { question: string; lead_ids: string[] } | undefined;
    if (body.follow_up !== undefined) {
      const value = body.follow_up;
      if (
        !parent ||
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
      )
        throw new ResearchRoundFault(
          400,
          "MB-400-FOLLOW-UP",
          "Follow-up focus is available after a completed round.",
        );
      const focus = value as Record<string, unknown>;
      if (
        typeof focus.question !== "string" ||
        focus.question.length > 4000 ||
        !Array.isArray(focus.lead_ids) ||
        focus.lead_ids.some((id) => typeof id !== "string")
      )
        throw new ResearchRoundFault(
          400,
          "MB-400-FOLLOW-UP",
          "Enter a focus of up to 4,000 characters and select saved research leads.",
        );
      const parentReview = await getResearchRoundReview(pool, parent);
      const allowedIds = new Set(
        parentReview.leads.map((lead) => lead.lead_id),
      );
      if (focus.lead_ids.some((id) => !allowedIds.has(id)))
        throw new ResearchRoundFault(
          400,
          "MB-400-FOLLOW-UP",
          "Select leads from the latest completed round.",
        );
      followUp = {
        question: focus.question,
        lead_ids: [...new Set(focus.lead_ids as string[])],
      };
    }
    const { plan, choices } = await buildResearchRoundPlan({
      round_number: (parent?.round_number ?? 0) + 1,
      depth: body.depth,
      research_tier: body.research_tier ?? "default",
      ...(typeof body.model === "string" && body.model
        ? { selected_model: body.model }
        : {}),
      parent_round_id: parent?.round_id ?? null,
      ...(followUp ? { follow_up: followUp } : {}),
      request_hash: researchRequestHash(session),
      focus_requirements: Array.isArray(gaps)
        ? gaps.filter((g): g is string => typeof g === "string")
        : [...(session.step3_deep_prompt?.discovery_criteria ?? [])],
      mode: session.mode === "demonstration" ? "demonstration" : "live",
    });
    const quoteId = await saveResearchQuote(pool, session, plan);
    return NextResponse.json({ quote_id: quoteId, plan, choices });
  } catch (error) {
    return failure(error);
  }
}
