import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalizeStandardCondition,
  canonicalizeStandardConstraintComparand,
  canonicalizeStandardExclusion,
  canonicalizeStandardFieldValue,
  canonicalizeStandardRequiredResult,
  canonicalizeStandardStructuredText,
} from "../src/canonicalization/standard-structured.js";
import {
  requireSyntheticDomainPackActivation,
  resolveSyntheticDomainPack,
  STANDARD_DOMAIN_INVARIANT_CORE,
  SYNTHETIC_DOMAIN_PACK,
} from "../src/domain-packs/registry.js";
import {
  STANDARD_EVIDENCE_VOLATILITY_POLICY,
  standardEvidenceReadStatuses,
  validateStandardEvidenceGraph,
} from "../src/evidence/standard.js";
import {
  assertStandardProjectionEvidenceLinks,
  findForbiddenStandardProjectionKeys,
  projectStandardResult,
} from "../src/projection/standard.js";
import {
  buildStandardSyntheticEvidenceGraph,
  STANDARD_SYNTHETIC_SCENARIO_COUNTS,
} from "../src/research/standard-synthetic-fixtures.js";
import { scoreStandardCandidate } from "../src/scoring/standard.js";

const NOW = new Date("2026-08-15T00:00:00.000Z");

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
    const projection = projectStandardResult(graph, { now: NOW });
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
  const capped = projectStandardResult(highConfidence, { now: NOW });
  assert.deepEqual(capped.limitations.affected_low_confidence_dimensions, []);
  assert.match(capped.limitations.cap_notice ?? "", /scores are 45 or lower/iu);
  assert.doesNotMatch(capped.limitations.cap_notice ?? "", /confidence/iu);
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
    projectStandardResult(graph, {
      now: new Date("2027-08-15T00:00:00.000Z"),
    }).candidates[0]?.freshness,
    "stale",
  );
});

test("rejects dangling driver, gap, value, and evidence lineage", () => {
  const graph = buildStandardSyntheticEvidenceGraph("RUN-HOSTILE", "one");
  assert.doesNotThrow(() => validateStandardEvidenceGraph(graph));
  const projection = projectStandardResult(graph, { now: NOW });
  projection.candidates[0]!.positive_drivers[0]!.evidence_ids = ["MISSING"];
  assert.throws(
    () => assertStandardProjectionEvidenceLinks(projection, graph),
    /dangling evidence lineage/iu,
  );
  const valueProjection = projectStandardResult(graph, { now: NOW });
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

test("rejects titled and unprefixed multilingual natural-person contact values", () => {
  for (const person of [
    "Dr Jane Smith",
    "Jane Smith",
    "علی رضایی",
    "محمد أحمد",
  ]) {
    const graph = buildStandardSyntheticEvidenceGraph("RUN-PERSON", "one");
    graph.evidenced_values[0] = {
      ...graph.evidenced_values[0]!,
      kind: "organization_contact",
      value: person,
    };
    assert.throws(
      () => validateStandardEvidenceGraph(graph),
      /named natural-person contact data/iu,
    );
  }
});
