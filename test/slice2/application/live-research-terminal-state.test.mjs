import assert from "node:assert/strict";
import test from "node:test";
import { liveResearchRunTerminalState } from "../../../packages/application/dist/live-research-terminal-state.js";

test("live terminal state follows the persisted result outcome", () => {
  assert.equal(
    liveResearchRunTerminalState("complete", "candidates"),
    "complete",
  );
  assert.equal(
    liveResearchRunTerminalState("complete", "scarcity"),
    "complete",
  );
  assert.equal(
    liveResearchRunTerminalState("complete", "no_responsible_match"),
    "no_responsible_match",
  );
});

test("failed and cancelled live terminals cannot claim persisted results", () => {
  assert.equal(liveResearchRunTerminalState("failed", null), "failed");
  assert.equal(
    liveResearchRunTerminalState("failed_retryable", null),
    "failed",
  );
  assert.equal(liveResearchRunTerminalState("cancelled", null), "cancelled");
  assert.throws(
    () => liveResearchRunTerminalState("failed", "candidates"),
    /cannot bind a persisted result/u,
  );
});

test("complete live terminals fail closed without a persisted result", () => {
  assert.throws(
    () => liveResearchRunTerminalState("complete", null),
    /requires a persisted result/u,
  );
});
