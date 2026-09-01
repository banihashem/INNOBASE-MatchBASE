import { describe, expect, test, vi } from "vitest";
import type { RequestContext } from "@matchbase/application";
import { handleUserProfileRoute } from "./user-profile-route-core";

const context: RequestContext = {
  accountId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  tier: "demo",
  adminSubRoles: [],
  correlationId: "profile-route-test",
  deploymentId: "test",
};

describe("user profile route", () => {
  test("returns an owner-scoped no-store history projection", async () => {
    const body = {
      schema_version: "user-profile-history.v2" as const,
      current_tier: "demo" as const,
      requests: [],
      runs: [],
      page: { limit: 50, has_more: false, next_cursor: null },
    };
    const getHistory = vi.fn(async () => body);
    const result = await handleUserProfileRoute({
      method: "GET",
      pathname: "/api/v1/profile/history",
      searchParams: new URLSearchParams(),
      context,
      application: { getHistory },
    });
    expect(result).toEqual({
      status: 200,
      body,
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
    expect(getHistory).toHaveBeenCalledWith(context, undefined);
  });

  test("does not claim unrelated routes", async () => {
    const getHistory = vi.fn();
    await expect(
      handleUserProfileRoute({
        method: "POST",
        pathname: "/api/v1/profile/history",
        searchParams: new URLSearchParams(),
        context,
        application: { getHistory },
      }),
    ).resolves.toBeNull();
    expect(getHistory).not.toHaveBeenCalled();
  });
});
