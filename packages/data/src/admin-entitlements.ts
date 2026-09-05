import { createHash, randomUUID } from "node:crypto";
import {
  ADMIN_SUB_ROLES,
  requireAdminSubRole,
  requirePersistedTier,
  type AdminSubRole,
  type PersistedTier,
} from "@matchbase/contracts";
import { appendAuditEvent } from "./audit.js";
import {
  inTransaction,
  type ConnectionPool,
  type Queryable,
  type TransactionClient,
} from "./database.js";

export type AdminEntitlementKind = "tier" | "admin_sub_role";
export type AdminEntitlementAction = "grant" | "revoke";

export interface EntitlementSnapshot {
  readonly tier: PersistedTier | null;
  readonly adminSubRoles: readonly AdminSubRole[];
  readonly tierExpiresAt?: Date | null;
}

export interface AdminEntitlementMutation {
  readonly accountId: string;
  readonly actorUserId: string;
  readonly subjectUserId: string;
  readonly action: AdminEntitlementAction;
  readonly entitlementKind: AdminEntitlementKind;
  readonly entitlementValue: PersistedTier | AdminSubRole;
  readonly justification: string;
  readonly correlationId: string;
  readonly deploymentId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: Buffer;
  readonly expiresAt?: string | null;
}

export interface AdminEntitlementMutationBody {
  readonly action: AdminEntitlementAction;
  readonly subject_user_id: string;
  readonly entitlement_kind: AdminEntitlementKind;
  readonly entitlement_value: PersistedTier | AdminSubRole;
  readonly expires_at: string | null;
  readonly changed: boolean;
  readonly before: {
    readonly tier: PersistedTier | null;
    readonly admin_sub_roles: readonly AdminSubRole[];
    readonly tier_expires_at: Date | null;
  };
  readonly after: {
    readonly tier: PersistedTier | null;
    readonly admin_sub_roles: readonly AdminSubRole[];
    readonly tier_expires_at: Date | null;
  };
  readonly audit_id: string;
}

export interface AdminEntitlementMutationResult {
  readonly status: 200 | 403 | 409 | 422;
  readonly code:
    | "MB-200-ENTITLEMENT"
    | "MB-403-ENTITLEMENT"
    | "MB-409-IDEMPOTENCY"
    | "MB-422-ENTITLEMENT";
  readonly reason:
    | "allowed"
    | "super-admin-required"
    | "self-mutation-refused"
    | "subject-not-visible"
    | "admin-tier-required"
    | "prohibited-role-combination"
    | "last-security-audit-required"
    | "expiry-required"
    | "expiry-not-allowed"
    | "expiry-invalid"
    | "expiry-not-future"
    | "idempotency-key-reuse";
  readonly body?: AdminEntitlementMutationBody;
  readonly replayed: boolean;
}

export interface AdminEntitlementHistoryEntry {
  readonly kind: AdminEntitlementKind;
  readonly value: PersistedTier | AdminSubRole;
  readonly effective_from: Date;
  readonly effective_to: Date | null;
  readonly revoked_at: Date | null;
  readonly grant_actor_kind: "system" | "user";
  readonly granted_by: string | null;
  readonly revoked_by: string | null;
  readonly justification: string;
}

export interface AdminEntitlementReadBody {
  readonly subject_user_id: string;
  readonly current: {
    readonly tier: PersistedTier | null;
    readonly admin_sub_roles: readonly AdminSubRole[];
    readonly tier_expires_at: Date | null;
  };
  readonly history: readonly AdminEntitlementHistoryEntry[];
}

export type AdminEntitlementReadResult =
  | { readonly status: 200; readonly body: AdminEntitlementReadBody }
  | {
      readonly status: 403;
      readonly reason: "super-admin-required" | "subject-not-visible";
    };

const PROHIBITED_ROLE_PAIRS: readonly (readonly [
  AdminSubRole,
  AdminSubRole,
])[] = [
  ["security_audit", "super_admin"],
  ["product", "consultant_manager"],
];

const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u;

