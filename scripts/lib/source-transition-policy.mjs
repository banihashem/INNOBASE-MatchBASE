const COMMIT = /^[a-f0-9]{40}$/u;

export function sourceTransitionState({ dirty, head, originMain }) {
  if (
    typeof dirty !== "boolean" ||
    !COMMIT.test(head ?? "") ||
    !COMMIT.test(originMain ?? "")
  )
    throw new Error("Source-transition identity is invalid.");
  if (dirty) return "WORKTREE_UNCOMMITTED";
  return head === originMain ? "PUBLISHED_SOURCE" : "COMMITTED_UNPUBLISHED";
}
