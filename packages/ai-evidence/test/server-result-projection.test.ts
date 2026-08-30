import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_QUALIFIED_LIVE_LIMITATIONS_NOTICE,
  DEMO_SYNTHETIC_LIMITATIONS_NOTICE,
  UnsupportedResultProjectionError,
  projectStoredResult,
  type UnsupportedConsultantResultProjectionRequest,
} from "../src/projection/server-result.js";
import { buildSyntheticEvidenceGraph } from "../src/research/synthetic-fixtures.js";
import {
  buildStandardSyntheticEvidenceGraph,
  buildStandardSyntheticHardConstraints,
} from "../src/research/standard-synthetic-fixtures.js";

test("central facade owns Demo notices, disclosure metadata, and final immutability", () => {
  const graph = buildSyntheticEvidenceGraph("RUN-DEMO-FACADE", "many");
  const synthetic = projectStoredResult({
    tier: "demo",
    completeResult: graph,
    runBoundMandatoryConstraints: [],
    researchMode: "synthetic_reference",
  });
  const qualified = projectStoredResult({
    tier: "demo",
    completeResult: graph,
    runBoundMandatoryConstraints: [],
    researchMode: "qualified_live_research",
  });

  assert.equal(
    synthetic.body.limitations_notice,
    DEMO_SYNTHETIC_LIMITATIONS_NOTICE,
  );
  assert.equal(
    qualified.body.limitations_notice,
    DEMO_QUALIFIED_LIVE_LIMITATIONS_NOTICE,
  );
  assert.deepEqual(synthetic.metadata, {
    tier: "demo",
    projectionVersion: 1,
    fieldsReleased: [
      "run_id",
      "outcome",
      "scarcity",
      "candidates",
      "unmet_mandatory_constraints",
      "limitations_notice",
      "projection_version",
    ],
    itemCount: 3,
  });
  assert.equal(Object.isFrozen(synthetic), true);
  assert.equal(Object.isFrozen(synthetic.body), true);
  assert.equal(Object.isFrozen(synthetic.body.candidates), true);
  assert.equal(Object.isFrozen(synthetic.body.candidates[0]), true);
  assert.throws(() => synthetic.body.candidates.push({} as never), TypeError);
});

test("central Standard projection is deterministic for an explicit DB-clock instant", () => {
  const hardConstraints = buildStandardSyntheticHardConstraints();
  const graph = buildStandardSyntheticEvidenceGraph(
    "RUN-STANDARD-FACADE",
    "one",
    hardConstraints,
  );
  const request = {
    tier: "standard" as const,
    completeResult: graph,
    projectionAsOf: "2026-08-15T00:00:00.000Z",
    runBoundCanonicalHardConstraints: hardConstraints,
  };

  const first = projectStoredResult(request);
  const second = projectStoredResult(structuredClone(request));
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.metadata.projectionAsOf, request.projectionAsOf);
  assert.equal(first.metadata.projectionVersion, first.body.projection_version);
  assert.equal(first.metadata.itemCount, first.body.candidates.length);
  assert.equal(first.metadata.fieldsReleased.includes("candidates"), true);
  assert.equal(
    first.metadata.fieldsReleased.includes(
      "candidates[].dimension_scores[].score",
    ),
    true,
  );
  assert.equal(Object.isFrozen(first.body.candidates[0]?.citations), true);
  assert.throws(
    () =>
      projectStoredResult({
        ...request,
        projectionAsOf: "2026-08-15T00:00:00Z",
      }),
    /exact UTC ISO 8601 instant/iu,
  );
});

test("Consultant fails closed before the facade inspects a result payload", () => {
  let payloadReads = 0;
  const request = new Proxy(
    { tier: "consultant" as const },
    {
      get(target, property, receiver) {
        if (property === "completeResult") {
          payloadReads += 1;
          throw new Error("payload was inspected");
        }
        return Reflect.get(target, property, receiver);
      },
    },
  ) as UnsupportedConsultantResultProjectionRequest;

  assert.throws(
    () => projectStoredResult(request),
    UnsupportedResultProjectionError,
  );
  assert.equal(payloadReads, 0);
});
