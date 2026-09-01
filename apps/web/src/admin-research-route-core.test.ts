import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ApplicationFault,
  type AdminResearchApplication,
  type RequestContext,
} from "@matchbase/application";
import { handleAdminResearchRoute } from "./admin-research-route-core";

const context: RequestContext = {
  accountId: randomUUID(),
  userId: randomUUID(),
  tier: "admin",
  adminSubRoles: ["super_admin"],
  correlationId: randomUUID(),
  deploymentId: "admin-research-route-test",
};

describe("Admin research inventory route", () => {
  it("passes a closed query and server context to the application", async () => {
    const body = {
      schema_version: "admin-research-inventory.v2",
      items: [],
      page: { limit: 20, has_more: false, next_cursor: null },
    };
    const read = vi.fn(async () => body);
    const subject = randomUUID();
    const result = await handleAdminResearchRoute({
      method: "GET",
      pathname: "/api/v1/admin/research",
      searchParams: new URLSearchParams({
        limit: "20",
        scope: "all",
        subject_user_id: subject,
        identity: "Verified Operator",
        state: "failed",
        purpose: "Investigate system-wide research operations",
      }),
      context,
      application: { read } as unknown as AdminResearchApplication,
    });
    expect(result).toEqual({
      status: 200,
      body,
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
    expect(read).toHaveBeenCalledWith(context, {
      limit: 20,
      scope: "all",
      subject_user_id: subject,
      identity: "Verified Operator",
      state: "failed",
      purpose: "Investigate system-wide research operations",
    });
  });

  it("rejects duplicate, unknown, forged and malformed filters", async () => {
    const read = vi.fn();
    for (const searchParams of [
      new URLSearchParams({ oidc_role: "super_admin" }),
      new URLSearchParams([
        ["scope", "all"],
        ["scope", "own"],
      ]),
      new URLSearchParams({ scope: "tenant-admin" }),
      new URLSearchParams({ subject_user_id: "all-users" }),
      new URLSearchParams({ state: "provider_error" }),
      new URLSearchParams({ limit: "101" }),
      new URLSearchParams({ scope: "all" }),
      new URLSearchParams({ purpose: " padded " }),
      new URLSearchParams({ purpose: "audit", identity: " padded " }),
    ]) {
      await expect(
        handleAdminResearchRoute({
          method: "GET",
          pathname: "/api/v1/admin/research",
          searchParams,
          context,
          application: { read } as unknown as AdminResearchApplication,
        }),
      ).rejects.toMatchObject({
        status: 400,
        code: "MB-400-ADMIN-RESEARCH",
      } satisfies Partial<ApplicationFault>);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("does not claim mutations or sibling paths", async () => {
    const application = {
      read: vi.fn(),
    } as unknown as AdminResearchApplication;
    expect(
      await handleAdminResearchRoute({
        method: "POST",
        pathname: "/api/v1/admin/research",
        searchParams: new URLSearchParams(),
        context,
        application,
      }),
    ).toBeNull();
    expect(
      await handleAdminResearchRoute({
        method: "GET",
        pathname: "/api/v1/admin/research/raw",
        searchParams: new URLSearchParams(),
        context,
        application,
      }),
    ).toBeNull();
  });
});
