import {
  parseUserProfileHistoryV1,
  type ProductTier,
  type UserProfileHistoryV1,
  type UserProfileRunV1,
} from "@matchbase/contracts";
import {
  appendAuditEvent,
  inTransaction,
  type ConnectionPool,
} from "@matchbase/data";
import { ApplicationFault, type RequestContext } from "./types.js";

const PRODUCT_TIER_RANK: Readonly<Record<ProductTier, number>> = {
  demo: 0,
  standard: 1,
  consultant: 2,
};
const PROFILE_PAGE_LIMIT = 50;
const MAX_PROFILE_OFFSET = 10_000;

function profileOffset(cursor?: string): number {
  if (cursor === undefined) return 0;
  if (!/^\d{1,5}$/u.test(cursor))
    throw new ApplicationFault(
      400,
      "invalid-cursor",
      "MB-400-CURSOR",
      "Invalid cursor.",
    );
  const value = Number(cursor);
  if (
    !Number.isSafeInteger(value) ||
    value < PROFILE_PAGE_LIMIT ||
    value > MAX_PROFILE_OFFSET ||
    value % PROFILE_PAGE_LIMIT !== 0
  )
    throw new ApplicationFault(
      400,
      "invalid-cursor",
      "MB-400-CURSOR",
      "Invalid cursor.",
    );
  return value;
}

type CanonicalDocument = Record<string, unknown>;

function canonicalSummary(document: CanonicalDocument): string {
  if (
    typeof document.canonical_text === "string" &&
    document.canonical_text.trim().length > 0
  )
    return document.canonical_text.trim().slice(0, 320);
  if (!Array.isArray(document.fields)) return "Canonical request";
  const values = document.fields.flatMap((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry))
      return [];
    const field = entry as Record<string, unknown>;
    const typed =
      field.typed_value !== null &&
      typeof field.typed_value === "object" &&
      !Array.isArray(field.typed_value)
        ? (field.typed_value as Record<string, unknown>)
        : null;
    const value =
      typeof typed?.value === "string"
        ? typed.value
        : typeof field.canonicalValue === "string"
          ? field.canonicalValue
          : typeof field.canonical_value === "string"
            ? field.canonical_value
            : null;
    return value && value.trim().length > 0 ? [value.trim()] : [];
  });
  return (values.slice(0, 3).join(" · ") || "Canonical request").slice(0, 320);
}

function outcome(state: string): UserProfileRunV1["outcome"] {
  if (state === "complete") return "matched";
  if (state === "no_responsible_match") return "no_responsible_match";
  if (state === "cancelled") return "cancelled";
  if (state === "superseded") return "superseded";
  if (state === "failed") return "failed";
  return "pending";
}

export class UserProfileApplication {
  constructor(private readonly pool: ConnectionPool) {}

