import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// MB-UX-DEV-004 L02: HTTP boundary checks with no database or provider access.
const mocks = vi.hoisted(() => {
  class Fault extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    Fault,
    authorize: vi.fn(),
    restore: vi.fn(),
    review: vi.fn(),
    hash: vi.fn(),
    costs: vi.fn(),
    plan: vi.fn(),
    availability: vi.fn(),
    modelChoices: vi.fn(),
    worker: vi.fn(),
    rounds: vi.fn(),
    events: vi.fn(),
    save: vi.fn(),
    approve: vi.fn(),
    resolve: vi.fn(),
    pool: Object.freeze({ synthetic: true }),
    after: vi.fn(),
  };
});
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
  after: mocks.after,
}));
vi.mock("@matchbase/application", () => ({
  ApplicationFault: mocks.Fault,
  authorizeConsultantRunResourceRead: mocks.authorize,
  getOrRestoreWorkflowSession: mocks.restore,
  getResearchRoundReview: mocks.review,
  researchRequestHash: mocks.hash,
  summarizeResearchCosts: mocks.costs,
  buildResearchRoundPlan: mocks.plan,
  configuredResearchTierAvailability: mocks.availability,
  researchModelChoices: mocks.modelChoices,
  runNextConsultantWorkflowJob: mocks.worker,
}));
vi.mock("@matchbase/data", () => ({
  ResearchRoundFault: mocks.Fault,
  listResearchRounds: mocks.rounds,
  readConsultantCostEvents: mocks.events,
  saveResearchQuote: mocks.save,
  approveResearchQuote: mocks.approve,
}));
vi.mock("./db-client", () => ({ getAppDatabasePool: () => mocks.pool }));
vi.mock("./fetch-runtime", () => ({ resolveRequestSession: mocks.resolve }));

import { GET, POST } from "../app/api/v1/consultant/research-rounds/route";