function isStrictRfc3339(value: string): boolean {
  const match = RFC3339_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[7] ?? 0);
  const offsetMinute = Number(match[8] ?? 0);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

function sortRoles(roles: Iterable<AdminSubRole>): AdminSubRole[] {
  return [...new Set(roles)].sort(
    (left, right) =>
      ADMIN_SUB_ROLES.indexOf(left) - ADMIN_SUB_ROLES.indexOf(right),
  );
}

function publicSnapshot(snapshot: EntitlementSnapshot): {
  tier: PersistedTier | null;
  admin_sub_roles: readonly AdminSubRole[];
  tier_expires_at: Date | null;
} {
  return {
    tier: snapshot.tier,
    admin_sub_roles: snapshot.adminSubRoles,
    tier_expires_at: snapshot.tierExpiresAt ?? null,
  };
}

function keyDigest(key: string): Buffer {
  return createHash("sha256").update(key, "utf8").digest();
}

async function lockUsers(
  client: TransactionClient,
  accountId: string,
  actorUserId: string,
  subjectUserId: string,
): Promise<{ actorExists: boolean; subjectExists: boolean }> {
  const users = await client.query<{ user_id: string }>(
    `SELECT user_id
       FROM app_user
      WHERE account_id=$1 AND user_id = ANY($2::uuid[]) AND status='active'
      ORDER BY user_id
      FOR UPDATE`,
    [accountId, [actorUserId, subjectUserId]],
  );
  const found = new Set(users.rows.map((row) => row.user_id));
  return {
    actorExists: found.has(actorUserId),
    subjectExists: found.has(subjectUserId),
  };
}

async function lockedSnapshot(
  client: TransactionClient,
  accountId: string,
  userId: string,
): Promise<EntitlementSnapshot> {
  const grants = await client.query<{
    tier: unknown;
    effective_to: Date | null;
  }>(
    `SELECT tier,effective_to
       FROM entitlement_grant
      WHERE account_id=$1 AND user_id=$2
        AND effective_from<=clock_timestamp()
        AND (effective_to IS NULL OR effective_to>clock_timestamp())
        AND revoked_at IS NULL
      ORDER BY effective_from DESC,created_at DESC
      FOR UPDATE`,
    [accountId, userId],
  );
  const roles = await client.query<{ sub_role: unknown }>(
    `SELECT sub_role
       FROM admin_role_grant
      WHERE account_id=$1 AND user_id=$2
        AND effective_from<=clock_timestamp()
        AND (effective_to IS NULL OR effective_to>clock_timestamp())
        AND revoked_at IS NULL
      FOR UPDATE`,
    [accountId, userId],
  );
  const tier = grants.rows[0]
    ? requirePersistedTier(grants.rows[0].tier)
    : null;
  const adminSubRoles = sortRoles(
    roles.rows.map((row) => requireAdminSubRole(row.sub_role)),
  );
  if (tier !== "admin" && adminSubRoles.length > 0) {
    throw new Error(
      "Stored Admin sub-role is attached to a non-Admin entitlement.",
    );
  }
  return {
    tier,
    adminSubRoles,
    tierExpiresAt: grants.rows[0]?.effective_to ?? null,
  };
}

function prohibitedRoleCombination(roles: readonly AdminSubRole[]): boolean {
  const held = new Set(roles);
  return PROHIBITED_ROLE_PAIRS.some(
    ([left, right]) => held.has(left) && held.has(right),
  );
}

