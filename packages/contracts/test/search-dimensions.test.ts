import assert from "node:assert/strict";
import test from "node:test";
import {
  assessSearchDimensionPriceComparability,
  assertSearchDimensionIntentPreserved,
  compileSearchDimensionPlan,
  createSearchDimensionConfiguration,
  createSearchDimensionCoverage,
  evaluateSearchDimensionPlan,
  evaluateSearchRequirementExpression,
  getSearchDimensionRegistry,
  hashSearchDimensionConfiguration,
  parseCustomSearchDimensionDefinition,
  parseSearchDimensionConfiguration,
  renderSearchDimensionInstructions,
  resolveSearchDimensionProfiles,
  searchDimensionPriceFreshness,
  verifySearchDimensionPlan,
  type SearchDimensionConfiguration,
  type SearchDimensionDefinition,
  type SearchDimensionObservation,
  type SearchDimensionPriceTuple,
  type SearchRequirementExpression,
} from "../src/v3/search-dimensions.js";

const owner_scope = { account_id: "owner-a", user_profile_id: "profile-a" };
const trace = {
  user_profile_id: "profile-a",
  research_run_id: "run-a",
  execution_id: "execution-a",
  classification_id: "primary-a",
};
const now = "2026-10-03T12:00:00Z";
const intent =
  "Require at least 21 destination free days. Require direct routing or at least 21 destination free days.";
function freight(): SearchDimensionConfiguration {
  return createSearchDimensionConfiguration({
    profile_ids: ["logistics.ocean"],
  });
}
function compiled(configuration = freight()) {
  return compileSearchDimensionPlan(configuration, {
    owner_scope,
    primary_classification_id: trace.classification_id,
    original_buyer_intent: intent,
  });
}
function required(
  configuration: SearchDimensionConfiguration,
  id: string,
  expected: number | string,
  lot_id = "default",
) {
  const entry = configuration.selections.find(
    (selection) => selection.dimension_id === id,
  )!;
  entry.severity = "mandatory";
  entry.operator = typeof expected === "number" ? "gte" : "equals";
  entry.expected = expected;
  entry.original_requirement = intent;
  entry.scope = { lot_id, subject_id: "request" };
  return entry;
}
function observed(
  configuration: SearchDimensionConfiguration,
  id: string,
  value: number | string,
): SearchDimensionObservation {
  const entry = configuration.selections.find(
    (selection) => selection.dimension_id === id,
  )!;
  return {
    observation_id: `obs-${id}`,
    selection_id: entry.selection_id,
    dimension_id: id,
    definition_revision: 1,
    trace,
    entity_id: "supplier-a",
    scope: entry.scope,
    value,
    ...(typeof value === "number" ? { unit: "day" } : {}),
    source: {
      source_id: "source-a",
      uri: "https://example.com/quotation",
      literal_excerpt: `${value}`,
      retrieved_at: now,
    },
  };
}
const context = { trace, entity_id: "supplier-a", now };

test("MB-SEARCH-DIMENSIONS-002 L01 registry has 26 logistics parameters with distinct policies and no default hard gates", () => {
  const registry = getSearchDimensionRegistry();
  const logistics = registry.definitions.filter((entry) =>
    entry.profile_ids.includes("logistics.ocean"),
  );
  assert.equal(logistics.length, 26);
  assert.equal(
    logistics.find((entry) => entry.id === "logistics.free_time")!
      .default_severity,
    "preferred",
  );
  assert.equal(
    logistics.find((entry) => entry.id === "logistics.pool")!.kind,
    "search_policy",
  );
  assert.equal(
    logistics.find((entry) => entry.id === "logistics.price_comparability")!
      .kind,
    "comparison_policy",
  );
  assert.ok(
    registry.profiles.every((entry) => entry.classification_mapping === "none"),
  );
  assert.ok(
    freight().selections.every(
      (entry) =>
        entry.operator === "research" &&
        entry.expected === undefined &&
        entry.severity !== "mandatory",
    ),
  );
  registry.definitions[0]!.label = "mutated";
  assert.notEqual(
    getSearchDimensionRegistry().definitions[0]!.label,
    "mutated",
  );
});

