import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  AdminEntitlementsApplication,
  ApplicationFault,
  parseAdminEntitlementMutationDto,
} from "../../packages/application/dist/index.js";

function validDto() {
  return {
    action: "grant",
    subject_user_id: randomUUID(),
    entitlement_kind: "admin_sub_role",
    entitlement_value: "support",
    justification: "Approved role assignment",
  };
}

test("admin entitlement DTO accepts only exact tier/sub-role namespaces", () => {
  const value = validDto();
  assert.deepEqual(parseAdminEntitlementMutationDto(value), value);
  for (const invalid of [
    { ...value, entitlement_value: "SUPER_ADMIN" },
    { ...value, entitlement_value: "auditor" },
    { ...value, entitlement_kind: "tier", entitlement_value: "premium" },
    { ...value, oidc_role: "super_admin" },
    { ...value, justification: "  padded  " },
  ]) {
    assert.throws(
      () => parseAdminEntitlementMutationDto(invalid),
      (error) =>
        error instanceof ApplicationFault &&
        error.status === 422 &&
        error.code === "MB-422-SCHEMA",
    );
  }
});

test("Consultant grants require one valid RFC3339 expiry and other mutations forbid it", () => {
  const expiresAt = "2099-12-31T23:59:59Z";
  const consultant = {
    ...validDto(),
    entitlement_kind: "tier",
    entitlement_value: "consultant",
    expires_at: expiresAt,
  };
  assert.deepEqual(parseAdminEntitlementMutationDto(consultant), consultant);
  for (const invalid of [
    (({ expires_at: _expiry, ...withoutExpiry }) => withoutExpiry)(consultant),
    { ...consultant, expires_at: "2099-12-31 23:59:59" },
    { ...consultant, expires_at: "2099-02-30T23:59:59Z" },
    { ...consultant, action: "revoke" },
    { ...validDto(), expires_at: expiresAt },
    {
      ...validDto(),
      entitlement_kind: "tier",
      entitlement_value: "standard",
      expires_at: expiresAt,
    },
  ]) {
    assert.throws(
      () => parseAdminEntitlementMutationDto(invalid),
      (error) =>
        error instanceof ApplicationFault &&
        error.status === 422 &&
        error.code === "MB-422-SCHEMA",
    );
  }
});

test("forged OIDC tier and role claims are not accepted as entitlement input", () => {
  const value = validDto();
  assert.throws(
    () =>
      parseAdminEntitlementMutationDto({
        ...value,
        tier: "admin",
        admin_sub_role: "super_admin",
        oidc_claims: { tier: "admin", role: "super_admin" },
      }),
    (error) =>
      error instanceof ApplicationFault &&
      error.status === 422 &&
      error.code === "MB-422-SCHEMA",
  );
});

test("entitlement persistence or audit failure maps to fail-closed 503", async () => {
  const application = new AdminEntitlementsApplication({
    async connect() {
      throw new Error("Injected entitlement audit-store failure");
    },
  });
  await assert.rejects(
    application.mutate(
      {
        accountId: randomUUID(),
        userId: randomUUID(),
        tier: "admin",
        adminSubRoles: ["super_admin"],
        correlationId: randomUUID(),
        deploymentId: "admin-audit-failure-test",
      },
      `admin-audit-${randomUUID()}`,
      validDto(),
    ),
    (error) =>
      error instanceof ApplicationFault &&
      error.status === 503 &&
      error.code === "MB-503-AUDIT" &&
      error.auditRecorded,
  );
});
