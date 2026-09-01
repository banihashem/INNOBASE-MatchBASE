import assert from "node:assert/strict";
import test from "node:test";
import { generateContractSchemas } from "../src/schema.js";
import { contractSha256Hex } from "../src/sha256.js";
import {
  CONSULTANT_AGRICULTURAL_DOMAIN_PACK_ID,
  CONSULTANT_AGRICULTURAL_LIMITATION_NOTICES,
  CONSULTANT_AGRICULTURAL_RFQ_QUESTIONS,
  CONSULTANT_DOMAIN_PACK_ID,
  CONSULTANT_DUE_DILIGENCE_CHECKS,
  CONSULTANT_RESULT_PROJECTION_V2_SCHEMA_VERSION,
  CONSULTANT_RESULT_PROJECTION_V2_VERSION,
  CONSULTANT_SOURCE_POLICY_ID,
  CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
  CONSULTANT_SOURCE_POLICY_VERSION,
  CONSULTANT_SYNTHETIC_RFQ_QUESTIONS,
  CONSULTANT_SYNTHETIC_LIMITATION_NOTICES,
  parseConsultantResultProjectionV2,
} from "../src/v2/consultant-projection.js";

const RUN_ID = "00000000-0000-4000-8000-000000000137";
const CONFIG_SHA256 = "b".repeat(64);
const BOUND_AT = "2026-08-25T00:00:00.000Z";
const WAVE_INSTANCE_ID = contractSha256Hex(
  [
    RUN_ID,
    CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
    CONFIG_SHA256,
    "RFQ_WAVE_INITIAL",
    "1",
    "",
  ].join("|"),
);
const AUDIT_EVENT_ID = contractSha256Hex(
  `${WAVE_INSTANCE_ID}|${BOUND_AT}|SYNTHETIC_WAVE_SNAPSHOT_PROJECTED`,
);

