import assert from "node:assert/strict";
import test from "node:test";
import {
  createApprovedRequestSnapshotV3,
  formatApprovedFactV3,
  parseApprovedRequestFactsV3,
} from "../src/v3/approved-request.js";
import { validateStep1RequirementFidelity } from "../src/v3/requirement-fidelity.js";

const intake = (order_profile: string, technical_compliance = "") => ({
  product_requirement: "Potassium hydroxide, industrial grade.",
  technical_compliance,
  order_profile,
});
const unselected =
  "Trade terms: FOB / CIF / EXW are listed without a final selection.";

test("MB-UX-QUALITY-001 L03 unselected Incoterm lists survive spacing and option order", () => {
  for (const english_translation of [
    "Incoterms listed are FOB/CIF/EXW without final selection.",
    "EXW or CIF or FOB are not yet selected.",
    "FOB / EXW / CIF: selection not finalized.",
    "Incoterms are not yet confirmed: CIF/FOB/EXW.",
    "CIF / EXW / FOB (selection not finalized)",
  ]) {
    const result = validateStep1RequirementFidelity(intake(unselected), {
      english_translation,
    });
    assert.equal(result.valid, true, result.explanation);
    const fact = parseApprovedRequestFactsV3(english_translation).facts[0]!;
    assert.equal(fact.concept, "delivery_terms_options");
    assert.equal(fact.value, "CIF|EXW|FOB");
    assert.equal(fact.modality, "optional");
    assert.equal(fact.qualifiers.destination, undefined);
    assert.equal(
      formatApprovedFactV3(fact),
      "CIF / EXW / FOB (selection not finalized)",
    );
  }
});

test("MB-UX-QUALITY-001 L03 normalized option feedback round-trips without fabricating a fixed term", () => {
  const fact = parseApprovedRequestFactsV3(unselected).facts[0]!;
  const normalized = formatApprovedFactV3(fact);
  const reparsed = parseApprovedRequestFactsV3(normalized).facts[0]!;
  assert.equal(reparsed.concept, fact.concept);
  assert.equal(reparsed.value, fact.value);
  assert.deepEqual(reparsed.qualifiers, fact.qualifiers);
  assert.equal(
    validateStep1RequirementFidelity(intake(unselected), {
      english_translation: normalized,
    }).valid,
    true,
  );
});

test("MB-UX-QUALITY-001 L03 changed options or an invented selected term still block approval", () => {
  for (const english_translation of [
    "FOB/CIF without final selection.",
    "FOB/CIF/EXW/DDP without final selection.",
    "FOB Shanghai.",
    "FOB/CIF/EXW are the agreed terms.",
    "Trade terms remain undecided.",
    "FOB/CIF/EXW without final selection. FOB Shanghai is agreed.",
  ])
    assert.equal(
      validateStep1RequirementFidelity(intake(unselected), {
        english_translation,
      }).valid,
      false,
      english_translation,
    );
});

test("MB-UX-QUALITY-001 L03 unresolved delivery choices remain unknown as a final Incoterm", () => {
  const snapshot = createApprovedRequestSnapshotV3({
    revision_id: "unselected-commercial-terms",
    approved_at: "2026-09-11T00:00:00Z",
    approved_translation: unselected,
    product_name: "Potassium hydroxide",
    product_category: "Industrial chemicals",
  });
  assert.ok(snapshot.unknown_fields.includes("delivery_terms"));
  assert.equal(
    snapshot.facts.filter((fact) => fact.concept === "delivery_terms").length,
    0,
  );
  assert.equal(snapshot.facts[0]?.source_clause, unselected.slice(0, -1));
});

test("MB-UX-QUALITY-001 L03 fixed trade terms and their named places remain enforceable", () => {
  const source = intake("CIF Aqaba.");
  for (const english_translation of [
    "CIF Shanghai.",
    "FOB Aqaba.",
    "CIF without final selection.",
  ])
    assert.equal(
      validateStep1RequirementFidelity(source, { english_translation }).valid,
      false,
    );
  assert.equal(
    validateStep1RequirementFidelity(source, {
      english_translation: "CIF Aqaba.",
    }).valid,
    true,
  );
  assert.equal(
    parseApprovedRequestFactsV3("CIF Aqaba.").facts[0]?.qualifiers.destination,
    "Aqaba",
  );
});

test("MB-UX-QUALITY-001 L03 uncertainty about a different requirement cannot unset agreed trade terms", () => {
  for (const text of [
    "CIF Aqaba with customs documents not confirmed.",
    "CIF Aqaba with payment method undecided.",
  ]) {
    const facts = parseApprovedRequestFactsV3(text).facts;
    const delivery = facts.find((fact) => fact.concept === "delivery_terms");
    assert.equal(delivery?.value, "CIF");
    assert.equal(delivery?.qualifiers.destination, "Aqaba");
    assert.equal(
      facts.some((fact) => fact.concept === "delivery_terms_options"),
      false,
    );
  }
});

test("MB-UX-QUALITY-001 L03 retaining unresolved options cannot hide an omitted quality standard", () => {
  const source = intake(
    unselected,
    "Quality standard: ISO 9001 or an applicable industrial standard.",
  );
  const result = validateStep1RequirementFidelity(source, {
    english_translation: "FOB/CIF/EXW without final selection.",
  });
  assert.equal(result.valid, false);
  assert.equal(result.mutated_count, 0);
  assert.equal(result.omitted_count, 1);
  assert.equal(result.omitted_items[0]?.concept, "certification");
  assert.equal(
    result.omitted_items[0]?.normalized_value,
    "ISO 9001 or an applicable standard",
  );
});

test("MB-UX-QUALITY-001 L03 a stated alternative standard cannot silently become mandatory ISO certification", () => {
  const source = intake("", "ISO 9001 or an applicable industrial standard.");
  assert.equal(
    validateStep1RequirementFidelity(source, {
      english_translation: "ISO 9001 or an applicable industrial standard.",
    }).valid,
    true,
  );
  for (const english_translation of [
    "ISO 9001 certification is required.",
    "ISO 9001 and an applicable industrial standard.",
    "An applicable industrial standard is required.",
  ])
    assert.equal(
      validateStep1RequirementFidelity(source, { english_translation }).valid,
      false,
      english_translation,
    );
});

test("MB-UX-QUALITY-001 L03 mandatory certification cannot be weakened by inventing an alternative", () => {
  const source = intake("", "ISO 9001 certification is required.");
  assert.equal(
    validateStep1RequirementFidelity(source, {
      english_translation: "ISO 9001 or an applicable industrial standard.",
    }).valid,
    false,
  );
});