async function recordDenied(
  client: TransactionClient,
  command: AdminEntitlementMutation,
  actor: EntitlementSnapshot | null,
  before: EntitlementSnapshot | null,
  reason: Exclude<AdminEntitlementMutationResult["reason"], "allowed">,
  status: 403 | 422,
): Promise<AdminEntitlementMutationResult> {
  const auditId = await appendAuditEvent(client, {
    accountId: command.accountId,
    actorUserId: command.actorUserId,
    ...(actor?.tier ? { actorTier: actor.tier } : {}),
    ...(actor?.adminSubRoles.includes("super_admin")
      ? { actorAdminSubRole: "super_admin" }
      : {}),
    eventType:
      reason === "self-mutation-refused"
        ? "security.self_elevation_attempted"
        : "authz.denied",
    resourceKind: "app_user",
    resourceId: command.subjectUserId,
    outcome: "deny",
    justification: command.justification,
    correlationId: command.correlationId,
    deploymentId: command.deploymentId,
    detail: {
      attemptedAction: command.action,
      entitlementKind: command.entitlementKind,
      entitlementValue: command.entitlementValue,
      expires_at: command.expiresAt ?? null,
      reasonCode: reason,
      ...(before ? { before: publicSnapshot(before) } : {}),
    },
  });
  if (reason === "self-mutation-refused") {
    const alertId = randomUUID();
    const inserted = await client.query(
      `INSERT INTO security_alert (
         security_alert_id,audit_id,account_id,actor_user_id,subject_user_id,
         event_type,severity,reason_code,entitlement_kind,entitlement_value,
         request_correlation_id,deployment_id,occurred_at
       )
       SELECT $1,audit_id,account_id,actor_user_id,resource_id,event_type,
              'high','self-mutation-refused',$3,$4,request_correlation_id,
              deployment_id,occurred_at
         FROM audit_event
        WHERE audit_id=$2 AND account_id=$5 AND actor_user_id=$6
          AND resource_kind='app_user' AND resource_id=$6
          AND event_type='security.self_elevation_attempted' AND outcome='deny'
          AND request_correlation_id=$7 AND deployment_id=$8
       RETURNING security_alert_id`,
      [
        alertId,
        auditId,
        command.entitlementKind,
        command.entitlementValue,
        command.accountId,
        command.actorUserId,
        command.correlationId,
        command.deploymentId,
      ],
    );
    if (inserted.rowCount !== 1) {
      throw new Error("Durable self-elevation alert could not be linked.");
    }
  }
  return {
    status,
    code: status === 403 ? "MB-403-ENTITLEMENT" : "MB-422-ENTITLEMENT",
    reason,
    replayed: false,
  };
}

