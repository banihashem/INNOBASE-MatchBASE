import assert from "node:assert/strict";
import test from "node:test";

import { buildConsultantResultProjectionV2 } from "../../../packages/application/dist/index.js";
import {
  buildStandardSyntheticEvidenceGraph,
  buildStandardSyntheticHardConstraints,
} from "../../../packages/ai-evidence/dist/src/standard.js";

test("Consultant v2 references an accepted live source fact used by an eligible candidate", () => {
  const constraints = buildStandardSyntheticHardConstraints();
  const graph = buildStandardSyntheticEvidenceGraph(
    "RUN-CONSULTANT-V2-REFERENCED-LIVE",
    "one",
    constraints,
  );
  const eligibleCandidateId = graph.eligible_candidate_ids[0];
  const liveEvidenceId = graph.claims.find(
    (claim) => claim.candidate_id === eligibleCandidateId,
  ).evidence_ids[0];
  const evidence = graph.evidence.find(
    (item) => item.evidence_id === liveEvidenceId,
  );
  delete evidence.fixture_identity;
  evidence.exact_url =
    "https://publisher-01.example.invalid/eligible-candidate-source";
  evidence.publisher_domain = "publisher-01.example.invalid";
  evidence.published_or_updated = "not stated by source";

  const result = buildConsultantResultProjectionV2({
    completeResult: graph,
    trustedLiveEvidenceIds: new Set([liveEvidenceId]),
    projectionAsOf: new Date("2026-08-25T00:00:00.000Z"),
    hardConstraints: constraints,
    softCap: 3,
    configurationRelease: {
      configId: "00000000-0000-4000-8000-000000000620",
      configVersion: "consultant-soft-cap.test.v1",
      contentSha256: "a".repeat(64),
      boundAt: new Date("2026-08-25T00:00:00.000Z"),
      effectiveReleaseAt: new Date("2026-08-24T00:00:00.000Z"),
    },
  });

  const sourceFact = result.source_facts.find(
    (fact) => fact.evidence_id === liveEvidenceId,
  );
  assert.equal(sourceFact.verification_disposition, "accepted");
  assert.equal(sourceFact.provenance, "live_secure_fetch");
  assert.ok(
    result.candidates.some((candidate) =>
      candidate.citations.some(
        (citation) => citation.evidence_id === liveEvidenceId,
      ),
    ),
  );
  assert.ok(
    result.eligible_ranking.some((candidate) =>
      candidate.evidence_ids.includes(liveEvidenceId),
    ),
  );
});
