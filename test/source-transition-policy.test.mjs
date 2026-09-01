import assert from "node:assert/strict";
import test from "node:test";
import { sourceTransitionState } from "../scripts/lib/source-transition-policy.mjs";

const predecessor = "1".repeat(40);
const successor = "2".repeat(40);

test("classifies a dirty worktree independently of the published ref", () => {
  assert.equal(
    sourceTransitionState({
      dirty: true,
      head: predecessor,
      originMain: predecessor,
    }),
    "WORKTREE_UNCOMMITTED",
  );
});

test("classifies a governed local commit before push", () => {
  assert.equal(
    sourceTransitionState({
      dirty: false,
      head: successor,
      originMain: predecessor,
    }),
    "COMMITTED_UNPUBLISHED",
  );
});

test("classifies the same candidate after push without changing static governance", () => {
  assert.equal(
    sourceTransitionState({
      dirty: false,
      head: successor,
      originMain: successor,
    }),
    "PUBLISHED_SOURCE",
  );
});

test("rejects incomplete or fabricated transition identities", () => {
  assert.throws(
    () =>
      sourceTransitionState({
        dirty: false,
        head: "not-a-commit",
        originMain: predecessor,
      }),
    /identity is invalid/u,
  );
});