async function applyMutation(
  client: TransactionClient,
  command: AdminEntitlementMutation,
): Promise<AdminEntitlementMutationResult> {
  const users = await lockUsers(
    client,
    command.accountId,
    command.actorUserId,
    command.subjectUserId,
  );
  const actor = users.actorExists
    ? await lockedSnapshot(client, command.accountId, command.actorUserId)
    : null;
  if (actor && command.actorUserId === command.subjectUserId) {
    return recordDenied(
      client,
      command,
      actor,
      actor,
      "self-mutation-refused",
      403,
    );
  }
  if (
    !actor ||
    actor.tier !== "admin" ||
    !actor.adminSubRoles.includes("super_admin")
  ) {
    return recordDenied(
      client,
      command,
      actor,
      null,
      "super-admin-required",
      403,
    );
  }
  if (!users.subjectExists) {
    return recordDenied(
      client,
      command,
      actor,
      null,
      "subject-not-visible",
      403,
    );
  }
  const before = await lockedSnapshot(
    client,
    command.accountId,
    command.subjectUserId,
  );
  const isConsultantGrant =
    command.action === "grant" &&
    command.entitlementKind === "tier" &&
    command.entitlementValue === "consultant";
  const requestedExpiresAt = command.expiresAt ?? null;
  if (isConsultantGrant && requestedExpiresAt === null) {
    return recordDenied(client, command, actor, before, "expiry-required", 422);
  }
  if (!isConsultantGrant && requestedExpiresAt !== null) {
    return recordDenied(
      client,
      command,
      actor,
      before,
      "expiry-not-allowed",
      422,
    );
  }
  if (isConsultantGrant) {
    if (!isStrictRfc3339(requestedExpiresAt as string)) {
      return recordDenied(
        client,
        command,
        actor,
        before,
        "expiry-invalid",
        422,
      );
    }
    const databaseClock = await client.query<{ database_now: Date }>(
      "SELECT clock_timestamp() AS database_now",
    );
    const expiryMilliseconds = Date.parse(requestedExpiresAt as string);
    if (
      !Number.isFinite(expiryMilliseconds) ||
      !databaseClock.rows[0] ||
      expiryMilliseconds <= databaseClock.rows[0].database_now.valueOf()
    ) {
      return recordDenied(
        client,
        command,
        actor,
        before,
        "expiry-not-future",
        422,
      );
    }
  }
  if (
    command.entitlementKind === "admin_sub_role" &&
    command.action === "grant" &&
    before.tier !== "admin"
  ) {
    return recordDenied(
      client,
      command,
      actor,
      before,
      "admin-tier-required",
      422,
    );
  }
  if (
    command.entitlementKind === "admin_sub_role" &&
    command.action === "grant" &&
    prohibitedRoleCombination([
      ...before.adminSubRoles,
      command.entitlementValue as AdminSubRole,
    ])
  ) {
    return recordDenied(
      client,
      command,
      actor,
      before,
      "prohibited-role-combination",
      422,
    );
  }

  let changed = false;
  if (command.entitlementKind === "tier") {
    const tier = command.entitlementValue as PersistedTier;
    const requestedExpiry = requestedExpiresAt
      ? new Date(requestedExpiresAt).valueOf()
      : null;
    const existingExpiry = before.tierExpiresAt?.valueOf() ?? null;
    if (
      command.action === "grant" &&
      (before.tier !== tier || requestedExpiry !== existingExpiry)
    ) {
      await client.query(
        `UPDATE entitlement_grant
            SET revoked_at=clock_timestamp(),revoked_by_user_id=$3
          WHERE account_id=$1 AND user_id=$2
            AND effective_from<=clock_timestamp()
            AND (effective_to IS NULL OR effective_to>clock_timestamp())
            AND revoked_at IS NULL`,
        [command.accountId, command.subjectUserId, command.actorUserId],
      );
      await client.query(
        `INSERT INTO entitlement_grant
          (grant_id,account_id,user_id,tier,grant_actor_kind,granted_by_user_id,
           justification,effective_from,effective_to)
         VALUES($1,$2,$3,$4,'user',$5,$6,clock_timestamp(),$7::timestamptz)`,
        [
          randomUUID(),
          command.accountId,
          command.subjectUserId,
          tier,
          command.actorUserId,
          command.justification,
          requestedExpiresAt,
        ],
      );
      if (tier !== "admin") {
        await client.query(
          `UPDATE admin_role_grant
              SET revoked_at=clock_timestamp(),revoked_by_user_id=$3
            WHERE account_id=$1 AND user_id=$2
              AND effective_from<=clock_timestamp()
              AND (effective_to IS NULL OR effective_to>clock_timestamp())
              AND revoked_at IS NULL`,
          [command.accountId, command.subjectUserId, command.actorUserId],
        );
      }
      changed = true;
    } else if (command.action === "revoke" && before.tier === tier) {
      await client.query(
        `UPDATE entitlement_grant
            SET revoked_at=clock_timestamp(),revoked_by_user_id=$3
          WHERE account_id=$1 AND user_id=$2 AND tier=$4
            AND effective_from<=clock_timestamp()
            AND (effective_to IS NULL OR effective_to>clock_timestamp())
            AND revoked_at IS NULL`,
        [command.accountId, command.subjectUserId, command.actorUserId, tier],
      );
      if (tier === "admin") {
        await client.query(
          `UPDATE admin_role_grant
              SET revoked_at=clock_timestamp(),revoked_by_user_id=$3
            WHERE account_id=$1 AND user_id=$2
              AND effective_from<=clock_timestamp()
              AND (effective_to IS NULL OR effective_to>clock_timestamp())
              AND revoked_at IS NULL`,
          [command.accountId, command.subjectUserId, command.actorUserId],
        );
      }
      changed = true;
    }
  } else {
    const role = command.entitlementValue as AdminSubRole;
    const hasRole = before.adminSubRoles.includes(role);
    if (command.action === "grant" && !hasRole) {
      await client.query(
        `INSERT INTO admin_role_grant
          (admin_grant_id,account_id,user_id,sub_role,granted_by_user_id,
           justification,effective_from)
         VALUES($1,$2,$3,$4,$5,$6,clock_timestamp())`,
        [
          randomUUID(),
          command.accountId,
          command.subjectUserId,
          role,
          command.actorUserId,
          command.justification,
        ],
      );
      changed = true;
    } else if (command.action === "revoke" && hasRole) {
      if (role === "security_audit") {
        const activeSecurityAuditors = await client.query(
          `SELECT admin_grant_id
             FROM admin_role_grant
            WHERE account_id=$1 AND sub_role='security_audit'
              AND effective_from<=clock_timestamp()
              AND (effective_to IS NULL OR effective_to>clock_timestamp())
              AND revoked_at IS NULL
            ORDER BY admin_grant_id
            FOR UPDATE`,
          [command.accountId],
        );
        if (activeSecurityAuditors.rows.length <= 1) {
          return recordDenied(
            client,
            command,
            actor,
            before,
            "last-security-audit-required",
            422,
          );
        }
      }
      await client.query(
        `UPDATE admin_role_grant
            SET revoked_at=clock_timestamp(),revoked_by_user_id=$3
          WHERE account_id=$1 AND user_id=$2 AND sub_role=$4
            AND effective_from<=clock_timestamp()
            AND (effective_to IS NULL OR effective_to>clock_timestamp())
            AND revoked_at IS NULL`,
        [command.accountId, command.subjectUserId, command.actorUserId, role],
      );
      changed = true;
    }
  }

  const after = await lockedSnapshot(
    client,
    command.accountId,
    command.subjectUserId,
  );
  const auditId = await appendAuditEvent(client, {
    accountId: command.accountId,
    actorUserId: command.actorUserId,
    actorTier: "admin",
    actorAdminSubRole: "super_admin",
    eventType:
      command.action === "grant"
        ? "entitlement.granted"
        : "entitlement.revoked",
    resourceKind: "app_user",
    resourceId: command.subjectUserId,
    outcome: "allow",
    justification: command.justification,
    correlationId: command.correlationId,
    deploymentId: command.deploymentId,
    detail: {
      entitlementKind: command.entitlementKind,
      entitlementValue: command.entitlementValue,
      tier:
        command.entitlementKind === "tier" ? command.entitlementValue : null,
      sub_role:
        command.entitlementKind === "admin_sub_role"
          ? command.entitlementValue
          : null,
      expires_at: requestedExpiresAt,
      changed,
      before: publicSnapshot(before),
      after: publicSnapshot(after),
    },
  });
  return {
    status: 200,
    code: "MB-200-ENTITLEMENT",
    reason: "allowed",
    replayed: false,
    body: {
      action: command.action,
      subject_user_id: command.subjectUserId,
      entitlement_kind: command.entitlementKind,
      entitlement_value: command.entitlementValue,
      expires_at: requestedExpiresAt,
      changed,
      before: publicSnapshot(before),
      after: publicSnapshot(after),
      audit_id: auditId,
    },
  };
}

