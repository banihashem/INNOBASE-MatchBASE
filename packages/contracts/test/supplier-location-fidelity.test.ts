import assert from "node:assert/strict";
import test from "node:test";
import { parseApprovedRequestFactsV3 } from "../src/v3/approved-request.js";
import { validateStep1RequirementFidelity } from "../src/v3/requirement-fidelity.js";

const profile =
  "حجم سفارش ۱۰ کانتینر ۲۰ فوت DV است. ارائه‌دهنده موردنیاز، فورواردر یا شرکت خدمات حمل دریایی دارای توان هماهنگی حمل در مسیر اعلام‌شده و انجام Switch B/L در امارات است. محل استقرار الزامی ارائه‌دهنده، زمان آماده‌بودن بار، تاریخ حمل، بودجه، شرایط پرداخت و یک‌باره یا تکرارشونده‌بودن سفارش در متن اعلام نشده‌اند.";
const translation =
  "The order volume is 10 x 20-foot DV containers. The required provider is a freight forwarder or ocean freight service company capable of coordinating transport on the stated route and performing Switch B/L in the UAE. The provider’s mandatory location/base, cargo ready time, sailing date, budget, payment terms, and whether this is a one-off or recurring order are not stated in the text.";
const intake = (order_profile: string) => ({
  product_requirement: "",
  technical_compliance: "",
  order_profile,
});

test("MB-UX-LIVE-001 L05 service venues and stated routes do not become a supplier base", () => {
  for (const text of [profile, translation]) {
    const role = parseApprovedRequestFactsV3(text).facts.find(
      (fact) => fact.concept === "supplier_profile",
    );
    assert.ok(role);
    assert.equal(role.qualifiers.jurisdiction, undefined);
    assert.equal(role.qualifiers.role_jurisdictions, undefined);
  }
  const result = validateStep1RequirementFidelity(intake(profile), {
    english_translation: translation,
  });
  assert.equal(result.valid, true, result.explanation);
  assert.equal(result.mutated_items.length, 0);
});

test("MB-UX-LIVE-001 L05 reordering transport and documentation services preserves the same role", () => {
  const source =
    "A Freight Forwarder to transport cargo through Egypt and perform Switch B/L in the UAE.";
  for (const text of [
    "A Freight Forwarder to perform Switch B/L in the UAE and transport cargo through Egypt.",
    "A Freight Forwarder capable of handling Switch B/L in the UAE and coordinating the shipment through Egypt.",
    "A Freight Forwarder in charge of arranging Switch B/L in the UAE and transport through Egypt.",
  ]) {
    const result = validateStep1RequirementFidelity(intake(source), {
      english_translation: text,
    });
    assert.equal(result.valid, true, result.explanation);
  }
});

test("MB-UX-LIVE-001 L05 explicit supplier bases survive service wording and remain enforceable", () => {
  const source =
    "A Freight Forwarder based in the UAE to arrange Switch B/L in Oman.";
  for (const text of [
    "A UAE-based Freight Forwarder capable of arranging Switch B/L in Oman.",
    "A Freight Forwarder located in UAE to arrange Switch B/L in Oman.",
  ]) {
    assert.equal(
      validateStep1RequirementFidelity(intake(source), {
        english_translation: text,
      }).valid,
      true,
    );
  }
  for (const text of [
    "A Freight Forwarder based in Oman to arrange Switch B/L in the UAE.",
    "A Freight Forwarder to arrange Switch B/L in the UAE and Oman.",
  ]) {
    assert.equal(
      validateStep1RequirementFidelity(intake(source), {
        english_translation: text,
      }).valid,
      false,
    );
  }
});

test("MB-UX-LIVE-001 L05 the interpretation cannot invent a supplier base from a service venue", () => {
  for (const text of [
    translation.replace("a freight forwarder", "a UAE-based freight forwarder"),
    translation.replace(
      "a freight forwarder",
      "a Hamburg-based freight forwarder",
    ),
    translation.replace(
      "a freight forwarder or",
      "a freight forwarder based in the UAE or",
    ),
  ]) {
    const result = validateStep1RequirementFidelity(intake(profile), {
      english_translation: text,
    });
    assert.equal(result.valid, false);
    assert.equal(
      result.mutated_items[0]?.requirement.concept,
      "supplier_profile",
    );
  }
});

test("MB-UX-LIVE-001 L05 a Persian explicit base remains separate from the service venue", () => {
  const source = "فورواردر مستقر در امارات برای انجام Switch B/L در عمان";
  assert.equal(
    validateStep1RequirementFidelity(intake(source), {
      english_translation:
        "A Freight Forwarder based in the UAE to perform Switch B/L in Oman.",
    }).valid,
    true,
  );
});

test("MB-UX-LIVE-001 L05 relative clauses preserve and enforce actual supplier locations", () => {
  for (const [source, equivalent, mutated] of [
    [
      "A Freight Forwarder who is based in UAE to arrange Switch B/L in Oman.",
      "A UAE-based Freight Forwarder to arrange Switch B/L in Oman.",
      "A Freight Forwarder who is based in Qatar to arrange Switch B/L in Oman.",
    ],
    [
      "The supplier must have an operational network that is in Oman.",
      "The supplier must have an operational network in Oman.",
      "The supplier must have an operational network that is in Qatar.",
    ],
  ]) {
    assert.equal(
      validateStep1RequirementFidelity(intake(source!), {
        english_translation: equivalent!,
      }).valid,
      true,
    );
    assert.equal(
      validateStep1RequirementFidelity(intake(source!), {
        english_translation: mutated!,
      }).valid,
      false,
    );
  }
});

test("MB-UX-LIVE-001 L05 attributive city bases exclude their English determiner", () => {
  for (const determiner of ["A", "The"]) {
    assert.equal(
      validateStep1RequirementFidelity(
        intake(
          "A Freight Forwarder based in Hamburg to arrange Switch B/L in UAE.",
        ),
        {
          english_translation: `${determiner} Hamburg-based Freight Forwarder to arrange Switch B/L in UAE.`,
        },
      ).valid,
      true,
    );
  }
});

test("MB-UX-LIVE-001 L05 coordinated explicit bases remain distinct from service places", () => {
  const source = "A Freight Forwarder handling cargo and based in UAE.";
  assert.equal(
    validateStep1RequirementFidelity(intake(source), {
      english_translation: "A UAE-based Freight Forwarder handling cargo.",
    }).valid,
    true,
  );
  assert.equal(
    validateStep1RequirementFidelity(intake(source), {
      english_translation:
        "A Freight Forwarder handling cargo and based in Oman.",
    }).valid,
    false,
  );
  assert.equal(
    parseApprovedRequestFactsV3(
      "A Freight Forwarder handling cargo in UAE.",
    ).facts.find((f) => f.concept === "supplier_profile")?.qualifiers
      .jurisdiction,
    undefined,
  );
});
