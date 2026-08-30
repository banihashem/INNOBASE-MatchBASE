import {
  requireAdminSubRole,
  requirePersistedTier,
  type AdminSubRole,
  type PersistedTier,
} from "@matchbase/contracts";
import type { Queryable } from "./database.js";

export interface StoredAdminAuthority {
  readonly tier: PersistedTier;
  readonly adminSubRoles: readonly AdminSubRole[];
}

/** Re-resolves authority from MatchBASE-owned grants at the data boundary. */
export async function resolveStoredAdminAuthority(
  client: Queryable,
  accountId: string,
  actorUserId: string,
): Promise<StoredAdminAuthority | null> {
  const tierResult = await client.query<{ tier: unknown }>(
    `SELECT eg.tier
       FROM app_user u
       JOIN entitlement_grant eg
         ON eg.account_id=u.account_id AND eg.user_id=u.user_id
      WHERE u.account_id=$1 AND u.user_id=$2 AND u.status='active'
        AND eg.effective_from<=clock_timestamp()
        AND (eg.effective_to IS NULL OR eg.effective_to>clock_timestamp())
        AND eg.revoked_at IS NULL
      ORDER BY eg.effective_from DESC,eg.created_at DESC
      LIMIT 1
      FOR SHARE OF u,eg`,
    [accountId, actorUserId],
  );
  const row = tierResult.rows[0];
  if (!row) return null;
  const tier = requirePersistedTier(row.tier);
  const roleResult = await client.query<{ sub_role: unknown }>(
    `SELECT sub_role
       FROM admin_role_grant
      WHERE account_id=$1 AND user_id=$2
        AND effective_from<=clock_timestamp()
        AND (effective_to IS NULL OR effective_to>clock_timestamp())
        AND revoked_at IS NULL
      ORDER BY sub_role
      FOR SHARE`,
    [accountId, actorUserId],
  );
  const adminSubRoles = roleResult.rows.map((entry) =>
    requireAdminSubRole(entry.sub_role),
  );
  if (tier !== "admin" && adminSubRoles.length > 0) {
    throw new Error("Stored Admin sub-role is attached to a non-Admin tier.");
  }
  return { tier, adminSubRoles };
}
