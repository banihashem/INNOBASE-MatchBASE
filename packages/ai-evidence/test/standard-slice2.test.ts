import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { StandardEvidenceGraphV1 } from "@matchbase/contracts";
import {
  canonicalizeStandardCondition,
  canonicalizeStandardConstraintComparand,
  canonicalizeStandardExclusion,
  canonicalizeStandardFieldValue,
  canonicalizeStandardRequiredResult,
  canonicalizeStandardStructuredText,
} from "../src/canonicalization/standard-structured.js";
import {
  FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK,
  requireSyntheticDomainPackActivation,
  resolveSyntheticDomainPack,
  STANDARD_DOMAIN_INVARIANT_CORE,
  SYNTHETIC_DOMAIN_PACK,
} from "../src/domain-packs/registry.js";
import {
  STANDARD_EVIDENCE_VOLATILITY_POLICY,
  standardContentSha256,
  standardEvidenceReadStatuses,
  validateStandardEvidenceGraph,
} from "../src/evidence/standard.js";
import {
  assertStandardProjectionEvidenceLinks,
  findForbiddenStandardProjectionKeys,
  prepareStandardCompleteResultForPersistence,
  type StandardProjectionContext,
} from "../src/projection/standard.js";
import { projectStoredResult } from "../src/projection/server-result.js";
import {
  assertStandardPiiReleaseSafe,
  standardPiiFindings,
} from "../src/projection/standard-privacy.js";
import {
  buildStandardSyntheticEvidenceGraph as buildStandardSyntheticEvidenceGraphFixture,
  buildStandardSyntheticHardConstraints,
  normalizeStandardSyntheticScenarioForConstraints,
  STANDARD_SYNTHETIC_SCENARIO_COUNTS,
} from "../src/research/standard-synthetic-fixtures.js";
import { scoreStandardCandidate } from "../src/scoring/standard.js";

const NOW = new Date("2026-08-15T00:00:00.000Z");
const RUN_BOUND_HARD_CONSTRAINTS = buildStandardSyntheticHardConstraints();
const projectionContext = (now = NOW) => ({
  now,
  runBoundCanonicalHardConstraints: RUN_BOUND_HARD_CONSTRAINTS,
});
const projectStandard = (
  completeResult: StandardEvidenceGraphV1,
  context: StandardProjectionContext,
) =>
  projectStoredResult({
    tier: "standard",
    completeResult,
    projectionAsOf: context.now.toISOString(),
    runBoundCanonicalHardConstraints: context.runBoundCanonicalHardConstraints,
    ...(context.allowLegacyEmptyScarcityLedger === undefined
      ? {}
      : {
          allowLegacyEmptyScarcityLedger:
            context.allowLegacyEmptyScarcityLedger,
        }),
    ...(context.volatilityPolicy === undefined
      ? {}
      : { volatilityPolicy: context.volatilityPolicy }),
  }).body;
const buildStandardSyntheticEvidenceGraph = (
  runId: string,
  scenario: keyof typeof STANDARD_SYNTHETIC_SCENARIO_COUNTS,
) =>
  buildStandardSyntheticEvidenceGraphFixture(
    runId,
    scenario,
    RUN_BOUND_HARD_CONSTRAINTS,
  );

test("canonicalizes the closed EN/FA/AR/ES structured fixtures source-free", () => {
  const fieldFixtures = [
    ["en", "Industrial component model MX900"],
    ["fa", "  قطعه صنعتی مدل MX900  "],
    ["ar", "مكوّن صناعي طراز MX900"],
    ["es", "Componente industrial modelo MX900"],
  ] as const;
  for (const [language, source] of fieldFixtures) {
    const result = canonicalizeStandardFieldValue(source, language);
    assert.equal(result.canonical_english, "Industrial component model MX900");
    assert.equal(result.translated, language !== "en");
    assert.deepEqual(result.protected_tokens, ["MX900"]);
    if (language === "es") {
      assert.deepEqual(
        [result.confidence, result.confidence_marker],
        [0.74, "low"],
      );
    }
    assert.equal(
      JSON.stringify(result).includes(source.trim()),
      language === "en",
    );
    assert.equal("source_text" in result, false);
  }
  assert.equal(
    canonicalizeStandardConstraintComparand("حداقل 45 kg", "fa")
      .canonical_english,
    "At least 45 kg",
  );
  assert.equal(
    canonicalizeStandardExclusion("استبعاد الرمز HS-CODE", "ar")
      .canonical_english,
    "Exclude code HS-CODE",
  );
  const low = canonicalizeStandardCondition(
    "Si se selecciona el modelo MX900",
    "es",
  );
  assert.deepEqual(
    [low.translated, low.confidence, low.confidence_marker],
    [true, 0.74, "low"],
  );
  assert.equal(
    canonicalizeStandardRequiredResult("گواهی با کد ISO-9001 الزامی است", "fa")
      .canonical_english,
    "Certification code ISO-9001 is required",
  );
  assert.throws(
    () =>
      canonicalizeStandardStructuredText({
        kind: "field_value",
        source_language: "fa",
        value: "متن ناشناخته SECRET-CANARY",
      }),
    (error: unknown) =>
      error instanceof Error &&
      /unsupported/iu.test(error.message) &&
      !error.message.includes("SECRET-CANARY"),
  );
});

test("canonicalizes arbitrary already-English structured intake without a fixture", () => {
  const field = canonicalizeStandardFieldValue(
    "  Industrial automation control system PLC S7-1500  ",
    "en",
  );
  assert.deepEqual(field, {
    canonical_english: "Industrial automation control system PLC S7-1500",
    translated: false,
    confidence: 1,
    confidence_marker: "high",
    protected_tokens: field.protected_tokens,
  });
  assert.equal(
    canonicalizeStandardConstraintComparand(
      "Compatible with existing packaging lines",
      "en",
    ).canonical_english,
    "Compatible with existing packaging lines",
  );
  assert.equal(
    canonicalizeStandardExclusion("Exclude unsupported PLC families", "en")
      .canonical_english,
    "Exclude unsupported PLC families",
  );
  assert.equal(
    canonicalizeStandardCondition("If remote monitoring is enabled", "en")
      .canonical_english,
    "If remote monitoring is enabled",
  );
  assert.equal(
    canonicalizeStandardRequiredResult("Encrypted telemetry is required", "en")
      .canonical_english,
    "Encrypted telemetry is required",
  );
  assert.throws(
    () => canonicalizeStandardFieldValue("سامانه اتوماسیون صنعتی سفارشی", "fa"),
    /Unsupported structured canonicalization fixture/u,
  );
  assert.deepEqual(
    canonicalizeStandardFieldValue(
      "Siemens S7-1200 CPU 1214C DC/DC/DC controller",
      "en",
    ).protected_tokens,
    ["S7-1200", "CPU", "DC", "DC", "DC"],
  );
});

