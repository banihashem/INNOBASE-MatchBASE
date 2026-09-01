import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoRestrictedProviderMaterial,
  normalizeLegacyProviderDimensionScores,
  validateEvidenceGraph,
} from "../src/evidence/integrity.js";
import { buildSyntheticEvidenceGraph } from "../src/research/synthetic-fixtures.js";

test("normalizes only a closed legacy JSON-encoded dimension score object", () => {
  const graph = structuredClone(
    buildSyntheticEvidenceGraph("RUN-LEGACY-DIMENSIONS", "one"),
  ) as unknown as Record<string, unknown>;
  const candidate = (graph.candidates as Array<Record<string, unknown>>)[0]!;
  candidate.dimensionScores = JSON.stringify(candidate.dimensionScores);
  const normalized = normalizeLegacyProviderDimensionScores(graph);
  assert.notEqual(normalized, graph);
  assert.doesNotThrow(() => validateEvidenceGraph(normalized));
  assert.equal(typeof candidate.dimensionScores, "string");
});

test("legacy dimension score normalization rejects widening and non-integers", () => {
  for (const dimensions of [
    {
      category_product_fit: 80,
      compliance_certification_fit: 80,
      volume_capacity_fit: 80,
      price_tier_fit: 80,
      positioning_brand_fit: 80,
      geographic_reach_fit: 80,
      extra: 80,
    },
    {
      category_product_fit: 80.5,
      compliance_certification_fit: 80,
      volume_capacity_fit: 80,
      price_tier_fit: 80,
      positioning_brand_fit: 80,
      geographic_reach_fit: 80,
    },
  ]) {
    const graph = structuredClone(
      buildSyntheticEvidenceGraph("RUN-REJECT-LEGACY-DIMENSIONS", "one"),
    ) as unknown as Record<string, unknown>;
    const candidate = (graph.candidates as Array<Record<string, unknown>>)[0]!;
    candidate.dimensionScores = JSON.stringify(dimensions);
    assert.throws(
      () => normalizeLegacyProviderDimensionScores(graph),
      /unknown|missing|invalid/iu,
    );
  }
});

test("EvidenceGraph validator enforces exact approved integer dimension keys", () => {
  const unknown = structuredClone(
    buildSyntheticEvidenceGraph("RUN-DIMENSION-KEYS", "one"),
  );
  (unknown.candidates[0]!.dimensionScores as Record<string, number>).extra = 1;
  assert.throws(() => validateEvidenceGraph(unknown), /unknown|missing/iu);
  const fractional = structuredClone(
    buildSyntheticEvidenceGraph("RUN-DIMENSION-INTEGER", "one"),
  );
  fractional.candidates[0]!.dimensionScores.category_product_fit = 1.5;
  assert.throws(() => validateEvidenceGraph(fractional), /invalid/iu);
});

test("provider EvidenceGraph rejects unknown fields at every closed level", () => {
  const mutations: Array<(graph: Record<string, unknown>) => void> = [
    (graph) => {
      graph.unexpected = true;
    },
    (graph) => {
      const claims = graph.claims as Array<Record<string, unknown>>;
      claims[0]!.unapproved = { nested: true };
    },
    (graph) => {
      const candidates = graph.candidates as Array<Record<string, unknown>>;
      candidates[0]!.debug = "internal";
    },
    (graph) => {
      const evidence = graph.evidence as Array<Record<string, unknown>>;
      evidence[0]!.response = { body: "raw" };
    },
  ];
  for (const mutate of mutations) {
    const graph = structuredClone(
      buildSyntheticEvidenceGraph("RUN-CLOSED", "one"),
    ) as unknown as Record<string, unknown>;
    mutate(graph);
    assert.throws(() => validateEvidenceGraph(graph), /unknown|missing/iu);
  }
});

test("provider EvidenceGraph rejects raw payload and provider topology recursively", () => {
  const raw = structuredClone(
    buildSyntheticEvidenceGraph("RUN-RAW", "one"),
  ) as unknown as Record<string, unknown>;
  raw.raw_provider_payload = { choices: [{ hidden: true }] };
  assert.throws(
    () => validateEvidenceGraph(raw),
    /restricted provider material/iu,
  );
  assert.throws(
    () =>
      assertNoRestrictedProviderMaterial({
        safeKey: '{"raw_provider_payload":{"hidden":true}}',
      }),
    /restricted provider material/iu,
  );

  const topology = structuredClone(
    buildSyntheticEvidenceGraph("RUN-TOPOLOGY", "one"),
  );
  (topology.candidates[0]!.dimensionScores as Record<string, number>)[
    "served_provider_id"
  ] = 1;
  assert.throws(
    () => validateEvidenceGraph(topology),
    /restricted provider material/iu,
  );
});

test("recursive output and persistence scans deny nested topology arrays", () => {
  assert.throws(
    () =>
      assertNoRestrictedProviderMaterial({
        persistence: {
          safe: [
            {
              nested: {
                requested_model_id: "hidden-model",
              },
            },
          ],
        },
      }),
    /restricted provider material/iu,
  );
  assert.doesNotThrow(() =>
    assertNoRestrictedProviderMaterial(
      buildSyntheticEvidenceGraph("RUN-SAFE-SCAN", "one"),
    ),
  );
});

test("allowed text fields reject raw provider traces and encoded topology", () => {
  const attacks = [
    '{"choices":[{"message":{"content":"raw-secret"}}],"usage":{"prompt_tokens":42}}',
    "served_provider_id=google; served_model_id=gemini-hidden; fallback_position=2",
    encodeURIComponent(
      encodeURIComponent("served_provider_id=google; route_id=hidden"),
    ),
    "%ZZserved%5Fprovider%5Fid%3Dgoogle",
    "safe%25ZZserved%255Fprovider%255Fid%253Dgoogle",
    "ｓｅｒｖｅｄ＿ｐｒｏｖｉｄｅｒ＿ｉｄ＝google",
    "served&#95;model&#95;id&#61;hidden",
    "tool_calls:[{function_call:{arguments:raw-secret}}]",
  ];
  for (const [index, attack] of attacks.entries()) {
    const graph = structuredClone(
      buildSyntheticEvidenceGraph(`RUN-TEXT-ATTACK-${index}`, "one"),
    );
    graph.candidates[0]!.rationaleShort = attack;
    assert.throws(
      () => validateEvidenceGraph(graph),
      /restricted provider material/iu,
      attack,
    );
  }
  const evidenceAttack = structuredClone(
    buildSyntheticEvidenceGraph("RUN-EVIDENCE-TEXT-ATTACK", "one"),
  );
  evidenceAttack.evidence[0]!.extract = "usage&#58; prompt&#95;tokens&#58; 42";
  assert.throws(
    () => validateEvidenceGraph(evidenceAttack),
    /restricted provider material/iu,
  );
});

test("excluded provider evidence requires a non-empty trimmed reason", () => {
  for (const exclusionReason of ["", "   ", "\t\r\n"]) {
    const graph = structuredClone(
      buildSyntheticEvidenceGraph("RUN-EXCLUDED-REASON", "one"),
    );
    graph.evidence[0]!.verificationDisposition = "excluded";
    graph.evidence[0]!.exclusionReason = exclusionReason;
    assert.throws(
      () => validateEvidenceGraph(graph),
      /excluded disposition requires a non-empty reason/iu,
    );
  }
});
