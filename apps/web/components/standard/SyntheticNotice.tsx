import { SYNTHETIC_NOTICE } from "./types";

export function SyntheticNotice({
  modeLabel = "Synthetic reference",
}: {
  modeLabel?: "Synthetic reference" | "Qualified live research";
}) {
  const qualifiedLive = modeLabel === "Qualified live research";
  return (
    <aside
      className={
        qualifiedLive
          ? "synthetic-banner qualified-live-banner"
          : "synthetic-banner"
      }
      aria-label={
        qualifiedLive
          ? "Qualified live research notice"
          : "Synthetic data notice"
      }
      data-testid="standard-synthetic-warning"
    >
      <span aria-hidden="true">●</span>
      <strong>{modeLabel}</strong>
      <span aria-hidden="true"> · </span>
      <span>
        {qualifiedLive
          ? "Controlled web evidence is fetched for this run; external verification requires independent corroboration or authoritative registry evidence"
          : SYNTHETIC_NOTICE}
      </span>
    </aside>
  );
}
