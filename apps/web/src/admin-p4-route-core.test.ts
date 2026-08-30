import { describe, expect, it, vi } from "vitest";
import {
  ApplicationFault,
  parseAdminAuditQuery,
  parseAdminGuardrailMetricQuery,
  parseAdminUnprojectedReadDto,
  type AdminAuditApplication,
  type AdminUnprojectedApplication,
  type RequestContext,
} from "@matchbase/application";
import { handleAdminAuditRoute } from "./admin-audit-route-core";
import { handleAdminUnprojectedRoute } from "./admin-unprojected-route-core";

const context: RequestContext = {
  accountId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  tier: "admin",
  adminSubRoles: ["security_audit"],
  correlationId: "p4-route-correlation",
  deploymentId: "p4-route-deployment",
};

describe("P4 Admin audit and unprojected route contracts", () => {
  it("parses closed subject/resource/time/cursor queries and rejects malformed ranges", () => {
    expect(
      parseAdminAuditQuery([
        ["limit", "25"],
        ["subject_user_id", context.userId],
        ["resource_id", "00000000-0000-4000-8000-000000000003"],
        ["from", "2026-08-29T00:00:00.000Z"],
        ["to", "2026-08-30T00:00:00.000Z"],
      ]),
    ).toMatchObject({ limit: 25, subject_user_id: context.userId });
    expect(() =>
      parseAdminAuditQuery([
        ["from", "2026-08-30T00:00:00.000Z"],
        ["to", "2026-08-29T00:00:00.000Z"],
      ]),
    ).toThrow(ApplicationFault);
    expect(() =>
      parseAdminGuardrailMetricQuery([
        ["from", "2026-08-29T00:00:00.000Z"],
        ["extra", "forbidden"],
      ]),
    ).toThrow(ApplicationFault);
  });

  it("dispatches read, export and guardrail metrics to distinct raw API contracts", async () => {
    const read = vi.fn(async () => ({ items: [] }));
    const exportAudit = vi.fn(async () => ({ items: [] }));
    const guardrailMetrics = vi.fn(async () => ({ activation_rate: 0 }));
    const application = {
      read,
      export: exportAudit,
      guardrailMetrics,
    } as unknown as AdminAuditApplication;
    for (const pathname of [
      "/api/v1/admin/audit",
      "/api/v1/admin/audit/export",
      "/api/v1/admin/audit/guardrails",
    ]) {
      const response = await handleAdminAuditRoute({
        method: "GET",
        pathname,
        searchParams: pathname.endsWith("guardrails")
          ? new URLSearchParams({
              from: "2026-08-29T00:00:00.000Z",
              to: "2026-08-30T00:00:00.000Z",
            })
          : new URLSearchParams(),
        context,
        application,
      });
      expect(response?.status).toBe(200);
    }
    expect(read).toHaveBeenCalledOnce();
    expect(exportAudit).toHaveBeenCalledOnce();
    expect(guardrailMetrics).toHaveBeenCalledOnce();
  });

  it("requires exact non-empty justification before unprojected application access", async () => {
    const value = {
      run_id: "00000000-0000-4000-8000-000000000003",
      justification: "Approved quality analysis",
    };
    expect(parseAdminUnprojectedReadDto(value)).toEqual(value);
    for (const invalid of [
      { ...value, justification: "" },
      { ...value, justification: " padded " },
      { ...value, tier: "admin" },
    ]) {
      expect(() => parseAdminUnprojectedReadDto(invalid)).toThrow(
        ApplicationFault,
      );
    }
    const read = vi.fn(async () => ({ run_id: value.run_id }));
    const response = await handleAdminUnprojectedRoute({
      method: "POST",
      pathname: "/api/v1/admin/unprojected-result",
      body: async () => value,
      context,
      application: { read } as unknown as AdminUnprojectedApplication,
    });
    expect(response).toEqual({ status: 200, body: { run_id: value.run_id } });
    expect(read).toHaveBeenCalledWith(context, value);
  });
});
