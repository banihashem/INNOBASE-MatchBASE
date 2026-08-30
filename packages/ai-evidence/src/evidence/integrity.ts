import { createHash } from "node:crypto";
import type {
  CandidateV1,
  ClaimV1,
  EvidenceGraphV1,
  EvidenceItemV1,
} from "@matchbase/contracts";

const GRAPH_FIELDS = [
  "schemaVersion",
  "runId",
  "candidates",
  "claims",
  "evidence",
  "eligibleCandidateIds",
  "gateEvaluationCompletedAt",
] as const;
const CANDIDATE_FIELDS = [
  "candidateId",
  "displayName",
  "countryCode",
  "rationaleShort",
  "rationaleClaimIds",
  "compatibilityScore",
  "fitBand",
  "bandCeiling",
  "displayedBand",
  "dimensionScores",
  "citations",
  "verificationStatus",
  "mandatoryConstraintsSatisfied",
  "failedConstraintIds",
  "deterministicRankKey",
] as const;
const CLAIM_FIELDS = [
  "claimId",
  "candidateId",
  "text",
  "decisionBearing",
  "verificationStatus",
  "evidenceConfidence",
  "evidenceIds",
] as const;
const EVIDENCE_FIELDS = [
  "evidenceId",
  "sourceKind",
  "url",
  "title",
  "publisher",
  "publisherDomain",
  "retrievedAt",
  "contentSha256",
  "extract",
  "verificationDisposition",
  "exclusionReason",
] as const;
const RESTRICTED_PROVIDER_KEYS = new Set([
  "rawproviderpayload",
  "providerpayload",
  "providertopology",
  "provider",
  "providerid",
  "requestedproviderid",
  "servedproviderid",
  "model",
  "modelid",
  "requestedmodelid",
  "servedmodelid",
  "route",
  "routeid",
  "routesnapshot",
  "fallbackposition",
  "systemprompt",
  "chainofthought",
]);
const RESTRICTED_PROVIDER_TEXT =
  /raw[_ -]?provider[_ -]?payload|provider[_ -]?topology|(?:served|requested|expected)[_ -]?(?:provider|model)(?:[_ -]?id)?\s*[:=]|fallback[_ -]?position\s*[:=]|route[_ -]?id\s*[:=]|(?:system|developer)[_ -]?prompt\s*[:=]|chain[_ -]?of[_ -]?thought|(?:tool[_ -]?calls?|function[_ -]?call|prompt[_ -]?tokens?|completion[_ -]?tokens?|system[_ -]?fingerprint|usage)\s*["']?\s*[:=]/iu;
const VERIFICATION_STATUSES = new Set([
  "claimed",
  "externally_verified",
  "inferred",
  "stale",
  "conflicting",
  "unknown",
  "synthetic",
]);
const EVIDENCE_CONFIDENCE = new Set(["high", "medium", "low"]);
const SOURCE_KINDS = new Set([
  "synthetic_fixture",
  "reserved_url",
  "local_fixture",
  "external_url",
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a closed object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const fields = [...expected].sort();
  if (
    actual.length !== fields.length ||
    actual.some((field, index) => field !== fields[index])
  ) {
    throw new Error(`${label} contains unknown or missing fields.`);
  }
}

function decodeEntities(value: string): string {
  const namedEntities: Readonly<Record<string, string>> = {
    colon: ":",
    quot: '"',
    apos: "'",
    lbrace: "{",
    rbrace: "}",
    lbrack: "[",
    rbrack: "]",
  };
  return value.replace(
    /&#(?:x([0-9a-f]+)|(\d+));|&(colon|quot|apos|lbrace|rbrace|lbrack|rbrack);/giu,
    (
      match,
      hex: string | undefined,
      decimal: string | undefined,
      named: string | undefined,
    ) => {
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
      return namedEntities[named!.toLowerCase()] ?? match;
    },
  );
}

function restrictedTextVariants(value: string): readonly string[] {
  const variants = new Set<string>();
  let current = decodeEntities(value.normalize("NFKC"));
  for (let pass = 0; pass < 4; pass += 1) {
    variants.add(current);
    const decoded = decodeEntities(
      current.replace(/(?:%[0-9a-f]{2})+/giu, (encoded) => {
        try {
          return decodeURIComponent(encoded);
        } catch {
          return encoded.replace(/%([0-9a-f]{2})/giu, (_, octet: string) =>
            String.fromCharCode(Number.parseInt(octet, 16)),
          );
        }
      }),
    ).normalize("NFKC");
    if (decoded === current) break;
    current = decoded;
  }
  return [...variants];
}

function containsRestrictedProviderText(value: string): boolean {
  return restrictedTextVariants(value).some((variant) => {
    if (RESTRICTED_PROVIDER_TEXT.test(variant)) return true;
    const trimmed = variant.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return parsed !== null && typeof parsed === "object";
    } catch {
      return false;
    }
  });
}

export function assertNoRestrictedProviderMaterial(
  value: unknown,
  path = "$",
): void {
  if (typeof value === "string" && containsRestrictedProviderText(value)) {
    throw new Error(`Restricted provider material exists at ${path}.`);
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoRestrictedProviderMaterial(item, `${path}[${index}]`),
    );
    return;
  }
  for (const [field, nested] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const normalized = field.replace(/[^a-z0-9]/giu, "").toLowerCase();
    if (RESTRICTED_PROVIDER_KEYS.has(normalized)) {
      throw new Error(
        `Restricted provider material exists at ${path}.${field}.`,
      );
    }
    assertNoRestrictedProviderMaterial(nested, `${path}.${field}`);
  }
}

