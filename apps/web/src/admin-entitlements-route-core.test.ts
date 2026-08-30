import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AdminEntitlementsApplication,
  ApplicationFault,
  type RequestContext,
} from "@matchbase/application";
import { handleAdminEntitlementsRoute } from "./admin-entitlements-route-core";

const context: RequestContext = {
  accountId: randomUUID(),
  userId: randomUUID(),
  tier: "admin",
  adminSubRoles: ["support"],
  correlationId: randomUUID(),
  deploymentId: "admin-route-core-test",
};

function input() {
  return {
    action: "grant",
    subject_user_id: randomUUID(),
    entitlement_kind: "tier",
    entitlement_value: "standard",
    justification: "Approved entitlement route test",
  };
}

describe("shared Admin entitlement route", () => {
  it("passes only the resolved server context and emits replay metadata", async () => {
    const body = {
      ...input(),
      changed: true,
      before: { tier: "demo", admin_sub_roles: [] },
      after: { tier: "standard", admin_sub_roles: [] },
      audit_id: randomUUID(),
    };
    const mutate = vi.fn(
      async (
        ..._arguments: Parameters<AdminEntitlementsApplication["mutate"]>
      ) => ({ body, replayed: true }),
    );
    const accepted = await handleAdminEntitlementsRoute({
      method: "POST",
      pathname: "/api/v1/admin/entitlements",
      searchParams: new URLSearchParams(),
      body: async () => input(),
      context,
      idempotencyKey: `admin-route-${randomUUID()}`,
      application: { mutate } as unknown as AdminEntitlementsApplication,
    });
    expect(accepted).toEqual({
      status: 200,
      body,
      headers: { "MB-Idempotent-Replay": "true" },
    });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toBe(context);
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      tier: "admin",
      adminSubRoles: ["support"],
    });
  });

  it("rejects forged authority fields before the application mutation", async () => {
    const mutate = vi.fn();
    await expect(
      handleAdminEntitlementsRoute({
        method: "POST",
        pathname: "/api/v1/admin/entitlements",
        searchParams: new URLSearchParams(),
        body: async () => ({
          ...input(),
          oidc_tier: "admin",
          oidc_role: "super_admin",
        }),
        context,
        idempotencyKey: `admin-route-${randomUUID()}`,
        application: { mutate } as unknown as AdminEntitlementsApplication,
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "MB-422-SCHEMA",
    } satisfies Partial<ApplicationFault>);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("forwards the exact RFC3339 expiry only for a Consultant grant", async () => {
    const expiresAt = "2099-12-31T23:59:59Z";
    const consultant = {
      ...input(),
      entitlement_value: "consultant",
      expires_at: expiresAt,
    };
    const body = {
      ...consultant,
      changed: true,
      before: { tier: "standard", admin_sub_roles: [] },
      after: { tier: "consultant", admin_sub_roles: [] },
      audit_id: randomUUID(),
    };
    const mutate = vi.fn(
      async (
        ..._arguments: Parameters<AdminEntitlementsApplication["mutate"]>
      ) => ({ body, replayed: false }),
    );
    await handleAdminEntitlementsRoute({
      method: "POST",
      pathname: "/api/v1/admin/entitlements",
      searchParams: new URLSearchParams(),
      body: async () => consultant,
      context,
      idempotencyKey: `admin-route-${randomUUID()}`,
      application: { mutate } as unknown as AdminEntitlementsApplication,
    });
    expect(mutate.mock.calls[0]?.[2]).toEqual(consultant);

    for (const invalid of [
      (({ expires_at: _expiry, ...missing }) => missing)(consultant),
      { ...consultant, expires_at: "2099-12-31 23:59:59" },
      { ...input(), expires_at: expiresAt },
    ]) {
      await expect(
        handleAdminEntitlementsRoute({
          method: "POST",
          pathname: "/api/v1/admin/entitlements",
          searchParams: new URLSearchParams(),
          body: async () => invalid,
          context,
          idempotencyKey: `admin-route-${randomUUID()}`,
          application: { mutate } as unknown as AdminEntitlementsApplication,
        }),
      ).rejects.toMatchObject({ status: 422, code: "MB-422-SCHEMA" });
    }
  });

  it("passes only the closed subject query to the read application", async () => {
    const subjectUserId = randomUUID();
    const responseBody = {
      subject_user_id: subjectUserId,
      current: {
        tier: "admin" as const,
        admin_sub_roles: ["analyst" as const],
      },
      history: [],
    };
    const read = vi.fn(async () => responseBody);
    const accepted = await handleAdminEntitlementsRoute({
      method: "GET",
      pathname: "/api/v1/admin/entitlements",
      searchParams: new URLSearchParams({ subject_user_id: subjectUserId }),
      body: async () => {
        throw new Error("GET must not read a request body.");
      },
      context,
      idempotencyKey: null,
      application: { read } as unknown as AdminEntitlementsApplication,
    });
    expect(accepted).toEqual({ status: 200, body: responseBody });
    expect(read).toHaveBeenCalledWith(context, {
      subject_user_id: subjectUserId,
    });
  });

  it("rejects missing, duplicate and unknown read query fields", async () => {
    const subjectUserId = randomUUID();
    const read = vi.fn();
    for (const searchParams of [
      new URLSearchParams(),
      new URLSearchParams([
        ["subject_user_id", subjectUserId],
        ["subject_user_id", subjectUserId],
      ]),
      new URLSearchParams({
        subject_user_id: subjectUserId,
        oidc_role: "super_admin",
      }),
    ]) {
      await expect(
        handleAdminEntitlementsRoute({
          method: "GET",
          pathname: "/api/v1/admin/entitlements",
          searchParams,
          body: async () => ({}),
          context,
          idempotencyKey: null,
          application: { read } as unknown as AdminEntitlementsApplication,
        }),
      ).rejects.toMatchObject({
        status: 422,
        code: "MB-422-SCHEMA",
      } satisfies Partial<ApplicationFault>);
    }
    expect(read).not.toHaveBeenCalled();
  });
});
