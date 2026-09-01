import type {
  ConsultantLandscapeV1,
  ConsultantResultProjectionV1,
} from "../v1/consultant-projection.js";
import {
  CONSULTANT_RESULT_PROJECTION_SCHEMA_VERSION,
  CONSULTANT_RESULT_PROJECTION_VERSION,
  parseConsultantResultProjectionV1,
} from "../v1/consultant-projection.js";
import type { StandardCitationV1 } from "../v1/standard-projection.js";
import { contractSha256Hex } from "../sha256.js";

export const CONSULTANT_RESULT_PROJECTION_V2_SCHEMA_VERSION =
  "consultant-result-projection.v2" as const;
export const CONSULTANT_RESULT_PROJECTION_V2_VERSION = 6 as const;
export const CONSULTANT_SOURCE_POLICY_ID =
  "task137-rfq-wave-due-diligence.v1" as const;
export const CONSULTANT_SOURCE_POLICY_VERSION = 1 as const;
export const CONSULTANT_SOURCE_POLICY_CONTENT_SHA256 =
  "6779c1683ca65f2f3dd60b458a89cc5a3ee79035fc5865d5a6d86bf96e135e16" as const;
export const CONSULTANT_DOMAIN_PACK_ID =
  "OD-TIER-056-MACHINED-ALLOY-DOMAIN-PACK-V1" as const;

export const CONSULTANT_SYNTHETIC_RFQ_QUESTIONS = [
  [
    "RFQ-LEGAL-IDENTITY",
    "Legal name, trading names, legal form, registration number, jurisdiction, registered address, operating address, and official website.",
  ],
  [
    "RFQ-AUTHORIZED-SIGNATORY",
    "Representative name, title, business email, authority basis, signature, and signature date.",
  ],
  [
    "RFQ-OWNERSHIP-CONTROL",
    "Direct and indirect owners, controllers, parent entities, and beneficial owners to the extent lawfully available.",
  ],
  [
    "RFQ-PRODUCT-CONFORMITY",
    "Item-by-item confirmation against the required specification, drawing, material, standard, and functional guarantee.",
  ],
  [
    "RFQ-DEVIATIONS",
    "Complete list of reservations, substitutions, exceptions, and unsupported requirements; NONE is required when no deviation exists.",
  ],
  [
    "RFQ-CERTIFICATIONS",
    "Certificate or approval name, issuer, identifier, scope, issue date, expiry date, and verification URL or bounded document reference.",
  ],
  [
    "RFQ-FACILITIES-SUBCONTRACTORS",
    "Manufacturing sites, country of origin, critical subcontractors, and the responsibility assigned to each party.",
  ],
  [
    "RFQ-CAPACITY-COMMITMENTS",
    "Current available capacity, total capacity, existing commitments, surge capacity, and capacity measurement period.",
  ],
  [
    "RFQ-MOQ-LEAD-DELIVERY",
    "MOQ, production lead time, delivery schedule, phased quantities, final destination, and proposed Incoterm.",
  ],
  [
    "RFQ-QUALITY-TEST-INSPECTION",
    "Quality controls, required tests, test frequency, inspection location, method, agency, and acceptance records.",
  ],
  [
    "RFQ-WARRANTY-RECALL",
    "Warranty scope and period, defect handling, traceability, recall process, and corrective-action process.",
  ],
  [
    "RFQ-COMMERCIALS",
    "Unit price, total price, currency, taxes, freight, Incoterm, payment terms, and lifecycle or recurring costs where applicable.",
  ],
  [
    "RFQ-VALIDITY-SECURITY",
    "Quote-validity date and performance security when required by the sourcing configuration.",
  ],
  [
    "RFQ-CONFLICT-OF-INTEREST",
    "Actual, potential, or perceived conflicts; NONE is required when none are disclosed.",
  ],
  [
    "RFQ-SANCTIONS-DECLARATION",
    "Supplier declaration covering the entity, owners, controllers, directors, subcontractors, and manufacturers.",
  ],
  [
    "RFQ-DEBARMENT-DECLARATION",
    "Current or historical suspension, exclusion, debarment, and conditional non-debarment.",
  ],
  [
    "RFQ-COMMISSIONS-FEES",
    "Recipient, address, reason, and amount for commissions, gratuities, or fees; NONE is required when none exist.",
  ],
  [
    "RFQ-ANTI-CORRUPTION",
    "Controls preventing fraud, bribery, collusion, coercion, obstruction, and unauthorized facilitation payments.",
  ],
  [
    "RFQ-RBC-DUE-DILIGENCE",
    "Human-rights, labor, environmental, bribery, consumer, grievance, tracking, and remediation controls in the supply chain.",
  ],
  [
    "RFQ-EVIDENCE-INDEX",
    "Evidence ID, question ID, source type, issuer, date, URL or document reference, and confidentiality classification.",
  ],
] as const;