function validateClosedEvidenceGraphShape(
  value: unknown,
): asserts value is EvidenceGraphV1 {
  assertNoRestrictedProviderMaterial(value);
  const graph = record(value, "Evidence graph");
  exactKeys(graph, GRAPH_FIELDS, "Evidence graph");
  if (
    typeof graph.runId !== "string" ||
    !Array.isArray(graph.candidates) ||
    !Array.isArray(graph.claims) ||
    !Array.isArray(graph.evidence) ||
    !Array.isArray(graph.eligibleCandidateIds) ||
    typeof graph.gateEvaluationCompletedAt !== "string"
  ) {
    throw new Error("Evidence graph field types are invalid.");
  }
  for (const [index, candidateValue] of graph.candidates.entries()) {
    const candidate = record(candidateValue, `Candidate ${index}`);
    exactKeys(candidate, CANDIDATE_FIELDS, `Candidate ${index}`);
    for (const field of [
      "candidateId",
      "displayName",
      "countryCode",
      "rationaleShort",
      "fitBand",
      "bandCeiling",
      "displayedBand",
      "verificationStatus",
      "deterministicRankKey",
    ]) {
      if (typeof candidate[field] !== "string") {
        throw new Error(`Candidate ${index}.${field} is invalid.`);
      }
    }
    for (const field of [
      "rationaleClaimIds",
      "citations",
      "failedConstraintIds",
    ]) {
      if (
        !Array.isArray(candidate[field]) ||
        candidate[field].some((item) => typeof item !== "string")
      ) {
        throw new Error(`Candidate ${index}.${field} is invalid.`);
      }
    }
    const dimensions = record(
      candidate.dimensionScores,
      `Candidate ${index}.dimensionScores`,
    );
    if (Object.values(dimensions).some((score) => typeof score !== "number")) {
      throw new Error(`Candidate ${index}.dimensionScores is invalid.`);
    }
    if (
      typeof candidate.compatibilityScore !== "number" ||
      !Number.isFinite(candidate.compatibilityScore) ||
      typeof candidate.mandatoryConstraintsSatisfied !== "boolean" ||
      !VERIFICATION_STATUSES.has(String(candidate.verificationStatus))
    ) {
      throw new Error(`Candidate ${index} scalar fields are invalid.`);
    }
  }
  for (const [index, claimValue] of graph.claims.entries()) {
    const claim = record(claimValue, `Claim ${index}`);
    exactKeys(claim, CLAIM_FIELDS, `Claim ${index}`);
    if (
      ![
        "claimId",
        "candidateId",
        "text",
        "verificationStatus",
        "evidenceConfidence",
      ].every((field) => typeof claim[field] === "string") ||
      typeof claim.decisionBearing !== "boolean" ||
      !VERIFICATION_STATUSES.has(String(claim.verificationStatus)) ||
      !EVIDENCE_CONFIDENCE.has(String(claim.evidenceConfidence)) ||
      !Array.isArray(claim.evidenceIds) ||
      claim.evidenceIds.some((item) => typeof item !== "string")
    ) {
      throw new Error(`Claim ${index} field types are invalid.`);
    }
  }
  for (const [index, evidenceValue] of graph.evidence.entries()) {
    const evidence = record(evidenceValue, `Evidence ${index}`);
    exactKeys(evidence, EVIDENCE_FIELDS, `Evidence ${index}`);
    if (
      Object.values(evidence).some((item) => typeof item !== "string") ||
      !SOURCE_KINDS.has(String(evidence.sourceKind)) ||
      !new Set(["accepted", "excluded"]).has(
        String(evidence.verificationDisposition),
      )
    ) {
      throw new Error(`Evidence ${index} field types are invalid.`);
    }
    if (
      evidence.verificationDisposition === "excluded" &&
      !String(evidence.exclusionReason).trim()
    ) {
      throw new Error(
        `Evidence ${index} excluded disposition requires a non-empty reason.`,
      );
    }
  }
  if (graph.eligibleCandidateIds.some((item) => typeof item !== "string")) {
    throw new Error("Eligible candidate identifiers are invalid.");
  }
}

