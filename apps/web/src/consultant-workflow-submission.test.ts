import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationFault } from "@matchbase/application";
import { POST } from "../app/api/v1/consultant/workflow/route";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  retry: vi.fn(),
  pool: {},
  after: vi.fn(),
  stop: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("@matchbase/application", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  submitConsultantIntake: mocks.submit,
  retryConsultantIntakeInterpretation: mocks.retry,
  getOrRestoreWorkflowSession: mocks.restore,
}));
vi.mock("@matchbase/data", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  stopConsultantResearch: mocks.stop,
}));
vi.mock("./db-client", () => ({ getAppDatabasePool: () => mocks.pool }));
vi.mock("./fetch-runtime", () => ({
  resolveRequestSession: async () => ({
    accountId: "owner-account",
    userId: "owner-user",
    tier: "consultant",
  }),
}));
vi.mock("next/server", () => ({
  after: mocks.after,
  NextResponse: {
    json: (value: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(value), init),
  },
}));

const draftId = "10000000-0000-4000-8000-000000000001";
const runId = "20000000-0000-4000-8000-000000000001";
const post = (body: Record<string, unknown>) =>
  POST(
    new Request("http://localhost/api/v1/consultant/workflow", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );

describe("L09 stop research admission", () => {
  it("requires an exact valid execution identity", async () => {
    expect(
      (await post({ action: "stop_research", run_id: runId })).status,
    ).toBe(400);
    expect(mocks.stop).not.toHaveBeenCalled();
  });
  it("scopes cancellation to the authenticated account and never dispatches work", async () => {
    mocks.stop.mockResolvedValue("already_stopped");
    mocks.restore.mockResolvedValue({
      execution_id: draftId,
      state: "workflow_failed",
    });
    const response = await post({
      action: "stop_research",
      run_id: runId,
      execution_id: draftId,
    });
    expect(response.status).toBe(200);
    expect(mocks.stop).toHaveBeenCalledWith(
      mocks.pool,
      "owner-account",
      runId,
      draftId,
    );
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("rejects other accounts, stale executions and completed work", async () => {
    for (const [outcome, status] of [
      ["not_found", 404],
      ["stale", 409],
      ["not_running", 409],
    ]) {
      mocks.stop.mockResolvedValue(outcome);
      expect(
        (
          await post({
            action: "stop_research",
            run_id: runId,
            execution_id: draftId,
          })
        ).status,
      ).toBe(status);
    }
    expect(mocks.after).not.toHaveBeenCalled();
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("L03 workflow submission admission", () => {
  it("rejects absent or malformed saved-draft identity before invoking the service", async () => {
    for (const identity of [
      {},
      { draft_id: "invalid", draft_version: 1 },
      { draft_id: draftId },
      { draft_id: draftId, draft_version: 0 },
      { draft_id: draftId, draft_version: 1.5 },
    ]) {
      const response = await post({
        action: "submit_intake",
        product_requirement: "Pumps",
        ...identity,
      });
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("MB-400-DRAFT-REQUIRED");
    }
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("uses authenticated ownership and passes the exact draft version to transactional admission", async () => {
    mocks.submit.mockResolvedValue({
      run_id: runId,
      draft_id: draftId,
      draft_version: 3,
    });
    const response = await post({
      action: "submit_intake",
      draft_id: draftId,
      draft_version: 2,
      account_id: "forged-owner",
      product_requirement: "Pumps",
    });
    expect(response.status).toBe(200);
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith(
      {
        account_id: "owner-account",
        user_profile_id: "owner-user",
        product_requirement: "Pumps",
        technical_compliance: "",
        order_profile: "",
      },
      mocks.pool,
      { mode: "live", draft: { draft_id: draftId, expected_version: 2 } },
    );
    expect((await response.json()).session.draft_version).toBe(3);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("returns persisted recovery identity and the real schema error instead of calling it coherence", async () => {
    mocks.submit.mockRejectedValue(
      Object.assign(
        new ApplicationFault(
          422,
          "interpretation-failed",
          "MB-422-LIVE-SCHEMA",
          "Interpretation failed.",
        ),
        {
          run_id: runId,
          draft_id: draftId,
          draft_version: 3,
          execution_id: "new-execution",
          retry_action: "interpretation",
        },
      ),
    );
    const response = await post({
      action: "submit_intake",
      draft_id: draftId,
      draft_version: 2,
      product_requirement: "Pumps",
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "Interpretation failed.",
      code: "MB-422-LIVE-SCHEMA",
      run_id: runId,
      draft_id: draftId,
      draft_version: 3,
      execution_id: "new-execution",
      retry_action: "interpretation",
    });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("dispatches an explicit initial retry with authenticated ownership and a valid existing run", async () => {
    const invalid = await post({
      action: "retry_interpretation",
      run_id: "invalid",
    });
    expect(invalid.status).toBe(400);
    expect(mocks.retry).not.toHaveBeenCalled();
    mocks.retry.mockResolvedValue({
      run_id: runId,
      state: "prep_step1_awaiting_approval",
    });
    const response = await post({
      action: "retry_interpretation",
      run_id: runId,
    });
    expect(response.status).toBe(200);
    expect(mocks.retry).toHaveBeenCalledExactlyOnceWith(
      mocks.pool,
      "owner-account",
      "owner-user",
      runId,
    );
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("preserves an unavailable retry diagnosis without labeling it a draft conflict", async () => {
    mocks.retry.mockRejectedValue(
      new ApplicationFault(
        409,
        "interpretation-retry-unavailable",
        "MB-409-INTERPRETATION-RETRY",
        "This interpretation cannot be retried in its current state.",
      ),
    );
    const response = await post({
      action: "retry_interpretation",
      run_id: runId,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "MB-409-INTERPRETATION-RETRY",
      error: "This interpretation cannot be retried in its current state.",
    });
    expect(mocks.retry).toHaveBeenCalledTimes(1);
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