test("server registry matches the committed 32-field domain-invariant pack", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../../../../config/slice2/synthetic-industrial-components.domain-pack.v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(fixture, SYNTHETIC_DOMAIN_PACK);
  assert.equal(STANDARD_DOMAIN_INVARIANT_CORE.length, 32);
  assert.deepEqual(
    ["PS", "SP", "TR"].map(
      (group) =>
        STANDARD_DOMAIN_INVARIANT_CORE.filter((field) =>
          field.field_id.startsWith(`FLD-CORE-${group}-`),
        ).length,
    ),
    [13, 8, 11],
  );
  for (const id of ["FLD-CORE-TR-09", "FLD-CORE-TR-10"]) {
    assert.equal(
      STANDARD_DOMAIN_INVARIANT_CORE.find((field) => field.field_id === id)
        ?.requirement,
      "required",
    );
  }
});

test("domain-pack activation is server-owned, confirmed, signed, and source-free", () => {
  const context = {
    accountId: "ACC-1",
    userId: "USR-1",
    now: NOW,
    activationTtlSeconds: 300,
    hmacSecret: "test-secret",
  };
  const low = resolveSyntheticDomainPack({ sourceText: "component" }, context);
  assert.equal(low.activation_state, "confirmation_required");
  assert.equal("activation_token" in low, false);
  const unresolved = resolveSyntheticDomainPack({ sourceText: "" }, context);
  assert.equal(unresolved.activation_state, "unresolved");
  assert.equal("category_id" in unresolved, false);
  const confirmed = resolveSyntheticDomainPack(
    {
      sourceText: "component alloy",
      explicitCategoryId: SYNTHETIC_DOMAIN_PACK.category_id,
    },
    context,
  );
  assert.equal(confirmed.activation_state, "confirmed");
  if (confirmed.activation_state !== "confirmed") assert.fail("not confirmed");
  assert.equal(confirmed.activation_token.includes("component alloy"), false);
  assert.deepEqual(
    requireSyntheticDomainPackActivation(confirmed.activation_token, context),
    SYNTHETIC_DOMAIN_PACK,
  );
  assert.throws(
    () =>
      requireSyntheticDomainPackActivation(
        `${confirmed.activation_token.slice(0, -1)}x`,
        context,
      ),
    /invalid/iu,
  );
  assert.throws(
    () =>
      requireSyntheticDomainPackActivation(confirmed.activation_token, {
        ...context,
        userId: "USR-OTHER",
      }),
    /invalid or expired/iu,
  );
  assert.throws(
    () =>
      requireSyntheticDomainPackActivation(confirmed.activation_token, {
        ...context,
        now: new Date("2026-08-16T00:00:00.000Z"),
      }),
    /invalid or expired/iu,
  );
});

test("pistachio procurement deterministically selects the governed agricultural pack", () => {
  const context = {
    accountId: "ACC-AGRI",
    userId: "USR-AGRI",
    now: NOW,
    activationTtlSeconds: 300,
    hmacSecret: "test-secret",
  };
  const result = resolveSyntheticDomainPack(
    {
      sourceText:
        "Procurement request for three containers of high-quality Iranian Ahmad Aghaei pistachios. The shipment must be routed via Dubai for distribution in the African market. The supplier should have at least one container currently available in stock.",
    },
    context,
  );
  assert.equal(result.activation_state, "confirmed");
  if (result.activation_state !== "confirmed") assert.fail("not confirmed");
  assert.equal(result.schema_version, "domain-pack-resolution.v2");
  if (result.schema_version !== "domain-pack-resolution.v2")
    assert.fail("not agricultural v2");
  assert.equal(
    result.category_id,
    FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK.category_id,
  );
  assert.equal(
    result.content_sha256,
    FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK.content_sha256,
  );
  assert.equal(
    result.resolver_version,
    "governed-agricultural-category-resolver.v2",
  );
  const pack = requireSyntheticDomainPackActivation(
    result.activation_token,
    context,
  );
  assert.deepEqual(pack, FOOD_AGRICULTURAL_COMMODITY_DOMAIN_PACK);
  assert.equal(
    pack.domain_fields.some((field) => field.field_id === "component_material"),
    false,
  );
  assert.equal(
    pack.domain_fields.some((field) =>
      /industrial|component|alloy/iu.test(
        `${field.field_id} ${field.label} ${field.description}`,
      ),
    ),
    false,
  );
  assert.deepEqual(
    new Set(pack.domain_fields.map((field) => field.field_id)),
    new Set([
      "commodity_variety",
      "commodity_grade",
      "commodity_origin",
      "container_quantity",
      "routing_via",
      "distribution_destination",
      "current_stock",
      "food_certifications",
      "export_readiness",
      "logistics_requirements",
    ]),
  );
});

test("ambiguous agricultural intake requires explicit confirmation", () => {
  const context = {
    accountId: "ACC-AGRI",
    userId: "USR-AGRI",
    now: NOW,
    activationTtlSeconds: 300,
    hmacSecret: "test-secret",
  };
  const result = resolveSyntheticDomainPack(
    { sourceText: "pistachio" },
    context,
  );
  assert.equal(result.activation_state, "confirmation_required");
  assert.equal(result.category_id, "food_agricultural_commodities");
  assert.equal("activation_token" in result, false);
});

