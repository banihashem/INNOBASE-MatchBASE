import {
  COMPLETE_RESULT_FOUNDATION_SCHEMA_VERSION,
  COMPLETE_RESULT_FOUNDATION_V2_SCHEMA_VERSION,
  CONSULTANT_UNAVAILABLE_SOURCES,
  DEMO_LOW_CONFIDENCE_CAUTION_TEXT,
  DEMO_RATIONALE_TEXT_BY_RULE_OUTCOME,
  type CompleteResultEvidenceV2,
  type CompleteResultFoundationV1,
  type CompleteResultFoundationV2,
  type LiveExternalVerificationBasisV2,
  type StandardEvidenceGraphV1,
  type StandardEvidenceItemV1,
  type TrustedLiveFetchRecordV2,
} from "@matchbase/contracts";
import {
  standardContentSha256,
  validateStandardEvidenceGraph,
} from "../evidence/standard.js";
import { validateCompleteResultFoundation } from "./foundation.js";

export const UNUSED_LIVE_SOURCE_EXCLUSION_REASON =
  "Fetched source was not used by any result claim or evidenced value." as const;

export type CompleteResultFoundationV2Source = Omit<
  StandardEvidenceGraphV1,
  "schema_version" | "evidence"
> & {
  readonly schema_version:
    "standard-evidence-graph.v1" | "complete-result-foundation.v2";
  readonly evidence: readonly CompleteResultEvidenceV2[];
};

const V2_KEYS = [
  "schema_version",
  "run_id",
  "candidates",
  "claims",
  "evidence",
  "evidenced_values",
  "eligible_candidate_ids",
  "gate_evaluations",
  "unknown_count",
  "not_asked_count",
  "gate_evaluation_completed_at",
  "demo_rationale_sources",
  "demo_low_confidence_caution",
  "consultant_projection_readiness",
] as const;
const TRUSTED_LIVE_FETCH_RECORD_KEYS = [
  "evidence_id",
  "canonical_url",
  "publisher_domain",
  "retrieved_at",
  "content_sha256",
  "bounded_excerpt",
  "authority_class",
] as const;

declare const trustedLiveFetchLedgerBrand: unique symbol;
export type TrustedLiveFetchLedgerV2 = Readonly<{
  schema_version: "trusted-live-fetch-ledger.v2";
  record_count: number;
  [trustedLiveFetchLedgerBrand]: true;
}>;

const trustedLiveFetchLedgerRecords = new WeakMap<
  object,
  readonly TrustedLiveFetchRecordV2[]
>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: object,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value);
  const extra = actual.filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !actual.includes(key));
  if (extra.length || missing.length)
    throw new Error(
      `${label} has invalid fields (extra: ${extra.join(", ")}; missing: ${missing.join(", ")}).`,
    );
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value as Record<string, unknown>))
    deepFreeze(child);
  return Object.freeze(value);
}

function referencedEvidenceIds(
  source: CompleteResultFoundationV2Source,
): Set<string> {
  return new Set([
    ...source.claims.flatMap((claim) => [
      ...claim.evidence_ids,
      ...claim.corroboration.independent_evidence_ids,
    ]),
    ...source.evidenced_values.flatMap((value) => value.evidence_ids),
    ...source.evidence.flatMap((item) => {
      if (item.provenance !== "live_secure_fetch") return [];
      if (item.external_verification_basis.kind === "independent_corroboration")
        return [...item.external_verification_basis.independent_evidence_ids];
      if (item.external_verification_basis.kind === "authoritative_registry")
        return [item.external_verification_basis.registry_evidence_id];
      return [];
    }),
  ]);
}

function normalizeUnusedLiveSources(
  source: CompleteResultFoundationV2Source,
): CompleteResultEvidenceV2[] {
  const referenced = referencedEvidenceIds(source);
  return source.evidence.map((item) => {
    const copy = structuredClone(item) as CompleteResultEvidenceV2;
    if (
      copy.provenance !== "live_secure_fetch" ||
      referenced.has(copy.evidence_id)
    )
      return copy;
    if (
      copy.verification_disposition === "excluded" &&
      copy.exclusion_reason.trim()
    )
      return copy;
    return {
      ...copy,
      verification_disposition: "excluded",
      exclusion_reason: UNUSED_LIVE_SOURCE_EXCLUSION_REASON,
    } as CompleteResultEvidenceV2;
  });
}

