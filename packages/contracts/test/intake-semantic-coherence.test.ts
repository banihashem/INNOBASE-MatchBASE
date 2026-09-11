import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectAllDomains,
  validateIntakeSemanticCoherence,
  validateConsultantOutputV3SemanticCoherence,
  GOLDEN_SCENARIO_V3_01,
  GOLDEN_SCENARIO_V3_02,
} from "../src/index.js";

test("MB-UX-QUALITY-001 L02 chemical uses and transport classification do not invent conflicting products", () => {
  const result = validateIntakeSemanticCoherence({
    productRequirement:
      "Supply industrial potassium hydroxide (KOH) flakes. Application context: fertilizer production, soap manufacturing, neutralization in water treatment and battery electrolytes.",
    technicalCompliance:
      "Minimum purity 90%. Moisture-resistant packaging, CoA, SDS/MSDS and Certificate of Origin. Dangerous-goods classification: Class 8. Food Grade documentation applies only if that grade is required.",
    orderProfile: "Manufacturer in China. Order quantity remains unspecified.",
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.conflicts, []);
});

test("MB-UX-QUALITY-001 L02 words containing old catalog fragments are not product identities", () => {
  for (const text of [
    "classification",
    "classified emulsifier",
    "pumpkin seed oil",
    "coffeehouse furniture",
    "بنادر چین",
    "مضخاتية",
  ]) {
    assert.deepEqual(detectAllDomains(text), [], text);
  }
});

test("MB-UX-QUALITY-001 L02 cross-industry certificates and parameters alone do not establish a product family", () => {
  for (const text of [
    "SFDA / MAPA / SIF; Halal certification",
    "ISO 9001; PED 2014/68/EU; 10 bar",
    "water treatment; desalination; permeate; brackish water",
    "تصفیه آب و تحلية المياه",
  ]) {
    assert.deepEqual(detectAllDomains(text), [], text);
  }
});

test("MB-UX-QUALITY-001 L02 actual identities retain case, plural and multilingual detection", () => {
  const cases: [string, string[]][] = [
    ["Commercial WATER HEATERS, 500 litres", ["water_heater"]],
    ["Frozen whole chickens", ["poultry"]],
    ["MAPA/SIF slaughterhouses", ["poultry"]],
    ["RO membranes and filtration systems", ["reverse_osmosis"]],
    ["centrifugal pumps", ["pump"]],
    ["قهوه", ["coffee"]],
    ["آبگرمکن برقی", ["water_heater"]],
    ["گوشت مرغ", ["poultry"]],
    ["مضخات", ["pump"]],
    ["الدجاج المجمد", ["poultry"]],
    ["الدواجن", ["poultry"]],
    ["المضخات", ["pump"]],
    ["پمپهای صنعتی", ["pump"]],
    ["آبگرمکنهای صنعتی", ["water_heater"]],
    ["آبگرمکن‌های صنعتی", ["water_heater"]],
  ];
  for (const [text, domains] of cases)
    assert.deepEqual(detectAllDomains(text), domains, text);
});

test("MB-UX-QUALITY-001 L02 genuine mixed products still block intake before interpretation", () => {
  const cases = [
    {
      productRequirement: "Commercial water heaters",
      technicalCompliance:
        "Halal poultry slaughter and SFDA slaughterhouse registration",
    },
    {
      productRequirement: "Frozen whole chickens",
      technicalCompliance: "Three-phase heater, calorifier standards",
    },
    {
      productRequirement: "Industrial water heaters and frozen chickens",
    },
    {
      productRequirement: "آبگرمکن برقی صنعتی",
      technicalCompliance:
        "Halal poultry slaughter; MAPA/SIF slaughterhouse traceability",
    },
    {
      productRequirement: "General sourcing",
      technicalCompliance: "RO membranes",
      orderProfile: "Monthly shipments of frozen chicken",
    },
    {
      productRequirement: "الدجاج المجمد",
      technicalCompliance: "Commercial water heaters",
    },
    {
      productRequirement: "آبگرمکنهای صنعتی",
      technicalCompliance: "Frozen chicken",
    },
    {
      productRequirement: "پمپهای صنعتی",
      technicalCompliance: "Frozen chicken",
    },
  ];
  for (const intake of cases) {
    const result = validateIntakeSemanticCoherence(intake);
    assert.equal(result.valid, false, JSON.stringify(intake));
    assert.ok(result.conflicts.length > 0);
  }
});

test("MB-UX-QUALITY-001 L02 output contamination and demonstration safeguards remain enforced", () => {
  for (const output of [GOLDEN_SCENARIO_V3_01, GOLDEN_SCENARIO_V3_02])
    assert.equal(
      validateConsultantOutputV3SemanticCoherence(output).valid,
      true,
    );
  const output = {
    ...GOLDEN_SCENARIO_V3_02,
    primary_classification: {
      ...GOLDEN_SCENARIO_V3_02.primary_classification,
      code: "0207.12",
    },
  };
  assert.equal(
    validateConsultantOutputV3SemanticCoherence(output).valid,
    false,
  );
});
