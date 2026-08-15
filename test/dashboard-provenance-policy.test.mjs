import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  HISTORICAL_LOCAL_RECORD_IDS,
  projectHistoricalLocalRecord,
  validateDashboardHistoricalProvenance,
  validateHistoricalProvenanceIndex,
  validateSlice2HistoricalGitObject,
} from "../scripts/lib/dashboard-provenance-policy.mjs";
import { slice2HistoricalLocalClosure } from "../scripts/lib/slice2-external-closure-policy.mjs";

const sha = (letter) => letter.repeat(64);
const source = (sourceId, path, digest) => ({
  sourceId,
  path,
  sha256: digest,
  observedAt: "2026-08-15T10:14:53.000Z",
});

function artifactIndex() {
  return {
    builds: [
      { id: "BUILD-SLICE-1-LOCAL", status: "SUPERSEDED" },
      { id: "BUILD-SLICE-2-LOCAL", status: "SUPERSEDED" },
    ],
    artifacts: [
      {
        id: "ARTIFACT-SLICE-1-LOCAL-VALIDATION",
        status: "SUPERSEDED",
        path: "evidence/slice1/local-validation.json",
        sha256: sha("A"),
      },
      {
        id: "ARTIFACT-SLICE-2-LOCAL-VALIDATION",
        status: "SUPERSEDED",
        path: "evidence/slice2/local-validation.json",
        sha256: sha("B"),
      },
    ],
    provenance: [
      { id: "PROV-SLICE-0-001", status: "ACTIVE" },
      {
        id: "PROV-SLICE-1-LOCAL",
        status: "SUPERSEDED",
        historicalCandidate: {
          kind: "LOCAL_UNCOMMITTED",
          baseCommit: "1".repeat(40),
          evidencePath: "evidence/slice1/local-validation.json",
          evidenceSha256: sha("A"),
        },
      },
      {
        id: "PROV-SLICE-2-LOCAL",
        status: "SUPERSEDED",
        historicalCandidate: {
          kind: "LOCAL_UNCOMMITTED",
          baseCommit: "2".repeat(40),
          hostedCandidateCommit: "5".repeat(40),
          evidencePath: "evidence/slice2/local-validation.json",
          evidenceGitObject: "7".repeat(40),
          evidenceSha256: sha("E"),
        },
      },
    ],
  };
}

function options() {
  return {
    artifactIndexSourceRef: source(
      "artifact-index",
      "C:\\repo\\governance\\artifact-index.json",
      sha("C"),
    ),
    candidateSourceRefs: {
      "SLICE-1": source(
        "slice1-candidate",
        "evidence/slice1/local-validation.json",
        sha("A"),
      ),
      "SLICE-2": source(
        "slice2-candidate",
        "evidence/slice2/local-validation.json",
        sha("B"),
      ),
    },
    slice1Closure: {
      repository: "banihashem/INNOBASE-MatchBASE",
      commit: "3".repeat(40),
      tree: "4".repeat(40),
      runId: 100,
      jobId: 200,
      conclusion: "success",
      role2Status: "PASS",
      source: { method: "Authenticated Slice 1 closure" },
    },
    slice1ClosureSourceRef: source(
      "slice1-closure",
      "C:\\management\\slice1-closure.md",
      sha("D"),
    ),
    slice2Closure: {
      repository: "banihashem/INNOBASE-MatchBASE",
      commit: "5".repeat(40),
      tree: "6".repeat(40),
      runId: 300,
      jobId: 400,
      conclusion: "success",
      role2: { status: "PENDING" },
      source: { method: "Authenticated Slice 2 closure" },
    },
    slice2ClosureSourceRef: source(
      "slice2-closure",
      "C:\\management\\slice2-closure.md",
      sha("E"),
    ),
  };
}

function views() {
  const index = artifactIndex();
  const opts = options();
  const items = [
    ...index.builds,
    ...index.artifacts,
    ...index.provenance.filter(({ id }) => id.includes("-LOCAL")),
  ];
  const evidence = items.map((item) =>
    projectHistoricalLocalRecord(item, index, opts),
  );
  return {
    index,
    opts,
    value: {
      portfolio: { records: [] },
      gates: { records: [] },
      backlog: { records: [] },
      decisions: { records: [] },
      risks: { records: [] },
      requirements: { records: [] },
      tests: { records: [] },
      defects: { records: [] },
      deployments: { records: [] },
      costs: { records: [] },
      agents: { records: [] },
      loops: { records: [] },
      evidence: { records: evidence },
    },
  };
}

test("projects every local candidate record as exact source-bound history", () => {
  const fixture = views();
  assert.deepEqual(
    fixture.value.evidence.records.map(({ id }) => id),
    HISTORICAL_LOCAL_RECORD_IDS,
  );
  assert.doesNotThrow(() =>
    validateDashboardHistoricalProvenance(
      fixture.value,
      fixture.index,
      fixture.opts,
    ),
  );
  for (const record of fixture.value.evidence.records) {
    assert.equal(record.status, "HISTORICAL");
    assert.equal(record.facts.lifecycleStatus, "SUPERSEDED");
    assert.equal(record.facts.currentGateCounted, false);
    assert.equal(record.facts.currentAcceptanceCounted, false);
    assert.match(record.summary, /was historical evidence and was superseded/u);
    assert.doesNotMatch(record.summary, /remains pending|hosted pending/u);
  }
});

