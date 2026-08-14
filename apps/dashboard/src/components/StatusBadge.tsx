import type { EvidenceState } from "../types";

export function StatusBadge({ state }: { state: EvidenceState }) {
  return (
    <span className={`status status--${state.toLowerCase()}`}>{state}</span>
  );
}
