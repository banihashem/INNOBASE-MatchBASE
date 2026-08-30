import assert from "node:assert/strict";
import test from "node:test";
import {
  TASK137_SYNTHETIC_BASE_WEIGHTS,
  TASK137_SYNTHETIC_STRATA,
  generateTask137SyntheticWeightCorpus,
  task137CanonicalJson,
  task137Sha256,
} from "../src/task137/synthetic-weight-corpus.js";
import {
  determineTask137SyntheticQualificationOutcome,
  generateTask137WeightConfigurations,
  runTask137SyntheticWeightQualification,
  type Task137RankReversalMetrics,
} from "../src/task137/synthetic-weight-qualification.js";
import {
  TASK137_PINNED_CONFIGURATION_SET_SHA256,
  TASK137_PINNED_CORPUS_SHA256,
} from "../src/task137/pinned-qualification-manifest.js";

test("generates an immutable deterministic 72-case corpus with six equal strata", () => {
  const first = generateTask137SyntheticWeightCorpus();
  const second = generateTask137SyntheticWeightCorpus();
  assert.equal(first.cases.length, 72);
  assert.equal(first.corpusSha256, second.corpusSha256);
  assert.equal(task137CanonicalJson(first), task137CanonicalJson(second));
  assert.match(first.corpusSha256, /^[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.cases), true);
  assert.equal(new Set(first.cases.map(({ caseId }) => caseId)).size, 72);
  assert.equal(
    new Set(first.cases.map(({ caseSha256 }) => caseSha256)).size,
    72,
  );
  for (const stratum of TASK137_SYNTHETIC_STRATA)
    assert.equal(
      first.cases.filter((item) => item.stratum === stratum).length,
      12,
      stratum,
    );
  for (const corpusCase of first.cases) {
    assert.match(corpusCase.caseSha256, /^[a-f0-9]{64}$/u);
    assert.equal(Object.isFrozen(corpusCase), true);
    assert.equal(Object.isFrozen(corpusCase.candidates), true);
    for (const candidate of corpusCase.candidates) {
      assert.equal(candidate.ratings.length, 6);
      assert.ok(candidate.usedEvidenceIds.length <= 6);
      assert.equal(
        candidate.evidence.filter(
          ({ disposition }) => disposition === "EXCLUDED",
        ).length,
        1,
      );
    }
  }
  assert.equal(first.corpusSha256, TASK137_PINNED_CORPUS_SHA256);
  assert.ok(
    first.cases.every(
      ({ businessFrame, expected }) =>
        Object.keys(businessFrame).length === 3 &&
        Object.values(businessFrame).every((value) => value.trim()) &&
        Object.values(expected.rationaleSourceIdsByCandidate).every(
          (ids) => ids.length > 0,
        ),
    ),
  );
  assert.equal(
    new Set(
      first.cases.flatMap((item) =>
        item.tieBreakExpectation ? [item.tieBreakExpectation.decidingKey] : [],
      ),
    ).size,
    5,
  );
  assert.ok(
    first.cases.some((item) =>
      item.candidates.some((candidate) => candidate.usedEvidenceIds.length < 6),
    ),
  );
  assert.ok(
    first.cases.some((item) =>
      item.candidates.some((candidate) =>
        candidate.evidence.some(
          ({ verification }) => verification === "SUPPLIER_ONLY",
        ),
      ),
    ),
  );
});

test("generates exactly one base and 60 immutable pairwise weight transfers", () => {
  const configurations = generateTask137WeightConfigurations();
  assert.equal(configurations.length, 61);
  assert.deepEqual(configurations[0]!.weights, TASK137_SYNTHETIC_BASE_WEIGHTS);
  assert.equal(configurations[0]!.kind, "BASE");
  assert.equal(
    configurations.filter(({ transferPoints }) => transferPoints === 5).length,
    30,
  );
  assert.equal(
    configurations.filter(({ transferPoints }) => transferPoints === 10).length,
    30,
  );
  assert.equal(
    new Set(configurations.map(({ configurationId }) => configurationId)).size,
    61,
  );
  assert.equal(
    new Set(
      configurations.map(({ configurationSha256 }) => configurationSha256),
    ).size,
    61,
  );
  assert.equal(Object.isFrozen(configurations), true);
  assert.equal(
    task137Sha256(configurations),
    TASK137_PINNED_CONFIGURATION_SET_SHA256,
  );
  for (const item of configurations) {
    assert.equal(item.weights.length, 6);
    assert.equal(
      item.weights.reduce((total, weight) => total + weight, 0),
      100,
    );
    assert.ok(
      item.weights.every((weight) => Number.isInteger(weight) && weight >= 0),
    );
    assert.match(item.configurationSha256, /^[a-f0-9]{64}$/u);
    assert.equal(Object.isFrozen(item), true);
  }
});