test("rejects stale current lifecycle, substitution, and current-count leakage", () => {
  const mutations = [
    (fixture) => (fixture.value.evidence.records[0].status = "ACTIVE"),
    (fixture) =>
      (fixture.value.evidence.records[0].facts.lifecycleStatus = "IN_PROGRESS"),
    (fixture) =>
      (fixture.value.evidence.records[0].facts.evidenceIntegrity = "ABSENT"),
    (fixture) =>
      (fixture.value.evidence.records[0].facts.currentGateCounted = true),
    (fixture) =>
      (fixture.value.evidence.records[0].facts.currentAcceptanceCounted = true),
    (fixture) =>
      (fixture.value.evidence.records[0].summary =
        "Local uncommitted candidate; hosted closure remains pending."),
    (fixture) => fixture.value.evidence.records.pop(),
    (fixture) =>
      fixture.value.evidence.records.push(
        structuredClone(fixture.value.evidence.records[0]),
      ),
    (fixture) =>
      fixture.value.evidence.records.splice(
        0,
        2,
        fixture.value.evidence.records[1],
        fixture.value.evidence.records[0],
      ),
    (fixture) => (fixture.value.evidence.records[0].id = "FORGED"),
    (fixture) => (fixture.value.evidence.records[0].unknown = true),
    (fixture) => fixture.value.evidence.records[0].sourceRefs.pop(),
    (fixture) =>
      (fixture.value.evidence.records[0].sourceRefs[0].sha256 = sha("F")),
    (fixture) =>
      fixture.value.gates.records.push(fixture.value.evidence.records[0]),
  ];
  for (const [index, mutate] of mutations.entries()) {
    const fixture = views();
    mutate(fixture);
    assert.throws(
      () =>
        validateDashboardHistoricalProvenance(
          fixture.value,
          fixture.index,
          fixture.opts,
        ),
      "mutation " + index + " must fail closed",
    );
  }
});

test("rejects stale index identity and missing superseding closure", () => {
  const mutations = [
    (index) => (index.builds[0].status = "ACTIVE"),
    (index) => (index.artifacts[0].status = "ACTIVE"),
    (index) => (index.provenance[1].status = "IN_PROGRESS"),
    (index) => index.provenance.pop(),
    (index) => index.provenance.push(structuredClone(index.provenance[1])),
    (index) =>
      ([index.provenance[1], index.provenance[2]] = [
        index.provenance[2],
        index.provenance[1],
      ]),
    (index) => (index.provenance[1].unknown = true),
    (index) =>
      (index.provenance[1].historicalCandidate.evidenceSha256 = sha("F")),
  ];
  for (const [position, mutate] of mutations.entries()) {
    const index = artifactIndex();
    mutate(index);
    assert.throws(
      () => validateHistoricalProvenanceIndex(index),
      "index mutation " + position + " must fail closed",
    );
  }

  const fixture = views();
  fixture.opts.slice2Closure = null;
  assert.throws(() =>
    projectHistoricalLocalRecord(
      fixture.index.provenance[2],
      fixture.index,
      fixture.opts,
    ),
  );
});

test("binds Slice 2 history to immutable Git bytes with temporal causality", () => {
  const index = JSON.parse(
    readFileSync("governance/artifact-index.json", "utf8"),
  );
  const closure = JSON.parse(
    readFileSync("governance/slice2-external-closure-anchor-v1.json", "utf8"),
  );
  const historicalClosure = slice2HistoricalLocalClosure(closure);
  assert.doesNotThrow(() =>
    validateSlice2HistoricalGitObject(index, historicalClosure, {
      repoRoot: process.cwd(),
    }),
  );

  const mutations = [
    (candidate) =>
      (candidate.hostedCandidateCommit =
        "0dce5b0c369055d84310c8d8d7545749cf7f8e3c"),
    (candidate) => (candidate.evidenceGitObject = "f".repeat(40)),
    (candidate) =>
      (candidate.evidencePath = "evidence/slice1/local-validation.json"),
    (candidate) => (candidate.evidenceSha256 = "F".repeat(64)),
    (candidate, value) =>
      (candidate.evidenceSha256 = value.artifacts.find(
        ({ id }) => id === "ARTIFACT-SLICE-2-LOCAL-VALIDATION",
      ).sha256),
  ];
  for (const [position, mutate] of mutations.entries()) {
    const value = structuredClone(index);
    const candidate = value.provenance.find(
      ({ id }) => id === "PROV-SLICE-2-LOCAL",
    ).historicalCandidate;
    mutate(candidate, value);
    assert.throws(
      () =>
        validateSlice2HistoricalGitObject(value, historicalClosure, {
          repoRoot: process.cwd(),
        }),
      `Git binding mutation ${position} must fail closed`,
    );
  }

  const earlyClosure = structuredClone(historicalClosure);
  earlyClosure.observedAt = "2026-08-15T08:00:00+04:00";
  assert.throws(
    () =>
      validateSlice2HistoricalGitObject(index, earlyClosure, {
        repoRoot: process.cwd(),
      }),
    /temporal causality/u,
  );
});
