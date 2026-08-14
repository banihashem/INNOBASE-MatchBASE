import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { CandidateV1, EvidenceGraphV1 } from "@matchbase/contracts";
import { validateEvidenceGraph } from "../src/evidence/integrity.js";
import {
  assertDemoProjectionSafe,
  findRestrictedProjectionKeys,
  projectDemoResult,
} from "../src/projection/demo.js";
import {
  buildSyntheticEvidenceGraph,
  selectEligibleCandidateIds,
  SYNTHETIC_CASE_COUNTS,
} from "../src/research/synthetic-fixtures.js";

test("fixture manifest covers zero, one, two, three and more-than-three", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL(
        "../../../../config/slice1/synthetic-research-cases.v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    cases: Array<{
      id: keyof typeof SYNTHETIC_CASE_COUNTS;
      eligibleCandidates: number;
    }>;
  };
  assert.deepEqual(
    Object.fromEntries(
      manifest.cases.map((item) => [item.id, item.eligibleCandidates]),
    ),
    SYNTHETIC_CASE_COUNTS,
  );
  for (const fixture of manifest.cases) {
    const graph = buildSyntheticEvidenceGraph(`RUN-${fixture.id}`, fixture.id);
    assert.equal(graph.eligibleCandidateIds.length, fixture.eligibleCandidates);
    assert.doesNotThrow(() => validateEvidenceGraph(graph));
  }
});

test("applies hard constraints before ranking", () => {
  const base = buildSyntheticEvidenceGraph("RUN-GATE", "two").candidates;
  const highScoringFailure: CandidateV1 = {
    ...base[0]!,
    candidateId: "CAND-INELIGIBLE",
    compatibilityScore: 100,
    deterministicRankKey: "000:CAND-INELIGIBLE",
    mandatoryConstraintsSatisfied: false,
    failedConstraintIds: ["MANDATORY-ORIGIN"],
  };
  assert.deepEqual(selectEligibleCandidateIds([highScoringFailure, base[1]!]), [
    base[1]!.candidateId,
  ]);
});

test("projects Demo with a server allowlist, maximum three, and no padding", () => {
  const expected = { zero: 0, one: 1, two: 2, three: 3, many: 3 } as const;
  for (const [fixture, count] of Object.entries(expected)) {
    const projection = projectDemoResult(
      buildSyntheticEvidenceGraph(
        `RUN-${fixture}`,
        fixture as keyof typeof SYNTHETIC_CASE_COUNTS,
      ),
    );
    assert.equal(projection.candidates.length, count);
    assert.deepEqual(findRestrictedProjectionKeys(projection), []);
    for (const candidate of projection.candidates) {
      assert.deepEqual(Object.keys(candidate).sort(), [
        "country_code",
        "display_name",
        "rationale_short",
      ]);
    }
  }
});

test("rejects recursive hidden fields and invalid evidence links or hashes", () => {
  assert.throws(
    () => assertDemoProjectionSafe({ nested: [{ compatibility_score: 91 }] }),
    /restricted keys/iu,
  );
  const badHash = structuredClone(
    buildSyntheticEvidenceGraph("RUN-BAD-HASH", "one"),
  );
  badHash.evidence[0]!.contentSha256 = "0".repeat(64);
  assert.throws(() => validateEvidenceGraph(badHash), /content hash/iu);

  const dangling = structuredClone(
    buildSyntheticEvidenceGraph("RUN-DANGLING", "one"),
  );
  dangling.claims[0]!.evidenceIds = ["EVD-MISSING"];
  assert.throws(() => validateEvidenceGraph(dangling), /dangling evidence/iu);

  const danglingCitation = structuredClone(
    buildSyntheticEvidenceGraph("RUN-DANGLING-CITATION", "one"),
  );
  danglingCitation.candidates[0]!.citations = ["EVD-MISSING"];
  assert.throws(
    () => validateEvidenceGraph(danglingCitation),
    /dangling citation/iu,
  );

  const unrelatedCitation = structuredClone(
    buildSyntheticEvidenceGraph("RUN-UNRELATED-CITATION", "two"),
  );
  unrelatedCitation.candidates[0]!.citations = [
    unrelatedCitation.evidence[1]!.evidenceId,
  ];
  assert.throws(
    () => validateEvidenceGraph(unrelatedCitation),
    /outside its rationale claims/iu,
  );

  for (const field of ["rationaleClaimIds", "citations"] as const) {
    const empty = structuredClone(
      buildSyntheticEvidenceGraph(`RUN-EMPTY-${field}`, "one"),
    );
    empty.candidates[0]![field] = [];
    assert.throws(
      () => validateEvidenceGraph(empty),
      /requires non-empty rationale claims and citations/iu,
    );
  }
  const emptyRationale = structuredClone(
    buildSyntheticEvidenceGraph("RUN-EMPTY-RATIONALE", "one"),
  );
  emptyRationale.candidates[0]!.rationaleShort = "   ";
  assert.throws(
    () => validateEvidenceGraph(emptyRationale),
    /requires non-empty rationale claims and citations/iu,
  );
});

test("stores the complete hidden result independently of Demo projection", () => {
  const graph: EvidenceGraphV1 = buildSyntheticEvidenceGraph(
    "RUN-HIDDEN",
    "many",
  );
  const projection = projectDemoResult(graph);
  assert.equal(graph.candidates.length, 4);
  assert.equal(projection.candidates.length, 3);
  assert.equal(
    graph.candidates.every((candidate) => candidate.citations.length > 0),
    true,
  );
  assert.equal(
    graph.candidates.every(
      (candidate) => candidate.verificationStatus === "synthetic",
    ),
    true,
  );
  assert.equal(
    graph.claims.every((claim) => claim.verificationStatus === "synthetic"),
    true,
  );
  assert.equal(
    JSON.stringify(projection).includes("compatibilityScore"),
    false,
  );
});
