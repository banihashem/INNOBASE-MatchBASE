import assert from "node:assert/strict";
import {
  parseConsultantResearchOutputV2,
  isConsultantResearchOutputV2,
  adaptV1ToV2ConsultantOutput,
  CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
  GOLDEN_SCENARIOS,
} from "../packages/contracts/dist/src/index.js";

console.log("=== MatchBASE Consultant Deep-Research Output V2 Test Suite ===");
console.log(
  `Evaluating ${GOLDEN_SCENARIOS.length} Golden Scenarios against contract invariants...\n`,
);

assert.equal(
  GOLDEN_SCENARIOS.length,
  15,
  "Must have exactly 15 golden scenarios",
);

const resultIds = new Set();
const runIds = new Set();
const queryTypes = new Set();

for (const [index, scenario] of GOLDEN_SCENARIOS.entries()) {
  const scenarioNum = index + 1;
  const idStr = `SC-${String(scenarioNum).padStart(2, "0")}`;

  // 1. Validate runtime schema parsing
  const parsed = parseConsultantResearchOutputV2(scenario);
  assert.equal(
    parsed.schema_version,
    CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
  );
  assert.equal(isConsultantResearchOutputV2(parsed), true);

  // 2. Identity and run uniqueness
  assert.equal(
    resultIds.has(parsed.result_id),
    false,
    `${idStr}: Duplicate result_id ${parsed.result_id}`,
  );
  assert.equal(
    runIds.has(parsed.run_id),
    false,
    `${idStr}: Duplicate run_id ${parsed.run_id}`,
  );
  resultIds.add(parsed.result_id);
  runIds.add(parsed.run_id);

  // 3. Track primary query type
  const primaryType = parsed.request_snapshot.primary_query_type;
  queryTypes.add(primaryType);

  // 4. Invariant checks based on scenario status
  if (parsed.research_status === "no_strong_match") {
    assert.equal(
      parsed.supplier_candidates.length,
      0,
      `${idStr}: no_strong_match must have 0 candidates`,
    );
    assert.equal(
      typeof parsed.executive_summary.no_match_summary,
      "string",
      `${idStr}: missing no_match_summary`,
    );
  }

  if (parsed.supplier_candidates.length > 0) {
    for (const cand of parsed.supplier_candidates) {
      assert.equal(
        cand.fit_assessment.compatibility_score >= 0 &&
          cand.fit_assessment.compatibility_score <= 100,
        true,
        `${idStr}: score out of bounds`,
      );
      assert.equal(
        ["strong", "potential", "low"].includes(cand.fit_assessment.fit_band),
        true,
        `${idStr}: invalid fit_band`,
      );
      assert.equal(
        ["high", "medium", "low"].includes(
          cand.fit_assessment.evidence_confidence,
        ),
        true,
        `${idStr}: invalid evidence_confidence`,
      );
    }
  }

  // 5. Decision support must be populated
  assert.equal(typeof parsed.decision_support.advisory_notice, "string");
  assert.equal(parsed.decision_support.advisory_notice.length > 0, true);

  console.log(
    `✔ [${idStr}] ${parsed.result_id} | Type: ${primaryType.padEnd(22)} | Status: ${parsed.research_status.padEnd(22)} | Candidates: ${parsed.supplier_candidates.length}`,
  );
}

// Ensure all 6 query types covered
const requiredQueryTypes = [
  "sourcing",
  "pricing",
  "product_recommendation",
  "product_catalog",
  "market_overview",
  "general_info",
];

for (const qt of requiredQueryTypes) {
  assert.equal(
    queryTypes.has(qt),
    true,
    `Query type "${qt}" was not covered in golden scenarios`,
  );
}

console.log("\nAll 6 required query types covered:");
for (const qt of requiredQueryTypes) {
  console.log(`  - ${qt}: verified`);
}