test("MB-SEARCH-DIMENSIONS-002 L01 profile resolution nominates mixed research facets without official code mappings", () => {
  assert.deepEqual(
    resolveSearchDimensionProfiles({
      text: "Chemical potassium hydroxide shipped by freight forwarder",
    }),
    ["core", "logistics.ocean", "chemical.supply"],
  );
  assert.deepEqual(
    resolveSearchDimensionProfiles({ text: "Industrial pump duty head" }),
    ["core", "industrial.pumps"],
  );
  assert.deepEqual(
    resolveSearchDimensionProfiles({ text: "Office stationery" }),
    ["core"],
  );
});

test("MB-SEARCH-DIMENSIONS-002 L01 compiled hashes bind active flags, profiles, original intent and definitions", () => {
  const configuration = freight();
  const original = compiled(configuration);
  assert.equal(verifySearchDimensionPlan(original), true);
  assert.equal(original.protected_buyer_intent, intent);
  assert.equal(
    original.dimensions.find(
      (entry) => entry.definition.id === "logistics.free_time",
    )!.applicability,
    "undetermined",
  );
  configuration.selections.find(
    (entry) => entry.dimension_id === "logistics.free_time",
  )!.active = false;
  assert.notEqual(compiled(configuration).plan_hash, original.plan_hash);
  const edited = structuredClone(original);
  edited.dimensions[0]!.definition.revision = 99;
  assert.equal(verifySearchDimensionPlan(edited), false);
  assert.equal(
    hashSearchDimensionConfiguration(configuration),
    hashSearchDimensionConfiguration(JSON.parse(JSON.stringify(configuration))),
  );
});

test("MB-SEARCH-DIMENSIONS-002 L01 strict parser rejects unknown fields, executable schemas, malformed values and disabled policy", () => {
  assert.throws(
    () =>
      parseSearchDimensionConfiguration({
        ...freight(),
        $ref: "https://example.com/schema",
      }),
    /Invalid/,
  );
  const configuration = freight();
  configuration.selections[0]!.active = false;
  assert.throws(
    () => parseSearchDimensionConfiguration(configuration),
    /Protected/,
  );
  const missing = freight();
  missing.selections.shift();
  assert.throws(
    () => parseSearchDimensionConfiguration(missing),
    /Missing invariant/,
  );
  const bad = freight();
  const selected = required(bad, "logistics.free_time", 21);
  selected.expected = "21";
  assert.throws(() => parseSearchDimensionConfiguration(bad), /numeric/);
});

test("MB-SEARCH-DIMENSIONS-002 L01 custom definitions are bounded, private, typed and server-owned", () => {
  const definition: SearchDimensionDefinition = {
    id: "custom.warranty",
    revision: 1,
    label: "Warranty duration",
    description: "Investigate warranty duration in months.",
    kind: "commercial",
    value_type: "number",
    profile_ids: ["core"],
    default_active: true,
    default_severity: "preferred",
    applicability: "always",
    locked: false,
    allowed_operators: ["research", "gte"],
    unit: "month",
  };
  const parsed = parseCustomSearchDimensionDefinition(definition, owner_scope);
  assert.deepEqual(parsed.owner_scope, owner_scope);
  assert.equal(
    parseCustomSearchDimensionDefinition(
      { ...definition, revision: 2 },
      owner_scope,
    ).revision,
    2,
  );
  assert.throws(
    () =>
      parseCustomSearchDimensionDefinition(
        {
          ...definition,
          owner_scope: { ...owner_scope, account_id: "foreign" },
        },
        owner_scope,
      ),
    /owner mismatch/,
  );
  assert.throws(
    () =>
      parseCustomSearchDimensionDefinition(
        { ...definition, execute: "return true" },
        owner_scope,
      ),
    /Invalid/,
  );
  assert.throws(
    () =>
      parseCustomSearchDimensionDefinition(
        { ...definition, kind: "search_policy" },
        owner_scope,
      ),
    /custom kind/,
  );
  assert.throws(
    () =>
      parseCustomSearchDimensionDefinition(
        { ...definition, allowed_operators: ["contains_any"] },
        owner_scope,
      ),
    /Incompatible/,
  );
});

