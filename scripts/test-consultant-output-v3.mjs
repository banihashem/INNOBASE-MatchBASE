#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  BRAZIL_POULTRY_20_SUPPLIERS,
  BRAZIL_POULTRY_GOLDEN_V3,
  adaptV2ToV3ConsultantOutput,
  GOLDEN_SCENARIOS,
} from "../packages/contracts/dist/src/index.js";

console.log("Testing Consultant Output V3 Invariants...");

// 1. Validate BRAZIL_POULTRY_GOLDEN_V3 structure
assert.equal(
  BRAZIL_POULTRY_GOLDEN_V3.schema_version,
  "consultant-research-output.v3",
  "Schema version must be consultant-research-output.v3",
);
assert.equal(
  BRAZIL_POULTRY_GOLDEN_V3.schema_contract_version,
  1,
  "Schema contract version must be 1",
);

// 2. Validate Four-ID trace
assert.ok(
  BRAZIL_POULTRY_GOLDEN_V3.user_profile_id,
  "user_profile_id must exist",
);
assert.ok(
  BRAZIL_POULTRY_GOLDEN_V3.research_run_id,
  "research_run_id must exist",
);
assert.ok(BRAZIL_POULTRY_GOLDEN_V3.execution_id, "execution_id must exist");
assert.ok(
  BRAZIL_POULTRY_GOLDEN_V3.classification_id,
  "classification_id must exist",
);

// 3. Validate classification
assert.equal(BRAZIL_POULTRY_GOLDEN_V3.primary_classification.scheme, "HS");
assert.equal(BRAZIL_POULTRY_GOLDEN_V3.primary_classification.code, "0207.12");

// 4. Validate 20 suppliers count
assert.equal(
  BRAZIL_POULTRY_20_SUPPLIERS.length,
  20,
  "Must contain exactly 20 suppliers",
);
assert.equal(
  BRAZIL_POULTRY_GOLDEN_V3.supplier_candidates.length,
  20,
  "Must contain exactly 20 candidate entities",
);
assert.equal(
  BRAZIL_POULTRY_GOLDEN_V3.target_candidates_count,
  20,
  "Target candidate count must be 20",
);

// 5. Validate first 4 are Active Tier-1 candidates
const top4 = BRAZIL_POULTRY_GOLDEN_V3.supplier_candidates.slice(0, 4);
for (const s of top4) {
  assert.equal(
    s.manufacturer_status,
    "direct_manufacturer",
    `${s.legal_name} must be direct_manufacturer`,
  );
  assert.ok(
    s.assessment.compatibility_score >= 80,
    `${s.legal_name} must have compatibility score >= 80`,
  );
  assert.equal(
    s.assessment.fit_band,
    "Strong Fit",
    `${s.legal_name} must be Strong Fit`,
  );
}

// 6. Validate remaining 16 are Conditional candidates
const remaining16 = BRAZIL_POULTRY_GOLDEN_V3.supplier_candidates.slice(4);
assert.equal(remaining16.length, 16, "Remaining count must be 16");
for (const s of remaining16) {
  assert.ok(s.assessment.rank >= 5 && s.assessment.rank <= 20);
  assert.ok(s.country_of_registration, "country_of_registration must exist");
}

// 7. Validate all claims link to valid evidence sources
const evidenceIds = new Set(
  BRAZIL_POULTRY_GOLDEN_V3.evidence_sources.map((e) => e.evidence_id),
);
for (const cl of BRAZIL_POULTRY_GOLDEN_V3.claims) {
  assert.ok(
    cl.evidence_ids.length > 0,
    `Claim ${cl.claim_id} must have evidence`,
  );
  for (const evId of cl.evidence_ids) {
    assert.ok(
      evidenceIds.has(evId),
      `Claim ${cl.claim_id} references missing evidence ${evId}`,
    );
  }
}

// 8. Validate V2 to V3 adapter
const v2Scenario = GOLDEN_SCENARIOS[0];
if (v2Scenario) {
  const adapted = adaptV2ToV3ConsultantOutput(v2Scenario);
  assert.equal(adapted.schema_version, "consultant-research-output.v3");
  assert.equal(adapted.research_run_id, v2Scenario.run_id);
  assert.ok(adapted.supplier_candidates.length > 0);
  console.log("V2 to V3 adapter validation PASSED");
}

console.log("ALL CONSULTANT OUTPUT V3 CONTRACT TESTS PASSED \u2713");
