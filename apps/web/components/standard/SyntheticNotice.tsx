import { SYNTHETIC_NOTICE } from "./types";

export function SyntheticNotice() {
  return (
    <aside
      className="synthetic-banner"
      aria-label="Synthetic data notice"
      data-testid="standard-synthetic-warning"
    >
      <span aria-hidden="true">●</span>
      <span>{SYNTHETIC_NOTICE}</span>
    </aside>
  );
}
