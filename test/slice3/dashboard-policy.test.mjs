import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applySlice3DashboardProjection,
  assertSnapshotByteParity,
  slice3EvidenceSourceRef,
  validateSlice3Dashboard,
  validateSlice3Evidence,
  validateSlice3Governance,
  verifySlice3CredentialPreflightSource,
} from "../../scripts/lib/slice3-dashboard-policy.mjs";

const baseEvidence = JSON.parse(
  readFileSync("evidence/slice3/local-validation.json", "utf8"),
);
const clone = (value) => structuredClone(value);
const pendingAudit = (id) => ({
  id,
  status: "PENDING",
  critical: 0,
  major: 0,
  minor: 0,
});
const passAudit = (id) => ({
  id,
  status: "PASS",
  critical: 0,
  major: 0,
  minor: 0,
});

function currentEvidence() {
  const value = clone(baseEvidence);
  value.localGate.status = "PASS";
  value.localGate.fullWrapper.result = "PASS";
  value.localGate.fullWrapper.durationMs = 1;
  const wrapperAt = Date.parse(value.localGate.fullWrapper.observedAt);
  const historicalAt = new Date(wrapperAt + 1_000).toISOString();
  const postReviewAt = new Date(wrapperAt + 2_000).toISOString();
  value.observedAt = new Date(wrapperAt + 3_000).toISOString();
  value.lifecyclePhase = "POST_REVIEW_CURRENT";
  value.candidateStatus =
    "REPOSITORY_IMPLEMENTATION_POST_REVIEW_CURRENT_LIVE_BLOCKED";
  value.independentAudits = value.independentAudits.map(({ id }) =>
    passAudit(id),
  );
  value.acceptance.find((item) => item.id === "S3-AC-022").status =
    "REPOSITORY_PASS";
  value.historicalLifecycle = {
    schemaVersion: "matchbase.slice3-during-review-history/v1",
    phase: "DURING_REVIEW_PENDING",
    observedAt: historicalAt,
    current: false,
    supersededBy: "postReview",
    audits: value.independentAudits.map(({ id }) => pendingAudit(id)),
    gates: [
      { id: "S3-G2", status: "PENDING" },
      { id: "S3-G6", status: "PENDING" },
    ],
    acceptance: [{ id: "S3-AC-022", status: "PENDING" }],
  };
  const { manifestSha256, aggregateSha256, fileCount } = value.candidate;
  value.postReview = {
    schemaVersion: "matchbase.slice3-post-review/v1",
    observedAt: postReviewAt,
    candidate: { manifestSha256, aggregateSha256, fileCount },
    wrapperSource: clone(value.localGate.fullWrapper.sourceRef),
    disciplines: value.independentAudits.slice(0, 6),
    integrationCritic: {
      status: "PASS",
      critical: 0,
      major: 0,
      minor: 0,
    },
    repositoryDisposition: "READY_FOR_REPOSITORY_RELEASE",
    slice3Overall: "BLOCKED_PREREQUISITE",
    role2Status: "FAIL",
    acceptanceClaimed: false,
    providerCalls: 0,
    externalMutations: 0,
  };
  return value;
}

const evidence = currentEvidence();
const bytes = Buffer.from(JSON.stringify(evidence));
const sourceRef = slice3EvidenceSourceRef(
  "C:\\INNOBASE\\MatchBASE\\03_Implementation\\INNOBASE-MatchBASE\\evidence\\slice3\\local-validation.json",
  bytes,
  evidence,
);
const views = () => ({
  gates: {
    records: Array.from({ length: 8 }, (_, index) => ({
      id: `S3-G${index}`,
      title: `G${index}`,
      summary: "stale",
      status: "ERROR",
      facts: { evidenceIntegrity: "ERROR" },
      sourceRefs: [],
    })),
  },
  tests: { records: [] },
  evidence: { records: [] },
});

test("accepts closed post-review current lifecycle and historical pending phase", () => {
  assert.doesNotThrow(() => validateSlice3Evidence(evidence));
  assert.equal(
    evidence.acceptance.filter(({ status }) => status === "REPOSITORY_PASS")
      .length,
    20,
  );
  assert.equal(evidence.historicalLifecycle.current, false);
});

test("rejects future, stale, omitted, duplicated and unknown post-review data", () => {
  for (const mutate of [
    (value) => delete value.postReview,
    (value) => (value.postReview.unknown = true),
    (value) => (value.postReview.observedAt = "2999-01-01T00:00:00.000Z"),
    (value) => value.postReview.disciplines.pop(),
    (value) =>
      value.postReview.disciplines.push(value.postReview.disciplines[0]),
  ]) {
    const mutated = clone(evidence);
    mutate(mutated);
    assert.throws(() => validateSlice3Evidence(mutated));
  }
});