const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const quoteId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const context = { accountId: "synthetic-account", userId: "synthetic-user" };
const session = {
  user_profile_id: context.userId,
  mode: "live",
  step3_deep_prompt: {
    is_approved: true,
    discovery_criteria: ["Synthetic criterion"],
  },
};
const post = (body: Record<string, unknown>) =>
  POST(
    new Request("http://localhost/api/v1/consultant/research-rounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId, ...body }),
    }),
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("External access forbidden in route tests");
    }),
  );
  mocks.resolve.mockResolvedValue(context);
  mocks.authorize.mockResolvedValue(undefined);
  mocks.restore.mockResolvedValue(session);
  mocks.review.mockImplementation(
    async (_pool, round) =>
      round.output?.research_review ?? {
        version: "research-review.v1",
        round_number: round.round_number,
        leads: [],
      },
  );
  mocks.hash.mockReturnValue("approved-request-hash");
  mocks.rounds.mockResolvedValue([]);
  mocks.events.mockResolvedValue([]);
  mocks.modelChoices.mockResolvedValue([]);
  mocks.costs.mockReturnValue({ recorded_total_usd: 0, complete: true });
  mocks.save.mockResolvedValue(quoteId);
  mocks.plan.mockImplementation(async (input) => ({
    plan: { ...input, models: ["synthetic/model"] },
    choices: [],
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("research tier HTTP approval boundary", () => {
  const readModelChoices = () =>
    GET(
      new Request(
        `http://localhost/api/v1/consultant/research-rounds?run_id=${runId}&view=model_choices`,
      ),
    );
  it("MB-UX-QUALITY-001 L07 lists eligible Gemini and DeepSeek routes without saving or dispatching", async () => {
    const choices = [
      { model: "google/gemini-research", billing_mode: "byok" },
      { model: "deepseek/research", billing_mode: "openrouter_credits" },
    ];
    mocks.modelChoices.mockResolvedValue(choices);
    const response = await readModelChoices();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ choices });
    expect(mocks.authorize).toHaveBeenCalled();
    expect(mocks.modelChoices).toHaveBeenCalledOnce();
    expect(mocks.modelChoices).toHaveBeenCalledWith({ for_followup: true });
    expect(mocks.rounds).not.toHaveBeenCalled();
    expect(mocks.events).not.toHaveBeenCalled();
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.worker).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("MB-UX-QUALITY-001 L07 checks ownership before reading account model choices", async () => {
    mocks.authorize.mockRejectedValue(
      new mocks.Fault(403, "MB-403-ACCESS", "Access denied."),
    );
    expect((await readModelChoices()).status).toBe(403);
    expect(mocks.modelChoices).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("MB-UX-QUALITY-001 L07 does not request provider metadata in demonstration mode", async () => {
    mocks.restore.mockResolvedValue({ ...session, mode: "demonstration" });
    expect(await (await readModelChoices()).json()).toEqual({ choices: [] });
    expect(mocks.modelChoices).not.toHaveBeenCalled();
  });
  it("MB-UX-QUALITY-001 L07 returns an unavailable catalog without leaking provider errors or starting research", async () => {
    mocks.modelChoices.mockRejectedValue(
      new Error("private provider metadata"),
    );
    const response = await readModelChoices();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      "private provider metadata",
    );
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.worker).not.toHaveBeenCalled();
  });
  const review = {
    version: "research-review.v1",
    round_number: 1,
    leads: [{ lead_id: "lead-a" }],
    coverage_gaps: ["Official service evidence"],
  };
  const parent = {
    round_id: "parent-round",
    status: "completed",
    round_number: 1,
    output: { research_review: review },
    continuation: { remaining_gaps: ["Official service evidence"] },
  };
  it("MB-UX-QUALITY-001 L01 saves multilingual focus without dispatch or raw search focus", async () => {
    mocks.rounds.mockResolvedValue([parent]);
    const focus = {
      question: "تحقق من الخدمة · بررسی قیمت · 核查服务",
      lead_ids: ["lead-a", "lead-a"],
    };
    const response = await post({
      action: "quote",
      depth: "deep",
      follow_up: focus,
    });
    expect(response.status).toBe(200);
    expect(mocks.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        follow_up: { ...focus, lead_ids: ["lead-a"] },
        parent_round_id: "parent-round",
        focus_requirements: ["Official service evidence"],
      }),
    );
    expect(mocks.save.mock.calls[0]?.[2].follow_up).toEqual({
      ...focus,
      lead_ids: ["lead-a"],
    });
    expect(mocks.worker).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it.each([
    null,
    [],
    { question: ["coerced"], lead_ids: [] },
    { question: "x".repeat(4001), lead_ids: [] },
    { question: "focus", lead_ids: "lead-a" },
    { question: "focus", lead_ids: [1] },
    { question: "focus", lead_ids: ["foreign-lead"] },
  ])(
    "MB-UX-QUALITY-001 L01 rejects malformed or foreign follow-up %j",
    async (followUp) => {
      mocks.rounds.mockResolvedValue([parent]);
      expect(
        (await post({ action: "quote", depth: "simple", follow_up: followUp }))
          .status,
      ).toBe(400);
      expect(mocks.plan).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.worker).not.toHaveBeenCalled();
    },
  );
  it("MB-UX-QUALITY-001 L01 validates against the latest parent and rejects first-round focus", async () => {
    expect(
      (
        await post({
          action: "quote",
          depth: "simple",
          follow_up: { question: "focus", lead_ids: [] },
        })
      ).status,
    ).toBe(400);
    mocks.rounds.mockResolvedValue([
      parent,
      {
        ...parent,
        round_id: "latest",
        round_number: 2,
        output: { research_review: { ...review, leads: [] } },
      },
    ]);
    expect(
      (
        await post({
          action: "quote",
          depth: "simple",
          follow_up: { question: "focus", lead_ids: ["lead-a"] },
        })
      ).status,
    ).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("MB-UX-QUALITY-001 L01 permits a 4,000-character focus on historical results without leads", async () => {
    mocks.rounds.mockResolvedValue([{ ...parent, output: {} }]);
    expect(
      (
        await post({
          action: "quote",
          depth: "simple",
          follow_up: { question: "x".repeat(4000), lead_ids: [] },
        })
      ).status,
    ).toBe(200);
  });
  it("MB-UX-QUALITY-001 L01 exposes and accepts reconstructed historical leads without mutating saved output", async () => {
    const oldRound = { ...parent, output: { legacy: true } };
    mocks.rounds.mockResolvedValue([oldRound]);
    mocks.review.mockResolvedValue(review);
    const response = await GET(
      new Request(
        `http://localhost/api/v1/consultant/research-rounds?run_id=${runId}&round_id=parent-round`,
      ),
    );
    expect(await response.json()).toMatchObject({
      research_review: review,
      output: { legacy: true, research_review: review },
    });
    expect(oldRound.output).toEqual({ legacy: true });
    expect(
      (
        await post({
          action: "quote",
          depth: "simple",
          follow_up: { question: "Confirm coverage", lead_ids: ["lead-a"] },
        })
      ).status,
    ).toBe(200);
    expect(mocks.review).toHaveBeenCalledWith(mocks.pool, oldRound);
  });
  it("MB-UX-QUALITY-001 L01 blocks a sixth round before quoting", async () => {
    mocks.rounds.mockResolvedValue([{ ...parent, round_number: 5 }]);
    const response = await post({ action: "quote", depth: "simple" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "MB-409-ROUND-LIMIT" });
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("MB-UX-QUALITY-001 L01 keeps the latest review separate from selected historical output", async () => {
    const latestReview = { ...review, round_number: 2, leads: [] };
    mocks.rounds.mockResolvedValue([
      parent,
      {
        ...parent,
        round_id: "latest",
        round_number: 2,
        output: { research_review: latestReview },
      },
    ]);
    const response = await GET(
      new Request(
        `http://localhost/api/v1/consultant/research-rounds?run_id=${runId}&round_id=parent-round`,
      ),
    );
    expect(await response.json()).toMatchObject({
      research_review: latestReview,
      output: { research_review: review },
      next_round: 3,
    });
  });
  it.each([
    { runtime: "production", node: "test", scheduled: 0 },
    { runtime: "local", node: "production", scheduled: 0 },
    { runtime: "local", node: "test", scheduled: 1 },
  ])(
    "MB-UX-PILOT-001 L01 keeps production queued research in the worker: $runtime/$node",
    async ({ runtime, node, scheduled }) => {
      vi.stubEnv("MATCHBASE_ENVIRONMENT", runtime);
      vi.stubEnv("NODE_ENV", node);
      mocks.approve.mockResolvedValue({
        job: { job_id: "queued-job", status: "queued" },
      });
      const response = await post({ action: "approve", quote_id: quoteId });
      expect(response.status).toBe(202);
      expect(mocks.after).toHaveBeenCalledTimes(scheduled);
      expect(mocks.worker).not.toHaveBeenCalled();
      expect(mocks.approve).toHaveBeenCalledOnce();
    },
  );
  it.each(["premium", "ULTRA", "", null, 3, {}, ["advanced"]])(
    "rejects invalid tier %j before creating a quote",
    async (tier) => {
      const response = await post({
        action: "quote",
        depth: "deep",
        research_tier: tier,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "MB-400-RESEARCH-TIER",
      });
      expect(mocks.plan).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.approve).not.toHaveBeenCalled();
    },
  );

  it.each(["default", "advanced", "ultra"])(
    "passes and saves the selected %s tier without dispatching research",
    async (tier) => {
      const response = await post({
        action: "quote",
        depth: "deep",
        research_tier: tier,
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        quote_id: quoteId,
        plan: { research_tier: tier, round_number: 1 },
      });
      expect(mocks.plan).toHaveBeenCalledWith(
        expect.objectContaining({
          research_tier: tier,
          request_hash: "approved-request-hash",
          mode: "live",
        }),
      );
      expect(mocks.save).toHaveBeenCalledWith(mocks.pool, session, body.plan);
      expect(mocks.resolve).toHaveBeenCalledWith(
        expect.any(Request),
        undefined,
        true,
      );
      expect(mocks.authorize).toHaveBeenCalledWith(
        expect.objectContaining({ context, runId, resourceKind: "run_detail" }),
      );
      expect(mocks.approve).not.toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
      expect(mocks.worker).not.toHaveBeenCalled();
    },
  );

  it("defaults an omitted tier for an existing client", async () => {
    expect((await post({ action: "quote", depth: "simple" })).status).toBe(200);
    expect(mocks.plan).toHaveBeenCalledWith(
      expect.objectContaining({ research_tier: "default" }),
    );
  });

  it("approves only the stored quote and ignores attempts to replace its tier or models", async () => {
    const storedPlan = {
      research_tier: "default",
      models: ["synthetic/first", "synthetic/second"],
    };
    mocks.approve.mockResolvedValue({
      round: { plan: storedPlan },
      job: { status: "queued", job_id: "synthetic-job" },
    });
    const response = await post({
      action: "approve",
      quote_id: quoteId,
      research_tier: "ultra",
      model: "unapproved/model",
      depth: "deep",
      plan: { research_tier: "ultra" },
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      round: { plan: storedPlan },
    });
    expect(mocks.approve).toHaveBeenCalledExactlyOnceWith(
      mocks.pool,
      context.accountId,
      context.userId,
      runId,
      quoteId,
      "approved-request-hash",
    );
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it("exposes configured availability for a live owned run", async () => {
    const availability = [
      { tier: "default", available: true },
      { tier: "advanced", available: false, missing_families: ["anthropic"] },
    ];
    mocks.availability.mockReturnValue(availability);
    const response = await GET(
      new Request(
        `http://localhost/api/v1/consultant/research-rounds?run_id=${runId}`,
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      research_tiers: availability,
      next_round: 1,
    });
    expect(mocks.availability).toHaveBeenCalledOnce();
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  it("does not report live provider availability for demonstration mode", async () => {
    mocks.restore.mockResolvedValue({ ...session, mode: "demonstration" });
    const response = await GET(
      new Request(
        `http://localhost/api/v1/consultant/research-rounds?run_id=${runId}`,
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("research_tiers");
    expect(mocks.availability).not.toHaveBeenCalled();
  });

  it("does not reveal availability or create a quote for another user's run", async () => {
    mocks.restore.mockResolvedValue({
      ...session,
      user_profile_id: "another-user",
    });
    expect(
      (
        await GET(
          new Request(
            `http://localhost/api/v1/consultant/research-rounds?run_id=${runId}`,
          ),
        )
      ).status,
    ).toBe(404);
    expect(
      (await post({ action: "quote", depth: "deep", research_tier: "ultra" }))
        .status,
    ).toBe(404);
    expect(mocks.availability).not.toHaveBeenCalled();
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
