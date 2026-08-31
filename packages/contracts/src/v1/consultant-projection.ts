import type { StandardResultProjectionV1 } from "./standard-projection.js";
import {
  STANDARD_DIMENSIONS,
  STANDARD_ORGANIZATION_WEB_POLICY_VERSION,
  STANDARD_ORGANIZATION_WEB_PURPOSES,
} from "./standard-evidence.js";

export const CONSULTANT_RESULT_PROJECTION_SCHEMA_VERSION =
  "consultant-result-projection.v1" as const;
export const CONSULTANT_RESULT_PROJECTION_VERSION = 5 as const;
export const CONSULTANT_RUN_HISTORY_SCHEMA_VERSION =
  "consultant-run-history.v1" as const;

export interface ConsultantRunHistoryItemV1 {
  readonly run_id: string;
  readonly request_id: string;
  readonly state:
    "queued" | "running" | "completed" | "failed" | "cancelled" | "superseded";
  readonly updated_at: string;
  readonly result_available: boolean;
  readonly outcome:
    | "pending"
    | "matched"
    | "no_responsible_match"
    | "failed"
    | "cancelled"
    | "superseded";
}

export interface ConsultantRunHistoryV1 {
  readonly schema_version: typeof CONSULTANT_RUN_HISTORY_SCHEMA_VERSION;
  readonly items: readonly ConsultantRunHistoryItemV1[];
}

export interface ConsultantLandscapeV1 {
  readonly eligible_count: number;
  readonly displayed_count: number;
  readonly soft_cap: number;
  readonly truncated: boolean;
  readonly scarcity_override_applied: boolean;
  readonly truncation_notice?: string;
}

export interface ConsultantResultProjectionV1 extends Omit<
  StandardResultProjectionV1,
  "schema_version" | "projection_version"
> {
  readonly schema_version: typeof CONSULTANT_RESULT_PROJECTION_SCHEMA_VERSION;
  readonly landscape: ConsultantLandscapeV1;
  readonly consultant_source_readiness: {
    readonly state: "limited";
    readonly notice: string;
  };
  readonly projection_version: typeof CONSULTANT_RESULT_PROJECTION_VERSION;
}

const TOP_LEVEL_KEYS = [
  "schema_version",
  "run_id",
  "outcome",
  "scarcity",
  "candidates",
  "gate_eliminations",
  "scarcity_analysis",
  "limitations",
  "synthetic_warning",
  "landscape",
  "consultant_source_readiness",
  "projection_version",
] as const;

const CANDIDATE_KEYS = [
  "display_name",
  "country_code",
  "rationale_extended",
  "compatibility_score",
  "fit_band",
  "band_ceiling",
  "displayed_band",
  "band_ceiling_reason",
  "dimension_scores",
  "positive_drivers",
  "limiting_gaps",
  "citations",
  "freshness",
  "verification_status",
  "evidence_confidence",
  "contact_details",
  "plant_identifiers",
  "approval_identifiers",
  "capacity_figures",
] as const;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value);
  if (
    keys.some((key) => !allowed.includes(key)) ||
    required.some((key) => !keys.includes(key))
  )
    throw new Error(`${label} is not closed.`);
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function string(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
}

function nonemptyString(
  value: unknown,
  label: string,
): asserts value is string {
  string(value, label);
  if (!value.trim()) throw new Error(`${label} must not be empty.`);
}

function member(
  value: unknown,
  allowed: readonly string[],
  label: string,
): asserts value is string {
  string(value, label);
  if (!allowed.includes(value)) throw new Error(`${label} is invalid.`);
}

function boolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean")
    throw new Error(`${label} must be a boolean.`);
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${label} must be a finite number.`);
  if (value < minimum || value > maximum)
    throw new Error(`${label} is outside its allowed bounds.`);
  return value;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const parsed = boundedNumber(value, minimum, maximum, label);
  if (!Number.isSafeInteger(parsed))
    throw new Error(`${label} must be an integer.`);
  return parsed;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error(`${label} must be a non-negative integer.`);
  return Number(value);
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = nonnegativeInteger(value, label);
  if (parsed < 1) throw new Error(`${label} must be positive.`);
  return parsed;
}

function assertExplanation(value: unknown): void {
  const item = record(value, "Consultant explanation");
  exactKeys(
    item,
    ["dimension_id", "explanation", "claim_id", "evidence_ids"],
    ["dimension_id", "explanation", "claim_id", "evidence_ids"],
    "Consultant explanation",
  );
  string(item.dimension_id, "Consultant explanation dimension");
  string(item.explanation, "Consultant explanation text");
  string(item.claim_id, "Consultant explanation claim");
  array(item.evidence_ids, "Consultant explanation evidence").forEach((id) =>
    string(id, "Consultant explanation evidence id"),
  );
}

function assertCitation(value: unknown): void {
  const item = record(value, "Consultant citation");
  const required = [
    "evidence_id",
    "title",
    "publisher",
    "published_or_updated",
    "accessed_at",
    "source_tier",
    "status",
    "access_state",
    "extract",
    "content_sha256",
    "provenance",
  ];
  exactKeys(
    item,
    [...required, "exact_url", "fixture_identity"],
    required,
    "Consultant citation",
  );
  if ("exact_url" in item === "fixture_identity" in item)
    throw new Error("Consultant citation locator is invalid.");
  if ("exact_url" in item) {
    nonemptyString(item.exact_url, "Consultant citation exact URL");
    let url: URL;
    try {
      url = new URL(item.exact_url);
    } catch {
      throw new Error("Consultant citation exact URL is invalid.");
    }
    if (url.protocol !== "https:")
      throw new Error("Consultant citation exact URL must use HTTPS.");
  }
  if ("fixture_identity" in item)
    nonemptyString(
      item.fixture_identity,
      "Consultant citation fixture identity",
    );
  for (const key of required) string(item[key], `Consultant citation ${key}`);
  member(
    item.source_tier,
    ["primary", "official_secondary", "secondary"],
    "Consultant citation source tier",
  );
  member(
    item.status,
    [
      "claimed",
      "externally_verified",
      "inferred",
      "stale",
      "conflicting",
      "unknown",
    ],
    "Consultant citation status",
  );
  member(
    item.access_state,
    ["available", "blocked", "unreachable"],
    "Consultant citation access state",
  );
  member(
    item.provenance,
    ["synthetic_fixture", "repository_fixture", "live_secure_fetch"],
    "Consultant citation provenance",
  );
  if (item.provenance === "live_secure_fetch" && !("exact_url" in item))
    throw new Error("Live Consultant citation must use an exact URL.");
}

function assertProjectedValue(value: unknown): void {
  const item = record(value, "Consultant evidenced value");
  member(
    item.kind,
    ["organization_contact", "plant", "approval", "capacity"],
    "Consultant evidenced value kind",
  );
  const common = ["kind", "value", "verification_status", "evidence_ids"];
  const contact = ["channel_type", "organization_domain"];
  const web = [
    "organization_web_policy_version",
    "organization_web_purpose",
    "organization_web_form",
  ];
  const allowed =
    item.kind === "organization_contact"
      ? item.channel_type === "organization_web"
        ? [...common, ...contact, ...web]
        : [...common, ...contact]
      : common;
  const required =
    item.kind === "organization_contact"
      ? item.channel_type === "organization_web"
        ? [...common, ...contact, ...web]
        : [...common, ...contact]
      : common;
  exactKeys(item, allowed, required, "Consultant evidenced value");
  string(item.value, "Consultant evidenced value");
  member(
    item.verification_status,
    [
      "claimed",
      "externally_verified",
      "inferred",
      "stale",
      "conflicting",
      "unknown",
    ],
    "Consultant evidenced value status",
  );
  if (item.kind === "organization_contact") {
    member(
      item.channel_type,
      ["role_email", "organization_phone", "organization_web"],
      "Consultant contact channel",
    );
    string(item.organization_domain, "Consultant organization domain");
    if (item.channel_type === "organization_web") {
      string(
        item.organization_web_policy_version,
        "Consultant organization web policy version",
      );
      if (
        item.organization_web_policy_version !==
        STANDARD_ORGANIZATION_WEB_POLICY_VERSION
      )
        throw new Error("Consultant organization web policy is invalid.");
      member(
        item.organization_web_purpose,
        ["organization_root", ...STANDARD_ORGANIZATION_WEB_PURPOSES],
        "Consultant organization web purpose",
      );
      member(
        item.organization_web_form,
        ["root", "role_path", "role_subdomain", "contact_role_path"],
        "Consultant organization web form",
      );
    }
  }
  array(item.evidence_ids, "Consultant evidenced value evidence").forEach(
    (id) => string(id, "Consultant evidenced value evidence id"),
  );
}

function assertCandidate(value: unknown): void {
  const candidate = record(value, "Consultant candidate");
  const required = CANDIDATE_KEYS.filter(
    (key) =>
      ![
        "band_ceiling_reason",
        "contact_details",
        "plant_identifiers",
        "approval_identifiers",
        "capacity_figures",
      ].includes(key),
  );
  exactKeys(candidate, CANDIDATE_KEYS, required, "Consultant candidate");
  for (const key of [
    "display_name",
    "country_code",
    "rationale_extended",
    "fit_band",
    "band_ceiling",
    "displayed_band",
    "freshness",
    "verification_status",
    "evidence_confidence",
  ])
    string(candidate[key], `Consultant candidate ${key}`);
  boundedInteger(candidate.compatibility_score, 0, 100, "Consultant score");
  member(
    candidate.fit_band,
    ["strong_fit", "potential_fit", "low_fit"],
    "Consultant fit band",
  );
  member(
    candidate.band_ceiling,
    ["strong_fit", "potential_fit", "low_fit"],
    "Consultant band ceiling",
  );
  member(
    candidate.displayed_band,
    ["strong_fit", "potential_fit", "low_fit"],
    "Consultant displayed band",
  );
  member(
    candidate.freshness,
    ["current", "stale", "mixed"],
    "Consultant freshness",
  );
  member(
    candidate.verification_status,
    [
      "claimed",
      "externally_verified",
      "inferred",
      "stale",
      "conflicting",
      "unknown",
    ],
    "Consultant verification status",
  );
  member(
    candidate.evidence_confidence,
    ["high", "medium", "low"],
    "Consultant evidence confidence",
  );
  if ("band_ceiling_reason" in candidate)
    nonemptyString(
      candidate.band_ceiling_reason,
      "Consultant band ceiling reason",
    );
  const dimensions = array(candidate.dimension_scores, "Consultant dimensions");
  if (dimensions.length !== 6)
    throw new Error("Consultant dimensions must contain exactly six items.");
  for (const [index, dimensionValue] of dimensions.entries()) {
    const dimension = record(dimensionValue, "Consultant dimension");
    exactKeys(
      dimension,
      ["dimension_id", "weight", "score", "confidence"],
      ["dimension_id", "weight", "score", "confidence"],
      "Consultant dimension",
    );
    string(dimension.dimension_id, "Consultant dimension id");
    const expected = STANDARD_DIMENSIONS[index]!;
    if (
      dimension.dimension_id !== expected.dimension_id ||
      dimension.weight !== expected.weight
    )
      throw new Error("Consultant dimension tuple is invalid.");
    boundedInteger(dimension.score, 0, 100, "Consultant dimension score");
    member(
      dimension.confidence,
      ["high", "medium", "low"],
      "Consultant dimension confidence",
    );
  }
  const drivers = array(
    candidate.positive_drivers,
    "Consultant positive drivers",
  );
  const gaps = array(candidate.limiting_gaps, "Consultant limiting gaps");
  if (drivers.length > 3 || gaps.length > 3)
    throw new Error("Consultant explanations exceed the disclosure cap.");
  drivers.forEach(assertExplanation);
  gaps.forEach(assertExplanation);
  array(candidate.citations, "Consultant citations").forEach(assertCitation);
  for (const key of [
    "contact_details",
    "plant_identifiers",
    "approval_identifiers",
    "capacity_figures",
  ])
    if (key in candidate)
      array(candidate[key], `Consultant ${key}`).forEach(assertProjectedValue);
}

function assertScarcity(value: unknown): void {
  const scarcity = record(value, "Consultant scarcity analysis");
  exactKeys(
    scarcity,
    [
      "reducing_constraints",
      "unmet_mandatory_constraints",
      "permitted_relaxations",
    ],
    [
      "reducing_constraints",
      "unmet_mandatory_constraints",
      "permitted_relaxations",
    ],
    "Consultant scarcity analysis",
  );
  const itemKeys = {
    reducing_constraints: [
      "constraint_id",
      "field_id",
      "label",
      "eliminated_count",
    ],
    unmet_mandatory_constraints: ["constraint_id", "field_id", "label"],
    permitted_relaxations: [
      "constraint_id",
      "field_id",
      "label",
      "direction",
      "tolerance",
    ],
  } as const;
  for (const [key, keys] of Object.entries(itemKeys))
    array(scarcity[key], `Consultant scarcity ${key}`).forEach((entry) => {
      const item = record(entry, `Consultant scarcity ${key} item`);
      exactKeys(item, keys, keys, `Consultant scarcity ${key} item`);
      for (const field of keys)
        if (field === "eliminated_count")
          positiveInteger(item[field], `Consultant scarcity ${key} count`);
        else string(item[field], `Consultant scarcity ${key} ${field}`);
      if (
        key === "permitted_relaxations" &&
        !["higher_is_acceptable", "lower_is_acceptable", "exact"].includes(
          item.direction as string,
        )
      )
        throw new Error("Consultant relaxation direction is invalid.");
    });
}

function assertLimitations(value: unknown): void {
  const limitations = record(value, "Consultant limitations");
  const required = [
    "unknown_count",
    "not_asked_count",
    "affected_low_confidence_dimensions",
    "evidence_states",
    "restricted_party_screening_notice",
    "advisory_boundary",
  ];
  exactKeys(
    limitations,
    [...required, "cap_notice"],
    required,
    "Consultant limitations",
  );
  nonnegativeInteger(limitations.unknown_count, "Consultant unknown count");
  nonnegativeInteger(limitations.not_asked_count, "Consultant not-asked count");
  array(
    limitations.affected_low_confidence_dimensions,
    "Consultant affected low-confidence dimensions",
  ).forEach((entry) =>
    string(entry, "Consultant affected low-confidence dimension"),
  );
  array(limitations.evidence_states, "Consultant evidence states").forEach(
    (entry) =>
      member(
        entry,
        [
          "claimed",
          "externally_verified",
          "inferred",
          "stale",
          "conflicting",
          "unknown",
        ],
        "Consultant evidence state",
      ),
  );
  for (const key of ["restricted_party_screening_notice", "advisory_boundary"])
    string(limitations[key], `Consultant limitations ${key}`);
  if ("cap_notice" in limitations)
    string(limitations.cap_notice, "Consultant limitations cap notice");
}

export function parseConsultantResultProjectionV1(
  value: unknown,
): ConsultantResultProjectionV1 {
  const projection = record(value, "Consultant result projection");
  exactKeys(
    projection,
    TOP_LEVEL_KEYS,
    TOP_LEVEL_KEYS,
    "Consultant result projection",
  );
  if (
    projection.schema_version !== CONSULTANT_RESULT_PROJECTION_SCHEMA_VERSION ||
    projection.projection_version !== CONSULTANT_RESULT_PROJECTION_VERSION
  )
    throw new Error("Consultant result projection version is invalid.");
  string(projection.run_id, "Consultant run id");
  member(
    projection.outcome,
    ["matched", "no_responsible_match"],
    "Consultant outcome",
  );
  member(
    projection.scarcity,
    ["none", "limited", "zero"],
    "Consultant scarcity",
  );
  const candidates = array(projection.candidates, "Consultant candidates");
  candidates.forEach(assertCandidate);
  array(projection.gate_eliminations, "Consultant gate eliminations").forEach(
    (value) => {
      const item = record(value, "Consultant gate elimination");
      exactKeys(
        item,
        ["gate_id", "label", "eliminated_count"],
        ["gate_id", "label", "eliminated_count"],
        "Consultant gate elimination",
      );
      string(item.gate_id, "Consultant gate id");
      string(item.label, "Consultant gate label");
      nonnegativeInteger(
        item.eliminated_count,
        "Consultant gate eliminated count",
      );
    },
  );
  assertScarcity(projection.scarcity_analysis);
  assertLimitations(projection.limitations);
  string(projection.synthetic_warning, "Consultant synthetic warning");
  const landscape = record(projection.landscape, "Consultant landscape");
  const landscapeRequired = [
    "eligible_count",
    "displayed_count",
    "soft_cap",
    "truncated",
    "scarcity_override_applied",
  ];
  exactKeys(
    landscape,
    [...landscapeRequired, "truncation_notice"],
    landscapeRequired,
    "Consultant landscape",
  );
  const eligible = nonnegativeInteger(
    landscape.eligible_count,
    "Consultant eligible count",
  );
  const displayed = nonnegativeInteger(
    landscape.displayed_count,
    "Consultant displayed count",
  );
  const softCap = nonnegativeInteger(landscape.soft_cap, "Consultant soft cap");
  boolean(landscape.truncated, "Consultant truncated state");
  boolean(
    landscape.scarcity_override_applied,
    "Consultant scarcity override state",
  );
  if (
    softCap < 3 ||
    displayed !== (projection.candidates as unknown[]).length ||
    displayed !== Math.min(eligible, softCap) ||
    landscape.truncated !== eligible > softCap ||
    landscape.scarcity_override_applied !== (eligible === 1 || eligible === 2)
  )
    throw new Error("Consultant landscape is inconsistent.");
  const expectedOutcome = eligible === 0 ? "no_responsible_match" : "matched";
  const expectedScarcity =
    eligible === 0 ? "zero" : eligible < 3 ? "limited" : "none";
  if (
    projection.outcome !== expectedOutcome ||
    projection.scarcity !== expectedScarcity
  )
    throw new Error("Consultant outcome or scarcity is inconsistent.");
  if (
    (landscape.truncated && !("truncation_notice" in landscape)) ||
    (!landscape.truncated && "truncation_notice" in landscape)
  )
    throw new Error("Consultant truncation notice is inconsistent.");
  if ("truncation_notice" in landscape)
    string(landscape.truncation_notice, "Consultant truncation notice");
  const readiness = record(
    projection.consultant_source_readiness,
    "Consultant source readiness",
  );
  exactKeys(
    readiness,
    ["state", "notice"],
    ["state", "notice"],
    "Consultant source readiness",
  );
  if (readiness.state !== "limited")
    throw new Error("Consultant source readiness is invalid.");
  nonemptyString(readiness.notice, "Consultant source readiness notice");
  return deepFreeze(structuredClone(value) as ConsultantResultProjectionV1);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseConsultantRunHistoryV1(
  value: unknown,
): ConsultantRunHistoryV1 {
  const history = record(value, "Consultant run history");
  exactKeys(
    history,
    ["schema_version", "items"],
    ["schema_version", "items"],
    "Consultant run history",
  );
  if (history.schema_version !== CONSULTANT_RUN_HISTORY_SCHEMA_VERSION)
    throw new Error("Consultant run history version is invalid.");
  array(history.items, "Consultant run history items").forEach((value) => {
    const item = record(value, "Consultant run history item");
    exactKeys(
      item,
      [
        "run_id",
        "request_id",
        "state",
        "updated_at",
        "result_available",
        "outcome",
      ],
      [
        "run_id",
        "request_id",
        "state",
        "updated_at",
        "result_available",
        "outcome",
      ],
      "Consultant run history item",
    );
    string(item.run_id, "Consultant history run id");
    string(item.request_id, "Consultant history request id");
    if (!UUID_PATTERN.test(item.run_id) || !UUID_PATTERN.test(item.request_id))
      throw new Error("Consultant run history identity is invalid.");
    member(
      item.state,
      ["queued", "running", "completed", "failed", "cancelled", "superseded"],
      "Consultant history state",
    );
    member(
      item.outcome,
      [
        "pending",
        "matched",
        "no_responsible_match",
        "failed",
        "cancelled",
        "superseded",
      ],
      "Consultant history outcome",
    );
    string(item.updated_at, "Consultant history update time");
    if (!Number.isFinite(Date.parse(item.updated_at)))
      throw new Error("Consultant run history update time is invalid.");
    boolean(item.result_available, "Consultant history result availability");
    const terminal = [
      "completed",
      "failed",
      "cancelled",
      "superseded",
    ].includes(String(item.state));
    if (
      (item.result_available && item.state !== "completed") ||
      (!terminal && item.outcome !== "pending") ||
      (item.state === "completed" &&
        !["matched", "no_responsible_match"].includes(String(item.outcome))) ||
      (["failed", "cancelled", "superseded"].includes(String(item.state)) &&
        item.outcome !== item.state)
    )
      throw new Error("Consultant run history state is inconsistent.");
  });
  return deepFreeze(structuredClone(value) as ConsultantRunHistoryV1);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
