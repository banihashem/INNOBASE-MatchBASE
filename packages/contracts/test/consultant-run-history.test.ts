import assert from "node:assert/strict";
import test from "node:test";
import { parseConsultantRunHistoryV1 } from "../src/index.js";

const history = {
  schema_version: "consultant-run-history.v1",
  items: [
    {
      run_id: "00000000-0000-4000-8000-000000000137",
      request_id: "00000000-0000-4000-8000-000000000138",
      state: "completed",
      updated_at: "2026-08-25T00:00:00.000Z",
      result_available: true,
      outcome: "matched",
    },
  ],
};

test("parses and freezes the closed Consultant run-history contract", () => {
  const parsed = parseConsultantRunHistoryV1(history);
  assert.equal(parsed.items.length, 1);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.items[0]), true);
});

test("rejects widened or inconsistent Consultant run-history output", () => {
  assert.throws(
    () =>
      parseConsultantRunHistoryV1({
        ...history,
        hidden_projection_depth: "consultant",
      }),
    /not closed/iu,
  );
  assert.throws(
    () =>
      parseConsultantRunHistoryV1({
        ...history,
        items: [
          {
            ...history.items[0],
            state: "running",
            result_available: true,
          },
        ],
      }),
    /inconsistent/iu,
  );
});
