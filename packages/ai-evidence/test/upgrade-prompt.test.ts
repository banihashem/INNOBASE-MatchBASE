import assert from "node:assert/strict";
import test from "node:test";
import { assertUpgradePromptSafe, buildUpgradePrompt } from "../src/index.js";

test("upgrade prompt is a closed result-independent value", () => {
  const prompt = buildUpgradePrompt();
  assert.deepEqual(Object.keys(prompt).sort(), [
    "action",
    "message",
    "schema_version",
  ]);
  assert.doesNotThrow(() => assertUpgradePromptSafe(prompt));
  assert.equal(JSON.stringify(prompt).includes("candidate"), false);
  assert.equal(prompt.message.match(/\d+/gu), null);
});

test("upgrade prompt rejects masked values, candidate names, counts, and unknown fields", () => {
  for (const extra of [
    { masked_value: "••••" },
    { candidate_name: "Restricted Supplier" },
    { additional_eligible_count: 4 },
    { restricted_field: "compatibility_score" },
  ])
    assert.throws(() =>
      assertUpgradePromptSafe({ ...buildUpgradePrompt(), ...extra }),
    );
});