test("rejects wrong candidate, wrapper, nonzero defect and audit substitutions", () => {
  for (const mutate of [
    (value) => (value.postReview.candidate.fileCount += 1),
    (value) => (value.postReview.wrapperSource.sha256 = "F".repeat(64)),
    (value) => (value.postReview.disciplines[0].major = 1),
    (value) => value.postReview.disciplines.reverse(),
    (value) => (value.postReview.disciplines[0].id = "substituted"),
    (value) => (value.postReview.integrationCritic.status = "PENDING"),
    (value) => (value.independentAudits[0].status = "PENDING"),
  ]) {
    const mutated = clone(evidence);
    mutate(mutated);
    assert.throws(() => validateSlice3Evidence(mutated));
  }
});

test("rejects missing, current, reordered or substituted historical phase", () => {
  for (const mutate of [
    (value) => delete value.historicalLifecycle,
    (value) => (value.historicalLifecycle.current = true),
    (value) => value.historicalLifecycle.audits.reverse(),
    (value) => (value.historicalLifecycle.audits[0].status = "PASS"),
    (value) => (value.historicalLifecycle.gates[0].id = "S3-G6"),
    (value) => (value.historicalLifecycle.unknown = true),
  ]) {
    const mutated = clone(evidence);
    mutate(mutated);
    assert.throws(() => validateSlice3Evidence(mutated));
  }
});

test("rejects premature Role 2 or Slice 3 acceptance and blocker mutation", () => {
  for (const mutate of [
    (value) => (value.role2.status = "PASS"),
    (value) => (value.role2.acceptanceClaimed = true),
    (value) => (value.liveQualification = "PASS"),
    (value) => (value.candidateStatus = "SLICE3_PASS_PRODUCTION_READY"),
    (value) => value.blockerCodes.pop(),
    (value) => value.blockerCodes.push("STALE_BLOCKER"),
    (value) =>
      (value.blockerCodes = [
        "ROUTE_POLICY_NOT_ENABLED",
        "TWO_QUALIFIED_ROUTES_NOT_PRESENT",
        "APPROVED_DIRECT_CREDENTIAL_ABSENT",
        "APPROVED_OPENROUTER_CREDENTIAL_ABSENT",
        "EXPLICIT_BILLABLE_QUALIFICATION_AUTHORIZATION_ABSENT",
        "QUALIFICATION_BUDGET_INVALID",
      ]),
    (value) => (value.acceptance[2].status = "REPOSITORY_PASS"),
  ]) {
    const mutated = clone(evidence);
    mutate(mutated);
    assert.throws(() => validateSlice3Evidence(mutated));
  }
});

test("rejects stale credential source binding and wrapper lifecycle contradiction", () => {
  for (const mutate of [
    (value) => (value.qualificationPreflight.disposition = "READY_TO_QUALIFY"),
    (value) => (value.qualificationPreflight.sourceBinding.httpStatus = 200),
    (value) =>
      (value.qualificationPreflight.sourceBinding.sha256 = "F".repeat(64)),
    (value) =>
      (value.qualificationPreflight.sourceBinding.verificationMode =
        "UNVERIFIED"),
    (value) => (value.qualificationPreflight.additionalAuthorizationGets = 1),
    (value) => (value.qualificationPreflight.v4SessionCreated = true),
    (value) =>
      (value.localGate.status =
        value.localGate.fullWrapper.result === "PASS" ? "PENDING" : "PASS"),
  ]) {
    const mutated = clone(evidence);
    mutate(mutated);
    assert.throws(() => validateSlice3Evidence(mutated));
  }
});