function validProjection(): Record<string, unknown> {
  return {
    schema_version: CONSULTANT_RESULT_PROJECTION_V2_SCHEMA_VERSION,
    run_id: RUN_ID,
    outcome: "no_responsible_match",
    scarcity: "zero",
    candidates: [],
    gate_eliminations: [],
    scarcity_analysis: {
      reducing_constraints: [],
      unmet_mandatory_constraints: [],
      permitted_relaxations: [],
    },
    limitations: {
      unknown_count: 0,
      not_asked_count: 0,
      affected_low_confidence_dimensions: [],
      evidence_states: [],
      restricted_party_screening_notice: "No screening conclusion.",
      advisory_boundary: "Synthetic advisory output only.",
    },
    synthetic_warning: "Synthetic contract fixture.",
    landscape: {
      eligible_count: 0,
      displayed_count: 0,
      soft_cap: 20,
      truncated: false,
      scarcity_override_applied: false,
    },
    source_policy: {
      policy_id: CONSULTANT_SOURCE_POLICY_ID,
      policy_version: CONSULTANT_SOURCE_POLICY_VERSION,
      content_sha256: CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
      domain_pack_id: CONSULTANT_DOMAIN_PACK_ID,
      mode: "agent_researched_synthetic_qualification",
      production_state: "blocked_pending_attributable_sme_validation",
    },
    configuration_release: {
      config_id: "00000000-0000-4000-8000-000000000620",
      config_version: "consultant-soft-cap.test.v1",
      content_sha256: CONFIG_SHA256,
      bound_at: BOUND_AT,
      effective_release_at: "2026-08-24T00:00:00.000Z",
      soft_cap: 20,
    },
    agent_authorship: {
      prepared_by: "matchbase_agent_research_and_implementation_team",
      mode: "agent_researched_synthetic_qualification",
      human_consultant_authorship: "not_claimed",
      production_sme_validation: "not_claimed",
    },
    rfq_questions: CONSULTANT_SYNTHETIC_RFQ_QUESTIONS.map(
      ([questionId, requiredResponse], index) => ({
        order: index + 1,
        question_id: questionId,
        required_response: requiredResponse,
        response_state: "not_collected",
      }),
    ),
    wave_recommendations: [
      {
        wave_id: "RFQ_WAVE_INITIAL",
        action: "no_eligible_candidates",
        selection_rule: "first_min_initial_wave_size_displayed",
        candidates: [],
      },
    ],
    eligible_ranking: [],
    rfq_execution_snapshot: {
      state: "synthetic_planning_only",
      contact_state: "not_contacted",
      response_state: "not_collected",
      qualified_response_count: 0,
      expansion_model: {
        initial_wave_size: 3,
        subsequent_wave_size: 2,
        expansion_threshold: 3,
        effective_expansion_threshold: 0,
      },
      wave_id: "RFQ_WAVE_INITIAL",
      wave_sequence: 1,
      wave_instance_id: WAVE_INSTANCE_ID,
      selected_candidates: [],
      remaining_displayed_queue: [],
      stop_state: "exhausted_displayed_queue",
      next_reserve_promotion: {
        state: "exhausted",
        candidate: null,
        promotion_mode: "one_next_ranked_eligible_only",
      },
      audit_identity: {
        event_type: "SYNTHETIC_WAVE_SNAPSHOT_PROJECTED",
        event_id: AUDIT_EVENT_ID,
        actor_type: "agent",
        actor_id: "matchbase_agent_research_and_implementation_team",
        occurred_at: BOUND_AT,
        policy_id: CONSULTANT_SOURCE_POLICY_ID,
        policy_version: CONSULTANT_SOURCE_POLICY_VERSION,
        policy_content_sha256: CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
        config_id: "00000000-0000-4000-8000-000000000620",
        config_version: "consultant-soft-cap.test.v1",
        config_content_sha256: CONFIG_SHA256,
      },
    },
    reserve_candidates: [],
    due_diligence_checklist: CONSULTANT_DUE_DILIGENCE_CHECKS.map(
      ([checkId, label], index) => ({
        order: index + 1,
        check_id: checkId,
        label,
        state: "not_executed",
        required_before_production: true,
      }),
    ),
    source_facts: [
      {
        evidence_id: "EVID-EXCLUDED-1",
        fixture_identity: "fixture/excluded-1.json",
        title: "Excluded synthetic source",
        publisher: "MatchBASE",
        published_or_updated: "2026-08-25",
        accessed_at: "2026-08-25T00:00:00.000Z",
        source_tier: "secondary",
        status: "unknown",
        access_state: "available",
        extract: "Bounded synthetic excerpt.",
        content_sha256: "a".repeat(64),
        provenance: "repository_fixture",
        verification_disposition: "excluded",
        exclusion_reason: "Not used by any decision-bearing claim.",
      },
    ],
    excluded_evidence: [
      {
        evidence_id: "EVID-EXCLUDED-1",
        fixture_identity: "fixture/excluded-1.json",
        title: "Excluded synthetic source",
        publisher: "MatchBASE",
        published_or_updated: "2026-08-25",
        accessed_at: "2026-08-25T00:00:00.000Z",
        source_tier: "secondary",
        status: "unknown",
        access_state: "available",
        extract: "Bounded synthetic excerpt.",
        content_sha256: "a".repeat(64),
        provenance: "repository_fixture",
        verification_disposition: "excluded",
        exclusion_reason: "Not used by any decision-bearing claim.",
      },
    ],
    full_limitations: {
      qualification_scope: "synthetic_only",
      human_consultant_authorship: "not_claimed",
      production_sme_validation: "not_claimed",
      production_release: "blocked",
      restricted_party_clearance: "not_claimed",
      due_diligence_completeness: "not_executed",
      notices: [...CONSULTANT_SYNTHETIC_LIMITATION_NOTICES],
    },
    projection_version: CONSULTANT_RESULT_PROJECTION_V2_VERSION,
  };
}

test("Consultant projection admits the governed agricultural pack identity", () => {
  const projection = validProjection();
  (projection.source_policy as Record<string, unknown>).domain_pack_id =
    CONSULTANT_AGRICULTURAL_DOMAIN_PACK_ID;
  (projection.source_policy as Record<string, unknown>).mode =
    "agent_researched_agricultural_qualification";
  (projection.agent_authorship as Record<string, unknown>).mode =
    "agent_researched_agricultural_qualification";
  (projection.rfq_execution_snapshot as Record<string, unknown>).state =
    "governed_agricultural_planning_only";
  const agriculturalWaveId = contractSha256Hex(
    [
      RUN_ID,
      CONSULTANT_SOURCE_POLICY_CONTENT_SHA256,
      CONFIG_SHA256,
      CONSULTANT_AGRICULTURAL_DOMAIN_PACK_ID,
      "RFQ_WAVE_INITIAL",
      "1",
      "",
    ].join("|"),
  );
  (
    projection.rfq_execution_snapshot as Record<string, unknown>
  ).wave_instance_id = agriculturalWaveId;
  projection.rfq_questions = CONSULTANT_AGRICULTURAL_RFQ_QUESTIONS.map(
    ([questionId, requiredResponse], index) => ({
      order: index + 1,
      question_id: questionId,
      required_response: requiredResponse,
      response_state: "not_collected",
    }),
  );
  const audit = (projection.rfq_execution_snapshot as Record<string, unknown>)
    .audit_identity as Record<string, unknown>;
  audit.event_type = "AGRICULTURAL_WAVE_SNAPSHOT_PROJECTED";
  audit.event_id = contractSha256Hex(
    `${agriculturalWaveId}|${BOUND_AT}|AGRICULTURAL_WAVE_SNAPSHOT_PROJECTED`,
  );
  const limitations = projection.full_limitations as Record<string, unknown>;
  limitations.qualification_scope = "governed_agricultural_qualification";
  limitations.notices = [...CONSULTANT_AGRICULTURAL_LIMITATION_NOTICES];
  assert.equal(
    parseConsultantResultProjectionV2(projection).source_policy.domain_pack_id,
    CONSULTANT_AGRICULTURAL_DOMAIN_PACK_ID,
  );
  assert.equal(
    (projection.rfq_questions as Array<Record<string, unknown>>).some(
      (question) =>
        /industrial|component|machined|alloy/iu.test(
          String(question.required_response),
        ),
    ),
    false,
  );
});