test("MB-SEARCH-DIMENSIONS-002 L01 mandatory intent cannot be silently disabled, downgraded or invented", () => {
  const configuration = freight();
  const selection = required(configuration, "logistics.free_time", 21);
  compiled(configuration);
  const changed = structuredClone(configuration);
  changed.selections.find(
    (entry) => entry.dimension_id === selection.dimension_id,
  )!.severity = "preferred";
  assert.throws(
    () => assertSearchDimensionIntentPreserved(configuration, changed),
    /amendment/,
  );
  selection.active = false;
  assert.throws(
    () => parseSearchDimensionConfiguration(configuration),
    /Protected/,
  );
  selection.active = true;
  selection.original_requirement = "An invented requirement";
  assert.throws(() => compiled(configuration), /absent/);
});

test("MB-SEARCH-DIMENSIONS-002 L01 source schema or keyword does not admit supplier fit", () => {
  const configuration = freight();
  required(configuration, "logistics.free_time", 21);
  const observation = observed(configuration, "logistics.free_time", 24);
  const result = evaluateSearchDimensionPlan(
    compiled(configuration),
    [observation],
    context,
  );
  assert.equal(result.mandatory_outcome, "unknown");
  assert.equal(result.eligibility, "needs_review");
  assert.equal(result.coverage.grounded, 0);
  assert.equal(
    createSearchDimensionCoverage(compiled(), context).eligibility,
    "needs_review",
  );
});

test("MB-SEARCH-DIMENSIONS-002 L01 admitted typed evidence evaluates numeric requirement with scope and unit boundaries", () => {
  const configuration = freight();
  required(configuration, "logistics.free_time", 21);
  const observation = observed(configuration, "logistics.free_time", 24);
  const input = {
    ...context,
    admitted_observation_ids: [observation.observation_id],
  };
  assert.equal(
    evaluateSearchDimensionPlan(compiled(configuration), [observation], input)
      .eligibility,
    "eligible",
  );
  assert.equal(
    evaluateSearchDimensionPlan(
      compiled(configuration),
      [{ ...observation, value: 14 }],
      input,
    ).eligibility,
    "excluded",
  );
  assert.equal(
    evaluateSearchDimensionPlan(
      compiled(configuration),
      [{ ...observation, unit: "hour" }],
      input,
    ).eligibility,
    "needs_review",
  );
  assert.equal(
    evaluateSearchDimensionPlan(
      compiled(configuration),
      [{ ...observation, scope: { lot_id: "other", subject_id: "request" } }],
      input,
    ).eligibility,
    "needs_review",
  );
  assert.equal(
    evaluateSearchDimensionPlan(
      compiled(configuration),
      [{ ...observation, entity_id: "parent-company" }],
      input,
    ).eligibility,
    "needs_review",
  );
  assert.throws(
    () =>
      evaluateSearchDimensionPlan(
        compiled(configuration),
        [{ ...observation, trace: { ...trace, user_profile_id: "foreign" } }],
        input,
      ),
    /ownership/,
  );
});

test("MB-SEARCH-DIMENSIONS-002 L01 contradictions and expiry remain visible", () => {
  const configuration = freight();
  required(configuration, "logistics.free_time", 21);
  const positive = observed(configuration, "logistics.free_time", 24);
  const negative = { ...positive, observation_id: "negative", value: 14 };
  const input = {
    ...context,
    admitted_observation_ids: [
      positive.observation_id,
      negative.observation_id,
    ],
  };
  assert.equal(
    evaluateSearchDimensionPlan(
      compiled(configuration),
      [positive, negative],
      input,
    ).mandatory_outcome,
    "conflicting",
  );
  const expired = {
    ...positive,
    source: { ...positive.source, valid_until: now },
  };
  const expiredAssessment = evaluateSearchDimensionPlan(
    compiled(configuration),
    [expired],
    input,
  );
  assert.deepEqual(
    expiredAssessment.dimensions.find(
      (entry) => entry.dimension_id === "logistics.free_time",
    )!.source_refs,
    [positive.source.uri],
  );
  assert.equal(expiredAssessment.coverage.grounded, 0);
  assert.equal(
    evaluateSearchDimensionPlan(compiled(configuration), [expired], input)
      .mandatory_outcome,
    "expired",
  );
  const withdrawn = {
    ...positive,
    source: { ...positive.source, withdrawn: true },
  };
  assert.equal(
    evaluateSearchDimensionPlan(compiled(configuration), [withdrawn], input)
      .mandatory_outcome,
    "unknown",
  );
});

