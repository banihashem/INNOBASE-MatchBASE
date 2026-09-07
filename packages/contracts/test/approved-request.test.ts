import assert from "node:assert/strict";
import test from "node:test";
import {
  createApprovedRequestSnapshotV3,
  parseApprovedRequestFactsV3,
  verifyApprovedRequestSnapshotV3,
} from "../src/v3/approved-request.js";
import { parseConsultantResearchOutputV3 } from "../src/v3/consultant-research-output.js";
import { GOLDEN_SCENARIO_V3_01 } from "../src/v3/golden-scenarios.js";
import { validateStep1RequirementFidelity } from "../src/v3/requirement-fidelity.js";

const intake = {
  product_requirement:
    "Commercial electric water heater 500 Litres, maximum outer diameter 85 cm for indoor installation.",
  technical_compliance:
    "Minimum 10 bar working pressure, three-phase 400V 50Hz, documented thermal insulation, safety-valve compatibility, CE and PED compliance, BMS-compatible thermostat, local installation support, authorized UAE distributor, two-year UAE warranty.",
  order_profile: "Exactly 10 units, DDP Dubai.",
};
const text = Object.values(intake).join("\n");

test("MB-UX-LIVE-001 L01 rejects semantic omissions and unrelated token matches", () => {
  assert.equal(
    validateStep1RequirementFidelity(intake, { english_translation: text })
      .valid,
    true,
  );
  for (const [before, after, concept] of [
    ["400V", "415V", "electrical_power"],
    ["two-year UAE warranty", "two-year project schedule", "warranty_duration"],
    ["authorized UAE distributor, ", "", "supplier_profile"],
    ["Exactly 10 units, ", "", "order_quantity"],
    ["DDP Dubai", "EXW Dubai", "delivery_terms"],
    ["minimum 10 bar", "maximum 10 bar", "working_pressure"],
    ["safety-valve compatibility, ", "", "safety_valve_compatibility"],
    [
      "documented thermal insulation",
      "thermal insulation",
      "thermal_insulation",
    ],
  ]) {
    const changed = text.replace(new RegExp(before!, "i"), after!);
    const result = validateStep1RequirementFidelity(intake, {
      english_translation: changed,
      mandatory_requirements: [text],
      explicit_requirements: [{ source_text: text }],
    });
    assert.equal(result.valid, false, `${before} -> ${after}`);
    assert.ok(
      [
        ...result.omitted_items,
        ...result.mutated_items.map((m) => m.requirement),
      ].some((r) => r.concept === concept),
    );
  }
  assert.equal(
    validateStep1RequirementFidelity(intake, {
      english_translation: " ",
      mandatory_requirements: [text],
    }).valid,
    false,
  );
});

test("MB-UX-LIVE-001 L01 preserves equivalent units and independent delivery ranges", () => {
  const equivalent =
    text
      .replace("85 cm", "850 mm")
      .replace("two-year UAE warranty", "24-month UAE warranty") +
    "\nDelivery within 4-6 weeks.";
  const result = validateStep1RequirementFidelity(intake, {
    english_translation: equivalent,
  });
  assert.equal(result.valid, true, result.explanation);
  const facts = parseApprovedRequestFactsV3(equivalent).facts;
  assert.equal(facts.find((f) => f.concept === "external_diameter")?.value, 85);
  assert.equal(facts.find((f) => f.concept === "warranty_duration")?.value, 24);
});

