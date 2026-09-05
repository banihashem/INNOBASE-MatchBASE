#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  GOLDEN_SCENARIO_V3_01,
  GOLDEN_SCENARIO_V3_02,
  GOLDEN_SCENARIO_V3_03,
  GOLDEN_SCENARIO_V3_04,
  BRAZIL_POULTRY_GOLDEN_V3,
} from "../packages/contracts/dist/src/index.js";

console.log("=== MatchBASE Consultant V3 Demonstration Truth Test Suite ===");

const REAL_COMPANY_DENYLIST = [
  "atlantic",
  "ariston",
  "stiebel eltron",
  "stiebel-eltron",
  "brf",
  "sadia",
  "perdigao",
  "seara",
  "jbs",
];

const scenarios = [
  { name: "V3-01 Brazil Poultry", data: GOLDEN_SCENARIO_V3_01 },
  { name: "V3-02 UAE Water Heaters", data: GOLDEN_SCENARIO_V3_02 },
  { name: "V3-03 No Strong Match Water Heater", data: GOLDEN_SCENARIO_V3_03 },
  { name: "V3-04 Reverse Osmosis Partial", data: GOLDEN_SCENARIO_V3_04 },
  { name: "BRAZIL_POULTRY_GOLDEN_V3 (Alias)", data: BRAZIL_POULTRY_GOLDEN_V3 },
];

for (const { name, data } of scenarios) {
  console.log(`\n--- Checking Scenario: ${name} ---`);

  // 1. Research mode must be fixture
  assert.equal(
    data.research_mode,
    "fixture",
    `Scenario ${name} research_mode must be 'fixture'`,
  );
  console.log("✔ research_mode is 'fixture'");

  // 2. Telemetry invariants: no false provider execution claims
  assert.deepEqual(
    data.telemetry.lanes_executed,
    [],
    `Scenario ${name} lanes_executed must be empty [] in fixture mode`,
  );
  assert.equal(
    data.telemetry.total_cost_usd,
    0,
    `Scenario ${name} total_cost_usd must be 0 in fixture mode`,
  );
  console.log(
    "✔ telemetry contains zero live provider claims and 0.00 USD cost",
  );

  // 3. Denylist check across full scenario JSON
  const jsonStr = JSON.stringify(data).toLowerCase();
  for (const forbidden of REAL_COMPANY_DENYLIST) {
    const found = jsonStr.includes(forbidden);
    assert.ok(
      !found,
      `Scenario ${name} must NOT contain real company name '${forbidden}'`,
    );
  }
  console.log("✔ Zero real company brands found (denylist clean)");

  // 4. Verification status invariants on candidates & certifications
  for (const cand of data.supplier_candidates) {
    assert.ok(
      cand.legal_name.includes("[Illustrative]") ||
        cand.candidate_id.startsWith("cand-v3-") ||
        cand.candidate_id.startsWith("cand-demo-"),
      `Candidate ${cand.candidate_id} must have illustrative moniker`,
    );

    // No externally_verified
    if (cand.contacts?.verification_status) {
      assert.notEqual(
        cand.contacts.verification_status,
        "externally_verified",
        `Candidate ${cand.candidate_id} must not be externally_verified`,
      );
    }

    for (const cert of cand.certifications) {
      assert.notEqual(
        cert.verification_status,
        "externally_verified",
        `Cert ${cert.certification_name} must not be externally_verified`,
      );
      assert.notEqual(
        cert.verification_status,
        "verified",
        `Fixture cert ${cert.certification_name} must not be labelled verified without external authority`,
      );
    }

    // No live public websites
    if (cand.website) {
      assert.ok(
        cand.website.includes(".internal") || cand.website === "",
        `Candidate ${cand.candidate_id} website must be internal fixture domain, got: ${cand.website}`,
      );
    }
  }
  console.log(
    `✔ All ${data.supplier_candidates.length} candidates satisfy synthetic demonstration truth rules`,
  );
}

// 5. Specific check for V3-03 title
console.log("\n--- Checking V3-03 Title Integrity ---");
assert.equal(
  GOLDEN_SCENARIO_V3_03.title,
  "No Strong Match — Commercial Electric Water Heater 500L",
  "V3-03 title must be 'No Strong Match — Commercial Electric Water Heater 500L'",
);
assert.ok(
  !JSON.stringify(GOLDEN_SCENARIO_V3_03).includes("Cryogenic Water Heater"),
  "V3-03 must not contain any reference to 'Cryogenic Water Heater'",
);
console.log(
  "✔ V3-03 title is correctly 'No Strong Match — Commercial Electric Water Heater 500L' (Cryogenic Water Heater removed)",
);

console.log("\n=======================================================");
console.log("✔ ALL CONSULTANT V3 DEMONSTRATION TRUTH TESTS PASSED!");
console.log("=======================================================");
