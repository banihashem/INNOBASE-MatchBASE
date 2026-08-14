export const PERSISTED_TIERS = [
  "demo",
  "standard",
  "consultant",
  "admin",
] as const;

export type PersistedTier = (typeof PERSISTED_TIERS)[number];

export const ADMIN_SUB_ROLES = [
  "support",
  "analyst",
  "consultant_manager",
  "product",
  "security_audit",
  "super_admin",
] as const;

export type AdminSubRole = (typeof ADMIN_SUB_ROLES)[number];

function memberOf<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return typeof value === "string" && values.includes(value);
}

export function isPersistedTier(value: unknown): value is PersistedTier {
  return memberOf(PERSISTED_TIERS, value);
}

export function isAdminSubRole(value: unknown): value is AdminSubRole {
  return memberOf(ADMIN_SUB_ROLES, value);
}

export function requirePersistedTier(value: unknown): PersistedTier {
  if (!isPersistedTier(value)) {
    throw new Error(
      "Stored tier violates the canonical authorization contract.",
    );
  }
  return value;
}

export function requireAdminSubRole(value: unknown): AdminSubRole {
  if (!isAdminSubRole(value)) {
    throw new Error(
      "Stored Admin sub-role violates the canonical authorization contract.",
    );
  }
  return value;
}
