import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoRestrictedProviderMaterial,
  validateEvidenceGraph,
} from "../src/evidence/integrity.js";
import { buildSyntheticEvidenceGraph } from "../src/research/synthetic-fixtures.js";

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
