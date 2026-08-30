import assert from "node:assert/strict";
import test from "node:test";
import {
  CONSULTANT_RESULT_PROJECTION_V2_SCHEMA_VERSION,
  TASK139_SYNTHETIC_FUTURE_FIELD,
} from "@matchbase/contracts";
import {
  TASK139_SYNTHETIC_FUTURE_FIELD_VALUE,
  assertTask139FutureFieldDenied,
  buildTask139ProjectionChangeReviewEvidence,
  buildTask139RawTierProjectionProbe,
  findExactFieldPaths,
} from "../src/projection/task139-change-review.js";

test("TASK139 raw Demo, Standard, and Consultant outputs deny a new stored field", () => {
  const probe = buildTask139RawTierProjectionProbe();

  assert.deepEqual(probe.storedInputProbe, {
    fieldName: TASK139_SYNTHETIC_FUTURE_FIELD,
    fieldValue: TASK139_SYNTHETIC_FUTURE_FIELD_VALUE,
    presentBeforeProjection: true,
  });
  assert.equal(probe.outputs.demo.schema_version, "demo-projection.v1");
  assert.equal(
    probe.outputs.standard.schema_version,
    "standard-result-projection.v1",
  );
  assert.equal(
    probe.outputs.consultant.schema_version,
    CONSULTANT_RESULT_PROJECTION_V2_SCHEMA_VERSION,
  );

  for (const output of Object.values(probe.outputs)) {
    assert.deepEqual(
      findExactFieldPaths(output, TASK139_SYNTHETIC_FUTURE_FIELD),
      [],
    );
    assert.equal(
      JSON.stringify(output).includes(TASK139_SYNTHETIC_FUTURE_FIELD),
      false,
    );
  }
});

test("TASK139 review evidence is deterministic and binds the closed registry", () => {
  const first = buildTask139ProjectionChangeReviewEvidence();
  const second = buildTask139ProjectionChangeReviewEvidence();

  assert.deepEqual(first, second);
  assert.equal(first.review.changeId, "TASK-139");
  assert.equal(
    first.review.decisionReference,
    "PO-001-TASK137-RESULT-CONTRACT-2026-08-25",
  );
  assert.equal(first.registry.entries.length, 9);
  assert.deepEqual(
    first.tierDenialEvidence.map(({ tier }) => tier),
    ["demo", "standard", "consultant"],
  );
  assert.equal(
    first.tierDenialEvidence.every(
      ({ deniedByDefault, futureFieldPaths, rawOutputSha256 }) =>
        deniedByDefault &&
        futureFieldPaths.length === 0 &&
        /^[a-f0-9]{64}$/u.test(rawOutputSha256),
    ),
    true,
  );
});

test("TASK139 denial assertion fails on an exact future-field leak", () => {
  assert.throws(
    () =>
      assertTask139FutureFieldDenied(
        {
          schema_version: "demo-projection.v1",
          nested: {
            [TASK139_SYNTHETIC_FUTURE_FIELD]:
              TASK139_SYNTHETIC_FUTURE_FIELD_VALUE,
          },
        },
        "demo",
      ),
    /future field leaked into demo/u,
  );
});
