import assert from "node:assert/strict";
import test from "node:test";
import { buildSemanticViews } from "../scripts/lib/semantic-dashboard.mjs";

const sourceRef = {
  sourceId: "matchbase://fixture/register.json",
  path: "C:\\INNOBASE\\MatchBASE\\fixture\\register.json",
  sha256: "A".repeat(64),
  observedAt: "2026-08-14T00:00:00.000Z",
};
const exactEvidenceRef = {
  sourceId: "matchbase://implementation-governance/evidence.json",
  path: "C:\\INNOBASE\\MatchBASE\\03_Implementation\\INNOBASE-MatchBASE\\governance\\evidence.json",
  sha256: "B".repeat(64),
  observedAt: "2026-08-14T00:00:00.000Z",
};
const managementRef = {
  sourceId:
    "matchbase://product-management/IMPLEMENTATION_WORKSPACE_REGISTER.md",
  path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\IMPLEMENTATION_WORKSPACE_REGISTER.md",
  sha256: "C".repeat(64),
  observedAt: "2026-08-14T00:00:00.000Z",
};

function document(value) {
  return { value, sourceRef };
}

function fixtureDocuments() {
  return {
    slices: document({ slices: [{ id: "SLICE-0", status: "IN_PROGRESS" }] }),
    gates: document({
      gates: [
        {
          id: "AG0",
          status: "PASS",
          evidence: ["governance/evidence.json"],
        },
        { id: "AG1", status: "BLOCKED" },
      ],
    }),
    backlog: document({ items: [{ id: "S0-001", status: "IN_PROGRESS" }] }),
    registers: document({
      risks: [{ id: "RISK-OPEN", status: "OPEN", summary: "Tracked risk" }],
      requirements: [],
      tests: [],
      defects: [],
      deployments: [],
      costs: [],
      loops: [],
      evidence: [],
    }),
    agents: document({
      agents: [
        {
          id: "AGENT-CRITIC",
          role: "Independent critic",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          executionStatus: "IN_PROGRESS",
          allowedTargets: ["test/**"],
          deliverables: [
            { target: "audit", status: "IN_PROGRESS", outputHashes: [] },
          ],
          testEvidence: [
            {
              id: "AUDIT",
              status: "PENDING",
              commandOrMethod: "independent reproduction",
              evidenceRefs: [],
            },
          ],
          dependencies: [],
          independentAudit: {
            auditorRole: "Role 2",
            disposition: "PENDING",
            evidenceRefs: [],
          },
          scope: "integration audit",
        },
      ],
    }),
    artifactIndex: document({
      builds: [],
      artifacts: [],
      sboms: [],
      provenance: [],
      deployments: [],
    }),
    externalState: document({
      github: {
        repository: "owner/repository",
        visibility: "private",
        refs: 0,
        status: "BOOTSTRAP_IN_PROGRESS",
        evidenceRefs: [
          {
            path: managementRef.path,
            sha256: managementRef.sha256,
            method: "read-only observation",
            result: "OBSERVED",
          },
        ],
      },
      gcp: {
        project: "project",
        lifecycle: "ACTIVE",
        readiness: "BLOCKED",
        mutation: "NONE",
        evidenceRefs: [],
      },
      cloudflare: {
        zone: "example.invalid",
        matchbaseDnsRecords: 0,
        readiness: "BLOCKED",
        mutation: "NONE",
        evidenceRefs: [],
      },
      deployment: { status: "NOT_STARTED" },
    }),
    dispositions: document({
      semantics: { CLOSED_BY_OWNER: "Closed", REMAINS_OPEN: "Open" },
      CLOSED_BY_OWNER: ["OD-001"],
      SUPERSEDED: [],
      PARTIALLY_CLOSED: [],
      DELEGATED_TECHNICAL: [],
      REMAINS_OPEN: ["OD-002"],
    }),
    artifactRecords: [
      {
        id: "ART-001",
        title: "evidence.json",
        summary: "Indexed artifact",
        status: "ACTIVE",
        sourceRefs: [exactEvidenceRef],
      },
      {
        id: "ART-MANAGEMENT",
        title: "IMPLEMENTATION_WORKSPACE_REGISTER.md",
        summary: "Indexed external management evidence",
        status: "ACTIVE",
        sourceRefs: [managementRef],
      },
    ],
    artifactRecordsByView: {
      requirements: [
        {
          id: "ART-REQ",
          title: "requirements.md",
          summary: "Indexed requirement artifact",
          status: "ACTIVE",
          sourceRefs: [sourceRef],
        },
      ],
      tests: [],
      defects: [],
      deployments: [],
    },
  };
}

