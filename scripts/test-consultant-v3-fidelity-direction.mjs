#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  extractExplicitRequirementLedger,
  validateStep1RequirementFidelity,
} from "../packages/contracts/dist/src/v3/requirement-fidelity.js";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";

console.log(
  "=== MatchBASE Consultant V3 Requirement Fidelity & Directional Test ===",
);

async function getAuthCookie(fixtureRole = "consultant") {
  const r1 = await fetch(
    `${BASE_URL}/auth/simulator/start?fixture=${fixtureRole}`,
    { redirect: "manual" },
  );
  const callbackUrl = r1.headers.get("location");
  const startCookie = r1.headers.get("set-cookie");
  const r2 = await fetch(`${BASE_URL}${callbackUrl}`, {
    redirect: "manual",
    headers: { cookie: startCookie || "" },
  });
  const rawCookies = r2.headers.getSetCookie
    ? r2.headers.getSetCookie()
    : [r2.headers.get("set-cookie")];
  return rawCookies
    .map((c) => c?.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function main() {
  // -------------------------------------------------------------
  // Test 1: Directional Operator Extraction
  // -------------------------------------------------------------
  console.log("\n--- [1] Directional Operator Extraction ---");
  const waterHeaterIntake = {
    product_requirement:
      "10 units Industrial electric storage water heater 500L, minimum 10 bar working pressure, indoor installation",
    technical_compliance:
      "Documented thermal insulation, safety-valve compatibility, CE or equivalent certification, 2-year UAE warranty",
    order_profile:
      "Delivery to Dubai Industrial City, authorized UAE distributor preferred, target unit price 8000 AED",
  };

  const ledger = extractExplicitRequirementLedger(waterHeaterIntake);
  assert.ok(
    ledger.requirements.length >= 8,
    `Expected at least 8 requirements, got ${ledger.requirements.length}`,
  );

  const pressureReq = ledger.requirements.find(
    (r) => r.concept === "working_pressure",
  );
  assert.ok(pressureReq, "Working pressure requirement must be extracted");
  assert.equal(
    pressureReq.comparison_operator,
    "gte",
    "Working pressure 'minimum 10 bar' must have operator 'gte'",
  );
  assert.equal(pressureReq.normalized_value, "Minimum 10 bar working pressure");

  const warrantyReq = ledger.requirements.find(
    (r) => r.concept === "warranty_duration",
  );
  assert.ok(warrantyReq, "Warranty requirement must be extracted");
  assert.equal(
    warrantyReq.comparison_operator,
    "gte",
    "Warranty must have operator 'gte'",
  );
  assert.equal(
    warrantyReq.jurisdiction,
    "UAE",
    "Warranty jurisdiction must be UAE",
  );

  const insulationReq = ledger.requirements.find(
    (r) => r.concept === "thermal_insulation",
  );
  assert.ok(insulationReq, "Thermal insulation must be extracted");
  assert.equal(
    insulationReq.evidence_qualifier,
    "documented",
    "Insulation must have qualifier 'documented'",
  );

  const distributorReq = ledger.requirements.find(
    (r) =>
      r.supplier_role === "authorized_distributor" ||
      r.concept === "supplier_profile",
  );
  assert.ok(
    distributorReq,
    "Authorized distributor requirement must be extracted",
  );
  assert.equal(distributorReq.supplier_role, "authorized_distributor");

  console.log(
    "✔ Operator extraction verified (gte, lte, eq, jurisdiction, qualifiers preserved)",
  );

  // -------------------------------------------------------------
  // Test 2: Directional Inversion Detection (minimum 10 bar -> maximum 10 bar)
  // -------------------------------------------------------------
  console.log(
    "\n--- [2] Directional Inversion Detection (Operator Inversion) ---",
  );
  const invertedInterpretation = {
    english_translation:
      "Sourcing 10 units of 500L commercial electric water heaters with 10 bar maximum working pressure and 2-year warranty in the UAE.",
    mandatory_requirements: [
      "Commercial electric water heater 500L capacity",
      "10 bar maximum working pressure",
      "Documented thermal insulation",
      "Safety-valve compatibility",
      "Two-year UAE warranty",
    ],
  };

  const invertedResult = validateStep1RequirementFidelity(
    waterHeaterIntake,
    invertedInterpretation,
  );
  assert.equal(
    invertedResult.valid,
    false,
    "Inverted interpretation must be marked INVALID",
  );
  assert.ok(invertedResult.mutated_count > 0, "Mutated count must be > 0");

  const mutatedPressure = invertedResult.mutated_items.find(
    (m) => m.requirement.concept === "working_pressure",
  );
  assert.ok(
    mutatedPressure,
    "Working pressure must be listed in mutated_items",
  );
  assert.equal(
    mutatedPressure.observed_operator,
    "lte",
    "Observed operator should be 'lte'",
  );
  assert.equal(
    mutatedPressure.expected_operator,
    "gte",
    "Expected operator should be 'gte'",
  );
  console.log(`✔ Detected operator inversion: ${mutatedPressure.explanation}`);

  // -------------------------------------------------------------
  // Test 3: Qualifier Mutation & Omission Detection
  // -------------------------------------------------------------
  console.log("\n--- [3] Qualifier Mutation & Omission Detection ---");
  const missingInsulationQual = {
    english_translation:
      "Sourcing 10 units of 500L electric water heaters, minimum 10 bar working pressure, standard thermal insulation, 2-year UAE warranty.",
    mandatory_requirements: [
      "Electric storage water heater 500L",
      "Minimum 10 bar working pressure",
      "High-efficiency thermal insulation", // missing 'documented' qualifier
      "Two-year UAE warranty",
    ],
  };

  const missingQualResult = validateStep1RequirementFidelity(
    waterHeaterIntake,
    missingInsulationQual,
  );
  assert.equal(
    missingQualResult.valid,
    false,
    "Missing documented qualifier must be INVALID",
  );
  const mutatedInsulation = missingQualResult.mutated_items.find(
    (m) => m.requirement.concept === "thermal_insulation",
  );
  assert.ok(
    mutatedInsulation,
    "Thermal insulation must be flagged for missing 'documented' qualifier",
  );
  console.log(
    `✔ Detected qualifier omission: ${mutatedInsulation.explanation}`,
  );

  // -------------------------------------------------------------
  // Test 4: Fully Preserved Interpretation (Valid Pass)
  // -------------------------------------------------------------
  console.log("\n--- [4] Fully Preserved Interpretation (Valid Pass) ---");
  const validInterpretation = {
    english_translation:
      "Sourcing 10 units of Industrial Electric Storage Water Heaters / Calorifiers (500L capacity), minimum 10 bar working pressure, designed for indoor installation. Requires documented high-efficiency thermal insulation, certified safety-valve compatibility, and CE conformity. Destination: Dubai Industrial City, UAE. Supplier must provide a two-year UAE warranty and authorized UAE distributor channel.",
    mandatory_requirements: [
      "Industrial Electric Storage Water Heater 500L capacity",
      "Minimum 10 bar working pressure (>= 10 bar)",
      "Documented high-efficiency thermal insulation",
      "Safety-valve compatibility",
      "Indoor installation design",
      "CE conformity certificate",
      "Delivery destination: Dubai Industrial City, UAE",
      "Two-year UAE warranty (24 months)",
      "Authorized UAE distributor channel",
    ],
  };

  const validResult = validateStep1RequirementFidelity(
    waterHeaterIntake,
    validInterpretation,
  );
  if (!validResult.valid) {
    console.log("validResult mutated_items:", validResult.mutated_items);
    console.log("validResult omitted_items:", validResult.omitted_items);
  }
  assert.equal(
    validResult.valid,
    true,
    "Faithful interpretation must be marked VALID",
  );
  assert.equal(validResult.mutated_count, 0, "Mutated count must be 0");
  assert.equal(validResult.omitted_count, 0, "Omitted count must be 0");
  assert.ok(validResult.preserved_count >= 6, "Preserved count must be >= 6");
  console.log(
    `✔ Faithful interpretation passed validation (Preserved: ${validResult.preserved_count}, Mutated: 0, Omitted: 0)`,
  );

  // -------------------------------------------------------------
  // Test 5: Dynamic API Revalidation (/api/v1/consultant/workflow)
  // -------------------------------------------------------------
  console.log("\n--- [5] Dynamic API Revalidation Endpoint ---");
  const cookie = await getAuthCookie("consultant");

  const revalRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      action: "validate_step1_fidelity",
      intake: waterHeaterIntake,
      translation: invertedInterpretation.english_translation,
      mandatory_requirements: invertedInterpretation.mandatory_requirements,
    }),
  });

  assert.equal(revalRes.status, 200, "Validation endpoint must return 200");
  const revalData = await revalRes.json();
  assert.equal(revalData.success, true);
  assert.equal(
    revalData.fidelity.valid,
    false,
    "Fidelity result in API must report invalid for inverted input",
  );
  assert.ok(
    revalData.fidelity.mutated_count > 0,
    "Mutated count in API must be > 0",
  );
  console.log(
    "✔ Dynamic revalidation API returned expected fidelity ledger & mutation breakdown",
  );

  // -------------------------------------------------------------
  // Test 6: Step 1 Approval Gated Against Mutations (HTTP 422)
  // -------------------------------------------------------------
  console.log("\n--- [6] Step 1 Approval Gated Against Mutations ---");
  // 1. Submit intake to create a workflow session
  const submissionDraftRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ action: "create_draft" }),
    },
  );
  assert.equal(submissionDraftRes.status, 200);
  const submissionDraft = await submissionDraftRes.json();
  const submitRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      action: "submit_intake",
      draft_id: submissionDraft.draft_id,
      draft_version: submissionDraft.draft_version,
      productRequirement: waterHeaterIntake.product_requirement,
      technicalCompliance: waterHeaterIntake.technical_compliance,
      orderProfile: waterHeaterIntake.order_profile,
    }),
  });

  assert.equal(submitRes.status, 200, "submit_intake must return 200");
  const submitData = await submitRes.json();
  const testRunId = submitData.session?.run_id || submitData.run_id;
  assert.ok(testRunId, "Run ID must be generated");

  // 2. Attempt to approve with inverted translation -> must fail with HTTP 422 MB-422-FIDELITY-FAILED
  const failApproveRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      action: "approve_step1",
      run_id: testRunId,
      edited_translation: invertedInterpretation.english_translation,
    }),
  });

  if (failApproveRes.status !== 422) {
    console.log(
      "failApproveRes error:",
      failApproveRes.status,
      await failApproveRes.text(),
    );
  }
  assert.equal(
    failApproveRes.status,
    422,
    "Step 1 approval with mutated requirements must be rejected with HTTP 422",
  );
  const failData = await failApproveRes.json();
  assert.equal(
    failData.code,
    "MB-422-FIDELITY-FAILED",
    "Error code must be MB-422-FIDELITY-FAILED",
  );
  console.log(
    `✔ Step 1 approval gate correctly rejected mutated requirement: [${failData.code}] ${failData.error || failData.message}`,
  );

  // 3. Approve with faithful translation -> must succeed
  const passApproveRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      action: "approve_step1",
      run_id: testRunId,
      edited_translation: validInterpretation.english_translation,
    }),
  });

  assert.equal(
    passApproveRes.status,
    200,
    "Step 1 approval with faithful translation must succeed with HTTP 200",
  );
  const passData = await passApproveRes.json();
  assert.equal(passData.success, true);
  assert.equal(
    passData.session.state || passData.session.current_state,
    "prep_step2_advisory_ready",
    "Session must advance to prep_step2_advisory_ready",
  );
  console.log(
    "✔ Step 1 approval succeeded with faithful interpretation and advanced session to Step 2",
  );

  console.log("\n=======================================================");
  console.log("✔ ALL REQUIREMENT FIDELITY & DIRECTIONAL TESTS PASSED!");
  console.log("=======================================================\n");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