test("Consultant parser rejects every cross-product semantic tuple mutation", () => {
  const mutations: Array<(value: Record<string, unknown>) => void> = [
    (value) => {
      (value.source_policy as Record<string, unknown>).mode =
        "agent_researched_agricultural_qualification";
    },
    (value) => {
      value.rfq_questions = CONSULTANT_AGRICULTURAL_RFQ_QUESTIONS.map(
        ([questionId, requiredResponse], index) => ({
          order: index + 1,
          question_id: questionId,
          required_response: requiredResponse,
          response_state: "not_collected",
        }),
      );
    },
    (value) => {
      (value.rfq_execution_snapshot as Record<string, unknown>).state =
        "governed_agricultural_planning_only";
    },
    (value) => {
      const snapshot = value.rfq_execution_snapshot as Record<string, unknown>;
      (snapshot.audit_identity as Record<string, unknown>).event_type =
        "AGRICULTURAL_WAVE_SNAPSHOT_PROJECTED";
    },
    (value) => {
      (value.full_limitations as Record<string, unknown>).qualification_scope =
        "governed_agricultural_qualification";
    },
  ];
  for (const mutate of mutations) {
    const projection = validProjection();
    mutate(projection);
    assert.throws(() => parseConsultantResultProjectionV2(projection));
  }
});

