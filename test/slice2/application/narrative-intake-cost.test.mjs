import assert from "node:assert/strict";
import test from "node:test";
import { narrativeIntakeView } from "../../../packages/application/dist/consultant-narrative-intake.js";
import { summarizeResearchCosts } from "../../../packages/application/dist/consultant-research-cost.js";
test("MB-UX-LOGISTICS-001 L01 draft and submitted cost views share partial BYOK accounting", () => {
  for (const detail of [
    {
      request_id: "upstream-only",
      model: "openai/test",
      dispatched: true,
      state: "completed",
      is_byok: true,
      upstream_inference_cost: 0.2,
      cost_reported: false,
    },
    {
      request_id: "platform-only",
      model: "openai/test",
      dispatched: true,
      state: "completed",
      is_byok: true,
      cost_usd: 0.1,
      cost_reported: true,
    },
    {
      request_id: "unknown",
      model: "openai/test",
      dispatched: true,
      state: "failed",
      cost_reported: false,
    },
    {
      request_id: "not-dispatched",
      model: "openai/test",
      dispatched: false,
      state: "failed",
      cost_reported: false,
    },
  ]) {
    const operation = {
      operation_id: "op",
      receipts: { [detail.request_id]: detail },
    };
    const draft = narrativeIntakeView(operation).cost_summary;
    const later = summarizeResearchCosts([
      { execution_id: "op", phase: "narrative_intake", detail },
      { execution_id: "op", phase: "narrative_intake", detail },
    ]);
    assert.deepEqual(draft, later);
    assert.equal(draft.research_usd, 0);
    assert.equal(draft.complete, false);
    assert.equal(
      draft.preparation_usd,
      detail.upstream_inference_cost ?? detail.cost_usd ?? 0,
    );
    assert.equal(draft.calls, detail.dispatched ? 1 : 0);
  }
});