  async getHistory(
    context: RequestContext,
    cursor?: string,
  ): Promise<UserProfileHistoryV1> {
    const offset = profileOffset(cursor);
    return inTransaction(this.pool, async (client) => {
      const grant = await client.query<{
        tier: string;
        is_super_admin: boolean;
      }>(
        `SELECT eg.tier,
                EXISTS (
                  SELECT 1 FROM admin_role_grant arg
                   WHERE arg.account_id=eg.account_id AND arg.user_id=eg.user_id
                     AND arg.sub_role='super_admin'
                     AND arg.effective_from <= clock_timestamp()
                     AND (arg.effective_to IS NULL OR arg.effective_to > clock_timestamp())
                     AND arg.revoked_at IS NULL
                ) AS is_super_admin
           FROM entitlement_grant eg
          WHERE eg.account_id=$1 AND eg.user_id=$2
            AND effective_from <= clock_timestamp()
            AND (effective_to IS NULL OR effective_to > clock_timestamp())
            AND revoked_at IS NULL
          ORDER BY effective_from DESC,created_at DESC LIMIT 1
          FOR SHARE`,
        [context.accountId, context.userId],
      );
      const stored = grant.rows[0];
      const adminProductAccess =
        context.tier === "admin" &&
        context.adminSubRoles.includes("super_admin") &&
        stored?.tier === "admin" &&
        stored.is_super_admin;
      if (
        (context.tier === "admin" && !adminProductAccess) ||
        (context.tier !== "admin" && stored?.tier !== context.tier)
      )
        throw new ApplicationFault(
          403,
          "product-profile-not-entitled",
          "MB-403-PROFILE",
          "Product profile access is not permitted.",
        );

      const requests = await client.query<{
        request_id: string;
        current_version: number;
        lifecycle_state: UserProfileHistoryV1["requests"][number]["lifecycle_state"];
        created_at: Date;
        canonical_created_at: Date;
        canonical_document: CanonicalDocument;
        run_count: number;
      }>(
        `SELECT sr.request_id,sr.current_version,sr.lifecycle_state,sr.created_at,
                crv.created_at AS canonical_created_at,crv.canonical_document,
                count(rr.run_id)::int AS run_count
           FROM sourcing_request sr
           JOIN canonical_request_version crv
             ON crv.account_id=sr.account_id AND crv.request_id=sr.request_id
            AND crv.version=sr.current_version
           LEFT JOIN research_run rr
             ON rr.account_id=sr.account_id
            AND rr.canonical_request_version_id=crv.canonical_request_version_id
          WHERE sr.account_id=$1 AND sr.created_by_user_id=$2
          GROUP BY sr.request_id,sr.current_version,sr.lifecycle_state,sr.created_at,
                   crv.created_at,crv.canonical_document
          ORDER BY sr.created_at DESC,sr.request_id DESC
          LIMIT $3 OFFSET $4`,
        [context.accountId, context.userId, PROFILE_PAGE_LIMIT + 1, offset],
      );
      const runs = await client.query<{
        run_id: string;
        request_id: string;
        version: number;
        tier_at_submission: ProductTier;
        state: string;
        queued_at: Date;
        started_at: Date | null;
        completed_at: Date | null;
        cancelled_at: Date | null;
        result_document_available: boolean;
      }>(
        `SELECT rr.run_id,crv.request_id,crv.version,rr.tier_at_submission,
                CASE WHEN rr.state='failed_retryable' AND lt.live_research_terminal_id IS NOT NULL
                     THEN 'failed' ELSE rr.state END AS state,
                rr.queued_at,rr.started_at,
                COALESCE(rr.completed_at,lt.completed_at) AS completed_at,
                rr.cancelled_at,
                (rs.complete_result_document IS NOT NULL) AS result_document_available
           FROM research_run rr
           JOIN canonical_request_version crv
             ON crv.account_id=rr.account_id
            AND crv.canonical_request_version_id=rr.canonical_request_version_id
           LEFT JOIN run_result rs
             ON rs.account_id=rr.account_id AND rs.run_id=rr.run_id
           LEFT JOIN live_research_terminal lt
             ON lt.account_id=rr.account_id AND lt.run_id=rr.run_id
          WHERE rr.account_id=$1 AND rr.requested_by_user_id=$2
          ORDER BY rr.queued_at DESC,rr.run_id DESC
          LIMIT $3 OFFSET $4`,
        [context.accountId, context.userId, PROFILE_PAGE_LIMIT + 1, offset],
      );
      const requestRows = requests.rows.slice(0, PROFILE_PAGE_LIMIT);
      const runRows = runs.rows.slice(0, PROFILE_PAGE_LIMIT);
      const hasMore =
        requests.rows.length > PROFILE_PAGE_LIMIT ||
        runs.rows.length > PROFILE_PAGE_LIMIT;
      const currentTier: ProductTier = adminProductAccess
        ? "consultant"
        : (context.tier as ProductTier);
      const body = parseUserProfileHistoryV1({
        schema_version: "user-profile-history.v1",
        current_tier: currentTier,
        requests: requestRows.map((row) => ({
          request_id: row.request_id,
          canonical_request_version: row.current_version,
          canonical_summary: canonicalSummary(row.canonical_document),
          lifecycle_state: row.lifecycle_state,
          created_at: row.created_at.toISOString(),
          updated_at: row.canonical_created_at.toISOString(),
          run_count: row.run_count,
        })),
        runs: runRows.map((row) => {
          const terminal = ["complete", "no_responsible_match"].includes(
            row.state,
          );
          const resultExists = terminal && row.result_document_available;
          const entitled =
            PRODUCT_TIER_RANK[currentTier] >=
            PRODUCT_TIER_RANK[row.tier_at_submission];
          const visible = resultExists && entitled;
          return {
            run_id: row.run_id,
            request_id: row.request_id,
            canonical_request_version: row.version,
            submitted_tier: row.tier_at_submission,
            state: row.state,
            outcome: outcome(row.state),
            queued_at: row.queued_at.toISOString(),
            updated_at: (
              row.completed_at ??
              row.cancelled_at ??
              row.started_at ??
              row.queued_at
            ).toISOString(),
            result_available: resultExists,
            result_projection: visible ? row.tier_at_submission : null,
            links: {
              request: `/api/v1/requests/${row.request_id}`,
              run: `/api/v1/runs/${row.run_id}`,
              result: visible
                ? adminProductAccess && row.tier_at_submission === "consultant"
                  ? `/api/v1/consultant/runs/${row.run_id}/result`
                  : `/api/v1/runs/${row.run_id}/result`
                : null,
            },
          };
        }),
        page: {
          limit: PROFILE_PAGE_LIMIT,
          has_more: hasMore,
          next_cursor: hasMore ? String(offset + PROFILE_PAGE_LIMIT) : null,
        },
      });
      await appendAuditEvent(client, {
        accountId: context.accountId,
        actorUserId: context.userId,
        actorTier: context.tier,
        eventType: "profile.history.projected",
        resourceKind: "user_profile",
        resourceId: context.userId,
        outcome: "allow",
        correlationId: context.correlationId,
        deploymentId: context.deploymentId,
        detail: {
          ownerScoped: true,
          requestCount: body.requests.length,
          runCount: body.runs.length,
          pageOffset: offset,
          hasMore,
          immutableSubmissionTier: true,
          adminProductAccess,
          disclosureCommittedBeforeResponse: true,
        },
      });
      return body;
    });
  }
}