test("logistics words have zero domain identity weight and conflicts fail closed", () => {
  const context = {
    accountId: "ACC-RESOLVE",
    userId: "USR-RESOLVE",
    now: NOW,
    activationTtlSeconds: 300,
    hmacSecret: "test-secret",
  };
  for (const sourceText of [
    "three containers via Dubai with current stock and export documents",
    "route through Dubai to Africa with certification and logistics",
  ]) {
    const result = resolveSyntheticDomainPack({ sourceText }, context);
    assert.equal(result.activation_state, "unresolved");
  }
  const industrial = resolveSyntheticDomainPack(
    { sourceText: "industrial alloy component shipped via Dubai" },
    context,
  );
  assert.equal(industrial.activation_state, "confirmed");
  if (industrial.activation_state === "confirmed")
    assert.equal(industrial.category_id, SYNTHETIC_DOMAIN_PACK.category_id);
  const conflict = resolveSyntheticDomainPack(
    { sourceText: "industrial alloy component for Ahmad Aghaei pistachios" },
    context,
  );
  assert.equal(conflict.activation_state, "unresolved");
});

test("scores the normative 78 fixture and applies the critical ceiling", () => {
  const candidate = buildStandardSyntheticEvidenceGraph("RUN-78", "one")
    .candidates[0]!;
  const result = scoreStandardCandidate(candidate.dimensions);
  assert.deepEqual(
    [
      result.compatibilityScore,
      result.fitBand,
      result.bandCeiling,
      result.displayedBand,
    ],
    [78, "strong_fit", "potential_fit", "potential_fit"],
  );
  assert.match(result.capReason ?? "", /2 critical dimensions/iu);
  assert.ok(result.drivers.length <= 3);
  assert.ok(result.gaps.length <= 3);
});

test("projects deterministic 0/1/2/3/>3 without padding or hidden keys", () => {
  const expected = { zero: 0, one: 1, two: 2, three: 3, many: 3 } as const;
  for (const [scenario, count] of Object.entries(expected)) {
    const graph = buildStandardSyntheticEvidenceGraph(
      `RUN-${scenario}`,
      scenario as keyof typeof STANDARD_SYNTHETIC_SCENARIO_COUNTS,
    );
    const projection = projectStandard(graph, projectionContext());
    assert.equal(projection.candidates.length, count);
    assert.deepEqual(findForbiddenStandardProjectionKeys(projection), []);
    assert.equal(
      /eligible_total|considered_total|first_gate_input_count|reserve_candidates/u.test(
        JSON.stringify(projection),
      ),
      false,
    );
    assert.doesNotThrow(() =>
      assertStandardProjectionEvidenceLinks(projection, graph),
    );
  }
  const complete = buildStandardSyntheticEvidenceGraph("RUN-MANY", "many");
  assert.equal(complete.candidates.length, 4);

  const highConfidence = buildStandardSyntheticEvidenceGraph(
    "RUN-HIGH-CONFIDENCE-CAP",
    "one",
  );
  for (const dimension of highConfidence.candidates[0]!.dimensions)
    dimension.confidence = "high";
  const capped = projectStandard(highConfidence, projectionContext());
  assert.deepEqual(capped.limitations.affected_low_confidence_dimensions, []);
  assert.match(capped.limitations.cap_notice ?? "", /scores are 45 or lower/iu);
  assert.doesNotMatch(capped.limitations.cap_notice ?? "", /confidence/iu);
});

test("derives structured scarcity only from run-bound constraints and failed candidate ids", () => {
  const certification = {
    constraint_id: "STD-CON-MANDATORY-CERTIFICATION",
    field_id: "FLD-CORE-COMP-01",
    label: "FLD-CORE-COMP-01 equals ISO-9001",
  };
  const capacity = {
    constraint_id: "STD-CON-MINIMUM-CAPACITY",
    field_id: "FLD-CORE-CAP-01",
    label: "FLD-CORE-CAP-01 minimum 1200 units/month",
  };
  const relaxation = {
    ...capacity,
    direction: "lower_is_acceptable",
    tolerance: "200 units/month",
  };
  const zero = projectStandard(
    buildStandardSyntheticEvidenceGraph("RUN-SCARCITY-ZERO", "zero"),
    projectionContext(),
  );
  assert.deepEqual(zero.scarcity_analysis, {
    reducing_constraints: [
      { ...certification, eliminated_count: 2 },
      { ...capacity, eliminated_count: 1 },
    ],
    unmet_mandatory_constraints: [certification, capacity],
    permitted_relaxations: [relaxation],
  });
  const one = projectStandard(
    buildStandardSyntheticEvidenceGraph("RUN-SCARCITY-ONE", "one"),
    projectionContext(),
  );
  assert.deepEqual(one.scarcity_analysis, {
    reducing_constraints: [
      { ...certification, eliminated_count: 1 },
      { ...capacity, eliminated_count: 1 },
    ],
    unmet_mandatory_constraints: [],
    permitted_relaxations: [relaxation],
  });
  const two = projectStandard(
    buildStandardSyntheticEvidenceGraph("RUN-SCARCITY-TWO", "two"),
    projectionContext(),
  );
  assert.deepEqual(two.scarcity_analysis, {
    reducing_constraints: [{ ...certification, eliminated_count: 1 }],
    unmet_mandatory_constraints: [],
    permitted_relaxations: [],
  });
  for (const scenario of ["three", "many"] as const) {
    const projection = projectStandard(
      buildStandardSyntheticEvidenceGraph(`RUN-SCARCITY-${scenario}`, scenario),
      projectionContext(),
    );
    assert.deepEqual(projection.scarcity_analysis, {
      reducing_constraints: [],
      unmet_mandatory_constraints: [],
      permitted_relaxations: [],
    });
  }
  const serialized = JSON.stringify(zero.scarcity_analysis);
  assert.doesNotMatch(
    serialized,
    /source_text|raw_expression|failed_constraint_ids|eligible_total|considered_total/u,
  );
});

