import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class Fault extends Error {
    constructor(
      readonly status: number,
      _kind: string,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    Fault,
    resolve: vi.fn(),
    search: vi.fn(),
    pool: Object.freeze({ profileEvidenceFixture: true }),
  };
});
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
}));
vi.mock("@matchbase/application", () => ({ ApplicationFault: mocks.Fault }));
vi.mock("@matchbase/data", () => ({
  ExecutionIntegrityFault: mocks.Fault,
  searchPrivateEvidenceProfile: mocks.search,
}));
vi.mock("./db-client", () => ({ getAppDatabasePool: () => mocks.pool }));
vi.mock("./fetch-runtime", () => ({ resolveRequestSession: mocks.resolve }));

import { GET } from "../app/api/v1/consultant/profile-evidence/route";

describe("profile evidence route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolve.mockResolvedValue({
      tier: "consultant",
      accountId: "account-one",
      userId: "profile-one",
    });
    mocks.search.mockResolvedValue({
      observations: [],
      current_count: 0,
      expired_count: 0,
      fresh_discovery_required: true,
    });
  });

  it("searches only the authenticated profile without dispatching research", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/v1/consultant/profile-evidence?status=all&query=Aqaba%20freight",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.search).toHaveBeenCalledWith(
      mocks.pool,
      { account_id: "account-one", user_profile_id: "profile-one" },
      { query: "Aqaba freight", status: "all", limit: 50 },
    );
  });

  it("rejects a malformed filter before database access", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/v1/consultant/profile-evidence?status=deleted",
      ),
    );
    expect(response.status).toBe(400);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("rejects a non-consultant identity", async () => {
    mocks.resolve.mockResolvedValue({
      tier: "standard",
      accountId: "account-one",
      userId: "profile-one",
    });
    const response = await GET(
      new Request("http://localhost/api/v1/consultant/profile-evidence"),
    );
    expect(response.status).toBe(403);
    expect(mocks.search).not.toHaveBeenCalled();
  });
});