test("MB-UX-LIVE-001 L01 snapshots preserve supplied facts without category defaults", () => {
  for (const [capacity, diameter, warranty, quantity] of [
    [750, 950, 36, 7],
    [1200, 1100, 48, 15],
    [640, 810, 18, 3],
  ]) {
    const snapshot = createApprovedRequestSnapshotV3({
      revision_id: `rev-${capacity}`,
      approved_at: "2026-09-07T00:00:00Z",
      product_name: "Industrial vessel",
      product_category: "Process equipment",
      approved_translation: `${capacity} L vessel, maximum diameter ${diameter} mm, maximum 12 bar, single-phase 230V 60Hz, ${warranty} months warranty, exactly ${quantity} units, CIF Sharjah.`,
    });
    assert.equal(
      snapshot.facts.find((f) => f.concept === "storage_capacity")?.value,
      capacity,
    );
    assert.equal(
      snapshot.facts.find((f) => f.concept === "external_diameter")?.value,
      diameter! / 10,
    );
    assert.equal(
      snapshot.facts.find((f) => f.concept === "warranty_duration")?.value,
      warranty,
    );
    assert.equal(
      snapshot.facts.find((f) => f.concept === "electrical_power")?.qualifiers
        .frequency_hz,
      "60",
    );
    assert.equal(
      snapshot.facts.find((f) => f.concept === "working_pressure")?.operator,
      "lte",
    );
    assert.equal(
      snapshot.facts.find((f) => f.concept === "delivery_terms")?.qualifiers
        .destination,
      "Sharjah",
    );
  }
  const unknown = createApprovedRequestSnapshotV3({
    revision_id: "empty-facts",
    approved_at: "2026-09-07T00:00:00Z",
    approved_translation: "Industrial replacement component",
    product_name: "Component",
    product_category: "Unclassified",
  });
  assert.equal(unknown.facts.length, 0);
  assert.ok(unknown.unknown_fields.includes("order_quantity"));
  assert.deepEqual(unknown.unparsed_clauses, [
    "Industrial replacement component",
  ]);
});

test("MB-UX-LIVE-001 L01 approved hashes change with approval and facts remain isolated", () => {
  const common = {
    revision_id: "r1",
    approved_at: "2026-09-07T00:00:00Z",
    product_name: "Pump",
    product_category: "Machinery",
    intake,
  };
  const a = createApprovedRequestSnapshotV3({
    ...common,
    approved_translation: "Exactly 7 units, DDP Abu Dhabi.",
  });
  const b = createApprovedRequestSnapshotV3({
    ...common,
    revision_id: "r2",
    approved_translation: "Exactly 8 units, CIF Sharjah.",
  });
  assert.notEqual(a.content_hash, b.content_hash);
  assert.equal(a.source_intake_hash, b.source_intake_hash);
  assert.equal(a.facts.find((f) => f.concept === "order_quantity")?.value, 7);
  assert.equal(
    a.facts.find((f) => f.concept === "delivery_terms")?.value,
    "DDP",
  );
  const reverseKeys = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reverseKeys)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([k, v]) => [k, reverseKeys(v)]),
          )
        : value;
  assert.equal(
    verifyApprovedRequestSnapshotV3(reverseKeys(a)),
    true,
    "JSONB object ordering must not change approval identity",
  );
  assert.equal(
    verifyApprovedRequestSnapshotV3({
      ...a,
      approved_translation: "Exactly 99 units",
    }),
    false,
  );
});

test("MB-UX-LIVE-001 L01 persisted V3 parser rejects malformed rich output and false live lineage", () => {
  assert.doesNotThrow(() =>
    parseConsultantResearchOutputV3(GOLDEN_SCENARIO_V3_01),
  );
  assert.throws(
    () =>
      parseConsultantResearchOutputV3({
        ...GOLDEN_SCENARIO_V3_01,
        total_candidates_found: 99,
      }),
    /counts disagree/,
  );
  assert.throws(
    () =>
      parseConsultantResearchOutputV3({
        ...GOLDEN_SCENARIO_V3_01,
        research_mode: "live",
      }),
    /trustworthy approved/,
  );
  const supplier = GOLDEN_SCENARIO_V3_01.supplier_candidates[0]!;
  const bad = {
    ...GOLDEN_SCENARIO_V3_01,
    supplier_candidates: [
      {
        ...supplier,
        assessment: { ...supplier.assessment, compatibility_score: NaN },
      },
      ...GOLDEN_SCENARIO_V3_01.supplier_candidates.slice(1),
    ],
  };
  assert.throws(() => parseConsultantResearchOutputV3(bad), /finite score/);
});
