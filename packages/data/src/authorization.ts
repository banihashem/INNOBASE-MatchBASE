import {
  ADMIN_SUB_ROLES,
  requireAdminSubRole,
  requirePersistedTier,
  type AdminSubRole,
  type PersistedTier,
} from "@matchbase/contracts";
import type { Queryable } from "./database.js";

export interface StoredAuthorization {
  tier: PersistedTier;
  adminSubRoles: readonly AdminSubRole[];
}

export async function resolveStoredAuthorization(
  database: Queryable,
  accountId: string,
  userId: string,
): Promise<StoredAuthorization | null> {
  const grant = await database.query<{ tier: unknown }>(
    `SELECT tier FROM entitlement_grant
      WHERE account_id = $1 AND user_id = $2 AND effective_from <= clock_timestamp()
        AND (effective_to IS NULL OR effective_to > clock_timestamp()) AND revoked_at IS NULL
      ORDER BY effective_from DESC, created_at DESC LIMIT 1`,
    [accountId, userId],
  );
  if (!grant.rows[0]) return null;
  const tier = requirePersistedTier(grant.rows[0].tier);
  const roleRows = await database.query<{ sub_role: unknown }>(
    `SELECT sub_role FROM admin_role_grant
      WHERE account_id = $1 AND user_id = $2 AND effective_from <= clock_timestamp()
        AND (effective_to IS NULL OR effective_to > clock_timestamp()) AND revoked_at IS NULL`,
    [accountId, userId],
  );
  const adminSubRoles = roleRows.rows.map((row) =>
    requireAdminSubRole(row.sub_role),
  );
  if (tier !== "admin" && adminSubRoles.length > 0) {
    throw new Error(
      "Stored Admin sub-role is attached to a non-Admin entitlement.",
    );
  }
  adminSubRoles.sort(
    (left, right) =>
      ADMIN_SUB_ROLES.indexOf(left) - ADMIN_SUB_ROLES.indexOf(right),
  );
  return { tier, adminSubRoles };
}
