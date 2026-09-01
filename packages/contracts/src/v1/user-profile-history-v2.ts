import {
  parseUserProfileHistoryV1,
  type UserProfileHistoryV1,
  type UserProfileRequestV1,
} from "./user-profile-history.js";

export const USER_PROFILE_HISTORY_V2_SCHEMA_VERSION =
  "user-profile-history.v2" as const;

export interface UserProfileRequestV2 extends UserProfileRequestV1 {
  readonly product_group: string;
}

export interface UserProfileHistoryV2 extends Omit<
  UserProfileHistoryV1,
  "schema_version" | "requests"
> {
  readonly schema_version: typeof USER_PROFILE_HISTORY_V2_SCHEMA_VERSION;
  readonly requests: readonly UserProfileRequestV2[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} is invalid.`);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  )
    throw new Error(`${label} contains an unsupported field.`);
}

/**
 * Additive profile history contract. V1 stays immutable; V2 adds only the
 * server-owned product-group label used by the first visual disclosure layer.
 */
export function parseUserProfileHistoryV2(
  value: unknown,
): UserProfileHistoryV2 {
  const root = record(value, "User profile history v2");
  exactKeys(
    root,
    ["schema_version", "current_tier", "requests", "runs", "page"],
    "User profile history v2",
  );
  if (root.schema_version !== USER_PROFILE_HISTORY_V2_SCHEMA_VERSION)
    throw new Error("User profile history v2 schema version is invalid.");
  if (!Array.isArray(root.requests))
    throw new Error("User profile history v2 requests are invalid.");
  const productGroups = root.requests.map((entry, index) => {
    const request = record(entry, `Profile v2 request ${index}`);
    exactKeys(
      request,
      [
        "request_id",
        "canonical_request_version",
        "canonical_summary",
        "product_group",
        "lifecycle_state",
        "created_at",
        "updated_at",
        "run_count",
      ],
      `Profile v2 request ${index}`,
    );
    if (
      typeof request.product_group !== "string" ||
      request.product_group.trim().length === 0 ||
      request.product_group.length > 120
    )
      throw new Error(`Profile v2 request ${index} product group is invalid.`);
    return request.product_group;
  });
  const v1 = parseUserProfileHistoryV1({
    ...root,
    schema_version: "user-profile-history.v1",
    requests: root.requests.map((entry) => {
      const { product_group: _productGroup, ...request } = entry as Record<
        string,
        unknown
      >;
      return request;
    }),
  });
  return Object.freeze({
    ...v1,
    schema_version: USER_PROFILE_HISTORY_V2_SCHEMA_VERSION,
    requests: Object.freeze(
      v1.requests.map((request, index) =>
        Object.freeze({
          ...request,
          product_group: productGroups[index]!,
        }),
      ),
    ),
  });
}
