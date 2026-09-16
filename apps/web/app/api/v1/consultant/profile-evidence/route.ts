import { NextResponse } from "next/server";
import { ApplicationFault } from "@matchbase/application";
import {
  ExecutionIntegrityFault,
  searchPrivateEvidenceProfile,
} from "@matchbase/data";
import { getAppDatabasePool } from "../../../../../src/db-client";
import { resolveRequestSession } from "../../../../../src/fetch-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const context = await resolveRequestSession(request);
    const allowed =
      context.tier === "consultant" ||
      (context.tier === "admin" &&
        context.adminSubRoles?.includes("super_admin"));
    if (!allowed)
      throw new ApplicationFault(
        403,
        "profile-evidence-forbidden",
        "MB-403-PROFILE-EVIDENCE",
        "Consultant access is required.",
      );
    const parameters = new URL(request.url).searchParams;
    const rawStatus = parameters.get("status") ?? "current";
    if (!["current", "expired", "all"].includes(rawStatus))
      throw new ApplicationFault(
        400,
        "profile-evidence-filter",
        "MB-400-PROFILE-EVIDENCE",
        "The evidence status filter is invalid.",
      );
    const result = await searchPrivateEvidenceProfile(
      getAppDatabasePool(),
      { account_id: context.accountId, user_profile_id: context.userId },
      {
        query: parameters.get("query") ?? "",
        status: rawStatus as "current" | "expired" | "all",
        limit: 50,
      },
    );
    return NextResponse.json(result, { headers });
  } catch (error) {
    const known =
      error instanceof ApplicationFault ||
      error instanceof ExecutionIntegrityFault;
    return NextResponse.json(
      {
        error: known
          ? error.message
          : "Saved evidence is temporarily unavailable. No research was started.",
        code: known ? error.code : "MB-503-PROFILE-EVIDENCE",
      },
      { status: known ? error.status : 503, headers },
    );
  }
}