test("normalizes no-constraint selectors and binds every scarcity elimination", () => {
  for (const scenario of ["zero", "one", "two"] as const) {
    assert.equal(
      normalizeStandardSyntheticScenarioForConstraints(scenario, 0),
      "three",
    );
    assert.throws(
      () =>
        buildStandardSyntheticEvidenceGraphFixture(
          `RUN-NO-CON-${scenario}`,
          scenario,
          [],
        ),
      /requires a run-bound canonical hard constraint/iu,
    );
  }
  assert.equal(
    normalizeStandardSyntheticScenarioForConstraints("many", 0),
    "many",
  );
  const singleConstraint = RUN_BOUND_HARD_CONSTRAINTS.slice(0, 1);
  for (const scenario of ["zero", "one", "two"] as const) {
    const graph = buildStandardSyntheticEvidenceGraphFixture(
      `RUN-ONE-CON-${scenario}`,
      scenario,
      singleConstraint,
    );
    const projection = projectStandard(graph, {
      now: NOW,
      runBoundCanonicalHardConstraints: singleConstraint,
    });
    const eligible = new Set(graph.eligible_candidate_ids);
    assert.equal(projection.scarcity_analysis.reducing_constraints.length, 1);
    assert.equal(
      graph.candidates
        .filter((candidate) => !eligible.has(candidate.candidate_id))
        .every(
          (candidate) =>
            !candidate.mandatory_constraints_satisfied &&
            candidate.failed_constraint_ids.length > 0,
        ),
      true,
    );
    assert.equal(
      graph.gate_evaluations.find(
        (gate) => gate.gate_id === "mandatory_constraints",
      )!.eliminated_count,
      3 - STANDARD_SYNTHETIC_SCENARIO_COUNTS[scenario],
    );
    assert.equal(
      graph.gate_evaluations.find(
        (gate) => gate.gate_id === "evidence_sufficiency",
      )!.eliminated_count,
      0,
    );
  }
});

test("fails closed when scarcity references an unbound canonical constraint", () => {
  const graph = buildStandardSyntheticEvidenceGraph("RUN-UNKNOWN-CON", "one");
  graph.candidates[1]!.failed_constraint_ids = ["CONSTRAINT-NOT-BOUND"];
  assert.throws(
    () => projectStandard(graph, projectionContext()),
    /not bound to the canonical hard constraints/iu,
  );
  const mismatch = buildStandardSyntheticEvidenceGraph(
    "RUN-GATE-MISMATCH",
    "one",
  );
  mismatch.gate_evaluations.find(
    (gate) => gate.gate_id === "mandatory_constraints",
  )!.eliminated_count = 1;
  assert.throws(
    () => projectStandard(mismatch, projectionContext()),
    /gate count does not match/iu,
  );
});

test("derives freshness at read time without mutating stored evidence or score", () => {
  const graph = buildStandardSyntheticEvidenceGraph("RUN-STALE", "one");
  const before = structuredClone(graph);
  const statuses = standardEvidenceReadStatuses(
    graph,
    new Date("2027-08-15T00:00:00.000Z"),
    STANDARD_EVIDENCE_VOLATILITY_POLICY,
  );
  assert.equal(statuses.get(graph.evidence[0]!.evidence_id), "stale");
  assert.deepEqual(graph, before);
  assert.equal(
    projectStandard(
      graph,
      projectionContext(new Date("2027-08-15T00:00:00.000Z")),
    ).candidates[0]?.freshness,
    "stale",
  );
});

test("rejects dangling driver, gap, value, and evidence lineage", () => {
  const graph = buildStandardSyntheticEvidenceGraph("RUN-HOSTILE", "one");
  assert.doesNotThrow(() => validateStandardEvidenceGraph(graph));
  const projection = structuredClone(
    projectStandard(graph, projectionContext()),
  );
  projection.candidates[0]!.positive_drivers[0]!.evidence_ids = ["MISSING"];
  assert.throws(
    () => assertStandardProjectionEvidenceLinks(projection, graph),
    /dangling evidence lineage/iu,
  );
  const valueProjection = structuredClone(
    projectStandard(graph, projectionContext()),
  );
  valueProjection.candidates[0]!.capacity_figures![0]!.evidence_ids = [
    "MISSING",
  ];
  assert.throws(
    () => assertStandardProjectionEvidenceLinks(valueProjection, graph),
    /commercial value has dangling/iu,
  );
  const badGraph = structuredClone(graph);
  badGraph.claims[0]!.evidence_ids = ["MISSING"];
  assert.throws(
    () => validateStandardEvidenceGraph(badGraph),
    /dangling evidence/iu,
  );
});

test("fails closed on natural-person and ambiguous organization contact values", () => {
  for (const person of [
    "Jane Smith",
    "Jane Mary Smith",
    "John Q. Public",
    "Jean Claude Van Damme",
    "Mary-Jane O'Neil",
    "Dr. Samir A. Haddad",
    "علی رضا حسینی",
    "دکتر محمد علی رضایی",
    "السيد أحمد محمد علي",
    "jane.smith@example.invalid",
    "Jane Smith sales@example.invalid",
    "sales@example.invalid John Public",
    "+971 50 123 4567 (Jane)",
    "Call our procurement team",
  ]) {
    const graph = buildStandardSyntheticEvidenceGraph("RUN-PERSON", "one");
    const evidence = graph.evidence[0]!;
    graph.evidenced_values[0] = {
      value_id: graph.evidenced_values[0]!.value_id,
      candidate_id: graph.evidenced_values[0]!.candidate_id,
      kind: "organization_contact",
      channel_type: "role_email",
      value: person,
      organization_domain: evidence.publisher_domain,
      verification_status: "claimed",
      evidence_ids: [evidence.evidence_id],
    };
    assert.throws(
      () => validateStandardEvidenceGraph(graph),
      /organization role inbox/iu,
    );
  }
});