async function authorizeReplay(
  client: TransactionClient,
  command: AdminEntitlementMutation,
  cachedResult: AdminEntitlementMutationResult,
  sameRequest: boolean,
): Promise<AdminEntitlementMutationResult | null> {
  const users = await lockUsers(
    client,
    command.accountId,
    command.actorUserId,
    command.subjectUserId,
  );
  const actor = users.actorExists
    ? await lockedSnapshot(client, command.accountId, command.actorUserId)
    : null;
  if (actor && command.actorUserId === command.subjectUserId) {
    if (
      sameRequest &&
      cachedResult.reason === "self-mutation-refused" &&
      cachedResult.status === 403
    ) {
      return { ...cachedResult, replayed: true };
    }
    return recordDenied(
      client,
      command,
      actor,
      actor,
      "self-mutation-refused",
      403,
    );
  }
  if (
    !actor ||
    actor.tier !== "admin" ||
    !actor.adminSubRoles.includes("super_admin")
  ) {
    return recordDenied(
      client,
      command,
      actor,
      null,
      "super-admin-required",
      403,
    );
  }
  if (!users.subjectExists) {
    return recordDenied(
      client,
      command,
      actor,
      null,
      "subject-not-visible",
      403,
    );
  }
  return null;
}

/**
 * The repository write boundary. It re-resolves and locks actor authority,
 * applies the entitlement change, writes its audit event and completes the
 * idempotency record in one transaction.
 */