test("verifies exact local credential-preflight bytes and rejects source drift", () => {
  const root = mkdtempSync(join(tmpdir(), "matchbase-s3-preflight-"));
  try {
    const source = join(root, "preflight.json");
    const original = Buffer.from('{"disposition":"BLOCKED_CREDENTIAL"}\n');
    writeFileSync(source, original);
    const binding = {
      path: baseEvidence.qualificationPreflight.sourceBinding.path,
      verificationMode: "EXACT_LOCAL_SHA256_OR_ANCHOR_ONLY_CI",
      sha256: createHash("sha256").update(original).digest("hex").toUpperCase(),
      httpStatus: 401,
      sanitizedEnvelopeDigest: "A".repeat(64),
    };
    const options = {
      sourceResolver: () => source,
      sourceRoot: root,
    };
    assert.doesNotThrow(() =>
      verifySlice3CredentialPreflightSource(binding, options),
    );
    writeFileSync(source, Buffer.from('{"disposition":"SUBSTITUTED"}\n'));
    assert.throws(() =>
      verifySlice3CredentialPreflightSource(binding, options),
    );
    assert.throws(() =>
      verifySlice3CredentialPreflightSource(
        { ...binding, sha256: "F".repeat(64) },
        options,
      ),
    );
    assert.throws(() =>
      verifySlice3CredentialPreflightSource(binding, {
        anchorOnly: true,
        ci: false,
      }),
    );
    assert.doesNotThrow(() =>
      verifySlice3CredentialPreflightSource(binding, {
        anchorOnly: true,
        ci: true,
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("projects every current acceptance and ordered PASS audit with exact evidence", () => {
  const preRelease = applySlice3DashboardProjection(
    views(),
    evidence,
    sourceRef,
  );
  assert.equal(
    preRelease.tests.records.find(({ id }) => id === "S3-AC-023").facts
      .acceptanceStatus,
    "PENDING",
  );
  const projected = applySlice3DashboardProjection(
    views(),
    evidence,
    sourceRef,
    { repositoryReleaseClosed: true },
  );
  validateSlice3Dashboard(projected, evidence, sourceRef, {
    repositoryReleaseClosed: true,
  });
  assert.equal(projected.tests.records.length, 24);
  assert.equal(projected.evidence.records.length, 8);
  assert.equal(
    projected.tests.records.find(({ id }) => id === "S3-AC-022").facts
      .acceptanceStatus,
    "REPOSITORY_PASS",
  );
  assert.equal(
    evidence.acceptance.find(({ id }) => id === "S3-AC-023").status,
    "PENDING",
  );
  assert.equal(
    projected.gates.records.find(({ id }) => id === "S3-G6").status,
    "PASS",
  );
});

test("rejects stale current gates and current PENDING audit records", () => {
  const projected = applySlice3DashboardProjection(
    views(),
    evidence,
    sourceRef,
    { repositoryReleaseClosed: true },
  );
  projected.gates.records.find(({ id }) => id === "S3-G6").status = "ACTIVE";
  assert.throws(
    () =>
      validateSlice3Dashboard(projected, evidence, sourceRef, {
        repositoryReleaseClosed: true,
      }),
    /G6 critic lifecycle/u,
  );
  const second = applySlice3DashboardProjection(views(), evidence, sourceRef, {
    repositoryReleaseClosed: true,
  });
  second.evidence.records[0].facts.auditStatus = "PENDING";
  assert.throws(
    () =>
      validateSlice3Dashboard(second, evidence, sourceRef, {
        repositoryReleaseClosed: true,
      }),
    /audit record/u,
  );
  const historical = applySlice3DashboardProjection(
    views(),
    evidence,
    sourceRef,
    { repositoryReleaseClosed: true },
  );
  historical.evidence.records.find(
    ({ id }) => id === "S3-HISTORICAL-DURING-REVIEW",
  ).facts.current = true;
  assert.throws(
    () =>
      validateSlice3Dashboard(historical, evidence, sourceRef, {
        repositoryReleaseClosed: true,
      }),
    /historical during-review/u,
  );
});

test("keeps base/pre-release mode distinct from current hosted handoff", () => {
  const duringReview = clone(evidence);
  duringReview.observedAt = new Date().toISOString();
  duringReview.lifecyclePhase = "DURING_REVIEW";
  duringReview.candidateStatus =
    "LOCAL_REPOSITORY_IMPLEMENTATION_FROZEN_LIVE_BLOCKED";
  duringReview.independentAudits = duringReview.independentAudits.map(
    ({ id }) => pendingAudit(id),
  );
  duringReview.acceptance.find(({ id }) => id === "S3-AC-022").status =
    "PENDING";
  delete duringReview.historicalLifecycle;
  delete duringReview.postReview;
  assert.doesNotThrow(() => validateSlice3Evidence(duringReview));
  assert.throws(
    () =>
      applySlice3DashboardProjection(views(), duringReview, sourceRef, {
        repositoryReleaseClosed: true,
      }),
    /requires post-review current evidence/u,
  );
});

test("accepts explicit base governance only and rejects stale substitutions", () => {
  const gates = [
    {
      id: "S3-G2",
      status: "PENDING",
      summary: "Base/pre-release lifecycle.",
    },
    {
      id: "S3-G6",
      status: "PENDING",
      summary: "Base/pre-release lifecycle.",
    },
  ];
  assert.doesNotThrow(() => validateSlice3Governance(gates, evidence));
  gates[0].summary = "stale pending";
  assert.throws(
    () => validateSlice3Governance(gates, evidence),
    /base governance/u,
  );
});

test("rejects missing records, ERROR integrity and public-dist divergence", () => {
  const projected = applySlice3DashboardProjection(
    views(),
    evidence,
    sourceRef,
    { repositoryReleaseClosed: true },
  );
  projected.tests.records.pop();
  assert.throws(
    () =>
      validateSlice3Dashboard(projected, evidence, sourceRef, {
        repositoryReleaseClosed: true,
      }),
    /acceptance record/u,
  );
  const second = applySlice3DashboardProjection(views(), evidence, sourceRef, {
    repositoryReleaseClosed: true,
  });
  second.evidence.records.shift();
  assert.throws(
    () =>
      validateSlice3Dashboard(second, evidence, sourceRef, {
        repositoryReleaseClosed: true,
      }),
    /audit record/u,
  );
  const third = applySlice3DashboardProjection(views(), evidence, sourceRef, {
    repositoryReleaseClosed: true,
  });
  third.gates.records[0].facts.evidenceIntegrity = "ERROR";
  assert.throws(
    () =>
      validateSlice3Dashboard(third, evidence, sourceRef, {
        repositoryReleaseClosed: true,
      }),
    /exact verified evidence/u,
  );
  assert.throws(
    () => assertSnapshotByteParity(Buffer.from("a"), Buffer.from("b")),
    /diverge/u,
  );
  assert.doesNotThrow(() =>
    assertSnapshotByteParity(Buffer.from("a"), Buffer.from("a")),
  );
});
