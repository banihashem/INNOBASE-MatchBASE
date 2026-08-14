import { blankView } from "../catalog";
import type { DashboardSnapshot, ViewData, ViewKey } from "../types";
import { VIEW_KEYS } from "../types";

export function fixtureSnapshot(): DashboardSnapshot {
  const views = Object.fromEntries(
    VIEW_KEYS.map((key) => [key, blankView(key)]),
  ) as Record<ViewKey, ViewData>;
  views.portfolio = {
    ...blankView("portfolio", "ACTIVE"),
    records: [
      {
        id: "PF-001",
        title: "Local PM dashboard",
        summary: "Read-only evidence surface for bounded delivery.",
        status: "PASS",
        owner: "Role 3",
        updatedAt: "2026-08-14T08:00:00.000Z",
        facts: { gate: "AG3", defects: 0 },
        sourceRefs: [
          {
            sourceId: "SRC-001",
            path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\ROLE3_IMPLEMENTATION_ORCHESTRATOR_PROMPT_PO_001.md",
            sha256: "a".repeat(64),
            lineStart: 101,
            lineEnd: 120,
            observedAt: "2026-08-14T08:00:00.000Z",
          },
        ],
      },
    ],
  };
  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    mode: "READ_ONLY",
    buildRef: "test",
    views,
  };
}