test("permits only closed organization channels with matching value-level evidence", () => {
  for (const channel of [
    {
      channel_type: "role_email",
      value: "procurement@publisher-01.example.invalid",
    },
    { channel_type: "organization_phone", value: "+971501234567" },
    {
      channel_type: "organization_web",
      value: "https://publisher-01.example.invalid/",
      organization_web_policy_version: "organization-web-channel.v1",
      organization_web_purpose: "organization_root",
      organization_web_form: "root",
    },
    {
      channel_type: "organization_web",
      value: "https://contact.publisher-01.example.invalid/procurement",
      organization_web_policy_version: "organization-web-channel.v1",
      organization_web_purpose: "procurement",
      organization_web_form: "contact_role_path",
    },
    {
      channel_type: "organization_web",
      value: "https://publisher-01.example.invalid/sales",
      organization_web_policy_version: "organization-web-channel.v1",
      organization_web_purpose: "sales",
      organization_web_form: "role_path",
    },
    {
      channel_type: "organization_web",
      value: "https://support.publisher-01.example.invalid/",
      organization_web_policy_version: "organization-web-channel.v1",
      organization_web_purpose: "support",
      organization_web_form: "role_subdomain",
    },
  ] as const) {
    const graph = buildStandardSyntheticEvidenceGraph("RUN-ORG", "one");
    const evidence = graph.evidence[0]!;
    evidence.extract = `${evidence.extract} Contact: [${channel.value}], verified.`;
    evidence.content_sha256 = standardContentSha256(evidence.extract);
    graph.evidenced_values[0] = {
      value_id: graph.evidenced_values[0]!.value_id,
      candidate_id: graph.evidenced_values[0]!.candidate_id,
      kind: "organization_contact",
      ...channel,
      organization_domain: evidence.publisher_domain,
      verification_status: "claimed",
      evidence_ids: [evidence.evidence_id],
    };
    assert.doesNotThrow(() => validateStandardEvidenceGraph(graph));
    const projected = projectStandard(graph, projectionContext());
    assert.deepEqual(projected.candidates[0]!.contact_details![0], {
      kind: "organization_contact",
      ...channel,
      organization_domain: evidence.publisher_domain,
      verification_status: "claimed",
      evidence_ids: [evidence.evidence_id],
    });
  }
});

test("rejects organization channels without exact value-level provenance", () => {
  const channels = [
    { channel_type: "role_email", value: "sales@publisher-01.example.invalid" },
    { channel_type: "organization_phone", value: "+971501234567" },
    {
      channel_type: "organization_web",
      value: "https://publisher-01.example.invalid/procurement",
      organization_web_policy_version: "organization-web-channel.v1",
      organization_web_purpose: "procurement",
      organization_web_form: "role_path",
    },
    {
      channel_type: "organization_web",
      value: "https://arbitrary.publisher-01.example.invalid/contact",
      organization_web_policy_version: "organization-web-channel.v1",
      organization_web_purpose: "contact",
      organization_web_form: "contact_role_path",
    },
    {
      channel_type: "organization_web",
      value: "https://publisher-01.example.invalid/contact?person=Jane-Smith",
      organization_web_policy_version: "organization-web-channel.v1",
      organization_web_purpose: "contact",
      organization_web_form: "role_path",
    },
  ] as const;
  for (const channel of channels) {
    const graph = buildStandardSyntheticEvidenceGraph("RUN-UNBOUND", "one");
    const evidence = graph.evidence[0]!;
    graph.evidenced_values[0] = {
      value_id: graph.evidenced_values[0]!.value_id,
      candidate_id: graph.evidenced_values[0]!.candidate_id,
      kind: "organization_contact",
      ...channel,
      organization_domain: evidence.publisher_domain,
      verification_status: "claimed",
      evidence_ids: [evidence.evidence_id],
    };
    assert.throws(
      () => validateStandardEvidenceGraph(graph),
      /contact evidence|organization web channel/iu,
    );
  }
});

test("rejects evidenced person names embedded in organization web URLs", () => {
  for (const url of [
    "https://publisher-01.example.invalid/Jane-Mary-Smith",
    "https://publisher-01.example.invalid/Jane-Q-Smith",
    "https://publisher-01.example.invalid/%D9%85%D8%AD%D9%85%D8%AF-%D8%B9%D9%84%DB%8C-%D8%B1%D8%B6%D8%A7%DB%8C%DB%8C",
    "https://publisher-01.example.invalid/contact?name=%D8%A3%D8%AD%D9%85%D8%AF-%D9%85%D8%AD%D9%85%D8%AF-%D8%B9%D9%84%D9%8A",
  ]) {
    const graph = buildStandardSyntheticEvidenceGraph("RUN-WEB-PERSON", "one");
    const evidence = graph.evidence[0]!;
    evidence.extract = `${evidence.extract} Contact: ${url}`;
    evidence.content_sha256 = standardContentSha256(evidence.extract);
    graph.evidenced_values[0] = {
      value_id: graph.evidenced_values[0]!.value_id,
      candidate_id: graph.evidenced_values[0]!.candidate_id,
      kind: "organization_contact",
      channel_type: "organization_web",
      value: url,
      organization_web_policy_version: "organization-web-channel.v1",
      organization_web_purpose: "contact",
      organization_web_form: "role_path",
      organization_domain: evidence.publisher_domain,
      verification_status: "claimed",
      evidence_ids: [evidence.evidence_id],
    };
    assert.throws(
      () => validateStandardEvidenceGraph(graph),
      /organization web channel/iu,
    );
  }
});