export const CONSULTANT_DUE_DILIGENCE_CHECKS = [
  ["DD-LEGAL-IDENTITY", "Legal identity and jurisdiction"],
  [
    "DD-SANCTIONS-OWNERSHIP-CONTROL",
    "Applicable sanctions and ownership or control screening",
  ],
  ["DD-DEBARMENT-EXCLUSION", "Applicable debarment or exclusion screening"],
  ["DD-PRODUCT-CONFORMITY", "Critical product conformity"],
  [
    "DD-CERTIFICATION-APPROVAL",
    "Mandatory certification or approval validity and scope",
  ],
  [
    "DD-CAPACITY-DELIVERY",
    "Minimum quantity, capacity, and delivery commitment",
  ],
  ["DD-CONFLICT-DISPOSITION", "Conflict-of-interest disposition"],
  ["DD-EVIDENCE-INTEGRITY", "Evidence integrity and provenance validation"],
] as const;

export interface ConsultantSourcePolicyV2 {
  readonly policy_id: typeof CONSULTANT_SOURCE_POLICY_ID;
  readonly policy_version: typeof CONSULTANT_SOURCE_POLICY_VERSION;
  readonly content_sha256: typeof CONSULTANT_SOURCE_POLICY_CONTENT_SHA256;
  readonly domain_pack_id: typeof CONSULTANT_DOMAIN_PACK_ID;
  readonly mode: "agent_researched_synthetic_qualification";
  readonly production_state: "blocked_pending_attributable_sme_validation";
}

export interface ConsultantAgentAuthorshipV2 {
  readonly prepared_by: "matchbase_agent_research_and_implementation_team";
  readonly mode: "agent_researched_synthetic_qualification";
  readonly human_consultant_authorship: "not_claimed";
  readonly production_sme_validation: "not_claimed";
}

export interface ConsultantRfqQuestionV2 {
  readonly order: number;
  readonly question_id: (typeof CONSULTANT_SYNTHETIC_RFQ_QUESTIONS)[number][0];
  readonly required_response: string;
  readonly response_state: "not_collected";
}

export interface ConsultantRankedCandidateReferenceV2 {
  readonly candidate_id: string;
  readonly rank: number;
  readonly display_name: string;
  readonly country_code: string;
  readonly projection_index: number | null;
  readonly evidence_ids: readonly string[];
}

export interface ConsultantWaveRecommendationV2 {
  readonly wave_id: "RFQ_WAVE_INITIAL";
  readonly action: "prepare_synthetic_rfq" | "no_eligible_candidates";
  readonly selection_rule: "first_min_initial_wave_size_displayed";
  readonly candidates: readonly ConsultantRankedCandidateReferenceV2[];
}

export interface ConsultantReserveCandidateV2 extends ConsultantRankedCandidateReferenceV2 {
  readonly eligibility_basis: "eligible_candidate_ids_only";
  readonly promotion_state: "next_ranked_eligible";
}

export interface ConsultantDueDiligenceCheckV2 {
  readonly order: number;
  readonly check_id: (typeof CONSULTANT_DUE_DILIGENCE_CHECKS)[number][0];
  readonly label: string;
  readonly state: "not_executed";
  readonly required_before_production: true;
}

export interface ConsultantConfigurationReleaseV2 {
  readonly config_id: string;
  readonly config_version: string;
  readonly content_sha256: string;
  readonly bound_at: string;
  readonly effective_release_at: string;
  readonly soft_cap: number;
}

export interface ConsultantRfqExecutionSnapshotV2 {
  readonly state: "synthetic_planning_only";
  readonly contact_state: "not_contacted";
  readonly response_state: "not_collected";
  readonly qualified_response_count: 0;
  readonly expansion_model: {
    readonly initial_wave_size: 3;
    readonly subsequent_wave_size: 2;
    readonly expansion_threshold: 3;
    readonly effective_expansion_threshold: number;
  };
  readonly wave_id: "RFQ_WAVE_INITIAL";
  readonly wave_sequence: 1;
  readonly wave_instance_id: string;
  readonly selected_candidates: readonly ConsultantRankedCandidateReferenceV2[];
  readonly remaining_displayed_queue: readonly ConsultantRankedCandidateReferenceV2[];
  readonly stop_state:
    "awaiting_synthetic_checkpoint" | "exhausted_displayed_queue";
  readonly next_reserve_promotion: {
    readonly state: "available" | "exhausted";
    readonly candidate: ConsultantReserveCandidateV2 | null;
    readonly promotion_mode: "one_next_ranked_eligible_only";
  };
  readonly audit_identity: {
    readonly event_type: "SYNTHETIC_WAVE_SNAPSHOT_PROJECTED";
    readonly event_id: string;
    readonly actor_type: "agent";
    readonly actor_id: "matchbase_agent_research_and_implementation_team";
    readonly occurred_at: string;
    readonly policy_id: typeof CONSULTANT_SOURCE_POLICY_ID;
    readonly policy_version: typeof CONSULTANT_SOURCE_POLICY_VERSION;
    readonly policy_content_sha256: typeof CONSULTANT_SOURCE_POLICY_CONTENT_SHA256;
    readonly config_id: string;
    readonly config_version: string;
    readonly config_content_sha256: string;
  };
}