test("passes the bounded synthetic qualification deterministically", () => {
  const first = runTask137SyntheticWeightQualification();
  const second = runTask137SyntheticWeightQualification();
  assert.equal(first.terminalResult, "SYNTHETIC_QUALIFICATION_PASSED");
  assert.equal(first.scope, "SYNTHETIC_ONLY");
  assert.equal(first.corpusCaseCount, 72);
  assert.equal(first.weightConfigurationCount, 61);
  assert.equal(first.runSha256, second.runSha256);
  assert.deepEqual(first, second);
  assert.ok(first.invariantChecks.every(({ passed }) => passed));
  assert.ok(
    first.invariantChecks.every(({ failureCount }) => failureCount === 0),
  );
  assert.ok(
    first.invariantChecks.every(({ checkedCount }) => checkedCount > 0),
  );
  assert.ok(first.metrics.applicableComparisonCount > 0);
  assert.ok(first.metrics.pairwiseOrderReversalCount > 0);
  assert.ok(first.metrics.top1ReversalRate <= 0.15);
  assert.ok(first.metrics.top3MembershipStability >= 0.8);
  assert.ok(first.metrics.medianKendallTauB >= 0.8);
  assert.equal(first.metrics.dominanceReversalCount, 0);
  assert.equal(
    first.reversalLedger.length,
    first.metrics.pairwiseOrderReversalCount,
  );
  assert.ok(
    first.reversalLedger.every(
      (entry) =>
        entry.donorDimensionId !== entry.receiverDimensionId &&
        entry.baseMarginToNext !== undefined &&
        entry.alternateMarginToNext !== undefined &&
        !["CORPUS_DEFECT", "IMPLEMENTATION_DEFECT", "UNRESOLVED"].includes(
          entry.disposition,
        ),
    ),
  );
  assert.equal(first.acceptancePackage.complete, true);
  assert.equal(first.acceptancePackage.corpusCaseManifest.length, 72);
  assert.equal(first.acceptancePackage.configurationManifest.length, 61);
  assert.equal(first.acceptancePackage.auditEntries.length, 5);
  assert.equal(
    first.invariantChecks.find(
      ({ invariantId }) => invariantId === "REPEATABILITY",
    )?.checkedCount,
    72 * 61,
  );
  assert.ok(
    (first.invariantChecks.find(
      ({ invariantId }) => invariantId === "TIE_BREAK_DETERMINISM",
    )?.checkedCount ?? 0) >= 5,
  );
  assert.doesNotMatch(JSON.stringify(first), /PRODUCTION_VALIDATED/u);
});

test("fails closed when the pinned configuration acceptance package is incomplete", () => {
  const configurations = generateTask137WeightConfigurations().slice(0, 60);
  const report = runTask137SyntheticWeightQualification(
    generateTask137SyntheticWeightCorpus(),
    configurations,
  );
  assert.equal(report.terminalResult, "SYNTHETIC_QUALIFICATION_FAILED");
  assert.equal(report.acceptancePackage.complete, false);
  assert.equal(
    report.invariantChecks.find(
      ({ invariantId }) => invariantId === "ACCEPTANCE_PACKAGE_COMPLETENESS",
    )?.passed,
    false,
  );
});

test("fails closed when immutable corpus content is altered", () => {
  const corpus = structuredClone(generateTask137SyntheticWeightCorpus());
  const firstCase = corpus.cases[0]!;
  (firstCase as { softCap: number }).softCap += 1;
  const report = runTask137SyntheticWeightQualification(corpus);
  assert.equal(report.terminalResult, "SYNTHETIC_QUALIFICATION_FAILED");
  assert.equal(
    report.invariantChecks.find(
      ({ invariantId }) => invariantId === "CORPUS_INTEGRITY",
    )?.passed,
    false,
  );
});

test("terminal classification is closed to synthetic pass, instability, or failure", () => {
  const stable: Task137RankReversalMetrics = {
    applicableComparisonCount: 1,
    top1ReversalCount: 0,
    top1ReversalRate: 0,
    top3MembershipChangeCount: 0,
    top3MembershipStability: 1,
    pairwiseOrderReversalCount: 0,
    medianKendallTauB: 1,
    dominanceReversalCount: 0,
  };
  assert.equal(
    determineTask137SyntheticQualificationOutcome(0, stable),
    "SYNTHETIC_QUALIFICATION_PASSED",
  );
  assert.equal(
    determineTask137SyntheticQualificationOutcome(0, {
      ...stable,
      top1ReversalCount: 1,
      top1ReversalRate: 0.16,
    }),
    "SYNTHETIC_WEIGHT_UNSTABLE",
  );
  assert.equal(
    determineTask137SyntheticQualificationOutcome(1, stable),
    "SYNTHETIC_QUALIFICATION_FAILED",
  );
  assert.equal(
    determineTask137SyntheticQualificationOutcome(0, stable, false),
    "SYNTHETIC_QUALIFICATION_FAILED",
  );
});