test("requires exact contact boundaries and closed organization web locations", () => {
  const cases = [
    {
      channel_type: "organization_phone",
      value: "+971501234567",
      evidenced: "+9715012345678",
      message: /contact evidence/iu,
    },
    {
      channel_type: "organization_phone",
      value: "+971501234567",
      evidenced: "9+971501234567",
      message: /contact evidence/iu,
    },
    {
      channel_type: "role_email",
      value: "sales@publisher-01.example.invalid",
      evidenced: "sales@publisher-01.example.invalid.evil",
      message: /contact evidence/iu,
    },
    {
      channel_type: "role_email",
      value: "sales@publisher-01.example.invalid",
      evidenced: "xsales@publisher-01.example.invalid",
      message: /contact evidence/iu,
    },
    {
      channel_type: "organization_web",
      value: "https://jane-smith.publisher-01.example.invalid/",
      organization_web_policy_version: "organization-web-channel.v1",
      organization_web_purpose: "contact",
      organization_web_form: "role_subdomain",
      evidenced: "https://jane-smith.publisher-01.example.invalid/",
      message: /organization web channel/iu,
    },
    {
      channel_type: "organization_web",
      value: "https://publisher-01.example.invalid/contact",
      organization_web_policy_version: "organization-web-channel.v1",
      organization_web_purpose: "contact",
      organization_web_form: "role_path",
      evidenced: "xhttps://publisher-01.example.invalid/contact",
      message: /contact evidence/iu,
    },
    {
      channel_type: "organization_web",
      value: "https://arbitrary.publisher-01.example.invalid/contact",
      organization_web_policy_version: "organization-web-channel.v1",
      organization_web_purpose: "contact",
      organization_web_form: "contact_role_path",
      evidenced: "https://arbitrary.publisher-01.example.invalid/contact",
      message: /organization web channel/iu,
    },
    {
      channel_type: "organization_web",
      value: "https://publisher-01.example.invalid/arbitrary-path",
      organization_web_policy_version: "organization-web-channel.v1",
      organization_web_purpose: "contact",
      organization_web_form: "role_path",
      evidenced: "https://publisher-01.example.invalid/arbitrary-path",
      message: /organization web channel/iu,
    },
    {
      channel_type: "organization_web",
      value: "https://publisher-01.example.invalid/contact?arbitrary=value",
      organization_web_policy_version: "organization-web-channel.v1",
      organization_web_purpose: "contact",
      organization_web_form: "role_path",
      evidenced: "https://publisher-01.example.invalid/contact?arbitrary=value",
      message: /organization web channel/iu,
    },
    {
      channel_type: "organization_web",
      value: "https://publisher-01.example.invalid/contact#Jane-Smith",
      organization_web_policy_version: "organization-web-channel.v1",
      organization_web_purpose: "contact",
      organization_web_form: "role_path",
      evidenced: "https://publisher-01.example.invalid/contact#Jane-Smith",
      message: /organization web channel/iu,
    },
  ] as const;
  for (const item of cases) {
    const graph = buildStandardSyntheticEvidenceGraph("RUN-BOUNDARY", "one");
    const evidence = graph.evidence[0]!;
    evidence.extract = `${evidence.extract} Contact: ${item.evidenced}`;
    evidence.content_sha256 = standardContentSha256(evidence.extract);
    const common = {
      value_id: graph.evidenced_values[0]!.value_id,
      candidate_id: graph.evidenced_values[0]!.candidate_id,
      kind: "organization_contact" as const,
      value: item.value,
      organization_domain: evidence.publisher_domain,
      verification_status: "claimed" as const,
      evidence_ids: [evidence.evidence_id],
    };
    graph.evidenced_values[0] =
      item.channel_type === "organization_web"
        ? {
            ...common,
            channel_type: item.channel_type,
            organization_web_policy_version:
              item.organization_web_policy_version,
            organization_web_purpose: item.organization_web_purpose,
            organization_web_form: item.organization_web_form,
          }
        : { ...common, channel_type: item.channel_type };
    assert.throws(() => validateStandardEvidenceGraph(graph), item.message);
  }
});

test("rejects every RFC 3986 continuation and encoded Unicode web suffix", () => {
  const claimed = "https://publisher-01.example.invalid/contact";
  const continuations = [
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~:/?#[]@!$&'()*+,;=",
    "%4A",
    "%D8%AC%D8%A7%D9%86",
  ];
  for (const suffix of continuations) {
    const graph = buildStandardSyntheticEvidenceGraph(
      "RUN-URI-BOUNDARY",
      "one",
    );
    const evidence = graph.evidence[0]!;
    evidence.extract = `${evidence.extract} Contact: ${claimed}${suffix}jane-smith`;
    evidence.content_sha256 = standardContentSha256(evidence.extract);
    graph.evidenced_values[0] = {
      value_id: graph.evidenced_values[0]!.value_id,
      candidate_id: graph.evidenced_values[0]!.candidate_id,
      kind: "organization_contact",
      channel_type: "organization_web",
      value: claimed,
      organization_web_policy_version: "organization-web-channel.v1",
      organization_web_purpose: "contact",
      organization_web_form: "role_path",
      organization_domain: evidence.publisher_domain,
      verification_status: "claimed",
      evidence_ids: [evidence.evidence_id],
    };
    assert.throws(
      () => validateStandardEvidenceGraph(graph),
      /contact evidence/iu,
      `continuation ${JSON.stringify(suffix)} must not attest the shorter URL`,
    );
  }
});

test("rejects arbitrary RFC 3986 components under the versioned organization web grammar", () => {
  const rejected = [
    "https://123.publisher-01.example.invalid/123?123=456#789",
    "https://publisher-01.example.invalid/%31%32%33",
    "https://publisher-01.example.invalid/%2531%2532%2533",
    "https://publisher-01.example.invalid/contact?123=456",
    "https://publisher-01.example.invalid/---",
    "https://publisher-01.example.invalid/contact;person=Jane-Smith",
    "https://publisher-01.example.invalid/contact?name=Jane-Smith",
    "https://publisher-01.example.invalid/contact#Jane-Smith",
    "https://publisher-01.example.invalid./contact",
    "https://publisher-01.example.invalid:443/contact",
    "https://user@publisher-01.example.invalid/contact",
    "https://127.0.0.1/contact",
    "https://arbitrary.publisher-01.example.invalid/contact",
    "https://publisher-01.example.invalid//contact",
    "https://publisher-01.example.invalid/%63ontact",
    "https://publisher-01.example.invalid/%2563ontact",
    "https://publisher-01.example.invalid/cοntact",
    "https://publisher-01.example.invalid/contact%2Fprocurement",
    "https://publisher-01.example.invalid/contact%252Fprocurement",
  ];
  for (const value of rejected) {
    const graph = buildStandardSyntheticEvidenceGraph("RUN-WEB-GRAMMAR", "one");
    const evidence = graph.evidence[0]!;
    evidence.extract = `${evidence.extract} Contact: ${value}`;
    evidence.content_sha256 = standardContentSha256(evidence.extract);
    graph.evidenced_values[0] = {
      value_id: graph.evidenced_values[0]!.value_id,
      candidate_id: graph.evidenced_values[0]!.candidate_id,
      kind: "organization_contact",
      channel_type: "organization_web",
      value,
      organization_domain: evidence.publisher_domain,
      organization_web_policy_version: "organization-web-channel.v1",
      organization_web_purpose: "contact",
      organization_web_form: "role_path",
      verification_status: "claimed",
      evidence_ids: [evidence.evidence_id],
    };
    assert.throws(
      () => validateStandardEvidenceGraph(graph),
      /organization web channel/iu,
      value,
    );
  }
});