export async function mutateAdminEntitlement(
  pool: ConnectionPool,
  command: AdminEntitlementMutation,
): Promise<AdminEntitlementMutationResult> {
  return inTransaction(pool, async (client) => {
    const keyHash = keyDigest(command.idempotencyKey);
    await client.query(
      `DELETE FROM idempotency_record
        WHERE account_id=$1 AND subject_user_id=$2 AND route=$3 AND key_hash=$4
          AND expires_at<=clock_timestamp()`,
      [
        command.accountId,
        command.actorUserId,
        "POST /api/v1/admin/entitlements",
        keyHash,
      ],
    );
    const reservationId = randomUUID();
    const reserved = await client.query(
      `INSERT INTO idempotency_record
        (idempotency_record_id,account_id,subject_user_id,route,key_hash,
         request_hash,response_status,response_body,created_at,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,102,'{"pending":true}'::jsonb,
              clock_timestamp(),clock_timestamp()+interval '24 hours')
       ON CONFLICT(account_id,subject_user_id,route,key_hash) DO NOTHING
       RETURNING idempotency_record_id`,
      [
        reservationId,
        command.accountId,
        command.actorUserId,
        "POST /api/v1/admin/entitlements",
        keyHash,
        command.requestDigest,
      ],
    );
    if (reserved.rowCount === 0) {
      const prior = await client.query<{
        request_hash: Buffer;
        response_body: AdminEntitlementMutationResult;
      }>(
        `SELECT request_hash,response_body
           FROM idempotency_record
          WHERE account_id=$1 AND subject_user_id=$2 AND route=$3 AND key_hash=$4
            AND expires_at>clock_timestamp()
          FOR UPDATE`,
        [
          command.accountId,
          command.actorUserId,
          "POST /api/v1/admin/entitlements",
          keyHash,
        ],
      );
      const row = prior.rows[0];
      if (!row) throw new Error("Idempotency reservation was lost.");
      const sameRequest = row.request_hash.equals(command.requestDigest);
      const replayDenial = await authorizeReplay(
        client,
        command,
        row.response_body,
        sameRequest,
      );
      if (replayDenial) return replayDenial;
      if (!sameRequest) {
        return {
          status: 409,
          code: "MB-409-IDEMPOTENCY",
          reason: "idempotency-key-reuse",
          replayed: true,
        };
      }
      return { ...row.response_body, replayed: true };
    }
    const result = await applyMutation(client, command);
    await client.query(
      `UPDATE idempotency_record
          SET response_status=$2,response_body=$3::jsonb
        WHERE idempotency_record_id=$1 AND response_status=102`,
      [reservationId, result.status, JSON.stringify(result)],
    );
    return result;
  });
}

/**
 * Tenant-scoped Admin entitlement read model. Actor authority and target
 * visibility are re-resolved while the corresponding users and live grants
 * are locked in the same transaction as the history read.
 */
