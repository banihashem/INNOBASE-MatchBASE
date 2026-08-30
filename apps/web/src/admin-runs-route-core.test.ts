import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AdminRunsApplication,
  ApplicationFault,
  type RequestContext,
} from "@matchbase/application";
import { handleAdminRunsRoute } from "./admin-runs-route-core";

const context: RequestContext = {
  accountId: randomUUID(),
  userId: randomUUID(),
  tier: "demo",
  adminSubRoles: [],
  correlationId: randomUUID(),
  deploymentId: "admin-runs-route-test",
};

describe("shared Admin runs route", () => {
  it("passes only server context and the closed query to the application", async () => {
    const body = {
      items: [],
      page: { next_cursor: null, has_more: false, limit: 7 },
    };
    const read = vi.fn(async () => body);
    const accepted = await handleAdminRunsRoute({
      method: "GET",
      pathname: "/api/v1/admin/runs",
      searchParams: new URLSearchParams({
        limit: "7",
        governance_state: "Escalated to Human",
        run_state: "escalated",
        failure_class: "timeout",
      }),
      context,
      application: { read } as unknown as AdminRunsApplication,
    });
    expect(accepted).toEqual({ status: 200, body });
    expect(read).toHaveBeenCalledWith(context, {
      limit: 7,
      governance_state: "Escalated to Human",
      run_state: "escalated",
      failure_class: "timeout",
    });
  });

  it("rejects forged authority, duplicate, unknown and free-form filters", async () => {
    const read = vi.fn();
    for (const searchParams of [
      new URLSearchParams({ oidc_role: "super_admin" }),
      new URLSearchParams([
        ["limit", "20"],
        ["limit", "20"],
      ]),
      new URLSearchParams({ governance_state: "review_required" }),
      new URLSearchParams({ run_state: "executing" }),
      new URLSearchParams({ failure_class: "raw provider error" }),
      new URLSearchParams({ limit: "101" }),
    ]) {
      await expect(
        handleAdminRunsRoute({
          method: "GET",
          pathname: "/api/v1/admin/runs",
          searchParams,
          context,
          application: { read } as unknown as AdminRunsApplication,
        }),
      ).rejects.toMatchObject({
        status: 400,
        code: "MB-400-QUERY",
      } satisfies Partial<ApplicationFault>);
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("does not claim unsafe methods or related paths", async () => {
    const application = { read: vi.fn() } as unknown as AdminRunsApplication;
    expect(
      await handleAdminRunsRoute({
        method: "POST",
        pathname: "/api/v1/admin/runs",
        searchParams: new URLSearchParams(),
        context,
        application,
      }),
    ).toBeNull();
    expect(
      await handleAdminRunsRoute({
        method: "GET",
        pathname: `/api/v1/admin/runs/${randomUUID()}`,
        searchParams: new URLSearchParams(),
        context,
        application,
      }),
    ).toBeNull();
  });
});
