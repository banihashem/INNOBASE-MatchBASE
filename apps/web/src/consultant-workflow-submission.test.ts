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
  correction: vi.fn(),
  unsafeGate: vi.fn(),
  authorize: vi.fn(),
  queue: vi.fn(),
}));
vi.mock("@matchbase/application", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  authorizeConsultantRunResourceRead: mocks.authorize,
  queueConsultantWorkflowStep: mocks.queue,
  submitConsultantIntake: mocks.submit,
  retryConsultantIntakeInterpretation: mocks.retry,
  getOrRestoreWorkflowSession: mocks.restore,
  suggestInterpretationCorrection: mocks.correction,
}));
vi.mock("@matchbase/data", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  stopConsultantResearch: mocks.stop,
}));
vi.mock("./db-client", () => ({ getAppDatabasePool: () => mocks.pool }));
vi.mock("./fetch-runtime", () => ({
  resolveRequestSession: async (
    request: Request,
    _path?: string,
    unsafe?: boolean,
  ) => {
    if (unsafe) await mocks.unsafeGate(request);
    return {
      accountId: "owner-account",
      userId: "owner-user",
      tier: "consultant",
    };
  },
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

describe("L12 correction preview admission", () => {
  it("refuses a correction when unsafe Origin/CSRF admission rejects it", async () => {
    mocks.unsafeGate.mockRejectedValueOnce(
      new ApplicationFault(
        403,
        "resource-not-visible",
        "MB-403-REQUEST",
        "Request refused.",
      ),
    );
    const response = await post({
      action: "suggest_step1_correction",
      run_id: runId,
      translation: "Current wording",
    });
    expect(response.status).toBe(403);
    expect(mocks.unsafeGate).toHaveBeenCalledTimes(1);
    expect(mocks.correction).not.toHaveBeenCalled();
  });
  it("rejects missing run and oversized text before requesting a correction", async () => {
    mocks.correction.mockClear();
    expect(
      (await post({ action: "suggest_step1_correction", translation: "Text" }))
        .status,
    ).toBe(400);
    expect(
      (
        await post({
          action: "suggest_step1_correction",
          run_id: runId,
          translation: "x".repeat(24001),
        })
      ).status,
    ).toBe(400);
    expect(mocks.correction).not.toHaveBeenCalled();
  });
  it("uses authenticated identity and only returns a proposal", async () => {
    mocks.correction.mockResolvedValue({
      suggested_translation: "Retained wording",
      cost_usd: 0,
    });
    mocks.after.mockClear();
    const result = await post({
      action: "suggest_step1_correction",
      run_id: runId,
      translation: "Current wording",
      account_id: "attacker",
      intake: { product_requirement: "Different request" },
    });
    expect(result.status).toBe(200);
    expect(mocks.correction).toHaveBeenCalledWith(
      mocks.pool,
      "owner-account",
      "owner-user",
      runId,
      "Current wording",
    );
    expect((await result.json()).correction.suggested_translation).toBe(
      "Retained wording",
    );
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.unsafeGate).toHaveBeenCalledTimes(1);
  });
});

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

describe("MB-UX-PILOT-001 L01 workflow security admission", () => {
  it.each([
    "create_draft",
    "clone_draft",
    "save_draft",
    "abandon_draft",
    "submit_intake",
    "retry_interpretation",
    "approve_step1",
    "approve_step3",
    "stop_research",
    "execute_research",
    "retry_workflow",
    "reveal_more",
    "validate_step1_fidelity",
  ])(
    "rejects %s before execution when unsafe request proof fails",
    async (action) => {
      mocks.unsafeGate.mockRejectedValueOnce(
        new ApplicationFault(
          403,
          "resource-not-visible",
          "MB-403-REQUEST",
          "Request refused.",
        ),
      );
      const response = await post({ action, run_id: runId });
      expect(response.status).toBe(403);
      expect(mocks.unsafeGate).toHaveBeenCalledTimes(1);
      expect(mocks.authorize).not.toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
    },
  );

  it.each([
    "approve_step1",
    "approve_step3",
    "stop_research",
    "execute_research",
    "retry_workflow",
    "reveal_more",
  ])(
    "rejects another profile's %s before restoring or changing a run",
    async (action) => {
      mocks.authorize.mockRejectedValueOnce(
        new ApplicationFault(
          404,
          "run-not-found",
          "MB-404-RUN",
          "The requested run was not found.",
        ),
      );
      const response = await post({
        action,
        run_id: runId,
        execution_id: draftId,
      });
      expect(response.status).toBe(404);
      expect(mocks.authorize).toHaveBeenCalledWith({
        context: {
          accountId: "owner-account",
          userId: "owner-user",
          tier: "consultant",
        },
        runId,
        pool: mocks.pool,
        resourceKind: "run_detail",
      });
      expect(mocks.restore).not.toHaveBeenCalled();
      expect(mocks.stop).not.toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
    },
  );
});

describe("MB-UX-PILOT-001 L01 malformed run identity correction", () => {
  it.each([
    "approve_step1",
    "approve_step3",
    "stop_research",
    "execute_research",
    "retry_workflow",
    "reveal_more",
  ])(
    "rejects non-string or invalid run IDs for %s before ownership lookup or dispatch",
    async (action) => {
      // Arrays containing another profile's UUID must never be coerced into an admitted run ID.
      for (const suppliedRunId of [
        [runId],
        [[runId]],
        [],
        null,
        42,
        {},
        "invalid",
        undefined,
      ]) {
        const response = await post({
          action,
          run_id: suppliedRunId,
          execution_id: draftId,
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          code: "MB-400-RUN-REQUIRED",
        });
        expect(mocks.authorize).not.toHaveBeenCalled();
        expect(mocks.restore).not.toHaveBeenCalled();
        expect(mocks.stop).not.toHaveBeenCalled();
        expect(mocks.queue).not.toHaveBeenCalled();
        expect(mocks.after).not.toHaveBeenCalled();
      }
    },
  );
});