test("MB-SEARCH-DIMENSIONS-002 L01 OR AND NOT retain decisive and unresolved truth", () => {
  const a: SearchRequirementExpression = { type: "leaf", selection_id: "a" };
  const b: SearchRequirementExpression = { type: "leaf", selection_id: "b" };
  const any: SearchRequirementExpression = { type: "any_of", children: [a, b] };
  assert.equal(
    evaluateSearchRequirementExpression(any, {
      a: "supported",
      b: "contradicted",
    }),
    "supported",
  );
  assert.equal(
    evaluateSearchRequirementExpression(any, {
      a: "unknown",
      b: "contradicted",
    }),
    "unknown",
  );
  assert.equal(
    evaluateSearchRequirementExpression(any, {
      a: "contradicted",
      b: "contradicted",
    }),
    "contradicted",
  );
  assert.equal(
    evaluateSearchRequirementExpression(
      { type: "all_of", children: [a, b] },
      { a: "supported", b: "contradicted" },
    ),
    "contradicted",
  );
  for (const [value, expected] of [
    ["supported", "contradicted"],
    ["contradicted", "supported"],
    ["unknown", "unknown"],
    ["conflicting", "conflicting"],
  ] as const)
    assert.equal(
      evaluateSearchRequirementExpression(
        { type: "not", child: a },
        { a: value },
      ),
      expected,
    );
});

test("MB-SEARCH-DIMENSIONS-002 L01 lot eligibility preserves partial and single-provider package policy", () => {
  const configuration = freight();
  required(configuration, "logistics.free_time", 21, "lot-a");
  required(configuration, "logistics.routing_transit", "direct", "lot-b");
  const observations = [
    observed(configuration, "logistics.free_time", 24),
    observed(configuration, "logistics.routing_transit", "transshipment"),
  ];
  const input = {
    ...context,
    admitted_observation_ids: observations.map((entry) => entry.observation_id),
  };
  configuration.award_policy = "partial";
  const partial = evaluateSearchDimensionPlan(
    compiled(configuration),
    observations,
    input,
  );
  assert.equal(partial.eligibility, "partial");
  assert.equal(
    partial.lot_evaluations.find((entry) => entry.lot_id === "lot-a")!
      .eligibility,
    "eligible",
  );
  assert.equal(
    partial.lot_evaluations.find((entry) => entry.lot_id === "lot-b")!
      .eligibility,
    "excluded",
  );
  configuration.award_policy = "single_provider";
  assert.equal(
    evaluateSearchDimensionPlan(compiled(configuration), observations, input)
      .eligibility,
    "excluded",
  );
  configuration.award_policy = "undetermined";
  assert.equal(
    evaluateSearchDimensionPlan(compiled(configuration), observations, input)
      .eligibility,
    "needs_review",
  );
  configuration.requirement_expression = {
    type: "any_of",
    children: [
      { type: "leaf", selection_id: "logistics.free_time" },
      { type: "leaf", selection_id: "logistics.routing_transit" },
    ],
  };
  assert.throws(() => compiled(configuration), /across lots/);
  configuration.requirement_expression = {
    type: "not",
    child: {
      type: "all_of",
      children: [
        { type: "leaf", selection_id: "logistics.free_time" },
        { type: "leaf", selection_id: "logistics.routing_transit" },
      ],
    },
  };
  assert.throws(() => compiled(configuration), /across lots/);
});

