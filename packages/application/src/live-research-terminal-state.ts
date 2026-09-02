export type PersistedLiveResultOutcome =
  "candidates" | "scarcity" | "no_responsible_match";

export type LiveResearchTerminalDisposition =
  "complete" | "failed_retryable" | "failed" | "cancelled";

export function liveResearchRunTerminalState(
  disposition: LiveResearchTerminalDisposition,
  persistedResultOutcome: PersistedLiveResultOutcome | null,
): "complete" | "no_responsible_match" | "failed" | "cancelled" {
  if (disposition === "complete") {
    if (persistedResultOutcome === "no_responsible_match")
      return "no_responsible_match";
    if (
      persistedResultOutcome === "candidates" ||
      persistedResultOutcome === "scarcity"
    )
      return "complete";
    throw new Error("A complete live terminal requires a persisted result.");
  }
  if (persistedResultOutcome !== null)
    throw new Error("A failed live terminal cannot bind a persisted result.");
  return disposition === "cancelled" ? "cancelled" : "failed";
}
