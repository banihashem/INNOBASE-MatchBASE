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

// 1a. Coherent Water Heater Intake (English) -> PASS
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
console.log("✔ 1. Coherent water heater intake passed semantic validation");

// 1b. Coherent Poultry Intake -> PASS
const coherentPoultry = {
  productRequirement:
    "Frozen whole chicken, Grade A, 1000g - 1200g calibrated weight per bird, polybag packed in master cartons of 10 or 12 birds.",
  technicalCompliance:
    "SFDA approved foreign slaughterhouse registration, accredited Halal slaughter certification, veterinary health certificate, reefer cold chain.",
  orderProfile:
    "Regular recurring shipments of 5 to 10 40ft reefer containers per month, CIF or CFR Jeddah Islamic Port.",
};
const res2 = validateIntakeSemanticCoherence(coherentPoultry);
assert.equal(res2.valid, true, "Coherent poultry intake must pass");
console.log("✔ 2. Coherent poultry intake passed semantic validation");

// 1c. Water heater + poultry slaughter requirements -> REJECT
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
  `✔ 3. Water heater + poultry slaughter correctly rejected: "${resContaminated.violations[0]}"`,
);

// 1d. Poultry + pressure vessel / three-phase heater -> REJECT
const poultryPlusHeater = {
  productRequirement:
    "Frozen whole chicken, Grade A, 1000g - 1200g calibrated weight per bird.",
  technicalCompliance:
    "Three-phase heater 18kW, 10 bar pressure vessel, CE-PED calorifier standards.",
  orderProfile: "5 containers CIF Jeddah.",
};
const resPoultryHeater = validateIntakeSemanticCoherence(poultryPlusHeater);
assert.equal(
  resPoultryHeater.valid,
  false,
  "Poultry + heater requirements must fail",
);
console.log(
  `✔ 4. Poultry + heater requirements correctly rejected: "${resPoultryHeater.violations[0]}"`,
);

// 1e. Multilingual Persian product (water heater) + English coherent technical details -> PASS
const persianWaterHeater = {
  productRequirement:
    "برای یک پروژه ساختمانی در دبی به دنبال آبگرمکن برقی ایستاده صنعتی با ظرفیت اسمی 500 لیتر هستیم.",
  technicalCompliance:
    "CE mark, PED 2014/68/EU compliance, working pressure 10 bar, vitreous enamel tank lining.",
  orderProfile: "Quantity: 10 units. DDP Dubai on-site delivery.",
};
const resPersianCoherent = validateIntakeSemanticCoherence(persianWaterHeater);
assert.equal(
  resPersianCoherent.valid,
  true,
  "Multilingual Persian water heater with coherent details must pass",
);
console.log(
  "✔ 5. Multilingual Persian water heater + coherent English technical details passed",
);

// 1f. Exact L05 Persian water heater + English poultry SFDA/Halal -> REJECT
const l05ExactContaminated = {
  productRequirement:
    "برای یک پروژه ساختمانی در دبی به دنبال آبگرمکن برقی ایستاده صنعتی با ظرفیت اسمی 500 لیتر هستیم.",
  technicalCompliance:
    "Halal poultry slaughter, active SFDA poultry-establishment eligibility, MAPA/SIF slaughterhouse traceability, and frozen storage at -18°C.",
  orderProfile:
    "Quantity: 10 units. DDP Dubai. Prefer a manufacturer or authorized UAE distributor.",
};
const resL05 = validateIntakeSemanticCoherence(l05ExactContaminated);
assert.equal(
  resL05.valid,
  false,
  "Exact L05 contaminated intake must fail validation",
);
assert.equal(
  resL05.conflicts[0]?.primary_product_family,
  "industrial_water_heater",
);
assert.equal(
  resL05.conflicts[0]?.conflicting_product_family,
  "poultry_food_product",
);
console.log(
  `✔ 6. Exact L05 Persian water heater + poultry correctly rejected with: "${resL05.conflicts[0]?.explanation}"`,
);

// 1g. Explicit two-unrelated-product request in Box 1 -> REJECT / CLARIFICATION
const multiProductIntake = {
  productRequirement:
    "Industrial electric water heaters and frozen whole chickens for new resort facility.",
  technicalCompliance: "Standard commercial and food safety regulations.",
  orderProfile: "Deliver to Dubai.",
};
const resMultiProduct = validateIntakeSemanticCoherence(multiProductIntake);
assert.equal(
  resMultiProduct.valid,
  false,
  "Explicit multi-product request must fail/request clarification",
);
assert.ok(
  resMultiProduct.conflicts[0]?.explanation.includes(
    "multiple unrelated product families",
  ),
);
console.log(
  `✔ 7. Explicit two-unrelated-product request correctly rejected: "${resMultiProduct.conflicts[0]?.explanation}"`,
);

// 1h. Generic supplier-contact / commercial requirements -> PASS (NO false positives)
const genericContactIntake = {
  productRequirement: "Frozen whole chicken, Grade A, 1000g per bird.",
  technicalCompliance:
    "Supplier must provide direct factory contact, official corporate website, verified email, and export price list. ISO 9001 certified.",
  orderProfile:
    "MOQ 2 containers, CIF Jeddah, payment via confirmed LC, 30 days delivery lead time.",
};
const resGenericContact = validateIntakeSemanticCoherence(genericContactIntake);
assert.equal(
  resGenericContact.valid,
  true,
  "Generic commercial/contact requirements must not trigger conflict",
);
console.log(
  "✔ 8. Generic supplier-contact & commercial requirements passed (zero false-positives)",
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