export type ConsultantSourceFactV2 = StandardCitationV1 &
  (
    | { readonly exact_url: string; readonly publisher_domain: string }
    | {
        readonly fixture_identity: string;
        readonly publisher_domain?: never;
      }
  ) &
  (
    | {
        readonly verification_disposition: "accepted";
        readonly exclusion_reason?: never;
      }
    | {
        readonly verification_disposition: "excluded";
        readonly exclusion_reason: string;
      }
  );

export type ConsultantExcludedEvidenceV2 = ConsultantSourceFactV2 & {
  readonly verification_disposition: "excluded";
  readonly exclusion_reason: string;
};

export interface ConsultantFullLimitationsV2 {
  readonly qualification_scope: "synthetic_only";
  readonly human_consultant_authorship: "not_claimed";
  readonly production_sme_validation: "not_claimed";
  readonly production_release: "blocked";
  readonly restricted_party_clearance: "not_claimed";
  readonly due_diligence_completeness: "not_executed";
  readonly notices: readonly [string, string, string, string, string];
}

export interface ConsultantResultProjectionV2 extends Omit<
  ConsultantResultProjectionV1,
  "schema_version" | "consultant_source_readiness" | "projection_version"
> {
  readonly schema_version: typeof CONSULTANT_RESULT_PROJECTION_V2_SCHEMA_VERSION;
  readonly source_policy: ConsultantSourcePolicyV2;
  readonly configuration_release: ConsultantConfigurationReleaseV2;
  readonly agent_authorship: ConsultantAgentAuthorshipV2;
  readonly rfq_questions: readonly ConsultantRfqQuestionV2[];
  readonly wave_recommendations: readonly [ConsultantWaveRecommendationV2];
  readonly eligible_ranking: readonly ConsultantRankedCandidateReferenceV2[];
  readonly rfq_execution_snapshot: ConsultantRfqExecutionSnapshotV2;
  readonly reserve_candidates: readonly ConsultantReserveCandidateV2[];
  readonly due_diligence_checklist: readonly ConsultantDueDiligenceCheckV2[];
  readonly source_facts: readonly ConsultantSourceFactV2[];
  readonly excluded_evidence: readonly ConsultantExcludedEvidenceV2[];
  readonly full_limitations: ConsultantFullLimitationsV2;
  readonly projection_version: typeof CONSULTANT_RESULT_PROJECTION_V2_VERSION;
}