// 6. Test backward-compatibility adapter
console.log("\nTesting v1-to-v2 backward-compatibility adapter round-trip...");
const mockV1 = {
  schema_version: "consultant-result-projection.v1",
  run_id: "00000000-0000-4000-8000-000000000999",
  projection_version: 5,
  outcome: "matched",
  scarcity: "none",
  consultant_source_readiness: {
    state: "limited",
    notice: "Historical projection notice",
  },
  landscape: {
    eligible_count: 5,
    displayed_count: 1,
    soft_cap: 3,
    truncated: false,
    scarcity_override_applied: false,
  },
  synthetic_warning: "Synthetic test data",
  limitations: {
    unknown_count: 0,
    not_asked_count: 0,
    affected_low_confidence_dimensions: [],
    evidence_states: [],
    restricted_party_screening_notice: "Screened against OFAC",
    advisory_boundary: "Commercial terms require confirmation",
  },
  gate_eliminations: [],
  scarcity_analysis: {
    reducing_constraints: [],
    unmet_mandatory_constraints: [],
    permitted_relaxations: [],
  },
  candidates: [
    {
      display_name: "Arabian Halal Poultry Ltd",
      country_code: "SA",
      rationale_extended: "Domestic producer with active SFDA registration.",
      compatibility_score: 89,
      fit_band: "strong_fit",
      band_ceiling: "strong_fit",
      displayed_band: "strong_fit",
      dimension_scores: [
        {
          dimension_id: "category_product_fit",
          weight: 25,
          score: 90,
          confidence: "high",
        },
        {
          dimension_id: "compliance_certification_fit",
          weight: 20,
          score: 92,
          confidence: "high",
        },
        {
          dimension_id: "volume_capacity_fit",
          weight: 15,
          score: 85,
          confidence: "high",
        },
        {
          dimension_id: "price_tier_fit",
          weight: 15,
          score: 80,
          confidence: "medium",
        },
        {
          dimension_id: "positioning_brand_fit",
          weight: 15,
          score: 88,
          confidence: "high",
        },
        {
          dimension_id: "geographic_reach_fit",
          weight: 10,
          score: 90,
          confidence: "high",
        },
      ],
      positive_drivers: [
        {
          dimension_id: "category_product_fit",
          explanation: "Active local slaughterhouse license.",
          claim_id: "C1",
          evidence_ids: ["E1"],
        },
      ],
      limiting_gaps: [
        {
          dimension_id: "price_tier_fit",
          explanation: "Higher cost structure than imports.",
          claim_id: "C2",
          evidence_ids: ["E1"],
        },
      ],
      citations: [
        {
          evidence_id: "E1",
          title: "Ministry of Agriculture Registry",
          publisher: "Saudi MEWA",
          published_or_updated: "2026-01-01",
          accessed_at: "2026-08-01T00:00:00.000Z",
          source_tier: "primary",
          status: "externally_verified",
          access_state: "available",
          extract:
            "Licensed national poultry producer operating under certified veterinary supervision.",
          content_sha256: "0".repeat(64),
          provenance: "synthetic_fixture",
          exact_url: "https://mewa.gov.sa/registry/sample",
        },
      ],
      freshness: "current",
      verification_status: "externally_verified",
      evidence_confidence: "high",
    },
  ],
};

const adapted = adaptV1ToV2ConsultantOutput(mockV1);
const parsedAdapted = parseConsultantResearchOutputV2(adapted);
assert.equal(
  parsedAdapted.schema_version,
  CONSULTANT_RESEARCH_OUTPUT_V2_SCHEMA_VERSION,
);
assert.equal(parsedAdapted.supplier_candidates.length, 1);
assert.equal(parsedAdapted.evidence.length, 1);
console.log(
  "✔ V1-to-V2 adapter successfully validated and parsed through V2 contract parser.",
);

console.log("\n=== ALL 15 GOLDEN SCENARIOS & ADAPTER TESTS PASSED (PASS) ===");