test("publishes Consultant v2 as an additive closed contract", () => {
  assert.equal(
    contractSha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  const schemas = generateContractSchemas() as {
    schemas: Record<string, Record<string, unknown>>;
  };
  const v1 = schemas.schemas.consultantResultProjection!;
  const v2 = schemas.schemas.consultantResultProjectionV2!;
  assert.equal(v1.additionalProperties, false);
  assert.equal(v2.additionalProperties, false);
  assert.doesNotMatch(JSON.stringify(v1), /rfq_questions/u);
  assert.match(JSON.stringify(v2), /rfq_questions/u);
  assert.match(
    JSON.stringify(v2),
    /blocked_pending_attributable_sme_validation/u,
  );
});

test("parses the closed source-facts projection and preserves fail-closed boundaries", () => {
  const parsed = parseConsultantResultProjectionV2(validProjection());
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(parsed.rfq_questions.length, 20);
  assert.equal(parsed.due_diligence_checklist.length, 8);
  assert.equal(parsed.source_facts.length, 1);
  assert.equal(
    parsed.agent_authorship.human_consultant_authorship,
    "not_claimed",
  );
  assert.equal(parsed.full_limitations.production_release, "blocked");
});

test("rejects forged authorship, incomplete questions, empty exclusions, and ranking drift", () => {
  const forged = validProjection();
  (
    forged.agent_authorship as Record<string, unknown>
  ).human_consultant_authorship = "approved";
  assert.throws(
    () => parseConsultantResultProjectionV2(forged),
    /authorship boundary/iu,
  );

  const incomplete = validProjection();
  (incomplete.rfq_questions as unknown[]).pop();
  assert.throws(
    () => parseConsultantResultProjectionV2(incomplete),
    /incomplete/iu,
  );

  const emptyReason = validProjection();
  (
    emptyReason.excluded_evidence as Record<string, unknown>[]
  )[0]!.exclusion_reason = " ";
  assert.throws(
    () => parseConsultantResultProjectionV2(emptyReason),
    /non-empty/iu,
  );

  const reserveDrift = validProjection();
  (reserveDrift.reserve_candidates as unknown[]).push({
    candidate_id: "CAND-FAILED",
    rank: 1,
    display_name: "Failed candidate",
    country_code: "US",
    eligibility_basis: "eligible_candidate_ids_only",
    promotion_state: "next_ranked_eligible",
  });
  assert.throws(
    () => parseConsultantResultProjectionV2(reserveDrift),
    /count is inconsistent/iu,
  );

  const fixtureDomain = validProjection();
  (
    fixtureDomain.source_facts as Record<string, unknown>[]
  )[0]!.publisher_domain = "forged.example";
  assert.throws(
    () => parseConsultantResultProjectionV2(fixtureDomain),
    /fixture.*derived domain/iu,
  );

  const acceptedUnreferenced = validProjection();
  const accepted = (
    acceptedUnreferenced.source_facts as Record<string, unknown>[]
  )[0]!;
  accepted.verification_disposition = "accepted";
  delete accepted.exclusion_reason;
  acceptedUnreferenced.excluded_evidence = [];
  assert.throws(
    () => parseConsultantResultProjectionV2(acceptedUnreferenced),
    /not referenced/iu,
  );

  const invalidTimestamp = validProjection();
  (invalidTimestamp.source_facts as Record<string, unknown>[])[0]!.accessed_at =
    "2026-08-25 00:00:00";
  assert.throws(
    () => parseConsultantResultProjectionV2(invalidTimestamp),
    /retrieval timestamp/iu,
  );

  const liveDomainMismatch = validProjection();
  for (const collection of ["source_facts", "excluded_evidence"] as const) {
    const fact = (
      liveDomainMismatch[collection] as Record<string, unknown>[]
    )[0]!;
    delete fact.fixture_identity;
    fact.exact_url = "https://canonical.example.test/evidence";
    fact.publisher_domain = "forged.example.test";
    fact.provenance = "live_secure_fetch";
  }
  assert.throws(
    () => parseConsultantResultProjectionV2(liveDomainMismatch),
    /publisher domain is inconsistent/iu,
  );

  const boundedLongUrl = validProjection();
  const longUrl = `https://canonical.example.test/${"bounded-segment-".repeat(40)}`;
  for (const collection of ["source_facts", "excluded_evidence"] as const) {
    const fact = (boundedLongUrl[collection] as Record<string, unknown>[])[0]!;
    delete fact.fixture_identity;
    fact.exact_url = longUrl;
    fact.publisher_domain = "canonical.example.test";
    fact.provenance = "live_secure_fetch";
  }
  const parsedLongUrl =
    parseConsultantResultProjectionV2(boundedLongUrl).source_facts[0]!;
  assert.ok("exact_url" in parsedLongUrl);
  assert.equal(parsedLongUrl.exact_url, longUrl);

  const invalidProvenance = validProjection();
  for (const collection of ["source_facts", "excluded_evidence"] as const) {
    const fact = (
      invalidProvenance[collection] as Record<string, unknown>[]
    )[0]!;
    delete fact.fixture_identity;
    fact.exact_url = "https://canonical.example.test/evidence";
    fact.publisher_domain = "canonical.example.test";
    fact.provenance = "repository_fixture";
  }
  assert.throws(
    () => parseConsultantResultProjectionV2(invalidProvenance),
    /live source fact provenance/iu,
  );

  const oversizedExcerpt = validProjection();
  (oversizedExcerpt.source_facts as Record<string, unknown>[])[0]!.extract =
    "x".repeat(2_001);
  assert.throws(
    () => parseConsultantResultProjectionV2(oversizedExcerpt),
    /excerpt exceeds/iu,
  );

  const invalidWaveHash = validProjection();
  (
    invalidWaveHash.rfq_execution_snapshot as Record<string, unknown>
  ).wave_instance_id = "not-a-digest";
  assert.throws(
    () => parseConsultantResultProjectionV2(invalidWaveHash),
    /wave instance digest/iu,
  );

  const forgedWaveDigest = validProjection();
  (
    forgedWaveDigest.rfq_execution_snapshot as Record<string, unknown>
  ).wave_instance_id = "e".repeat(64);
  assert.throws(
    () => parseConsultantResultProjectionV2(forgedWaveDigest),
    /wave instance digest is inconsistent/iu,
  );

  const forgedAuditDigest = validProjection();
  const forgedAudit = (
    forgedAuditDigest.rfq_execution_snapshot as Record<string, unknown>
  ).audit_identity as Record<string, unknown>;
  forgedAudit.event_id = "f".repeat(64);
  assert.throws(
    () => parseConsultantResultProjectionV2(forgedAuditDigest),
    /audit event digest is inconsistent/iu,
  );

  const releaseAfterBinding = validProjection();
  (
    releaseAfterBinding.configuration_release as Record<string, unknown>
  ).effective_release_at = "2026-08-26T00:00:00.000Z";
  assert.throws(
    () => parseConsultantResultProjectionV2(releaseAfterBinding),
    /cannot follow binding/iu,
  );
});