test("projects governed domain items and roster execution metadata", () => {
  const views = buildSemanticViews(fixtureDocuments());
  assert.deepEqual(
    views.gates.records.map(({ id }) => id),
    ["AG0", "AG1"],
  );
  assert.equal(views.requirements.records.length, 1);
  assert.equal(views.evidence.records.at(-1).id, "ART-MANAGEMENT");
  assert.equal(views.defects.status, "UNKNOWN");
  assert.equal(views.deployments.records.length, 4);
  assert.equal(views.gates.status, "BLOCKED");
  assert.deepEqual(
    views.backlog.records.map(({ id }) => id),
    ["S0-001"],
  );
  assert.deepEqual(
    views.decisions.records.map(({ id }) => id),
    ["OD-001", "OD-002"],
  );
  assert.equal(views.decisions.records[0].status, "ACTIVE");
  assert.equal(views.agents.records[0].facts.model, "gpt-5.6-sol");
  assert.equal(views.agents.records[0].facts.reasoningEffort, "high");
  assert.equal(views.agents.records[0].facts.auditDisposition, "PENDING");
  assert.equal(views.agents.records[0].facts.allowedTargets, 1);
});

test("does not turn a human-authored PASS string into verified PASS", () => {
  const documents = fixtureDocuments();
  documents.gates.value.gates = [{ id: "AG-HUMAN", status: "PASS" }];
  const record = buildSemanticViews(documents).gates.records[0];
  assert.equal(record.status, "ACTIVE");
  assert.equal(record.facts.evidenceIntegrity, "ABSENT");
});

test("turns an unmatched or forged evidence hash into ERROR", () => {
  const documents = fixtureDocuments();
  documents.gates.value.gates = [
    {
      id: "AG-FORGED",
      status: "PASS",
      evidenceRefs: [{ path: exactEvidenceRef.path, sha256: "0".repeat(64) }],
    },
  ];
  const record = buildSemanticViews(documents).gates.records[0];
  assert.equal(record.status, "ERROR");
  assert.equal(record.facts.evidenceIntegrity, "ERROR");
});

test("does not ignore an unresolved string beside valid evidence", () => {
  const documents = fixtureDocuments();
  documents.gates.value.gates[0].evidence = [
    "governance/gates.json",
    "unresolved-or-forged-evidence.txt",
  ];
  const views = buildSemanticViews(documents);
  assert.equal(views.gates.records[0].status, "ERROR");
  assert.equal(views.gates.records[0].facts.evidenceIntegrity, "ERROR");
});

test("allows PASS only when claimed evidence matches an indexed exact hash", () => {
  const views = buildSemanticViews(fixtureDocuments());
  const record = views.gates.records.find(({ id }) => id === "AG0");
  assert.equal(record.status, "PASS");
  assert.equal(record.facts.evidenceIntegrity, "VERIFIED");
  assert.ok(
    record.sourceRefs.some(
      (reference) =>
        reference.path === exactEvidenceRef.path &&
        reference.sha256 === exactEvidenceRef.sha256,
    ),
  );
});

