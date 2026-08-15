import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applySlice3DashboardProjection,
  assertSnapshotByteParity,
  slice3EvidenceSourceRef,
  validateSlice3Dashboard,
  validateSlice3Evidence,
  validateSlice3Governance,
} from "../../scripts/lib/slice3-dashboard-policy.mjs";

const evidence = JSON.parse(
  readFileSync("evidence/slice3/local-validation.json", "utf8"),
);
evidence.observedAt = new Date().toISOString();
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
const clone = (value) => structuredClone(value);

test("rejects future observedAt", () => {
  const mutated = clone(evidence);
  mutated.observedAt = "2999-01-01T00:00:00.000Z";
  assert.throws(() => validateSlice3Evidence(mutated), /future/u);
});

test("projects every acceptance and ordered audit with exact evidence", () => {
  const projected = applySlice3DashboardProjection(
    views(),
    evidence,
    sourceRef,
  );
  validateSlice3Dashboard(projected, evidence, sourceRef);
  assert.equal(projected.tests.records.length, 24);
  assert.equal(projected.evidence.records.length, 7);
});

test("rejects stale gate lifecycle", () => {
  const projected = applySlice3DashboardProjection(
    views(),
    evidence,
    sourceRef,
  );
  projected.gates.records.find(({ id }) => id === "S3-G2").status = "ACTIVE";
  assert.throws(
    () => validateSlice3Dashboard(projected, evidence, sourceRef),
    /G2 audit lifecycle/u,
  );
});

test("rejects stale governed G2 and G6 lifecycle", () => {
  const gates = [
    { id: "S3-G2", status: "PENDING", summary: "pending" },
    { id: "S3-G6", status: "PENDING", summary: "pending" },
  ];
  assert.throws(
    () => validateSlice3Governance(gates, evidence),
    /G2 governed lifecycle/u,
  );
});

test("rejects missing Slice 3 acceptance and audit records", () => {
  const projected = applySlice3DashboardProjection(
    views(),
    evidence,
    sourceRef,
  );
  projected.tests.records.pop();
  assert.throws(
    () => validateSlice3Dashboard(projected, evidence, sourceRef),
    /acceptance record/u,
  );
  const second = applySlice3DashboardProjection(views(), evidence, sourceRef);
  second.evidence.records.shift();
  assert.throws(
    () => validateSlice3Dashboard(second, evidence, sourceRef),
    /audit record/u,
  );
});

test("rejects ERROR integrity and public-dist byte divergence", () => {
  const projected = applySlice3DashboardProjection(
    views(),
    evidence,
    sourceRef,
  );
  projected.gates.records[0].facts.evidenceIntegrity = "ERROR";
  assert.throws(
    () => validateSlice3Dashboard(projected, evidence, sourceRef),
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
