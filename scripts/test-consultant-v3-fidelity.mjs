#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  extractExplicitRequirementLedger,
  validateStep1RequirementFidelity,
} from "../packages/contracts/dist/src/index.js";
import { PreparationModelGateway } from "../packages/application/dist/index.js";

console.log(
  "=== MatchBASE Consultant V3 Step-1 Requirement Fidelity Test Suite ===",
);

async function runTests() {
  const sampleWaterHeaterIntake = {
    product_requirement:
      "Commercial / Industrial Electric Water Heater 500 Litres, maximum outer diameter 85 cm for indoor mechanical room installation.",
    technical_compliance:
      "10 bar working pressure, three-phase 400V 50Hz, CE and PED compliance, BMS-compatible thermostat integration, installation support, local spare parts availability, and two-year UAE warranty.",
    order_profile:
      "Batch of 10 units for hotel project in Dubai, DDP Dubai delivery terms.",
  };

  // 1. Ledger Extraction Verification
  console.log("\n--- [Step 1] Explicit Requirement Ledger Extraction ---");
  const ledger = extractExplicitRequirementLedger(sampleWaterHeaterIntake);
  assert.ok(
    ledger.total_explicit_count >= 8,
    `Expected at least 8 explicit clauses, found ${ledger.total_explicit_count}`,
  );

  const labels = ledger.requirements.map((r) => r.normalized_label);
  assert.ok(
    labels.includes("Storage Capacity"),
    "Ledger must include Storage Capacity",
  );
  assert.ok(
    labels.includes("Maximum External Diameter"),
    "Ledger must include Maximum External Diameter",
  );
  assert.ok(
    labels.includes("Installation Environment"),
    "Ledger must include Installation Environment (indoor)",
  );
  assert.ok(
    labels.includes("Operating Pressure"),
    "Ledger must include Operating Pressure (10 bar)",
  );
  assert.ok(
    labels.includes("Electrical Power Supply"),
    "Ledger must include Electrical Power Supply (400V 3-phase)",
  );
  assert.ok(
    labels.includes("Automation & Controls"),
    "Ledger must include Automation & Controls (BMS)",
  );
  assert.ok(
    labels.includes("Warranty Period"),
    "Ledger must include Warranty Period (2-year)",
  );
  assert.ok(
    labels.includes("Order Quantity"),
    "Ledger must include Order Quantity (10 units)",
  );
  console.log(
    `✔ Extracted ${ledger.total_explicit_count} explicit requirement items with complete provenance`,
  );

  // 2. Fidelity Gate - Prohibited Substitution Detection
  console.log(
    "\n--- [Step 2] Prohibited Substitution Detection (5-Year Substituted for 2-Year) ---",
  );
  const mutatedStep1 = {
    english_translation:
      "Industrial water heater 500L, max 85cm diameter, indoor installation, 10 bar, 400V three-phase, CE/PED, BMS-compatible thermostat, and 5-year tank warranty.",
    mandatory_requirements: [
      "500 Litres calorifier",
      "Maximum outer diameter 85 cm",
      "Indoor mechanical room installation",
      "10 bar working pressure",
      "Three-phase 400V supply",
      "CE and PED conformity",
      "BMS-compatible thermostat integration",
      "Minimum 5-year tank warranty",
      "Order quantity: 10 units",
      "DDP Dubai delivery terms",
    ],
    explicit_requirements: [],
    model_suggestions: [],
  };

  const mutatedVal = validateStep1RequirementFidelity(
    sampleWaterHeaterIntake,
    mutatedStep1,
  );
  assert.equal(mutatedVal.valid, false, "Mutation must be flagged as invalid");
  assert.ok(
    mutatedVal.mutated_count > 0,
    "Must record at least one mutated item",
  );
  assert.ok(
    mutatedVal.mutated_items.some(
      (m) => m.prohibited_value === "5-year tank warranty",
    ),
    "Must specifically identify '5-year tank warranty' as prohibited substitution",
  );
  console.log(
    "✔ Detected and rejected prohibited substitution: 5-year tank warranty replacing requested 2-year warranty",
  );

  // 3. Fidelity Gate - Omission Detection
  console.log(
    "\n--- [Step 3] Omission Detection (Omitted BMS & Indoor Installation) ---",
  );
  const omittedStep1 = {
    english_translation:
      "Industrial water heater 500L, max 85cm diameter, 10 bar, 400V three-phase, CE/PED, two-year UAE warranty, 10 units DDP Dubai.",
    mandatory_requirements: [
      "500 Litres calorifier",
      "Maximum outer diameter 85 cm",
      "10 bar working pressure",
      "Three-phase 400V supply",
      "CE and PED conformity",
      "Two-year UAE warranty",
      "Order quantity: 10 units",
      "DDP Dubai delivery terms",
    ],
    explicit_requirements: [],
    model_suggestions: [],
  };

  const omittedVal = validateStep1RequirementFidelity(
    sampleWaterHeaterIntake,
    omittedStep1,
  );
  assert.equal(
    omittedVal.valid,
    false,
    "Omission must cause validation to fail",
  );
  assert.ok(
    omittedVal.omitted_count >= 2,
    `Expected at least 2 omitted items, got ${omittedVal.omitted_count}`,
  );
  const omittedLabels = omittedVal.omitted_items.map((o) => o.normalized_label);
  assert.ok(
    omittedLabels.includes("Automation & Controls"),
    "Must flag omitted BMS thermostat",
  );
  assert.ok(
    omittedLabels.includes("Installation Environment"),
    "Must flag omitted indoor installation",
  );
  console.log(
    `✔ Detected omitted explicit requirements: ${omittedLabels.join(", ")}`,
  );

  // 4. Preparation Gateway Integration Verification
  console.log(
    "\n--- [Step 4] Preparation Gateway End-to-End Extraction & Fidelity ---",
  );
  const gateway = new PreparationModelGateway();
  const step1Result = await gateway.extractAndInterpret(
    sampleWaterHeaterIntake,
  );

  assert.ok(
    step1Result.fidelity_validation,
    "Gateway result must contain fidelity_validation",
  );
  assert.equal(
    step1Result.fidelity_validation.valid,
    true,
    `Gateway output must be valid: ${step1Result.fidelity_validation.explanation}`,
  );
  assert.equal(
    step1Result.fidelity_validation.mutated_count,
    0,
    "Gateway output must have 0 mutations",
  );
  assert.equal(
    step1Result.fidelity_validation.omitted_count,
    0,
    "Gateway output must have 0 omissions",
  );

  // Verify Warranty Fidelity in Approved Facts
  const mandatoryJoined = step1Result.mandatory_requirements.join(" ");
  assert.ok(
    /two[- ]year|2[- ]year|24[- ]months/i.test(mandatoryJoined),
    "Mandatory requirements must preserve requested 2-year UAE warranty",
  );
  assert.ok(
    !/5[- ]year\s*(?:tank\s*)?warranty/i.test(mandatoryJoined),
    "Mandatory requirements must NOT contain 5-year tank warranty",
  );

  // Verify BMS and Indoor Installation in Approved Facts
  assert.ok(
    /bms/i.test(mandatoryJoined),
    "Mandatory requirements must preserve BMS-compatible thermostat",
  );
  assert.ok(
    /indoor/i.test(mandatoryJoined),
    "Mandatory requirements must preserve indoor installation",
  );

  // Verify Model Suggestions Separation
  assert.ok(
    step1Result.model_suggestions,
    "Model suggestions array must be present",
  );
  assert.ok(
    step1Result.model_suggestions.length > 0,
    "Should include model suggestion for 5-year warranty",
  );
  assert.ok(
    step1Result.model_suggestions.some((s) =>
      s.suggested_value.includes("5-year"),
    ),
    "Model suggestion must hold the 5-year consideration separately",
  );
  console.log(
    "✔ Gateway successfully preserved 2-year warranty, BMS thermostat, and indoor installation",
  );
  console.log(
    "✔ Model suggestions for 5-year warranty kept strictly separate from approved facts",
  );

  console.log("\n=======================================================");
  console.log("✔ ALL CONSULTANT V3 REQUIREMENT FIDELITY TESTS PASSED!");
  console.log("=======================================================\n");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
