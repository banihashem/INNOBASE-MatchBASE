import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  researchAuthorityHash,
  matchesResearchAuthorityHash,
} from "../../../packages/data/dist/index.js";

const source = {
  approved_request_revision: {
    revision_id: "approved",
    conditions: { region: "A", quantity: 10 },
  },
  deep_prompt_revision: { is_approved: true, prompt_text: "Find pumps" },
  search_dimension_plan: {
    version: "synthetic",
    groups: [{ values: ["A", "B"], key: "region" }],
  },
};
function reorder(value) {
  return Array.isArray(value)
    ? value.map(reorder)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .reverse()
            .map(([key, child]) => [key, reorder(child)]),
        )
      : value;
}
test("MB-UX-QUALITY-002 L06 authority ignores recursive object order but binds request, prompt, dimension content and array order", () => {
  const original = researchAuthorityHash(source);
  assert.match(original, /^research-authority\.v2:[a-f0-9]{64}$/);
  assert.equal(researchAuthorityHash(reorder(source)), original);
  for (const field of [
    "approved_request_revision",
    "deep_prompt_revision",
    "search_dimension_plan",
  ]) {
    assert.notEqual(
      researchAuthorityHash({ ...source, [field]: null }),
      original,
    );
    assert.notEqual(
      researchAuthorityHash({
        ...source,
        [field]: { ...source[field], changed: true },
      }),
      original,
    );
  }
  const changed = structuredClone(source);
  changed.search_dimension_plan.groups[0].values.reverse();
  assert.notEqual(researchAuthorityHash(changed), original);
});
test("MB-UX-QUALITY-002 L06 retained historical hashes never permit dropping current approved dimensions", () => {
  const old = (values) =>
    createHash("sha256").update(JSON.stringify(values)).digest("hex");
  const values = [
    source.approved_request_revision,
    source.deep_prompt_revision,
  ];
  assert.equal(matchesResearchAuthorityHash(old(values), source), false);
  assert.equal(
    matchesResearchAuthorityHash(
      old([...values, source.search_dimension_plan]),
      source,
    ),
    true,
  );
  assert.equal(
    matchesResearchAuthorityHash(old(values), {
      ...source,
      search_dimension_plan: undefined,
    }),
    true,
  );
  assert.equal(
    matchesResearchAuthorityHash(
      "research-authority.v9:" + "a".repeat(64),
      source,
    ),
    false,
  );
  assert.equal(matchesResearchAuthorityHash(undefined, source), false);
  assert.equal(
    matchesResearchAuthorityHash(
      old([...values, reorder(source.search_dimension_plan)]),
      source,
    ),
    false,
    "An unrecoverable legacy insertion order must not be guessed",
  );
});
