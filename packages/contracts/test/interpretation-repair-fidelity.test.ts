import assert from "node:assert/strict";
import test from "node:test";
import { parseApprovedRequestFactsV3 } from "../src/v3/approved-request.js";
import { validateStep1RequirementFidelity } from "../src/v3/requirement-fidelity.js";

const intake = {
  product_requirement: "به دستگاه قهوه‌ساز WMF 1500 S+ نیاز داریم.",
  technical_compliance: "ضمانت حداقل ۱۲ماهه الزامی است.",
  order_profile:
    "سفارش اولیه ۳ دستگاه با تحویل در دبی است. اولویت با نماینده رسمی یا فروشنده‌ای است که بتواند اصالت کالا را مستند کند.",
};
const translation =
  "We need a WMF 1500 S+ coffee machine. A minimum 12-month warranty is mandatory. Initial order is 3 machines delivered in Dubai. Priority is given to an official representative or a seller that can document product authenticity.";

test("L12 machine quantities and preferred representative/seller alternatives preserve bilingual intent", () => {
  const result = validateStep1RequirementFidelity(intake, {
    english_translation: translation,
  });
  assert.equal(result.valid, true, result.explanation);
  const profile = result.ledger.requirements.find(
    (item) => item.concept === "supplier_profile",
  )!;
  assert.equal(profile.modality, "preferred");
  for (const source of [intake.order_profile, translation]) {
    const facts = parseApprovedRequestFactsV3(source).facts;
    assert.equal(
      facts.find((item) => item.concept === "order_quantity")?.value,
      3,
    );
    const supplier = facts.find((item) => item.concept === "supplier_profile")!;
    assert.equal(supplier.qualifiers.authorization, "authorized");
    assert.equal(supplier.qualifiers.alternative, "seller");
    assert.equal(supplier.modality, "preferred");
  }
});
test("L12 changed or missing machine quantities still block approval", () => {
  for (const replacement of ["2 machines", "machines", "30 machines"]) {
    const result = validateStep1RequirementFidelity(intake, {
      english_translation: translation.replace("3 machines", replacement),
    });
    assert.equal(result.valid, false, replacement);
    assert.ok(
      [
        ...result.omitted_items,
        ...result.mutated_items.map((item) => item.requirement),
      ].some((item) => item.concept === "order_quantity"),
    );
  }
});
test("L12 representative preference, authorization and seller alternative cannot be silently changed", () => {
  for (const changed of [
    translation.replace("Priority is given to", "We require"),
    translation.replace("official representative", "distributor"),
    translation.replace(" or a seller", ""),
    translation.replace(" or a seller", " and a seller"),
    translation.replace("official representative or a seller", "seller"),
  ])
    assert.equal(
      validateStep1RequirementFidelity(intake, { english_translation: changed })
        .valid,
      false,
      changed,
    );
});
test("L12 machine aliases retain range and quantity operator distinctions", () => {
  const source = {
    product_requirement: "",
    technical_compliance: "",
    order_profile: "Maximum 3 units.",
  };
  assert.equal(
    validateStep1RequirementFidelity(source, {
      english_translation: "Maximum 3 machines.",
    }).valid,
    true,
  );
  assert.equal(
    validateStep1RequirementFidelity(source, {
      english_translation: "Minimum 3 machines.",
    }).valid,
    false,
  );
  assert.equal(
    parseApprovedRequestFactsV3("One machine.").facts.find(
      (item) => item.concept === "order_quantity",
    )?.value,
    1,
  );
  assert.equal(
    parseApprovedRequestFactsV3("3-5 machines.").facts.find(
      (item) => item.concept === "order_quantity",
    )?.operator,
    "range",
  );
});

test("L12 supplier priority cannot downgrade a mandatory quantity in the same clause", () => {
  const source = "۳ دستگاه الزامی است و اولویت با نماینده رسمی است.";
  const translated =
    "We require 3 machines and priority is given to an official representative.";
  for (const text of [source, translated]) {
    const facts = parseApprovedRequestFactsV3(text).facts;
    assert.equal(
      facts.find((item) => item.concept === "order_quantity")?.modality,
      "mandatory",
    );
    assert.equal(
      facts.find((item) => item.concept === "supplier_profile")?.modality,
      "preferred",
    );
  }
  const request = {
    product_requirement: "",
    technical_compliance: "",
    order_profile: source,
  };
  assert.equal(
    validateStep1RequirementFidelity(request, {
      english_translation: translated,
    }).valid,
    true,
  );
  assert.equal(
    validateStep1RequirementFidelity(request, {
      english_translation:
        "We require 3 machines and an official representative.",
    }).valid,
    false,
  );
  assert.equal(
    validateStep1RequirementFidelity(request, {
      english_translation:
        "We prefer 3 machines and priority is given to an official representative.",
    }).valid,
    false,
  );
});
test("L12 an unrelated priority phrase does not make the supplier optional", () => {
  for (const text of [
    "Priority is given to delivery speed and we require an official representative.",
    "اولویت با سرعت تحویل است و نماینده رسمی الزامی است.",
  ])
    assert.equal(
      parseApprovedRequestFactsV3(text).facts.find(
        (item) => item.concept === "supplier_profile",
      )?.modality,
      "mandatory",
    );
});

test("L12 priority for a different seller role cannot downgrade a mandatory distributor", () => {
  for (const source of [
    "An authorized distributor is mandatory and priority is given to a local seller.",
    "نماینده رسمی الزامی است و اولویت با فروشنده محلی است.",
  ])
    assert.equal(
      parseApprovedRequestFactsV3(source).facts.find(
        (item) => item.concept === "supplier_profile",
      )?.modality,
      "mandatory",
    );
  assert.equal(
    validateStep1RequirementFidelity(intake, {
      english_translation: translation,
    }).valid,
    true,
  );
});
