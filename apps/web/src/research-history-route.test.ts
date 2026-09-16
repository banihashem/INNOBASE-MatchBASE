import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class DataFault extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status = 409,
    ) {
      super(message);
    }
  }
  class AppFault extends Error {
    constructor(
      readonly status: number,
      _slug: string,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    DataFault,
    AppFault,
    resolve: vi.fn(),
    authorize: vi.fn(),
    restore: vi.fn(),
    history: vi.fn(),
    renew: vi.fn(),
    hash: vi.fn(),
    pool: Object.freeze({ synthetic: true }),
  };
});
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
}));
vi.mock("@matchbase/application", () => ({
  ApplicationFault: mocks.AppFault,
  authorizeConsultantRunResourceRead: mocks.authorize,
  getOrRestoreWorkflowSession: mocks.restore,
  getConsultantResearchHistory: mocks.history,
}));
vi.mock("@matchbase/data", () => ({
  ExecutionIntegrityFault: mocks.DataFault,
  createLinkedResearchRenewal: mocks.renew,
  hashResearchAuthority: mocks.hash,
}));
vi.mock("./db-client", () => ({ getAppDatabasePool: () => mocks.pool }));
vi.mock("./fetch-runtime", () => ({ resolveRequestSession: mocks.resolve }));
import { GET, POST } from "../app/api/v1/consultant/research-history/route";

const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const childId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const commandId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const context = { accountId: "account", userId: "profile" };
const session = {
  account_id: "account",
  user_profile_id: "profile",
  run_id: runId,
  approved_request_revision: { approved: true },
  step3_deep_prompt: {
    is_approved: true,
    prompt_text: "Original approved scope",
  },
};
const dto = {
  history: {
    generation: 2,
    runs: [
      {
        run_id: runId,
        renewal_ordinal: 2,
        created_at: "2026-09-16T00:00:00Z",
        state: "workflow_complete",
      },
    ],
    costs: { recorded_total_usd: 0.4, unpriced_calls: 1, complete: false },
    can_renew: true,
  },
  memory: {
    eligible_count: 2,
    needs_refresh_count: 3,
    observations: [],
    fresh_discovery_required: true,
  },
};
const read = () =>
  GET(
    new Request(
      `http://localhost/api/v1/consultant/research-history?run_id=${runId}`,
    ),
  );
const post = (override: Record<string, unknown> = {}) =>
  POST(
    new Request("http://localhost/api/v1/consultant/research-history", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        action: "renew",
        run_id: runId,
        expected_generation: 2,
        idempotency_key: commandId,
        ...override,
      }),
    }),
  );
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("No external access allowed");
    }),
  );
  mocks.resolve.mockResolvedValue(context);
  mocks.authorize.mockResolvedValue(undefined);
  mocks.restore.mockResolvedValue(session);
  mocks.history.mockResolvedValue(dto);
  mocks.hash.mockImplementation((value) =>
    value === session.approved_request_revision
      ? "server-request-hash"
      : "server-prompt-hash",
  );
  mocks.renew.mockResolvedValue({
    run_id: childId,
    logical_request_root_id: runId,
    generation: 3,
    replayed: false,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("MB-ARCH-IMPLEMENT-001 L02 private research history boundary", () => {
  it("returns private history, unknown costs and freshness without starting work", async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(dto);
    expect(mocks.history).toHaveBeenCalledWith(mocks.pool, session);
    expect(mocks.renew).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("denies unauthenticated history before lookup", async () => {
    mocks.resolve.mockRejectedValue(
      new mocks.AppFault(401, "session", "MB-401-SESSION", "Session required."),
    );
    expect((await read()).status).toBe(401);
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.restore).not.toHaveBeenCalled();
  });
  it("denies a different profile even after account-level resource permission", async () => {
    mocks.restore.mockResolvedValue({
      ...session,
      user_profile_id: "different-profile",
    });
    expect((await read()).status).toBe(404);
    expect((await post()).status).toBe(404);
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.renew).not.toHaveBeenCalled();
  });
  it("renewal uses unsafe-origin validation and server-owned scope hashes without dispatch", async () => {
    const response = await post({
      expected_request_hash: "attacker",
      expected_prompt_hash: "attacker",
    });
    expect(response.status).toBe(201);
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.any(Request),
      undefined,
      true,
    );
    expect(mocks.renew).toHaveBeenCalledWith(
      mocks.pool,
      { account_id: "account", user_profile_id: "profile" },
      {
        parent_run_id: runId,
        expected_generation: 2,
        idempotency_key: commandId,
        expected_request_hash: "server-request-hash",
        expected_prompt_hash: "server-prompt-hash",
        compatibility_version: "renewal.v1",
      },
    );
    expect(await response.json()).toEqual({
      success: true,
      run_id: childId,
      root_id: runId,
      generation: 3,
      replayed: false,
      workflow_url: `/consultant/workflow?run_id=${childId}`,
      requires_cost_approval: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects origin admission failures before renewal", async () => {
    mocks.resolve.mockRejectedValue(
      new mocks.AppFault(403, "origin", "MB-403-ORIGIN", "Origin denied."),
    );
    expect((await post()).status).toBe(403);
    expect(mocks.renew).not.toHaveBeenCalled();
  });
  it.each([
    { expected_generation: -1 },
    { expected_generation: 1.5 },
    { idempotency_key: "not-uuid" },
    { action: "start" },
  ])("rejects malformed renewal %j", async (value) => {
    expect((await post(value)).status).toBe(400);
    expect(mocks.renew).not.toHaveBeenCalled();
  });
  it("replays the same child while still requiring fresh cost approval", async () => {
    mocks.renew.mockResolvedValue({
      run_id: childId,
      logical_request_root_id: runId,
      generation: 3,
      replayed: true,
    });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      run_id: childId,
      replayed: true,
      requires_cost_approval: true,
    });
  });
  it("surfaces root-generation conflicts without silently renewing", async () => {
    mocks.renew.mockRejectedValue(
      new mocks.DataFault("MB-409-RESEARCH-RENEWAL", "A newer renewal exists."),
    );
    const response = await post();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "MB-409-RESEARCH-RENEWAL",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not leak an unexpected database failure", async () => {
    mocks.history.mockRejectedValue(new Error("connection secret"));
    const response = await read();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      "connection secret",
    );
  });
});