const V2_TOP_LEVEL_KEYS = [
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
  "source_policy",
  "configuration_release",
  "agent_authorship",
  "rfq_questions",
  "wave_recommendations",
  "eligible_ranking",
  "rfq_execution_snapshot",
  "reserve_candidates",
  "due_diligence_checklist",
  "source_facts",
  "excluded_evidence",
  "full_limitations",
  "projection_version",
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

function nonempty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string.`);
}

function integer(value: unknown, minimum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum)
    throw new Error(`${label} must be an integer of at least ${minimum}.`);
  return Number(value);
}

function constant(value: unknown, expected: unknown, label: string): void {
  if (value !== expected) throw new Error(`${label} is invalid.`);
}

function assertRankedReference(
  value: unknown,
  label: string,
  expectedRank: number,
): Record<string, unknown> {
  const item = record(value, label);
  exactKeys(
    item,
    [
      "candidate_id",
      "rank",
      "display_name",
      "country_code",
      "projection_index",
      "evidence_ids",
    ],
    [
      "candidate_id",
      "rank",
      "display_name",
      "country_code",
      "projection_index",
      "evidence_ids",
    ],
    label,
  );
  nonempty(item.candidate_id, `${label} candidate id`);
  nonempty(item.display_name, `${label} display name`);
  nonempty(item.country_code, `${label} country code`);
  if (integer(item.rank, 1, `${label} rank`) !== expectedRank)
    throw new Error(`${label} rank is inconsistent.`);
  if (
    item.projection_index !== null &&
    (!Number.isSafeInteger(item.projection_index) ||
      Number(item.projection_index) < 0)
  )
    throw new Error(`${label} projection index is invalid.`);
  const evidenceIds = array(item.evidence_ids, `${label} evidence ids`);
  const uniqueEvidenceIds = new Set<string>();
  evidenceIds.forEach((evidenceId) => {
    nonempty(evidenceId, `${label} evidence id`);
    if (uniqueEvidenceIds.has(evidenceId))
      throw new Error(`${label} evidence id is duplicated.`);
    uniqueEvidenceIds.add(evidenceId);
  });
  return item;
}

function assertSourcePolicy(value: unknown): void {
  const item = record(value, "Consultant source policy");
  const keys = [
    "policy_id",
    "policy_version",
    "content_sha256",
    "domain_pack_id",
    "mode",
    "production_state",
  ];
  exactKeys(item, keys, keys, "Consultant source policy");
  constant(
    item.policy_id,
    CONSULTANT_SOURCE_POLICY_ID,
    "Consultant source policy id",
  );
  constant(
    item.policy_version,
    CONSULTANT_SOURCE_POLICY_VERSION,
    "Consultant source policy version",
  );
  constant(
    item.content_sha256,
    CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
    "Consultant source policy content digest",
  );
  constant(
    item.domain_pack_id,
    CONSULTANT_DOMAIN_PACK_ID,
    "Consultant domain pack id",
  );
  constant(
    item.mode,
    "agent_researched_synthetic_qualification",
    "Consultant source policy mode",
  );
  constant(
    item.production_state,
    "blocked_pending_attributable_sme_validation",
    "Consultant source policy production state",
  );
}

function assertConfigurationRelease(value: unknown): Record<string, unknown> {
  const item = record(value, "Consultant configuration release");
  const keys = [
    "config_id",
    "config_version",
    "content_sha256",
    "bound_at",
    "effective_release_at",
    "soft_cap",
  ];
  exactKeys(item, keys, keys, "Consultant configuration release");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      String(item.config_id),
    )
  )
    throw new Error("Consultant configuration release id is invalid.");
  nonempty(item.config_version, "Consultant configuration release version");
  if (!/^[a-f0-9]{64}$/u.test(String(item.content_sha256)))
    throw new Error("Consultant configuration release digest is invalid.");
  for (const key of ["bound_at", "effective_release_at"])
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(
        String(item[key]),
      ) ||
      Number.isNaN(Date.parse(String(item[key])))
    )
      throw new Error(`Consultant configuration release ${key} is invalid.`);
  if (
    Date.parse(String(item.effective_release_at)) >
    Date.parse(String(item.bound_at))
  )
    throw new Error(
      "Consultant configuration effective release cannot follow binding.",
    );
  integer(item.soft_cap, 3, "Consultant configuration release soft cap");
  return item;
}

function assertAgentAuthorship(value: unknown): void {
  const item = record(value, "Consultant agent authorship");
  const keys = [
    "prepared_by",
    "mode",
    "human_consultant_authorship",
    "production_sme_validation",
  ];
  exactKeys(item, keys, keys, "Consultant agent authorship");
  constant(
    item.prepared_by,
    "matchbase_agent_research_and_implementation_team",
    "Consultant prepared-by identity",
  );
  constant(
    item.mode,
    "agent_researched_synthetic_qualification",
    "Consultant authorship mode",
  );
  constant(
    item.human_consultant_authorship,
    "not_claimed",
    "Consultant human authorship boundary",
  );
  constant(
    item.production_sme_validation,
    "not_claimed",
    "Consultant SME validation boundary",
  );
}

function assertRfqQuestions(value: unknown): void {
  const questions = array(value, "Consultant RFQ questions");
  if (questions.length !== CONSULTANT_SYNTHETIC_RFQ_QUESTIONS.length)
    throw new Error("Consultant RFQ question set is incomplete.");
  questions.forEach((entry, index) => {
    const item = record(entry, "Consultant RFQ question");
    const keys = [
      "order",
      "question_id",
      "required_response",
      "response_state",
    ];
    exactKeys(item, keys, keys, "Consultant RFQ question");
    const expected = CONSULTANT_SYNTHETIC_RFQ_QUESTIONS[index]!;
    constant(item.order, index + 1, "Consultant RFQ question order");
    constant(item.question_id, expected[0], "Consultant RFQ question id");
    constant(
      item.required_response,
      expected[1],
      "Consultant RFQ required response",
    );
    constant(
      item.response_state,
      "not_collected",
      "Consultant RFQ response state",
    );
  });
}

function assertDueDiligence(value: unknown): void {
  const checks = array(value, "Consultant due-diligence checklist");
  if (checks.length !== CONSULTANT_DUE_DILIGENCE_CHECKS.length)
    throw new Error("Consultant due-diligence checklist is incomplete.");
  checks.forEach((entry, index) => {
    const item = record(entry, "Consultant due-diligence check");
    const keys = [
      "order",
      "check_id",
      "label",
      "state",
      "required_before_production",
    ];
    exactKeys(item, keys, keys, "Consultant due-diligence check");
    const expected = CONSULTANT_DUE_DILIGENCE_CHECKS[index]!;
    constant(item.order, index + 1, "Consultant due-diligence order");
    constant(item.check_id, expected[0], "Consultant due-diligence id");
    constant(item.label, expected[1], "Consultant due-diligence label");
    constant(item.state, "not_executed", "Consultant due-diligence state");
    constant(
      item.required_before_production,
      true,
      "Consultant due-diligence production boundary",
    );
  });
}

function assertSourceFact(value: unknown): Record<string, unknown> {
  const item = record(value, "Consultant source fact");
  const base = [
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
    "verification_disposition",
  ];
  exactKeys(
    item,
    [
      ...base,
      "exact_url",
      "fixture_identity",
      "publisher_domain",
      "exclusion_reason",
    ],
    base,
    "Consultant source fact",
  );
  if ("exact_url" in item === "fixture_identity" in item)
    throw new Error("Consultant source fact locator is invalid.");
  for (const key of base) nonempty(item[key], `Consultant source fact ${key}`);
  if (item.verification_disposition === "excluded")
    nonempty(item.exclusion_reason, "Consultant source fact exclusion reason");
  else {
    constant(
      item.verification_disposition,
      "accepted",
      "Consultant source fact disposition",
    );
    if ("exclusion_reason" in item)
      throw new Error(
        "Accepted Consultant source fact cannot have an exclusion reason.",
      );
  }
  if ("exact_url" in item) {
    nonempty(item.exact_url, "Consultant source fact exact URL");
    let url: URL;
    try {
      url = new URL(item.exact_url);
    } catch {
      throw new Error("Consultant source fact exact URL is invalid.");
    }
    if (url.protocol !== "https:")
      throw new Error("Consultant source fact exact URL must use HTTPS.");
    if (url.username || url.password || !url.hostname || url.hash)
      throw new Error("Consultant source fact exact URL is not canonical.");
    nonempty(item.publisher_domain, "Consultant source fact publisher domain");
    if (
      String(item.publisher_domain).toLowerCase() !== url.hostname.toLowerCase()
    )
      throw new Error(
        "Consultant source fact publisher domain is inconsistent.",
      );
    constant(
      item.provenance,
      "live_secure_fetch",
      "Consultant live source fact provenance",
    );
  }
  if ("fixture_identity" in item) {
    nonempty(item.fixture_identity, "Consultant source fact fixture identity");
    if ("publisher_domain" in item)
      throw new Error(
        "Consultant fixture source fact cannot expose a derived domain.",
      );
    if (!/^fixture(?::\/\/|\/)/u.test(String(item.fixture_identity)))
      throw new Error("Consultant source fact fixture identity is invalid.");
    if (
      !["synthetic_fixture", "repository_fixture"].includes(
        String(item.provenance),
      )
    )
      throw new Error("Consultant fixture source fact provenance is invalid.");
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(
      String(item.accessed_at),
    ) ||
    Number.isNaN(Date.parse(String(item.accessed_at)))
  )
    throw new Error("Consultant source fact retrieval timestamp is invalid.");
  if (
    item.published_or_updated !== "not stated by source" &&
    (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/u.test(
      String(item.published_or_updated),
    ) ||
      Number.isNaN(Date.parse(String(item.published_or_updated))))
  )
    throw new Error("Consultant source fact publication timestamp is invalid.");
  if (String(item.extract).length > 2_000)
    throw new Error("Consultant source fact excerpt exceeds the bound.");
  if (!/^[a-f0-9]{64}$/u.test(String(item.content_sha256)))
    throw new Error("Consultant source fact digest is invalid.");
  if (
    !["primary", "official_secondary", "secondary"].includes(
      String(item.source_tier),
    )
  )
    throw new Error("Consultant source fact source tier is invalid.");
  if (
    ![
      "claimed",
      "externally_verified",
      "inferred",
      "stale",
      "conflicting",
      "unknown",
    ].includes(String(item.status))
  )
    throw new Error("Consultant source fact status is invalid.");
  if (
    !["available", "blocked", "unreachable"].includes(String(item.access_state))
  )
    throw new Error("Consultant source fact access state is invalid.");
  return item;
}

function assertFullLimitations(value: unknown): void {
  const item = record(value, "Consultant full limitations");
  const keys = [
    "qualification_scope",
    "human_consultant_authorship",
    "production_sme_validation",
    "production_release",
    "restricted_party_clearance",
    "due_diligence_completeness",
    "notices",
  ];
  exactKeys(item, keys, keys, "Consultant full limitations");
  constant(
    item.qualification_scope,
    "synthetic_only",
    "Consultant qualification scope",
  );
  constant(
    item.human_consultant_authorship,
    "not_claimed",
    "Consultant human authorship limitation",
  );
  constant(
    item.production_sme_validation,
    "not_claimed",
    "Consultant SME limitation",
  );
  constant(
    item.production_release,
    "blocked",
    "Consultant production release limitation",
  );
  constant(
    item.restricted_party_clearance,
    "not_claimed",
    "Consultant screening limitation",
  );
  constant(
    item.due_diligence_completeness,
    "not_executed",
    "Consultant diligence limitation",
  );
  const notices = array(item.notices, "Consultant limitation notices");
  if (notices.length !== 5)
    throw new Error("Consultant limitation notices are incomplete.");
  notices.forEach((notice) => nonempty(notice, "Consultant limitation notice"));
}

export function parseConsultantResultProjectionV2(
  value: unknown,
): ConsultantResultProjectionV2 {
  let normalized: unknown;
  try {
    normalized = JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    throw new Error("Consultant result projection v2 is not serializable.");
  }
  const projection = record(normalized, "Consultant result projection v2");
  exactKeys(
    projection,
    V2_TOP_LEVEL_KEYS,
    V2_TOP_LEVEL_KEYS,
    "Consultant result projection v2",
  );
  constant(
    projection.schema_version,
    CONSULTANT_RESULT_PROJECTION_V2_SCHEMA_VERSION,
    "Consultant result projection v2 schema version",
  );
  constant(
    projection.projection_version,
    CONSULTANT_RESULT_PROJECTION_V2_VERSION,
    "Consultant result projection v2 version",
  );

  const legacyCompatible = structuredClone(projection);
  for (const key of [
    "source_policy",
    "configuration_release",
    "agent_authorship",
    "rfq_questions",
    "wave_recommendations",
    "eligible_ranking",
    "rfq_execution_snapshot",
    "reserve_candidates",
    "due_diligence_checklist",
    "source_facts",
    "excluded_evidence",
    "full_limitations",
  ])
    delete legacyCompatible[key];
  legacyCompatible.schema_version = CONSULTANT_RESULT_PROJECTION_SCHEMA_VERSION;
  legacyCompatible.consultant_source_readiness = {
    state: "limited",
    notice: "Legacy validation adapter for additive Consultant projection v2.",
  };
  legacyCompatible.projection_version = CONSULTANT_RESULT_PROJECTION_VERSION;
  parseConsultantResultProjectionV1(legacyCompatible);

  assertSourcePolicy(projection.source_policy);
  const configuration = assertConfigurationRelease(
    projection.configuration_release,
  );
  const landscapeRecord = record(projection.landscape, "Consultant landscape");
  if (configuration.soft_cap !== landscapeRecord.soft_cap)
    throw new Error("Consultant configuration soft cap is inconsistent.");
  assertAgentAuthorship(projection.agent_authorship);
  assertRfqQuestions(projection.rfq_questions);
  assertDueDiligence(projection.due_diligence_checklist);
  const sourceFacts = array(projection.source_facts, "Consultant source facts");
  const sourceFactIds = new Set<string>();
  sourceFacts.forEach((entry) => {
    const item = assertSourceFact(entry);
    const evidenceId = String(item.evidence_id);
    if (sourceFactIds.has(evidenceId))
      throw new Error("Consultant source fact is duplicated.");
    sourceFactIds.add(evidenceId);
  });
  const referencedEvidenceIds = new Set<string>();
  const citationByEvidenceId = new Map<string, Record<string, unknown>>();
  array(projection.candidates, "Consultant candidates").forEach((entry) => {
    const candidate = record(entry, "Consultant candidate");
    array(candidate.citations, "Consultant candidate citations").forEach(
      (citation) => {
        const item = record(citation, "Consultant candidate citation");
        const evidenceId = String(item.evidence_id);
        if (citationByEvidenceId.has(evidenceId))
          throw new Error("Consultant citation evidence id is duplicated.");
        referencedEvidenceIds.add(evidenceId);
        citationByEvidenceId.set(evidenceId, item);
      },
    );
    for (const key of ["positive_drivers", "limiting_gaps"])
      array(candidate[key], `Consultant candidate ${key}`).forEach((item) =>
        array(
          record(item, `Consultant candidate ${key} item`).evidence_ids,
          `Consultant candidate ${key} evidence ids`,
        ).forEach((evidenceId) =>
          referencedEvidenceIds.add(String(evidenceId)),
        ),
      );
  });
  array(projection.eligible_ranking, "Consultant eligible ranking").forEach(
    (entry) =>
      array(
        record(entry, "Consultant eligible ranking entry").evidence_ids,
        "Consultant eligible ranking evidence ids",
      ).forEach((evidenceId) => referencedEvidenceIds.add(String(evidenceId))),
  );
  sourceFacts.forEach((entry) => {
    const item = record(entry, "Consultant source fact");
    if (
      item.verification_disposition === "accepted" &&
      !referencedEvidenceIds.has(String(item.evidence_id))
    )
      throw new Error("Accepted Consultant source fact is not referenced.");
    const citation = citationByEvidenceId.get(String(item.evidence_id));
    if (item.verification_disposition === "accepted" && citation) {
      for (const key of [
        "title",
        "publisher",
        "published_or_updated",
        "source_tier",
        "status",
        "access_state",
        "extract",
        "content_sha256",
        "provenance",
      ])
        if (item[key] !== citation[key])
          throw new Error(
            "Consultant source fact citation binding is inconsistent.",
          );
      if (
        new Date(String(item.accessed_at)).toISOString() !==
        new Date(String(citation.accessed_at)).toISOString()
      )
        throw new Error(
          "Consultant source fact citation timestamp is inconsistent.",
        );
      for (const locator of ["exact_url", "fixture_identity"])
        if (item[locator] !== citation[locator])
          throw new Error(
            "Consultant source fact citation locator is inconsistent.",
          );
    }
  });
  const excludedEvidence = array(
    projection.excluded_evidence,
    "Consultant excluded evidence",
  );
  excludedEvidence.forEach((entry) => {
    const item = assertSourceFact(entry);
    constant(
      item.verification_disposition,
      "excluded",
      "Consultant excluded evidence disposition",
    );
  });
  const expectedExcluded = sourceFacts.filter(
    (entry) =>
      record(entry, "Consultant source fact").verification_disposition ===
      "excluded",
  );
  if (JSON.stringify(excludedEvidence) !== JSON.stringify(expectedExcluded))
    throw new Error("Consultant excluded evidence projection is inconsistent.");
  assertFullLimitations(projection.full_limitations);

  const landscape = projection.landscape as unknown as ConsultantLandscapeV1;
  const eligibleRanking = array(
    projection.eligible_ranking,
    "Consultant eligible ranking",
  );
  if (eligibleRanking.length !== landscape.eligible_count)
    throw new Error("Consultant eligible ranking count is inconsistent.");
  const seenIds = new Set<string>();
  eligibleRanking.forEach((entry, index) => {
    const item = assertRankedReference(
      entry,
      "Consultant eligible ranking entry",
      index + 1,
    );
    const candidateId = String(item.candidate_id);
    if (seenIds.has(candidateId))
      throw new Error("Consultant ranked candidate is duplicated.");
    seenIds.add(candidateId);
    if (index < landscape.displayed_count) {
      if (item.projection_index !== index)
        throw new Error(
          "Consultant projected candidate index is inconsistent.",
        );
      const displayed = record(
        array(projection.candidates, "Consultant candidates")[index],
        "Consultant projected candidate",
      );
      if (
        item.display_name !== displayed.display_name ||
        item.country_code !== displayed.country_code
      )
        throw new Error(
          "Consultant ranked candidate projection is inconsistent.",
        );
    } else if (item.projection_index !== null)
      throw new Error("Consultant reserve cannot bind a projection index.");
  });
  const waves = array(
    projection.wave_recommendations,
    "Consultant wave recommendations",
  );
  if (waves.length !== 1)
    throw new Error("Consultant wave recommendation must contain wave 1 only.");
  const wave = record(waves[0], "Consultant wave recommendation");
  const waveKeys = ["wave_id", "action", "selection_rule", "candidates"];
  exactKeys(wave, waveKeys, waveKeys, "Consultant wave recommendation");
  constant(wave.wave_id, "RFQ_WAVE_INITIAL", "Consultant wave id");
  constant(
    wave.selection_rule,
    "first_min_initial_wave_size_displayed",
    "Consultant wave selection rule",
  );
  constant(
    wave.action,
    landscape.displayed_count === 0
      ? "no_eligible_candidates"
      : "prepare_synthetic_rfq",
    "Consultant wave action",
  );
  const waveCandidates = array(wave.candidates, "Consultant wave candidates");
  if (waveCandidates.length !== Math.min(3, landscape.displayed_count))
    throw new Error("Consultant wave candidate count is inconsistent.");
  waveCandidates.forEach((entry, index) => {
    const item = assertRankedReference(
      entry,
      "Consultant wave candidate",
      index + 1,
    );
    if (JSON.stringify(item) !== JSON.stringify(eligibleRanking[index]))
      throw new Error("Consultant wave candidate projection is inconsistent.");
  });

  const reserves = array(
    projection.reserve_candidates,
    "Consultant reserve candidates",
  );
  if (reserves.length !== landscape.eligible_count - landscape.displayed_count)
    throw new Error("Consultant reserve candidate count is inconsistent.");
  reserves.forEach((entry, index) => {
    const item = record(entry, "Consultant reserve candidate");
    const keys = [
      "candidate_id",
      "rank",
      "display_name",
      "country_code",
      "projection_index",
      "evidence_ids",
      "eligibility_basis",
      "promotion_state",
    ];
    exactKeys(item, keys, keys, "Consultant reserve candidate");
    assertRankedReference(
      {
        candidate_id: item.candidate_id,
        rank: item.rank,
        display_name: item.display_name,
        country_code: item.country_code,
        projection_index: item.projection_index,
        evidence_ids: item.evidence_ids,
      },
      "Consultant reserve candidate",
      landscape.displayed_count + index + 1,
    );
    constant(
      item.eligibility_basis,
      "eligible_candidate_ids_only",
      "Consultant reserve eligibility basis",
    );
    constant(
      item.promotion_state,
      "next_ranked_eligible",
      "Consultant reserve promotion state",
    );
    const ranked = record(
      eligibleRanking[landscape.displayed_count + index],
      "Consultant eligible reserve ranking",
    );
    for (const key of [
      "candidate_id",
      "rank",
      "display_name",
      "country_code",
      "projection_index",
      "evidence_ids",
    ])
      if (JSON.stringify(item[key]) !== JSON.stringify(ranked[key]))
        throw new Error("Consultant reserve ranking is inconsistent.");
  });
  const snapshot = record(
    projection.rfq_execution_snapshot,
    "Consultant RFQ execution snapshot",
  );
  const snapshotKeys = [
    "state",
    "contact_state",
    "response_state",
    "qualified_response_count",
    "expansion_model",
    "wave_id",
    "wave_sequence",
    "wave_instance_id",
    "selected_candidates",
    "remaining_displayed_queue",
    "stop_state",
    "next_reserve_promotion",
    "audit_identity",
  ];
  exactKeys(
    snapshot,
    snapshotKeys,
    snapshotKeys,
    "Consultant RFQ execution snapshot",
  );
  constant(
    snapshot.state,
    "synthetic_planning_only",
    "Consultant RFQ snapshot state",
  );
  constant(
    snapshot.contact_state,
    "not_contacted",
    "Consultant RFQ contact state",
  );
  constant(
    snapshot.response_state,
    "not_collected",
    "Consultant RFQ response state",
  );
  constant(
    snapshot.qualified_response_count,
    0,
    "Consultant qualified response count",
  );
  constant(snapshot.wave_id, "RFQ_WAVE_INITIAL", "Consultant RFQ wave id");
  constant(snapshot.wave_sequence, 1, "Consultant RFQ wave sequence");
  if (!/^[a-f0-9]{64}$/u.test(String(snapshot.wave_instance_id)))
    throw new Error("Consultant RFQ wave instance digest is invalid.");
  const expansion = record(
    snapshot.expansion_model,
    "Consultant RFQ expansion model",
  );
  const expansionKeys = [
    "initial_wave_size",
    "subsequent_wave_size",
    "expansion_threshold",
    "effective_expansion_threshold",
  ];
  exactKeys(
    expansion,
    expansionKeys,
    expansionKeys,
    "Consultant RFQ expansion model",
  );
  constant(expansion.initial_wave_size, 3, "Consultant initial wave size");
  constant(
    expansion.subsequent_wave_size,
    2,
    "Consultant subsequent wave size",
  );
  constant(expansion.expansion_threshold, 3, "Consultant expansion threshold");
  constant(
    expansion.effective_expansion_threshold,
    Math.min(3, landscape.displayed_count),
    "Consultant effective expansion threshold",
  );
  const initialCount = Math.min(3, landscape.displayed_count);
  if (
    JSON.stringify(snapshot.selected_candidates) !==
      JSON.stringify(eligibleRanking.slice(0, initialCount)) ||
    JSON.stringify(snapshot.remaining_displayed_queue) !==
      JSON.stringify(
        eligibleRanking.slice(initialCount, landscape.displayed_count),
      )
  )
    throw new Error("Consultant RFQ queue binding is inconsistent.");
  const selectedCandidateIds = array(
    snapshot.selected_candidates,
    "Consultant RFQ selected candidates",
  ).map((entry) =>
    String(record(entry, "Consultant RFQ selected candidate").candidate_id),
  );
  const expectedWaveInstanceId = contractSha256Hex(
    [
      String(projection.run_id),
      CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
      String(configuration.content_sha256),
      "RFQ_WAVE_INITIAL",
      "1",
      selectedCandidateIds.join(","),
    ].join("|"),
  );
  if (snapshot.wave_instance_id !== expectedWaveInstanceId)
    throw new Error("Consultant RFQ wave instance digest is inconsistent.");
  constant(
    snapshot.stop_state,
    landscape.displayed_count === 0
      ? "exhausted_displayed_queue"
      : "awaiting_synthetic_checkpoint",
    "Consultant RFQ stop state",
  );
  const promotion = record(
    snapshot.next_reserve_promotion,
    "Consultant next reserve promotion",
  );
  const promotionKeys = ["state", "candidate", "promotion_mode"];
  exactKeys(
    promotion,
    promotionKeys,
    promotionKeys,
    "Consultant next reserve promotion",
  );
  constant(
    promotion.promotion_mode,
    "one_next_ranked_eligible_only",
    "Consultant reserve promotion mode",
  );
  constant(
    promotion.state,
    reserves.length ? "available" : "exhausted",
    "Consultant reserve promotion state",
  );
  if (
    JSON.stringify(promotion.candidate) !==
    JSON.stringify(reserves.length ? reserves[0] : null)
  )
    throw new Error("Consultant next reserve promotion is inconsistent.");
  const audit = record(
    snapshot.audit_identity,
    "Consultant RFQ audit identity",
  );
  const auditKeys = [
    "event_type",
    "event_id",
    "actor_type",
    "actor_id",
    "occurred_at",
    "policy_id",
    "policy_version",
    "policy_content_sha256",
    "config_id",
    "config_version",
    "config_content_sha256",
  ];
  exactKeys(audit, auditKeys, auditKeys, "Consultant RFQ audit identity");
  constant(
    audit.event_type,
    "SYNTHETIC_WAVE_SNAPSHOT_PROJECTED",
    "Consultant RFQ audit event type",
  );
  if (!/^[a-f0-9]{64}$/u.test(String(audit.event_id)))
    throw new Error("Consultant RFQ audit event id is invalid.");
  constant(audit.actor_type, "agent", "Consultant RFQ audit actor type");
  constant(
    audit.actor_id,
    "matchbase_agent_research_and_implementation_team",
    "Consultant RFQ audit actor id",
  );
  constant(
    audit.policy_id,
    CONSULTANT_SOURCE_POLICY_ID,
    "Consultant RFQ audit policy id",
  );
  constant(
    audit.policy_version,
    CONSULTANT_SOURCE_POLICY_VERSION,
    "Consultant RFQ audit policy version",
  );
  constant(
    audit.policy_content_sha256,
    CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
    "Consultant RFQ audit policy digest",
  );
  for (const [auditKey, configKey] of [
    ["config_id", "config_id"],
    ["config_version", "config_version"],
    ["config_content_sha256", "content_sha256"],
  ] as const)
    if (audit[auditKey] !== configuration[configKey])
      throw new Error(
        "Consultant RFQ audit configuration binding is inconsistent.",
      );
  if (audit.occurred_at !== configuration.bound_at)
    throw new Error("Consultant RFQ audit timestamp is inconsistent.");
  const expectedAuditEventId = contractSha256Hex(
    `${expectedWaveInstanceId}|${String(configuration.bound_at)}|SYNTHETIC_WAVE_SNAPSHOT_PROJECTED`,
  );
  if (audit.event_id !== expectedAuditEventId)
    throw new Error("Consultant RFQ audit event digest is inconsistent.");
  return deepFreeze(normalized as ConsultantResultProjectionV2);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
