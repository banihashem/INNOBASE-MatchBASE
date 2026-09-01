import assert from "node:assert/strict";
import test from "node:test";
import { evaluateStructuredReadiness } from "../../../packages/application/dist/index.js";
import { FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK } from "../../../packages/ai-evidence/dist/src/standard.js";

const packFields = [
  ...FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK.core_fields,
  ...FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK.domain_fields,
];

function fields(overrides = {}) {
  return packFields.map((definition) => ({
    field_id: definition.field_id,
    macro_parameter: definition.macro_parameter,
    typed_value:
      overrides[definition.field_id] ??
      (definition.requirement === "required"
        ? { value_state: "provided", value: `provided-${definition.field_id}` }
        : { value_state: "not_asked" }),
  }));
}

const ahmadFields = {
  commodity_variety: { value_state: "provided", value: "Ahmad Aghaei" },
  commodity_origin: { value_state: "provided", value: "Iranian origin" },
  container_quantity: {
    value_state: "provided",
    value: "3",
    unit: "container",
  },
  routing_via: { value_state: "provided", value: "Dubai" },
  distribution_destination: {
    value_state: "provided",
    value: "African market",
  },
  current_stock: {
    value_state: "provided",
    value: "1",
    unit: "container",
    raw_expression: "currently available in stock",
  },
};

const exactUserInput =
  "Procurement request for three containers of high-quality Iranian Ahmad Aghaei pistachios. The shipment must be routed via Dubai for distribution in the African market. The supplier should have at least one container currently available in stock.";

test("exact Ahmad Aghaei buyer input is ready without a buyer-supplied evidence date", () => {
  assert.match(exactUserInput, /three containers/iu);
  assert.match(exactUserInput, /Iranian Ahmad Aghaei pistachios/iu);
  assert.match(exactUserInput, /routed via Dubai/iu);
  assert.match(exactUserInput, /African market/iu);
  assert.match(
    exactUserInput,
    /at least one container currently available in stock/iu,
  );
  const category = FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK.category_id;
  assert.equal(
    evaluateStructuredReadiness(fields(ahmadFields), [], [], category),
    "ready",
  );
});

test("Ahmad Aghaei readiness rejects contradictory or incomplete buyer constraints", () => {
  const category = FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK.category_id;
  assert.equal(
    evaluateStructuredReadiness(
      fields({
        ...ahmadFields,
        current_stock: {
          value_state: "provided",
          value: "0",
          unit: "container",
          raw_expression: "currently available in stock",
        },
      }),
      [],
      [],
      category,
    ),
    "not_ready",
  );
  assert.equal(
    evaluateStructuredReadiness(
      fields(ahmadFields),
      [
        {
          constraint_id: "C-AFRICA",
          field_id: "distribution_destination",
          operator: "equals",
          target: { value_state: "provided", value: "European market" },
          relaxability: "non_relaxable",
        },
      ],
      [],
      category,
    ),
    "not_ready",
  );
  assert.equal(
    evaluateStructuredReadiness(
      fields(ahmadFields),
      [],
      [
        {
          contradiction_id: "CONFLICT-1",
          contradiction_class: "field_value",
          alternatives: [
            {
              alternative_id: "A",
              canonical_english_value: "Dubai",
              field_ids: ["routing_via"],
            },
            {
              alternative_id: "B",
              canonical_english_value: "Doha",
              field_ids: ["routing_via"],
            },
          ],
          resolution_state: "unresolved",
        },
      ],
      category,
    ),
    "not_ready",
  );
});
