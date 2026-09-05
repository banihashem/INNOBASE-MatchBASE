import { NextResponse } from "next/server";
import {
  submitConsultantIntake,
  approveInterpretationStep,
  approveDeepPromptStep,
  executeConsultantWorkflowResearch,
  revealMoreCandidates,
  getWorkflowSession,
} from "@matchbase/application";
import { getConsultantOutputV3ByRunId } from "@matchbase/data";
import { getAppDatabasePool } from "../../../../../src/db-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = body.action as string;

    if (action === "submit_intake") {
      const product_requirement = (body.product_requirement as string) || "";
      const technical_compliance = (body.technical_compliance as string) || "";
      const order_profile = (body.order_profile as string) || "";

      if (!product_requirement.trim()) {
        return NextResponse.json(
          { error: "Product requirement is mandatory." },
          { status: 400 },
        );
      }

      const session = await submitConsultantIntake({
        user_profile_id: "2efd403d-823e-4b3f-9fe8-fe3f800c460e",
        account_id: "a9442670-2db5-447f-8fb4-c71f6e16a893",
        product_requirement,
        technical_compliance,
        order_profile,
      });

      return NextResponse.json({ success: true, session });
    }

    if (action === "approve_step1") {
      const run_id = body.run_id as string;
      const edited_translation = body.edited_translation as string | undefined;
      const session = approveInterpretationStep(run_id, edited_translation);
      return NextResponse.json({ success: true, session });
    }

    if (action === "approve_step3") {
      const run_id = body.run_id as string;
      const edited_prompt = body.edited_prompt as string | undefined;
      const session = approveDeepPromptStep(run_id, edited_prompt);
      return NextResponse.json({ success: true, session });
    }

    if (action === "execute_research") {
      const run_id = body.run_id as string;
      const pool = getAppDatabasePool();
      const output = await executeConsultantWorkflowResearch(pool, run_id);
      const session = getWorkflowSession(run_id);
      return NextResponse.json({ success: true, session, output });
    }

    if (action === "reveal_more") {
      const run_id = body.run_id as string;
      const increment = typeof body.increment === "number" ? body.increment : 5;
      const count = revealMoreCandidates(run_id, increment);
      const session = getWorkflowSession(run_id);
      return NextResponse.json({
        success: true,
        revealed_count: count,
        session,
      });
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 },
    );
  } catch (err) {
    console.error("Error in consultant workflow API:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const runId = url.searchParams.get("run_id");

  if (!runId) {
    return NextResponse.json(
      { error: "run_id parameter required" },
      { status: 400 },
    );
  }

  const session = getWorkflowSession(runId);
  if (session) {
    return NextResponse.json({ success: true, session });
  }

  // Fallback to checking database
  const pool = getAppDatabasePool();
  const dbOutput = await getConsultantOutputV3ByRunId(
    pool,
    "a9442670-2db5-447f-8fb4-c71f6e16a893",
    runId,
  );

  if (dbOutput) {
    return NextResponse.json({
      success: true,
      session: {
        run_id: runId,
        state: "workflow_complete",
        revealed_count: dbOutput.supplier_candidates.length,
        output: dbOutput,
      },
    });
  }

  return NextResponse.json(
    { error: "Session or output not found" },
    { status: 404 },
  );
}
