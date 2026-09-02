import assert from "node:assert/strict";
import test from "node:test";

import { buildConsultantResultProjectionV2 } from "../../../packages/application/dist/index.js";
import {
  buildStandardSyntheticEvidenceGraph,
  buildStandardSyntheticHardConstraints,
} from "../../../packages/ai-evidence/dist/src/standard.js";

const now = new Date("2026-08-25T00:00:00.000Z");
const constraints = buildStandardSyntheticHardConstraints();
const configurationRelease = {
  configId: "00000000-0000-4000-8000-000000000621",
  configVersion: "consultant-source-facts.test.v1",
  contentSha256: "b".repeat(64),
  boundAt: now,
  effectiveReleaseAt: new Date("2026-08-24T00:00:00.000Z"),
};

test("v2 retains accepted live evidence for ineligible candidates as explicitly excluded Consultant source facts", () => {
  const graph = buildStandardSyntheticEvidenceGraph(
    "RUN-CONSULTANT-V2-INELIGIBLE-SOURCES",
    "one",
    constraints,
  );
  const trustedLiveEvidenceIds = new Set();
  for (const [index, evidence] of graph.evidence.entries()) {
    delete evidence.fixture_identity;
    evidence.exact_url = `https://publisher-${index + 1}.example.invalid/source`;
    evidence.publisher_domain = `publisher-${index + 1}.example.invalid`;
    evidence.published_or_updated = "not stated by source";
    trustedLiveEvidenceIds.add(evidence.evidence_id);
  }
  const before = structuredClone(graph);

  const result = buildConsultantResultProjectionV2({
    completeResult: graph,
    trustedLiveEvidenceIds,
    projectionAsOf: now,
    hardConstraints: constraints,
    softCap: 3,
    configurationRelease,
  });

  const referencedEvidenceIds = new Set(
    result.eligible_ranking.flatMap((entry) => entry.evidence_ids),
  );
  const accepted = result.source_facts.filter(
    (fact) => fact.verification_disposition === "accepted",
  );
  const excluded = result.source_facts.filter(
    (fact) => fact.verification_disposition === "excluded",
  );
  assert.equal(result.landscape.eligible_count, 1);
  assert.equal(accepted.length, 1);
  assert.ok(
    accepted.every((fact) => referencedEvidenceIds.has(fact.evidence_id)),
  );
  assert.equal(excluded.length, 2);
  assert.ok(
    excluded.every(
      (fact) =>
        fact.provenance === "live_secure_fetch" &&
        fact.exclusion_reason ===
          "Source fact is not referenced by an eligible Consultant candidate.",
    ),
  );
  assert.deepEqual(result.excluded_evidence, excluded);
  assert.deepEqual(graph, before);
});

test("v2 zero-match results retain every accepted source with a non-empty Consultant exclusion reason", () => {
  const graph = buildStandardSyntheticEvidenceGraph(
    "RUN-CONSULTANT-V2-ZERO-SOURCES",
    "zero",
    constraints,
  );

  const result = buildConsultantResultProjectionV2({
    completeResult: graph,
    projectionAsOf: now,
    hardConstraints: constraints,
    softCap: 3,
    configurationRelease,
  });

  assert.equal(result.outcome, "no_responsible_match");
  assert.equal(result.source_facts.length, graph.evidence.length);
  assert.deepEqual(result.excluded_evidence, result.source_facts);
  assert.ok(
    result.source_facts.every(
      (fact) =>
        fact.verification_disposition === "excluded" &&
        fact.exclusion_reason.trim().length > 0,
    ),
  );
});
