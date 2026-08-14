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