test("preserves validated external management evidence as an exact source ref", () => {
  const record = buildSemanticViews(
    fixtureDocuments(),
  ).deployments.records.find(({ id }) => id === "EXT-GITHUB");
  assert.ok(
    record.sourceRefs.some(
      (reference) =>
        reference.path === managementRef.path &&
        reference.sha256 === managementRef.sha256 &&
        reference.observedAt === managementRef.observedAt,
    ),
  );
});

test("maps an open risk to ACTIVE rather than UNKNOWN", () => {
  const record = buildSemanticViews(fixtureDocuments()).risks.records[0];
  assert.equal(record.status, "ACTIVE");
});

test("maps explicit non-deployment states to ACTIVE rather than UNKNOWN", () => {
  const documents = fixtureDocuments();
  documents.registers.value.deployments = [
    {
      id: "DEPLOY-LOCAL",
      status: "NOT_APPLICABLE",
      summary: "Local-only slice.",
    },
  ];
  const records = buildSemanticViews(documents).deployments.records;
  const external = records.find(({ id }) => id === "EXT-DEPLOYMENT");
  assert.equal(external.status, "ACTIVE");
  assert.equal(external.facts.lifecycleStatus, "NOT_STARTED");

  const local = records.find(({ id }) => id === "DEPLOY-LOCAL");
  assert.equal(local.status, "ACTIVE");
  assert.equal(local.facts.lifecycleStatus, "NOT_APPLICABLE");
});

test("projects hosted closure without converting pending Role 2 into PASS", () => {
  const documents = fixtureDocuments();
  const auditRef = {
    ...managementRef,
    sourceId: "matchbase://product-management/role2-audit",
    path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE2_AUDIT.md",
    sha256: "D".repeat(64),
  };
  documents.trustedEvidenceRefs = [exactEvidenceRef, managementRef, auditRef];
  documents.gates.value.gates.push({
    id: "AG6",
    status: "ACTIVE",
    summary: "stale candidate state",
  });
  documents.registers.value.tests.push({
    id: "S1-AC-022",
    status: "PENDING",
  });
  documents.externalClosure = {
    sourceRef: managementRef,
    value: {
      repository: "banihashem/INNOBASE-MatchBASE",
      commit: "a".repeat(40),
      tree: "b".repeat(40),
      runId: 123,
      jobId: 456,
      conclusion: "success",
      closureStatus: "HOSTED_VERIFIED",
      role2Status: "PENDING_ROLE2",
      predecessorFailures: [{ runId: 100, jobId: 200 }],
      role2: {
        status: "FAIL",
        disposition: "PENDING_ROLE2_CORRECTION_REAUDIT",
        auditPath: auditRef.path,
        auditSha256: auditRef.sha256,
        critical: 0,
        major: 3,
        minor: 0,
        defects: [
          {
            id: "S1-L1-D001",
            severity: "major",
            status: "OPEN",
            title: "D001",
          },
          {
            id: "S1-L1-D002",
            severity: "major",
            status: "OPEN",
            title: "D002",
          },
          {
            id: "S1-L1-D003",
            severity: "major",
            status: "OPEN",
            title: "D003",
          },
        ],
      },
    },
  };
  const views = buildSemanticViews(documents);
  const gate = views.gates.records.find(({ id }) => id === "AG6");
  const acceptance = views.tests.records.find(({ id }) => id === "S1-AC-022");
  const closure = views.deployments.records.find(
    ({ id }) => id === "EXT-GITHUB-CLOSURE",
  );
  assert.equal(gate.status, "ACTIVE");
  assert.equal(gate.facts.closureStatus, "HOSTED_VERIFIED");
  assert.equal(gate.facts.role2Status, "PENDING_ROLE2");
  assert.equal(acceptance.status, "ACTIVE");
  assert.equal(acceptance.facts.runId, 123);
  assert.equal(closure.facts.jobId, 456);
  assert.equal(
    views.defects.records.filter(({ id }) => id.startsWith("S1-L1-D")).length,
    3,
  );
  assert.equal(
    views.loops.records.find(({ id }) => id === "PO-001-R2-S1-L1").status,
    "BLOCKED",
  );
});
