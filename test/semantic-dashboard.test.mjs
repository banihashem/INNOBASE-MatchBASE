import assert from "node:assert/strict";
import test from "node:test";
import { buildSemanticViews } from "../scripts/lib/semantic-dashboard.mjs";

const sourceRef = {
  sourceId: "matchbase://fixture/register.json",
  path: "C:\\INNOBASE\\MatchBASE\\fixture\\register.json",
  sha256: "A".repeat(64),
  observedAt: "2026-08-14T00:00:00.000Z",
};

function document(value) {
  return { value, sourceRef };
}

test("projects governed domain items rather than artifact filenames", () => {
  const views = buildSemanticViews({
    slices: document({ slices: [{ id: "SLICE-0", status: "IN_PROGRESS" }] }),
    gates: document({
      gates: [
        { id: "AG0", status: "PASS" },
        { id: "AG1", status: "BLOCKED" },
      ],
    }),
    backlog: document({ items: [{ id: "S0-001", status: "IN_PROGRESS" }] }),
    registers: document({
      risks: [],
      requirements: [],
      tests: [],
      defects: [],
      deployments: [],
      costs: [],
      loops: [],
      evidence: [],
    }),
    agents: document({
      agents: [{ role: "Independent critic", status: "ACTIVE" }],
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
      },
      gcp: {
        project: "project",
        lifecycle: "ACTIVE",
        readiness: "BLOCKED",
        mutation: "NONE",
      },
      cloudflare: {
        zone: "example.invalid",
        matchbaseDnsRecords: 0,
        readiness: "BLOCKED",
        mutation: "NONE",
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
        sourceRefs: [sourceRef],
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
  });
  assert.deepEqual(
    views.gates.records.map(({ id }) => id),
    ["AG0", "AG1"],
  );
  assert.equal(views.requirements.records.length, 1);
  assert.equal(views.evidence.records.at(-1).id, "ART-001");
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
  assert.equal(views.decisions.records[0].sourceRefs[0].sha256.length, 64);
});
