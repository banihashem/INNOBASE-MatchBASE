import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Base64Url } from "@matchbase/auth";
import { closeFetchRuntime, resolveRequestSession } from "./fetch-runtime";

const mocks = vi.hoisted(() => ({
  config: {
    environment: "test",
    origin: "https://matchbase.example",
    deploymentId: "pilot-admission",
    databaseUrl: "postgres://unused.invalid/test",
    digestKey: Buffer.alloc(32, 1),
    originAdmissionKey: Buffer.from("test-origin-admission-proof"),
    oidcSimulatorEnabled: false,
    syntheticFixtureEnabled: false,
  },
  query: vi.fn(),
  authorization: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("./config", () => ({ loadWebConfig: () => mocks.config }));
vi.mock("./canonicalization-runtime", () => ({
  createRuntimeCanonicalizer: () => ({}),
}));
vi.mock("./server-owned-research-admission", () => ({
  loadServerOwnedResearchAdmission: () => ({}),
}));
vi.mock("@matchbase/data", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createPool: () => ({ end: async () => {} }),
  inTransaction: (_pool: unknown, operation: (client: unknown) => unknown) => {
    mocks.transaction();
    return operation({ query: mocks.query });
  },
  resolveStoredAuthorization: mocks.authorization,
}));

function request(headers: Record<string, string> = {}, method = "POST") {
  return new Request("https://matchbase.example/api/v1/consultant/workflow", {
    method,
    headers: {
      Cookie: `${mocks.config.environment === "production" ? "__Host-" : ""}matchbase_session=session-handle`,
      ...headers,
    },
  });
}
const valid = {
  Origin: "https://matchbase.example",
  "X-CSRF-Token": "session-csrf",
  "Idempotency-Key": "pilot-admission-00000001",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.environment = "test";
  mocks.authorization.mockResolvedValue({
    tier: "consultant",
    adminSubRoles: [],
  });
  mocks.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes("FROM user_session")
      ? [
          {
            session_id: "session",
            account_id: "account",
            user_id: "profile",
            csrf_token_hash: Buffer.from(
              sha256Base64Url("session-csrf"),
              "base64url",
            ),
            session_active: true,
          },
        ]
      : [],
  }));
});
afterEach(async () => {
  await closeFetchRuntime();
});

describe("MB-UX-PILOT-001 L01 direct Consultant runtime admission", () => {
  it.each(["GET", "POST", "HEAD"])(
    "rejects production %s before session access when origin admission is missing",
    async (method) => {
      mocks.config.environment = "production";
      await expect(
        resolveRequestSession(request({}, method)),
      ).rejects.toMatchObject({ status: 403, code: "MB-403-ORIGIN" });
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );
  it("rejects an incorrect production origin proof", async () => {
    mocks.config.environment = "production";
    await expect(
      resolveRequestSession(request({ "MB-Origin-Admission": "wrong" }, "GET")),
    ).rejects.toMatchObject({ status: 403, code: "MB-403-ORIGIN" });
  });
  it("admits an authenticated production read through the admitted origin", async () => {
    mocks.config.environment = "production";
    await expect(
      resolveRequestSession(
        request(
          { "MB-Origin-Admission": "test-origin-admission-proof" },
          "GET",
        ),
      ),
    ).resolves.toMatchObject({
      accountId: "account",
      userId: "profile",
      tier: "consultant",
    });
  });
  it.each([
    {},
    { ...valid, Origin: "https://unrelated.example" },
    { ...valid, "X-CSRF-Token": "wrong-token" },
  ])(
    "rejects an unsafe request lacking same-origin session proof",
    async (headers) => {
      await expect(
        resolveRequestSession(request(headers), undefined, true),
      ).rejects.toMatchObject({ status: 403, code: "MB-403-REQUEST" });
    },
  );
  it("requires an idempotency admission key", async () => {
    await expect(
      resolveRequestSession(
        request({
          Origin: valid.Origin,
          "X-CSRF-Token": valid["X-CSRF-Token"],
        }),
        undefined,
        true,
      ),
    ).rejects.toMatchObject({ status: 400, code: "MB-400-IDEMPOTENCY" });
  });
  it("accepts valid local mutation proof without changing authenticated identity", async () => {
    await expect(
      resolveRequestSession(request(valid), undefined, true),
    ).resolves.toMatchObject({
      accountId: "account",
      userId: "profile",
      tier: "consultant",
    });
  });
});
