import type { PersistedTier } from "./authorization.js";

export const USER_PROFILE_HISTORY_SCHEMA_VERSION =
  "user-profile-history.v1" as const;

export type ProductTier = Exclude<PersistedTier, "admin">;

export interface UserProfileRequestV1 {
  readonly request_id: string;
  readonly canonical_request_version: number;
  readonly canonical_summary: string;
  readonly lifecycle_state: "draft" | "canonicalised" | "confirmed" | "closed";
  readonly created_at: string;
  readonly updated_at: string;
  readonly run_count: number;
}

export interface UserProfileRunV1 {
  readonly run_id: string;
  readonly request_id: string;
  readonly canonical_request_version: number;
  readonly submitted_tier: ProductTier;
  readonly state: string;
  readonly outcome:
    | "pending"
    | "matched"
    | "no_responsible_match"
    | "failed"
    | "cancelled"
    | "superseded";
  readonly queued_at: string;
  readonly updated_at: string;
  readonly result_available: boolean;
  readonly result_projection: ProductTier | null;
  readonly links: {
    readonly request: string;
    readonly run: string;
    readonly result: string | null;
  };
}

export interface UserProfileHistoryV1 {
  readonly schema_version: typeof USER_PROFILE_HISTORY_SCHEMA_VERSION;
  readonly current_tier: ProductTier;
  readonly requests: readonly UserProfileRequestV1[];
  readonly runs: readonly UserProfileRunV1[];
  readonly page: {
    readonly limit: number;
    readonly has_more: boolean;
    readonly next_cursor: string | null;
  };
}

const PRODUCT_TIERS = new Set<ProductTier>(["demo", "standard", "consultant"]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} is invalid.`);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new Error(`${label} contains an unsupported field.`);
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${label} is invalid.`);
  return value;
}

function iso(value: unknown, label: string): string {
  const text = nonEmpty(value, label);
  if (!Number.isFinite(new Date(text).valueOf()))
    throw new Error(`${label} is invalid.`);
  return text;
}

function productTier(value: unknown, label: string): ProductTier {
  if (!PRODUCT_TIERS.has(value as ProductTier))
    throw new Error(`${label} is invalid.`);
  return value as ProductTier;
}

function natural(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error(`${label} is invalid.`);
  return Number(value);
}

export function parseUserProfileHistoryV1(
  value: unknown,
): UserProfileHistoryV1 {
  const root = record(value, "User profile history");
  exactKeys(
    root,
    ["schema_version", "current_tier", "requests", "runs", "page"],
    "User profile history",
  );
  if (root.schema_version !== USER_PROFILE_HISTORY_SCHEMA_VERSION)
    throw new Error("User profile history schema version is invalid.");
  if (!Array.isArray(root.requests) || !Array.isArray(root.runs))
    throw new Error("User profile history collections are invalid.");
  const requests = root.requests.map((entry, index) => {
    const item = record(entry, `Profile request ${index}`);
    exactKeys(
      item,
      [
        "request_id",
        "canonical_request_version",
        "canonical_summary",
        "lifecycle_state",
        "created_at",
        "updated_at",
        "run_count",
      ],
      `Profile request ${index}`,
    );
    if (
      !["draft", "canonicalised", "confirmed", "closed"].includes(
        String(item.lifecycle_state),
      )
    )
      throw new Error(`Profile request ${index} lifecycle is invalid.`);
    return {
      request_id: nonEmpty(item.request_id, `Profile request ${index} id`),
      canonical_request_version: natural(
        item.canonical_request_version,
        `Profile request ${index} version`,
      ),
      canonical_summary: nonEmpty(
        item.canonical_summary,
        `Profile request ${index} summary`,
      ),
      lifecycle_state:
        item.lifecycle_state as UserProfileRequestV1["lifecycle_state"],
      created_at: iso(item.created_at, `Profile request ${index} created at`),
      updated_at: iso(item.updated_at, `Profile request ${index} updated at`),
      run_count: natural(item.run_count, `Profile request ${index} run count`),
    };
  });
  const runs = root.runs.map((entry, index) => {
    const item = record(entry, `Profile run ${index}`);
    exactKeys(
      item,
      [
        "run_id",
        "request_id",
        "canonical_request_version",
        "submitted_tier",
        "state",
        "outcome",
        "queued_at",
        "updated_at",
        "result_available",
        "result_projection",
        "links",
      ],
      `Profile run ${index}`,
    );
    const submittedTier = productTier(
      item.submitted_tier,
      `Profile run ${index} submitted tier`,
    );
    const projection =
      item.result_projection === null
        ? null
        : productTier(
            item.result_projection,
            `Profile run ${index} result projection`,
          );
    if (projection !== null && projection !== submittedTier)
      throw new Error(`Profile run ${index} projection widened.`);
    if (typeof item.result_available !== "boolean")
      throw new Error(`Profile run ${index} result availability is invalid.`);
    if (!item.result_available && projection !== null)
      throw new Error(`Profile run ${index} result availability drifted.`);
    const outcome = nonEmpty(item.outcome, `Profile run ${index} outcome`);
    if (
      ![
        "pending",
        "matched",
        "no_responsible_match",
        "failed",
        "cancelled",
        "superseded",
      ].includes(outcome)
    )
      throw new Error(`Profile run ${index} outcome is invalid.`);
    const links = record(item.links, `Profile run ${index} links`);
    exactKeys(
      links,
      ["request", "run", "result"],
      `Profile run ${index} links`,
    );
    if (links.result !== null && typeof links.result !== "string")
      throw new Error(`Profile run ${index} result link is invalid.`);
    if ((projection === null) !== (links.result === null))
      throw new Error(`Profile run ${index} result link drifted.`);
    return {
      run_id: nonEmpty(item.run_id, `Profile run ${index} id`),
      request_id: nonEmpty(item.request_id, `Profile run ${index} request id`),
      canonical_request_version: natural(
        item.canonical_request_version,
        `Profile run ${index} version`,
      ),
      submitted_tier: submittedTier,
      state: nonEmpty(item.state, `Profile run ${index} state`),
      outcome: outcome as UserProfileRunV1["outcome"],
      queued_at: iso(item.queued_at, `Profile run ${index} queued at`),
      updated_at: iso(item.updated_at, `Profile run ${index} updated at`),
      result_available: item.result_available,
      result_projection: projection,
      links: {
        request: nonEmpty(links.request, `Profile run ${index} request link`),
        run: nonEmpty(links.run, `Profile run ${index} run link`),
        result:
          links.result === null
            ? null
            : nonEmpty(links.result, `Profile run ${index} result link`),
      },
    };
  });
  const page = record(root.page, "User profile page");
  exactKeys(page, ["limit", "has_more", "next_cursor"], "User profile page");
  if (
    typeof page.has_more !== "boolean" ||
    (page.next_cursor !== null && typeof page.next_cursor !== "string") ||
    page.has_more !== (page.next_cursor !== null)
  )
    throw new Error("User profile page is invalid.");
  return Object.freeze({
    schema_version: USER_PROFILE_HISTORY_SCHEMA_VERSION,
    current_tier: productTier(root.current_tier, "User profile current tier"),
    requests: Object.freeze(requests.map((item) => Object.freeze(item))),
    runs: Object.freeze(
      runs.map((item) =>
        Object.freeze({ ...item, links: Object.freeze(item.links) }),
      ),
    ),
    page: Object.freeze({
      limit: natural(page.limit, "User profile page limit"),
      has_more: page.has_more,
      next_cursor: page.next_cursor,
    }),
  });
}