export function standardEvidenceGraphFromCompleteResultFoundationV2(
  source: CompleteResultFoundationV2Source | CompleteResultFoundationV2,
): StandardEvidenceGraphV1 {
  return {
    schema_version: "standard-evidence-graph.v1",
    run_id: source.run_id,
    candidates: structuredClone([...source.candidates]),
    claims: structuredClone([...source.claims]),
    evidence: source.evidence.map((item) => {
      const copy = structuredClone(item) as unknown as Record<string, unknown>;
      delete copy.external_verification_basis;
      return {
        ...copy,
        provenance:
          item.provenance === "live_secure_fetch"
            ? "repository_fixture"
            : item.provenance,
        content_sha256:
          item.provenance === "live_secure_fetch"
            ? standardContentSha256(item.extract)
            : item.content_sha256,
      } as StandardEvidenceItemV1;
    }),
    evidenced_values: structuredClone([...source.evidenced_values]),
    eligible_candidate_ids: [...source.eligible_candidate_ids],
    gate_evaluations: structuredClone([...source.gate_evaluations]),
    unknown_count: source.unknown_count,
    not_asked_count: source.not_asked_count,
    gate_evaluation_completed_at: source.gate_evaluation_completed_at,
  };
}

function canonicalTimestamp(value: string): boolean {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function trustedLiveFetchRecordsById(
  records: readonly TrustedLiveFetchRecordV2[],
): ReadonlyMap<string, TrustedLiveFetchRecordV2> {
  const byId = new Map<string, TrustedLiveFetchRecordV2>();
  const tuples = new Set<string>();
  for (const record of records) {
    if (!isRecord(record))
      throw new Error("Trusted live fetch record must be an object.");
    exactKeys(
      record,
      TRUSTED_LIVE_FETCH_RECORD_KEYS,
      "Trusted live fetch record",
    );
    let url: URL;
    try {
      url = new URL(record.canonical_url);
    } catch {
      throw new Error("Trusted live fetch record URL is invalid.");
    }
    if (
      !record.evidence_id.trim() ||
      byId.has(record.evidence_id) ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.href !== record.canonical_url ||
      record.publisher_domain !== url.hostname ||
      !canonicalTimestamp(record.retrieved_at) ||
      !/^[a-f0-9]{64}$/u.test(record.content_sha256) ||
      !record.bounded_excerpt.trim() ||
      record.bounded_excerpt.length > 600 ||
      !["ordinary_source", "authoritative_registry"].includes(
        record.authority_class,
      )
    )
      throw new Error("Trusted live fetch record is invalid.");
    const tuple = JSON.stringify([
      record.canonical_url,
      record.publisher_domain,
      record.retrieved_at,
      record.content_sha256,
      record.bounded_excerpt,
    ]);
    if (tuples.has(tuple))
      throw new Error(
        "Trusted live fetch tuple cannot have multiple evidence IDs.",
      );
    tuples.add(tuple);
    byId.set(record.evidence_id, record);
  }
  return byId;
}

export function sealTrustedLiveFetchLedgerV2(
  records: readonly TrustedLiveFetchRecordV2[],
): TrustedLiveFetchLedgerV2 {
  trustedLiveFetchRecordsById(records);
  const sealedRecords = deepFreeze(structuredClone(records));
  const ledger = Object.freeze({
    schema_version: "trusted-live-fetch-ledger.v2" as const,
    record_count: sealedRecords.length,
  }) as TrustedLiveFetchLedgerV2;
  trustedLiveFetchLedgerRecords.set(ledger, sealedRecords);
  return ledger;
}

function recordsFromTrustedLedger(
  ledger: TrustedLiveFetchLedgerV2 | undefined,
): readonly TrustedLiveFetchRecordV2[] {
  if (ledger === undefined) return [];
  const records = trustedLiveFetchLedgerRecords.get(ledger);
  if (!records)
    throw new Error("Trusted live fetch ledger is not server-sealed.");
  return records;
}

function assertVerificationBasisShape(
  basis: unknown,
): asserts basis is LiveExternalVerificationBasisV2 {
  if (!isRecord(basis))
    throw new Error("Live evidence external verification basis is invalid.");
  if (basis.kind === "not_externally_verified") {
    exactKeys(basis, ["kind"], "Live evidence external verification basis");
    return;
  }
  if (basis.kind === "independent_corroboration") {
    exactKeys(
      basis,
      ["kind", "independent_evidence_ids"],
      "Live evidence external verification basis",
    );
    if (
      !Array.isArray(basis.independent_evidence_ids) ||
      basis.independent_evidence_ids.length < 2 ||
      basis.independent_evidence_ids.some(
        (id) => typeof id !== "string" || !id.trim(),
      ) ||
      new Set(basis.independent_evidence_ids).size !==
        basis.independent_evidence_ids.length
    )
      throw new Error("Live evidence independent corroboration is invalid.");
    return;
  }
  if (basis.kind === "authoritative_registry") {
    exactKeys(
      basis,
      ["kind", "registry_evidence_id"],
      "Live evidence external verification basis",
    );
    if (
      typeof basis.registry_evidence_id !== "string" ||
      !basis.registry_evidence_id.trim()
    )
      throw new Error("Live evidence authoritative registry basis is invalid.");
    return;
  }
  throw new Error("Live evidence external verification basis is invalid.");
}

function assertLiveEvidence(
  item: CompleteResultEvidenceV2,
  trustedById: ReadonlyMap<string, TrustedLiveFetchRecordV2>,
): void {
  if (item.provenance !== "live_secure_fetch") return;
  const evidenceId = item.evidence_id;
  if (item.source_kind !== "reserved_url" || !("exact_url" in item))
    throw new Error(
      `Live evidence ${evidenceId} requires an exact reserved URL.`,
    );
  let url: URL;
  try {
    url = new URL(item.exact_url);
  } catch {
    throw new Error(`Live evidence ${item.evidence_id} URL is invalid.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.href !== item.exact_url
  )
    throw new Error(
      `Live evidence ${item.evidence_id} URL is not canonical HTTPS.`,
    );
  if (item.publisher_domain !== url.hostname)
    throw new Error(
      `Live evidence ${item.evidence_id} domain is not server-derived from its URL.`,
    );
  if (!canonicalTimestamp(item.accessed_at))
    throw new Error(
      `Live evidence ${item.evidence_id} retrieval timestamp is not canonical RFC3339.`,
    );
  if (!/^[a-f0-9]{64}$/u.test(item.content_sha256))
    throw new Error(
      `Live evidence ${item.evidence_id} content hash is invalid.`,
    );
  if (!item.evidence_id.trim() || !item.extract.trim())
    throw new Error(
      "Live evidence server-owned tuple contains an empty field.",
    );
  assertVerificationBasisShape(item.external_verification_basis);
  const trusted = trustedById.get(item.evidence_id);
  if (
    !trusted ||
    trusted.canonical_url !== item.exact_url ||
    trusted.publisher_domain !== item.publisher_domain ||
    trusted.retrieved_at !== item.accessed_at ||
    trusted.content_sha256 !== item.content_sha256 ||
    trusted.bounded_excerpt !== item.extract
  )
    throw new Error(
      `Live evidence ${item.evidence_id} is not bound to its trusted fetch record.`,
    );
}

function assertExternalVerification(
  document: CompleteResultFoundationV2,
  trustedById: ReadonlyMap<string, TrustedLiveFetchRecordV2>,
): void {
  void trustedById;
  for (const item of document.evidence) {
    if (item.provenance !== "live_secure_fetch") continue;
    const basis = item.external_verification_basis;
    if (item.verification_status !== "externally_verified") {
      if (basis.kind !== "not_externally_verified")
        throw new Error(
          `Live evidence ${item.evidence_id} has an inapplicable external verification basis.`,
        );
      continue;
    }
    throw new Error(
      `Live evidence ${item.evidence_id} cannot be externally verified until a trusted server claim-support registry is available.`,
    );
  }
}

function assertDerivedDemoFields(value: CompleteResultFoundationV2): void {
  if (value.demo_rationale_sources.length !== value.candidates.length)
    throw new Error(
      "Demo rationale sources must cover every candidate exactly once.",
    );
  value.demo_rationale_sources.forEach((source, index) => {
    if (!isRecord(source))
      throw new Error("Demo rationale source must be an object.");
    exactKeys(
      source,
      ["candidate_id", "rule_outcome", "rationale_short"],
      "Demo rationale source",
    );
    const candidate = value.candidates[index];
    if (!candidate || source.candidate_id !== candidate.candidate_id)
      throw new Error(
        "Demo rationale source order or candidate mapping is invalid.",
      );
    const expectedOutcome = candidate.mandatory_constraints_satisfied
      ? "mandatory_rules_satisfied"
      : "mandatory_rules_not_satisfied";
    if (
      source.rule_outcome !== expectedOutcome ||
      source.rationale_short !==
        DEMO_RATIONALE_TEXT_BY_RULE_OUTCOME[expectedOutcome]
    )
      throw new Error(
        "Demo rationale source is not mapped to a closed rule outcome.",
      );
  });
  const caution = value.demo_low_confidence_caution;
  if (!isRecord(caution))
    throw new Error(
      "Demo low-confidence caution must be one top-level object.",
    );
  exactKeys(caution, ["state", "text"], "Demo low-confidence caution");
  const low = value.candidates
    .filter((candidate) =>
      value.eligible_candidate_ids.includes(candidate.candidate_id),
    )
    .some(
      (candidate) =>
        candidate.evidence_confidence === "low" ||
        candidate.dimensions.some(
          (dimension) => dimension.confidence === "low",
        ),
    );
  const valid = low
    ? caution.state === "present" &&
      caution.text === DEMO_LOW_CONFIDENCE_CAUTION_TEXT
    : caution.state === "not_required" && caution.text === "";
  if (!valid) throw new Error("Demo low-confidence caution is invalid.");
}

export function buildCompleteResultFoundationV2(
  graph: CompleteResultFoundationV2Source,
  trustedLiveFetchLedger?: TrustedLiveFetchLedgerV2,
): CompleteResultFoundationV2 {
  const source = structuredClone(graph) as CompleteResultFoundationV2Source;
  const evidence = normalizeUnusedLiveSources(source);
  const normalized = { ...source, evidence };
  validateStandardEvidenceGraph(
    standardEvidenceGraphFromCompleteResultFoundationV2(normalized),
  );
  const trustedLiveFetchRecords = recordsFromTrustedLedger(
    trustedLiveFetchLedger,
  );
  const trustedById = trustedLiveFetchRecordsById(trustedLiveFetchRecords);
  evidence.forEach((item) => assertLiveEvidence(item, trustedById));
  if (
    trustedById.size !==
    evidence.filter((item) => item.provenance === "live_secure_fetch").length
  )
    throw new Error(
      "Every trusted live fetch record must be retained as live evidence.",
    );
  const low = normalized.candidates
    .filter((candidate) =>
      normalized.eligible_candidate_ids.includes(candidate.candidate_id),
    )
    .some(
      (candidate) =>
        candidate.evidence_confidence === "low" ||
        candidate.dimensions.some(
          (dimension) => dimension.confidence === "low",
        ),
    );
  const result: CompleteResultFoundationV2 = {
    ...normalized,
    schema_version: COMPLETE_RESULT_FOUNDATION_V2_SCHEMA_VERSION,
    demo_rationale_sources: normalized.candidates.map((candidate) =>
      candidate.mandatory_constraints_satisfied
        ? {
            candidate_id: candidate.candidate_id,
            rule_outcome: "mandatory_rules_satisfied",
            rationale_short:
              DEMO_RATIONALE_TEXT_BY_RULE_OUTCOME.mandatory_rules_satisfied,
          }
        : {
            candidate_id: candidate.candidate_id,
            rule_outcome: "mandatory_rules_not_satisfied",
            rationale_short:
              DEMO_RATIONALE_TEXT_BY_RULE_OUTCOME.mandatory_rules_not_satisfied,
          },
    ),
    demo_low_confidence_caution: low
      ? { state: "present", text: DEMO_LOW_CONFIDENCE_CAUTION_TEXT }
      : { state: "not_required", text: "" },
    consultant_projection_readiness: {
      outcome: "blocked",
      missing_sources: structuredClone(CONSULTANT_UNAVAILABLE_SOURCES),
    },
  };
  validateCompleteResultFoundationV2(result, trustedLiveFetchLedger);
  return deepFreeze(result);
}

export function validateCompleteResultFoundationV2(
  value: unknown,
  trustedLiveFetchLedger?: TrustedLiveFetchLedgerV2,
): asserts value is CompleteResultFoundationV2 {
  if (!isRecord(value))
    throw new Error("Complete-result foundation v2 must be an object.");
  exactKeys(value, V2_KEYS, "Complete-result foundation v2");
  if (value.schema_version !== COMPLETE_RESULT_FOUNDATION_V2_SCHEMA_VERSION)
    throw new Error("Complete-result foundation v2 schema version is invalid.");
  const document = value as unknown as CompleteResultFoundationV2;
  const v1Compatibility = structuredClone(document) as unknown as Record<
    string,
    unknown
  >;
  delete v1Compatibility.demo_rationale_sources;
  delete v1Compatibility.demo_low_confidence_caution;
  v1Compatibility.schema_version = COMPLETE_RESULT_FOUNDATION_SCHEMA_VERSION;
  const sourceView = document as unknown as CompleteResultFoundationV2Source;
  v1Compatibility.evidence =
    standardEvidenceGraphFromCompleteResultFoundationV2(sourceView).evidence;
  validateCompleteResultFoundation(v1Compatibility);
  const trustedLiveFetchRecords = recordsFromTrustedLedger(
    trustedLiveFetchLedger,
  );
  const trustedById = trustedLiveFetchRecordsById(trustedLiveFetchRecords);
  document.evidence.forEach((item) => assertLiveEvidence(item, trustedById));
  if (
    trustedById.size !==
    document.evidence.filter((item) => item.provenance === "live_secure_fetch")
      .length
  )
    throw new Error(
      "Every trusted live fetch record must be retained as live evidence.",
    );
  assertExternalVerification(document, trustedById);
  const referenced = referencedEvidenceIds(sourceView);
  for (const item of document.evidence)
    if (
      item.provenance === "live_secure_fetch" &&
      !referenced.has(item.evidence_id) &&
      (item.verification_disposition !== "excluded" ||
        !item.exclusion_reason.trim())
    )
      throw new Error(
        `Unused live evidence ${item.evidence_id} must be retained as excluded with a reason.`,
      );
  assertDerivedDemoFields(document);
}

export type StoredCompleteResultDocument =
  | {
      readonly kind: "foundation_v2";
      readonly document: CompleteResultFoundationV2;
    }
  | {
      readonly kind: "foundation_v1";
      readonly document: CompleteResultFoundationV1;
    }
  | {
      readonly kind: "legacy_standard_evidence_graph_v1";
      readonly document: StandardEvidenceGraphV1;
    };

export function readStoredCompleteResultDocumentWithoutRewrite(
  value: unknown,
  trustedLiveFetchLedger?: TrustedLiveFetchLedgerV2,
): StoredCompleteResultDocument {
  if (!isRecord(value))
    throw new Error("Stored complete result must be an object.");
  const copy = structuredClone(value);
  if (value.schema_version === COMPLETE_RESULT_FOUNDATION_V2_SCHEMA_VERSION) {
    validateCompleteResultFoundationV2(copy, trustedLiveFetchLedger);
    return deepFreeze({ kind: "foundation_v2", document: copy });
  }
  if (value.schema_version === COMPLETE_RESULT_FOUNDATION_SCHEMA_VERSION) {
    validateCompleteResultFoundation(copy);
    return deepFreeze({ kind: "foundation_v1", document: copy });
  }
  if (value.schema_version === "standard-evidence-graph.v1") {
    validateStandardEvidenceGraph(copy as unknown as StandardEvidenceGraphV1);
    return deepFreeze({
      kind: "legacy_standard_evidence_graph_v1",
      document: copy as unknown as StandardEvidenceGraphV1,
    });
  }
  throw new Error("Stored complete result schema version is unsupported.");
}