test("rejects phone prefixes, longer tokens, Unicode digits, and extensions", () => {
  const claimed = "+971501234567";
  const rejectedEvidence = [
    "tel:+971501234567ext123",
    "phone +971501234567 x99",
    "+971501234567 extension 99",
    "+971501234567 ext. 99",
    "+971501234567 x 99",
    "+971501234567 #99",
    "+971501234567;ext=99",
    "+9715012345678",
    `+971501234567\u0661`,
    `\u0661+971501234567`,
  ];
  for (const evidenced of rejectedEvidence) {
    const graph = buildStandardSyntheticEvidenceGraph(
      "RUN-PHONE-GRAMMAR",
      "one",
    );
    const evidence = graph.evidence[0]!;
    evidence.extract = `${evidence.extract} Contact: ${evidenced}`;
    evidence.content_sha256 = standardContentSha256(evidence.extract);
    graph.evidenced_values[0] = {
      value_id: graph.evidenced_values[0]!.value_id,
      candidate_id: graph.evidenced_values[0]!.candidate_id,
      kind: "organization_contact",
      channel_type: "organization_phone",
      value: claimed,
      organization_domain: evidence.publisher_domain,
      verification_status: "claimed",
      evidence_ids: [evidence.evidence_id],
    };
    assert.throws(
      () => validateStandardEvidenceGraph(graph),
      /contact evidence/iu,
      evidenced,
    );
  }
});

test("redacts person names adjacent to every valid organization channel before projection and persistence", () => {
  const people = [
    "Jane Mary Smith",
    "John Q. Public",
    "Jean Claude Van Damme",
    "Mary-Jane O'Neil",
    "Dr. Samir A. Haddad",
    "علی رضا حسینی",
    "دکتر محمد علی رضایی",
    "السيد أحمد محمد علي",
  ];
  const channels = [
    {
      channel_type: "role_email",
      value: "sales@publisher-01.example.invalid",
    },
    { channel_type: "organization_phone", value: "+971501234567" },
    {
      channel_type: "organization_web",
      value: "https://publisher-01.example.invalid/contact",
      organization_web_policy_version: "organization-web-channel.v1",
      organization_web_purpose: "contact",
      organization_web_form: "role_path",
    },
  ] as const;
  for (const person of people) {
    for (const channel of channels) {
      const graph = buildStandardSyntheticEvidenceGraph(
        "RUN-PII-RELEASE",
        "one",
      );
      const evidence = graph.evidence[0]!;
      evidence.extract = `${evidence.extract} Contact: ${channel.value} ${person}`;
      evidence.content_sha256 = standardContentSha256(evidence.extract);
      const common = {
        value_id: graph.evidenced_values[0]!.value_id,
        candidate_id: graph.evidenced_values[0]!.candidate_id,
        kind: "organization_contact" as const,
        value: channel.value,
        organization_domain: evidence.publisher_domain,
        verification_status: "claimed" as const,
        evidence_ids: [evidence.evidence_id],
      };
      graph.evidenced_values[0] =
        channel.channel_type === "organization_web"
          ? { ...common, ...channel }
          : { ...common, channel_type: channel.channel_type };
      const events: unknown[] = [];
      const prepared = prepareStandardCompleteResultForPersistence(graph, {
        ...projectionContext(),
        onSecurityEvent: (event) => events.push(event),
      });
      assert.equal(JSON.stringify(prepared.projection).includes(person), false);
      assert.equal(
        JSON.stringify(prepared.persistence_graph).includes(person),
        false,
      );
      assert.equal(
        prepared.projection.candidates[0]!.contact_details![0]!.value,
        channel.value,
      );
      assert.match(
        prepared.projection.candidates[0]!.citations[0]!.extract,
        /personal data withheld/iu,
      );
      assert.doesNotThrow(() =>
        assertStandardPiiReleaseSafe(prepared.projection),
      );
      assert.equal(events.length, 1);
      assert.equal(JSON.stringify(events).includes(person), false);
    }
  }
});

test("recursively denies personal data outside redactable evidence excerpts", () => {
  const mutations = [
    (graph: ReturnType<typeof buildStandardSyntheticEvidenceGraph>) => {
      graph.candidates[0]!.display_name = "Jane Mary Smith";
    },
    (graph: ReturnType<typeof buildStandardSyntheticEvidenceGraph>) => {
      graph.candidates[0]!.rationale_extended = "John Q. Public";
    },
    (graph: ReturnType<typeof buildStandardSyntheticEvidenceGraph>) => {
      graph.claims[0]!.text = "Mary-Jane O'Neil";
    },
    (graph: ReturnType<typeof buildStandardSyntheticEvidenceGraph>) => {
      graph.evidence[0]!.title = "Dr. Samir A. Haddad";
    },
    (graph: ReturnType<typeof buildStandardSyntheticEvidenceGraph>) => {
      graph.gate_evaluations[0]!.label = "علی رضا حسینی";
    },
  ];
  for (const mutate of mutations) {
    const graph = buildStandardSyntheticEvidenceGraph("RUN-PII-DENY", "one");
    mutate(graph);
    assert.throws(
      () => projectStandard(graph, projectionContext()),
      /PII release membrane/iu,
    );
  }
  assert.throws(
    () =>
      assertStandardPiiReleaseSafe({
        nested: [{ value: "sales@example.invalid Jane Mary Smith" }],
      }),
    /PII release membrane/iu,
  );
});