test("MB-SEARCH-DIMENSIONS-002 L01 contextual classifications cannot replace primary identity or apply goods HS to a service", () => {
  const configuration = freight();
  configuration.context_classifications = [
    {
      assignment_id: "context-a",
      revision: 1,
      primary_classification_id: trace.classification_id,
      lot_id: "default",
      subject_id: "request",
      target_role: "purchased_service",
      scheme: "CPC",
      code: "test-code",
      edition: "test-edition",
      jurisdiction: "test-jurisdiction",
      provenance: "Synthetic provisional assignment",
      state: "provisional",
    },
  ];
  configuration.selections[1]!.scope.context_assignment_id = "context-a";
  assert.equal(
    compiled(configuration).primary_classification_id,
    trace.classification_id,
  );
  configuration.context_classifications[0]!.scheme = "HS";
  assert.throws(() => compiled(configuration), /HS/);
  configuration.context_classifications[0]!.scheme = "CPC";
  configuration.context_classifications[0]!.primary_classification_id =
    "changed-primary";
  assert.throws(() => compiled(configuration), /lineage/);
});

test("MB-SEARCH-DIMENSIONS-002 L01 price recency uses strict dated windows and rejects malformed or future dates", () => {
  assert.equal(
    searchDimensionPriceFreshness("2026-09-26T12:00:01Z", now),
    "under_seven_days",
  );
  assert.equal(
    searchDimensionPriceFreshness("2026-09-26T12:00:00Z", now),
    "under_thirty_days_fallback",
  );
  assert.equal(
    searchDimensionPriceFreshness("2026-09-03T12:00:01Z", now),
    "under_thirty_days_fallback",
  );
  assert.equal(
    searchDimensionPriceFreshness("2026-09-03T12:00:00Z", now),
    "inadmissible",
  );
  assert.equal(
    searchDimensionPriceFreshness("2026-10-04T12:00:00Z", now),
    "inadmissible",
  );
  assert.equal(
    searchDimensionPriceFreshness("2026-02-30T12:00:00Z", now),
    "inadmissible",
  );
  assert.equal(searchDimensionPriceFreshness(undefined, now), "inadmissible");
});

test("MB-SEARCH-DIMENSIONS-002 L01 price tuples reject unit currency lane terminal and charge mismatch", () => {
  const quote: SearchDimensionPriceTuple = {
    supplier_id: "supplier-a",
    kind: "supplier_quote",
    amount: 1200,
    currency: "USD",
    unit: "20DV container",
    origin: "port-a",
    destination: "port-b",
    origin_terminal: null,
    destination_terminal: "terminal-b",
    equipment: "20DV",
    cargo: "specified nonhazardous cargo",
    weight_basis: "20 tonnes net",
    quantity: 2,
    service_legs: ["ocean"],
    included_charges: ["freight"],
    excluded_charges: ["destination THC"],
    commercial_scope: "port to port",
    issued_at: now,
    valid_from: now,
    valid_until: "2026-10-04T12:00:00Z",
    source_ref: "https://example.com/quote",
  };
  assert.equal(
    assessSearchDimensionPriceComparability(
      quote,
      { ...quote, supplier_id: "supplier-b" },
      now,
    ).comparable,
    true,
  );
  for (const changed of [
    { unit: "TEU" },
    { currency: "EUR" },
    { origin: "port-b", destination: "port-a" },
    { destination_terminal: null },
    { included_charges: ["all-in"] },
    { kind: "market_benchmark" as const },
  ])
    assert.equal(
      assessSearchDimensionPriceComparability(
        quote,
        { ...quote, ...changed },
        now,
      ).comparable,
      false,
    );
});

test("MB-SEARCH-DIMENSIONS-002 L01 prompt adapter exposes approved questions without private ownership and no independent supplier fit", () => {
  const rendered = renderSearchDimensionInstructions(compiled());
  assert.match(rendered, /untrusted buyer\/configuration data/);
  assert.match(rendered, /never pad supplier counts/);
  assert.match(rendered, /logistics.free_time/);
  assert.doesNotMatch(rendered, /owner-a|profile-a/);
});
