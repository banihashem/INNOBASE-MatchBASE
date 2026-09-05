#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  validateIntakeSemanticCoherence,
  validateConsultantOutputV3SemanticCoherence,
  GOLDEN_SCENARIO_V3_01,
  GOLDEN_SCENARIO_V3_02,
} from "../packages/contracts/dist/src/index.js";

console.log("=== MatchBASE Consultant V3 Semantic Coherence Test Suite ===");

// 1. Intake Semantic Coherence Validation
console.log("\n1. Testing Intake Semantic Coherence...");

// 1a. Coherent Water Heater Intake -> PASS
const coherentWaterHeater = {
  productRequirement:
    "Commercial electric storage water heaters, 500 Litres capacity, outer diameter strictly under 85 cm for standard doorway clearance, vertical orientation.",
  technicalCompliance:
    "CE mark, EU Pressure Equipment Directive (PED 2014/68/EU), UAE MoIAT conformity, working pressure 10 bar.",
  orderProfile:
    "10 units initial order for commercial hotel renovation in Dubai, DDP delivery required.",
};
const res1 = validateIntakeSemanticCoherence(coherentWaterHeater);
assert.equal(res1.valid, true, "Coherent water heater intake must pass");
console.log("✔ Coherent water heater intake passed semantic validation");

// 1b. Coherent Poultry Intake -> PASS
const coherentPoultry = {
  productRequirement:
    "Frozen whole chicken, Grade A, 1000g - 1200g calibrated weight per bird, polybag packed in master cartons of 10 or 12 birds.",
  technicalCompliance:
    "SFDA approved foreign slaughterhouse registration, accredited Halal slaughter certification, veterinary health certificate.",
  orderProfile:
    "Regular recurring shipments of 5 to 10 40ft reefer containers per month, CIF or CFR Jeddah Islamic Port.",
};
const res2 = validateIntakeSemanticCoherence(coherentPoultry);
assert.equal(res2.valid, true, "Coherent poultry intake must pass");
console.log("✔ Coherent poultry intake passed semantic validation");

// 1c. Cross-domain contaminated intake (Water heater Box 1 + Poultry SFDA Halal Box 2) -> FAIL
const contaminatedIntake = {
  productRequirement:
    "Commercial electric storage water heaters, 500 Litres capacity, outer diameter 85 cm.",
  technicalCompliance:
    "Mandatory SFDA approved foreign slaughterhouse registration, Halal ritual slaughter certificate, poultry sanitary permit.",
  orderProfile: "10 units delivered to Dubai hotel project.",
};
const resContaminated = validateIntakeSemanticCoherence(contaminatedIntake);
assert.equal(
  resContaminated.valid,
  false,
  "Cross-domain contaminated intake must fail validation",
);
assert.ok(
  resContaminated.violations.length > 0,
  "Must report violations for cross-domain contamination",
);
console.log(
  `✔ Cross-domain intake correctly rejected with ${resContaminated.violations.length} violation(s): "${resContaminated.violations[0]}"`,
);

// 2. Output V3 Semantic Coherence Validation
console.log("\n2. Testing Output V3 Semantic Coherence...");

// 2a. Clean Golden Scenarios -> PASS
const outRes1 = validateConsultantOutputV3SemanticCoherence(
  GOLDEN_SCENARIO_V3_01,
);
assert.equal(outRes1.valid, true, "Golden Scenario V3-01 must pass coherence");
console.log("✔ Golden Scenario V3-01 passed coherence validation");

const outRes2 = validateConsultantOutputV3SemanticCoherence(
  GOLDEN_SCENARIO_V3_02,
);
assert.equal(outRes2.valid, true, "Golden Scenario V3-02 must pass coherence");
console.log("✔ Golden Scenario V3-02 passed coherence validation");

// 2b. Contaminated Output: Water Heater Title + Poultry Classification -> FAIL
const contaminatedClassification = {
  ...GOLDEN_SCENARIO_V3_02,
  primary_classification: {
    ...GOLDEN_SCENARIO_V3_02.primary_classification,
    scheme: "HS",
    code: "0207.12",
    label: "Meat and edible offal of the poultry of heading 01.05, frozen",
    description: "Frozen whole chicken and cuts",
  },
};
const outResBadClass = validateConsultantOutputV3SemanticCoherence(
  contaminatedClassification,
);
assert.equal(
  outResBadClass.valid,
  false,
  "Water heater title with poultry classification must fail coherence",
);
console.log(
  `✔ Water heater with poultry classification rejected: "${outResBadClass.violations[0]}"`,
);

// 2c. Contaminated Output: Poultry Claim in Water Heater Output -> FAIL
const contaminatedClaim = {
  ...GOLDEN_SCENARIO_V3_02,
  claims: [
    ...GOLDEN_SCENARIO_V3_02.claims,
    {
      claim_id: "claim-bad-poultry-01",
      candidate_id: GOLDEN_SCENARIO_V3_02.supplier_candidates[0].candidate_id,
      claim_type: "compliance",
      claim_text:
        "Supplier facility is certified for Islamic Halal poultry slaughter.",
      confidence: "high",
      status: "claimed",
      evidence_ids: [
        GOLDEN_SCENARIO_V3_02.supplier_candidates[0].certifications[0]
          .evidence_ids[0],
      ],
    },
  ],
};
const outResBadClaim =
  validateConsultantOutputV3SemanticCoherence(contaminatedClaim);
assert.equal(
  outResBadClaim.valid,
  false,
  "Water heater with poultry claim must fail coherence",
);
console.log(
  `✔ Water heater with poultry claim rejected: "${outResBadClaim.violations[0]}"`,
);

console.log("\n=======================================================");
console.log("✔ ALL CONSULTANT V3 SEMANTIC COHERENCE TESTS PASSED!");
console.log("=======================================================");