export function contentSha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function uniqueIds<T>(
  values: readonly T[],
  getId: (value: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = getId(value);
    if (!id || result.has(id))
      throw new Error(`${label} identifiers must be unique.`);
    result.set(id, value);
  }
  return result;
}

function acceptedEvidence(
  claim: ClaimV1,
  evidenceById: ReadonlyMap<string, EvidenceItemV1>,
): EvidenceItemV1[] {
  return claim.evidenceIds.map((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence)
      throw new Error(`Claim ${claim.claimId} has dangling evidence.`);
    return evidence;
  });
}

export function validateEvidenceGraph(
  graph: unknown,
): asserts graph is EvidenceGraphV1 {
  validateClosedEvidenceGraphShape(graph);
  if (graph.schemaVersion !== "evidence-graph.v1") {
    throw new Error("Evidence graph schema version is invalid.");
  }
  const candidates = uniqueIds(
    graph.candidates,
    (item) => item.candidateId,
    "Candidate",
  );
  const claims = uniqueIds(graph.claims, (item) => item.claimId, "Claim");
  const evidence = uniqueIds(
    graph.evidence,
    (item) => item.evidenceId,
    "Evidence",
  );

  for (const item of graph.evidence) {
    if (
      item.sourceKind !== "external_url" &&
      item.contentSha256 !== contentSha256(item.extract)
    ) {
      throw new Error(`Evidence ${item.evidenceId} content hash is invalid.`);
    }
    if (
      item.sourceKind === "external_url" &&
      (!item.url.startsWith("https://") ||
        !/^[a-f0-9]{64}$/u.test(item.contentSha256))
    ) {
      throw new Error(
        `Evidence ${item.evidenceId} external source is invalid.`,
      );
    }
    if (
      item.sourceKind === "synthetic_fixture" &&
      !(
        item.url.startsWith("fixture://") ||
        /^https:\/\/[^/]+\.example\.invalid(?:\/|$)/u.test(item.url)
      )
    ) {
      throw new Error(
        `Synthetic evidence ${item.evidenceId} uses a reachable URL shape.`,
      );
    }
  }
  for (const claim of graph.claims) {
    if (!candidates.has(claim.candidateId)) {
      throw new Error(`Claim ${claim.claimId} has a dangling candidate.`);
    }
    const linked = acceptedEvidence(claim, evidence);
    if (
      claim.decisionBearing &&
      !linked.some((item) => item.verificationDisposition === "accepted")
    ) {
      throw new Error(
        `Decision-bearing claim ${claim.claimId} lacks accepted evidence.`,
      );
    }
  }
  for (const candidate of graph.candidates) {
    const isEligible = graph.eligibleCandidateIds.includes(
      candidate.candidateId,
    );
    if (
      isEligible &&
      (!candidate.rationaleShort.trim() ||
        candidate.rationaleClaimIds.length === 0 ||
        candidate.citations.length === 0)
    ) {
      throw new Error(
        `Eligible candidate ${candidate.candidateId} requires non-empty rationale claims and citations.`,
      );
    }
    const rationaleEvidence = new Set<string>();
    for (const claimId of candidate.rationaleClaimIds) {
      const claim = claims.get(claimId);
      if (!claim || claim.candidateId !== candidate.candidateId) {
        throw new Error(
          `Candidate ${candidate.candidateId} has a dangling rationale claim.`,
        );
      }
      const linked = acceptedEvidence(claim, evidence);
      linked.forEach((item) => rationaleEvidence.add(item.evidenceId));
      if (
        !claim.decisionBearing ||
        !linked.some((item) => item.verificationDisposition === "accepted")
      ) {
        throw new Error(
          `Candidate ${candidate.candidateId} uses an unsupported rationale claim.`,
        );
      }
    }
    for (const citationId of candidate.citations) {
      if (!evidence.has(citationId)) {
        throw new Error(
          `Candidate ${candidate.candidateId} has a dangling citation.`,
        );
      }
      if (!rationaleEvidence.has(citationId)) {
        throw new Error(
          `Candidate ${candidate.candidateId} cites evidence outside its rationale claims.`,
        );
      }
    }
  }
  const eligible = new Set(graph.eligibleCandidateIds);
  if (eligible.size !== graph.eligibleCandidateIds.length) {
    throw new Error("Eligible candidate identifiers must be unique.");
  }
  for (const candidateId of eligible) {
    const candidate = candidates.get(candidateId);
    if (!candidate || !candidate.mandatoryConstraintsSatisfied) {
      throw new Error(
        "An ineligible candidate entered the eligible result set.",
      );
    }
  }
}

export function eligibleClaimsForCandidate(
  candidate: CandidateV1,
  claims: readonly ClaimV1[],
): ClaimV1[] {
  const claimIds = new Set(candidate.rationaleClaimIds);
  return claims.filter((claim) => claimIds.has(claim.claimId));
}