export async function readAdminEntitlement(
  pool: ConnectionPool,
  input: {
    readonly accountId: string;
    readonly actorUserId: string;
    readonly subjectUserId: string;
  },
): Promise<AdminEntitlementReadResult> {
  return inTransaction(pool, async (client) => {
    const users = await lockUsers(
      client,
      input.accountId,
      input.actorUserId,
      input.subjectUserId,
    );
    const actor = users.actorExists
      ? await lockedSnapshot(client, input.accountId, input.actorUserId)
      : null;
    if (
      !actor ||
      actor.tier !== "admin" ||
      !actor.adminSubRoles.includes("super_admin")
    ) {
      return { status: 403, reason: "super-admin-required" };
    }
    if (!users.subjectExists) {
      return { status: 403, reason: "subject-not-visible" };
    }

    const current = await lockedSnapshot(
      client,
      input.accountId,
      input.subjectUserId,
    );
    const history = await client.query<{
      kind: AdminEntitlementKind;
      value: unknown;
      effective_from: Date;
      effective_to: Date | null;
      revoked_at: Date | null;
      grant_actor_kind: "system" | "user";
      granted_by: string | null;
      revoked_by: string | null;
      justification: string;
      created_at: Date;
    }>(
      `SELECT 'tier'::text AS kind,tier AS value,effective_from,effective_to,
              revoked_at,grant_actor_kind,granted_by_user_id AS granted_by,
              revoked_by_user_id AS revoked_by,justification,created_at
         FROM entitlement_grant
        WHERE account_id=$1 AND user_id=$2
       UNION ALL
       SELECT 'admin_sub_role'::text AS kind,sub_role AS value,effective_from,
              effective_to,revoked_at,'user'::text AS grant_actor_kind,
              granted_by_user_id AS granted_by,
              revoked_by_user_id AS revoked_by,justification,created_at
         FROM admin_role_grant
        WHERE account_id=$1 AND user_id=$2
       ORDER BY effective_from DESC,created_at DESC,kind,value`,
      [input.accountId, input.subjectUserId],
    );
    return {
      status: 200,
      body: {
        subject_user_id: input.subjectUserId,
        current: {
          ...publicSnapshot(current),
        },
        history: history.rows.map((row) => ({
          kind: row.kind,
          value:
            row.kind === "tier"
              ? requirePersistedTier(row.value)
              : requireAdminSubRole(row.value),
          effective_from: row.effective_from,
          effective_to: row.effective_to,
          revoked_at: row.revoked_at,
          grant_actor_kind: row.grant_actor_kind,
          granted_by: row.granted_by,
          revoked_by: row.revoked_by,
          justification: row.justification,
        })),
      },
    };
  });
}

