import { createHash } from "node:crypto";
import {
  ADMIN_SUB_ROLES,
  PERSISTED_TIERS,
  type AdminSubRole,
  type PersistedTier,
} from "@matchbase/contracts";
import {
  mutateAdminEntitlement,
  readAdminEntitlement,
  type AdminEntitlementAction,
  type AdminEntitlementKind,
  type AdminEntitlementMutationBody,
  type AdminEntitlementMutationResult,
  type AdminEntitlementReadBody,
  type ConnectionPool,
} from "@matchbase/data";
import { ApplicationFault, type RequestContext } from "./types.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IDEMPOTENCY_PATTERN = /^[\x20-\x7e]{16,128}$/u;

export interface AdminEntitlementMutationDto {
  readonly action: AdminEntitlementAction;
  readonly subject_user_id: string;
  readonly entitlement_kind: AdminEntitlementKind;
  readonly entitlement_value: PersistedTier | AdminSubRole;
  readonly justification: string;
  readonly expires_at?: string;
}

export interface AdminEntitlementReadQuery {
  readonly subject_user_id: string;
}

function schemaFault(): never {
  throw new ApplicationFault(
    422,
    "schema-violation",
    "MB-422-SCHEMA",
    "Admin entitlement input is invalid.",
  );
}

const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u;

function isRfc3339(value: string): boolean {
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

export function parseAdminEntitlementMutationDto(
  value: unknown,
): AdminEntitlementMutationDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return schemaFault();
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    "action",
    "subject_user_id",
    "entitlement_kind",
    "entitlement_value",
    "justification",
    "expires_at",
  ]);
  const hasExpiry = Object.hasOwn(input, "expires_at");
  const requiresExpiry =
    input.action === "grant" &&
    input.entitlement_kind === "tier" &&
    input.entitlement_value === "consultant";
  if (
    (Object.keys(input).length !== 5 && Object.keys(input).length !== 6) ||
    Object.keys(input).some((key) => !allowed.has(key)) ||
    (input.action !== "grant" && input.action !== "revoke") ||
    (input.entitlement_kind !== "tier" &&
      input.entitlement_kind !== "admin_sub_role") ||
    typeof input.subject_user_id !== "string" ||
    !UUID_PATTERN.test(input.subject_user_id) ||
    typeof input.entitlement_value !== "string" ||
    typeof input.justification !== "string" ||
    input.justification !== input.justification.trim() ||
    input.justification.length < 1 ||
    input.justification.length > 2_000 ||
    [...input.justification].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    }) ||
    (requiresExpiry &&
      (!hasExpiry ||
        typeof input.expires_at !== "string" ||
        !isRfc3339(input.expires_at))) ||
    (!requiresExpiry && hasExpiry)
  ) {
    return schemaFault();
  }
  if (
    (input.entitlement_kind === "tier" &&
      !PERSISTED_TIERS.includes(input.entitlement_value as PersistedTier)) ||
    (input.entitlement_kind === "admin_sub_role" &&
      !ADMIN_SUB_ROLES.includes(input.entitlement_value as AdminSubRole))
  ) {
    return schemaFault();
  }
  return {
    action: input.action,
    subject_user_id: input.subject_user_id,
    entitlement_kind: input.entitlement_kind,
    entitlement_value: input.entitlement_value as PersistedTier | AdminSubRole,
    justification: input.justification,
    ...(requiresExpiry ? { expires_at: input.expires_at as string } : {}),
  };
}

export function parseAdminEntitlementReadQuery(
  entries: readonly (readonly [string, string])[],
): AdminEntitlementReadQuery {
  if (
    entries.length !== 1 ||
    entries[0]?.[0] !== "subject_user_id" ||
    !UUID_PATTERN.test(entries[0][1])
  ) {
    return schemaFault();
  }
  return { subject_user_id: entries[0][1] };
}

export class AdminEntitlementsApplication {
  constructor(private readonly pool: ConnectionPool) {}

  async read(
    context: RequestContext,
    input: AdminEntitlementReadQuery,
  ): Promise<AdminEntitlementReadBody> {
    let result: Awaited<ReturnType<typeof readAdminEntitlement>>;
    try {
      result = await readAdminEntitlement(this.pool, {
        accountId: context.accountId,
        actorUserId: context.userId,
        subjectUserId: input.subject_user_id,
      });
    } catch {
      throw new ApplicationFault(
        503,
        "entitlement-read-unavailable",
        "MB-503-ENTITLEMENT",
        "The entitlement history could not be read.",
        true,
      );
    }
    if (result.status === 403) {
      throw new ApplicationFault(
        403,
        "resource-not-visible",
        "MB-403-ENTITLEMENT",
        "The entitlement subject is not visible.",
      );
    }
    return result.body;
  }

  async mutate(
    context: RequestContext,
    idempotencyKey: string,
    input: AdminEntitlementMutationDto,
  ): Promise<{ body: AdminEntitlementMutationBody; replayed: boolean }> {
    if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
      throw new ApplicationFault(
        400,
        "idempotency-key-required",
        "MB-400-IDEMPOTENCY",
        "A valid Idempotency-Key is required.",
      );
    }
    const requestDigest = createHash("sha256")
      .update(JSON.stringify(input), "utf8")
      .digest();
    let result: AdminEntitlementMutationResult;
    try {
      result = await mutateAdminEntitlement(this.pool, {
        accountId: context.accountId,
        actorUserId: context.userId,
        subjectUserId: input.subject_user_id,
        action: input.action,
        entitlementKind: input.entitlement_kind,
        entitlementValue: input.entitlement_value,
        justification: input.justification,
        expiresAt: input.expires_at ?? null,
        correlationId: context.correlationId,
        deploymentId: context.deploymentId,
        idempotencyKey,
        requestDigest,
      });
    } catch {
      throw new ApplicationFault(
        503,
        "audit-unavailable",
        "MB-503-AUDIT",
        "The entitlement change could not be durably audited.",
        true,
        {},
        true,
      );
    }
    if (result.status !== 200 || !result.body) {
      const details: Readonly<
        Record<Exclude<typeof result.reason, "allowed">, string>
      > = {
        "super-admin-required": "Super-admin entitlement is required.",
        "self-mutation-refused": "Self entitlement mutation is refused.",
        "subject-not-visible": "The subject is not visible.",
        "admin-tier-required":
          "An Admin tier is required before an Admin sub-role can be granted.",
        "prohibited-role-combination":
          "The requested Admin sub-role combination is prohibited.",
        "last-security-audit-required":
          "The final active Security and audit assignment cannot be revoked.",
        "expiry-required":
          "A Consultant grant requires an RFC3339 expiry timestamp.",
        "expiry-not-allowed":
          "Expiry is allowed only for a Consultant tier grant.",
        "expiry-invalid":
          "The Consultant grant expiry must be a valid RFC3339 timestamp.",
        "expiry-not-future":
          "The Consultant grant expiry must be later than the database clock.",
        "idempotency-key-reuse":
          "Idempotency key was reused with different input.",
      };
      throw new ApplicationFault(
        result.status,
        result.reason === "idempotency-key-reuse"
          ? "idempotency-key-reuse"
          : result.reason === "self-mutation-refused"
            ? "self-elevation-forbidden"
            : result.status === 403
              ? "tier-not-entitled"
              : "entitlement-change-refused",
        result.code,
        details[result.reason as Exclude<typeof result.reason, "allowed">],
        false,
        result.replayed ? { "MB-Idempotent-Replay": "true" } : {},
        result.reason !== "idempotency-key-reuse",
      );
    }
    return { body: result.body, replayed: result.replayed };
  }
}