test("keeps a redacted evidence extract inside the closed 600-character boundary", () => {
  const graph = buildStandardSyntheticEvidenceGraph("RUN-PII-BOUND", "one");
  const evidence = graph.evidence[0]!;
  evidence.extract = `${"verified industrial evidence. ".repeat(40).slice(0, 580)} Jane Mary Smith`;
  evidence.content_sha256 = standardContentSha256(evidence.extract);
  const prepared = prepareStandardCompleteResultForPersistence(
    graph,
    projectionContext(),
  );
  assert.equal(prepared.persistence_graph.evidence[0]!.extract.length, 600);
  assert.match(
    prepared.persistence_graph.evidence[0]!.extract,
    /personal data withheld/iu,
  );
  assert.doesNotThrow(() =>
    validateStandardEvidenceGraph(prepared.persistence_graph),
  );
});

test("maps compatibility-expanded and controlled person text back to original spans", () => {
  const values = [
    "Jane Mary Smiﬁth",
    "Ｊａｎｅ Ｍａｒｙ Ｓｍｉｔｈ",
    "Ja\u0301ne Mary Smith",
    "Jane\u200f Mary Smith",
    "Jane\u202e Mary Smith",
    "ﻋﻠﻲ ﺭﺿﺎ ﺣﺴﻴﻨﻲ",
    "Jаne Mary Smiﬁth",
    "jane\u200Bmary smith",
    "jane\u200Cmary smith",
    "jane\u200Dmary smith",
    "john\u200Eq public",
    "jane\u2066mary smith\u2069",
    "jane\u202Emary smith",
    "علی\u200Dرضا حسینی",
    "Ja\u034Fne Mary Smith",
    "Ja\uFE0Fne Mary Smith",
    "Ja\u00ADne Mary Smith",
  ];
  for (const value of values) {
    const findings = standardPiiFindings(value);
    assert.ok(findings.length > 0, value);
    assert.ok(
      findings.every(({ start, end }) => start >= 0 && end <= value.length),
    );
    assert.throws(
      () => assertStandardPiiReleaseSafe({ value }),
      /PII release membrane/iu,
      value,
    );
    const encoded = encodeURIComponent(value);
    assert.throws(
      () => assertStandardPiiReleaseSafe({ value: encoded }),
      /PII release membrane/iu,
      encoded,
    );
  }
});

test("withholds the complete excerpt for ambiguous controls and denies entity-encoded variants", () => {
  const controlled = [
    "jane\u200Bmary smith",
    "jane\u200Dmary smith",
    "john\u200Eq public",
    "علی\u200Dرضا حسینی",
    "Ja\u034Fne Mary Smith",
    "Ja\uFE0Fne Mary Smith",
    "Ja\u00ADne Mary Smith",
  ];
  for (const person of controlled) {
    const graph = buildStandardSyntheticEvidenceGraph("RUN-CONTROL-PII", "one");
    const evidence = graph.evidence[0]!;
    evidence.extract = `${evidence.extract} Contact ${person}`;
    evidence.content_sha256 = standardContentSha256(evidence.extract);
    const prepared = prepareStandardCompleteResultForPersistence(
      graph,
      projectionContext(),
    );
    assert.equal(
      prepared.persistence_graph.evidence[0]!.extract,
      "[personal data withheld]",
      person,
    );
    assert.equal(
      prepared.persistence_foundation.evidence[0]!.extract,
      "[personal data withheld]",
      person,
    );
    assert.equal(JSON.stringify(prepared.projection).includes(person), false);
  }
  for (const encoded of [
    "jane&#8203;mary smith",
    "jane&#x200D;mary smith",
    "علی&#8204;رضا حسینی",
    "jane%26%238203%3Bmary%20smith",
  ])
    assert.throws(
      () => assertStandardPiiReleaseSafe({ value: encoded }),
      /PII release membrane/iu,
      encoded,
    );
});

test("fails closed on unsupported and mixed Unicode letter scripts", () => {
  const unsupportedOrMixed = [
    "jօhn q public",
    "joհn q public",
    "jane marу smith",
    "jane mаry smith",
    "jane μαry smith",
    "jane მary smith",
    "jane מary smith",
    "jane 張ary smith",
    "јоһո q public",
    "jane مary smith",
  ];

  for (const person of unsupportedOrMixed) {
    assert.throws(
      () => assertStandardPiiReleaseSafe({ person }),
      /PII release membrane rejected personal data/,
    );
    assert.throws(
      () =>
        assertStandardPiiReleaseSafe({
          person: encodeURIComponent(person),
        }),
      /PII release membrane rejected personal data/,
    );

    const graph = buildStandardSyntheticEvidenceGraph(
      "RUN-CLOSED-SCRIPT-PII",
      "one",
    );
    graph.evidence[0]!.extract = person;
    graph.evidence[0]!.content_sha256 = standardContentSha256(person);
    const release = prepareStandardCompleteResultForPersistence(
      graph,
      projectionContext(),
    );
    assert.equal(
      release.persistence_graph.evidence[0]!.extract,
      "[personal data withheld]",
    );
    assert.equal(JSON.stringify(release.projection).includes(person), false);
    assert.doesNotThrow(() =>
      assertStandardPiiReleaseSafe(release.persistence_graph),
    );
  }

  const contactGraph = buildStandardSyntheticEvidenceGraph(
    "RUN-CLOSED-SCRIPT-CONTACT",
    "one",
  );
  const contactEvidence = contactGraph.evidence[0]!;
  const contactValue = "sales@publisher-01.example.invalid";
  contactEvidence.extract = `${contactValue} jane marу smith`;
  contactEvidence.content_sha256 = standardContentSha256(
    contactEvidence.extract,
  );
  contactGraph.evidenced_values[0] = {
    value_id: contactGraph.evidenced_values[0]!.value_id,
    candidate_id: contactGraph.evidenced_values[0]!.candidate_id,
    kind: "organization_contact",
    channel_type: "role_email",
    value: contactValue,
    organization_domain: contactEvidence.publisher_domain,
    verification_status: "claimed",
    evidence_ids: [contactEvidence.evidence_id],
  };
  assert.throws(
    () =>
      prepareStandardCompleteResultForPersistence(
        contactGraph,
        projectionContext(),
      ),
    /exact value-level contact evidence/,
  );

  assert.doesNotThrow(() =>
    assertStandardPiiReleaseSafe({
      latin: "Procurement team",
      arabic: "فريق المشتريات",
      fullwidth: "Ｐｒｏｃｕｒｅｍｅｎｔ",
    }),
  );
});