/** Audited bootstrap for Demo and non-production synthetic Standard, Consultant, and Admin fixtures. */
export async function ensureBootstrapEntitlement(
  client: TransactionClient,
  input: {
    readonly accountId: string;
    readonly subjectUserId: string;
    readonly correlationId: string;
    readonly deploymentId: string;
    readonly environment: "local" | "test" | "production";
    readonly justification: string;
  } & (
    | { readonly tier: "demo" }
    | { readonly tier: "standard"; readonly grantorUserId: string }
    | { readonly tier: "consultant"; readonly grantorUserId: string }
    | {
        readonly tier: "admin";
        readonly grantorUserId: string;
        readonly adminSubRole?: AdminSubRole;
      }
  ),
): Promise<void> {
  if (
    (input.tier === "standard" ||
      input.tier === "consultant" ||
      input.tier === "admin") &&
    input.environment === "production"
  ) {
    throw new Error(
      `${input.tier} simulator bootstrap is prohibited in production.`,
    );
  }
  const userIds =
    input.tier === "demo"
      ? [input.subjectUserId]
      : [input.subjectUserId, input.grantorUserId];
  const users = await client.query<{ user_id: string }>(
    `SELECT user_id FROM app_user
      WHERE account_id=$1 AND user_id=ANY($2::uuid[]) AND status='active'
      ORDER BY user_id
      FOR UPDATE`,
    [input.accountId, userIds],
  );
  const found = new Set(users.rows.map((row) => row.user_id));
  if (!found.has(input.subjectUserId))
    throw new Error("Bootstrap subject is not active.");
  if (
    input.tier !== "demo" &&
    (!found.has(input.grantorUserId) ||
      input.grantorUserId === input.subjectUserId)
  )
    throw new Error(`${input.tier} bootstrap grantor is invalid.`);
  const before = await lockedSnapshot(
    client,
    input.accountId,
    input.subjectUserId,
  );
  if (before.tier) return;
  if (input.tier === "demo") {
    await client.query(
      `INSERT INTO entitlement_grant
        (grant_id,account_id,user_id,tier,grant_actor_kind,justification,effective_from)
       VALUES($1,$2,$3,'demo','system',$4,clock_timestamp())`,
      [randomUUID(), input.accountId, input.subjectUserId, input.justification],
    );
  } else if (input.tier === "admin") {
    const subRole = input.adminSubRole ?? "super_admin";
    await client.query(
      `INSERT INTO entitlement_grant
        (grant_id,account_id,user_id,tier,grant_actor_kind,granted_by_user_id,justification,effective_from)
       VALUES($1,$2,$3,'admin','user',$4,$5,clock_timestamp())`,
      [
        randomUUID(),
        input.accountId,
        input.subjectUserId,
        input.grantorUserId,
        input.justification,
      ],
    );
    await client.query(
      `INSERT INTO admin_role_grant
        (admin_grant_id,account_id,user_id,sub_role,granted_by_user_id,
         justification,effective_from)
       VALUES($1,$2,$3,$4,$5,$6,clock_timestamp())`,
      [
        randomUUID(),
        input.accountId,
        input.subjectUserId,
        subRole,
        input.grantorUserId,
        input.justification,
      ],
    );
    await appendAuditEvent(client, {
      accountId: input.accountId,
      actorUserId: input.grantorUserId,
      eventType: "entitlement.granted",
      resourceKind: "app_user",
      resourceId: input.subjectUserId,
      outcome: "allow",
      justification: input.justification,
      correlationId: input.correlationId,
      deploymentId: input.deploymentId,
      detail: {
        actorKind: "synthetic_simulator_bootstrap",
        entitlementKind: "tier",
        entitlementValue: "admin",
        tier: "admin",
        sub_role: subRole,
        expires_at: null,
        changed: true,
        before: publicSnapshot(before),
        after: { tier: "admin", admin_sub_roles: [subRole] },
      },
    });
    return;
  } else {
    await client.query(
      `INSERT INTO entitlement_grant
        (grant_id,account_id,user_id,tier,grant_actor_kind,granted_by_user_id,justification,effective_from)
       VALUES($1,$2,$3,$4,'user',$5,$6,clock_timestamp())`,
      [
        randomUUID(),
        input.accountId,
        input.subjectUserId,
        input.tier,
        input.grantorUserId,
        input.justification,
      ],
    );
  }
  await appendAuditEvent(client, {
    accountId: input.accountId,
    ...(input.tier === "standard" || input.tier === "consultant"
      ? { actorUserId: input.grantorUserId }
      : {}),
    eventType: "entitlement.granted",
    resourceKind: "app_user",
    resourceId: input.subjectUserId,
    outcome: "allow",
    justification: input.justification,
    correlationId: input.correlationId,
    deploymentId: input.deploymentId,
    detail: {
      actorKind:
        input.tier === "demo" ? "system" : "synthetic_simulator_bootstrap",
      entitlementKind: "tier",
      entitlementValue: input.tier,
      tier: input.tier,
      sub_role: null,
      expires_at: null,
      changed: true,
      before: publicSnapshot(before),
      after: { tier: input.tier, admin_sub_roles: [] },
    },
  });
}

export async function readEntitlementSnapshot(
  database: Queryable,
  accountId: string,
  userId: string,
): Promise<EntitlementSnapshot> {
  const grants = await database.query<{ tier: unknown }>(
    `SELECT tier FROM entitlement_grant
      WHERE account_id=$1 AND user_id=$2 AND effective_from<=clock_timestamp()
        AND (effective_to IS NULL OR effective_to>clock_timestamp())
        AND revoked_at IS NULL
      ORDER BY effective_from DESC,created_at DESC LIMIT 1`,
    [accountId, userId],
  );
  const roles = await database.query<{ sub_role: unknown }>(
    `SELECT sub_role FROM admin_role_grant
      WHERE account_id=$1 AND user_id=$2 AND effective_from<=clock_timestamp()
        AND (effective_to IS NULL OR effective_to>clock_timestamp())
        AND revoked_at IS NULL`,
    [accountId, userId],
  );
  return {
    tier: grants.rows[0] ? requirePersistedTier(grants.rows[0].tier) : null,
    adminSubRoles: sortRoles(
      roles.rows.map((row) => requireAdminSubRole(row.sub_role)),
    ),
  };
}
