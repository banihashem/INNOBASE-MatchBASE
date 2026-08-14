import type {
  DashboardSnapshot,
  EvidenceState,
  ViewData,
  ViewKey,
} from "./types";
import { VIEW_KEYS } from "./types";

export const VIEW_META: Record<
  ViewKey,
  { label: string; short: string; description: string }
> = {
  portfolio: {
    label: "Portfolio",
    short: "PF",
    description: "Initiatives, outcomes, and delivery confidence.",
  },
  gates: {
    label: "Gates",
    short: "GT",
    description: "Evidence gates and promotion eligibility.",
  },
  backlog: {
    label: "Backlog",
    short: "BL",
    description: "Prioritized work and bounded delivery slices.",
  },
  decisions: {
    label: "Decisions",
    short: "DC",
    description: "Product-owner decisions and unresolved choices.",
  },
  risks: {
    label: "Risks",
    short: "RK",
    description: "Threats, mitigations, and residual exposure.",
  },
  requirements: {
    label: "Requirements",
    short: "RQ",
    description: "Traceable product and operational requirements.",
  },
  tests: {
    label: "Tests",
    short: "TS",
    description: "Verification results linked to requirements.",
  },
  defects: {
    label: "Defects",
    short: "DF",
    description: "Known faults, severity, and current disposition.",
  },
  deployments: {
    label: "Deployments",
    short: "DP",
    description: "Environment state and deployment evidence.",
  },
  costs: {
    label: "Costs",
    short: "CT",
    description: "Attribution coverage and cost-control evidence.",
  },
  agents: {
    label: "Agents",
    short: "AG",
    description: "Delegated work, ownership, and audit separation.",
  },
  loops: {
    label: "Loops",
    short: "LP",
    description: "Autonomous control-loop checkpoints and outcomes.",
  },
  evidence: {
    label: "Evidence",
    short: "EV",
    description: "Immutable source references and verification artifacts.",
  },
};

export const STATUS_ORDER: EvidenceState[] = [
  "ERROR",
  "BLOCKED",
  "STALE",
  "UNKNOWN",
  "ACTIVE",
  "PASS",
];

function isEvidenceState(value: unknown): value is EvidenceState {
  return (
    typeof value === "string" && STATUS_ORDER.includes(value as EvidenceState)
  );
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Snapshot record ${field} is invalid.`);
  return value;
}

export function blankView(
  key: ViewKey,
  status: EvidenceState = "UNKNOWN",
): ViewData {
  return { ...VIEW_META[key], status, records: [] };
}

export function unavailableSnapshot(message: string): DashboardSnapshot {
  const views = Object.fromEntries(
    VIEW_KEYS.map((key) => [key, blankView(key, "ERROR")]),
  ) as Record<ViewKey, ViewData>;
  return {
    schemaVersion: "1.0",
    generatedAt: new Date(0).toISOString(),
    mode: "READ_ONLY",
    notice: message,
    views,
  };
}

export function normalizeSnapshot(input: unknown): DashboardSnapshot {
  if (!input || typeof input !== "object")
    throw new Error("Snapshot root must be an object.");
  const value = input as Partial<DashboardSnapshot>;
  if (value.schemaVersion !== "1.0")
    throw new Error("Unsupported dashboard snapshot schema.");
  if (value.mode !== "READ_ONLY")
    throw new Error("Snapshot is not marked READ_ONLY.");
  if (!value.generatedAt || Number.isNaN(Date.parse(value.generatedAt)))
    throw new Error("Snapshot generatedAt is invalid.");
  if (!value.views || typeof value.views !== "object")
    throw new Error("Snapshot views are missing.");

  const views = Object.fromEntries(
    VIEW_KEYS.map((key) => {
      const candidate = value.views?.[key];
      if (!candidate || !Array.isArray(candidate.records))
        throw new Error(`Snapshot view ${key} is missing or invalid.`);
      if (!isEvidenceState(candidate.status))
        throw new Error(`Snapshot view ${key} status is invalid.`);
      return [
        key,
        {
          ...blankView(key),
          ...candidate,
          status: candidate.status,
          records: candidate.records.map((record) => ({
            ...record,
            id: requireText(record.id, "id"),
            title: requireText(record.title, "title"),
            summary: requireText(record.summary, "summary"),
            status: isEvidenceState(record.status)
              ? record.status
              : (() => {
                  throw new Error(
                    `Snapshot record ${record.id} status is invalid.`,
                  );
                })(),
            sourceRefs:
              Array.isArray(record.sourceRefs) && record.sourceRefs.length > 0
                ? record.sourceRefs.map((source) => {
                    if (
                      !source ||
                      typeof source.sourceId !== "string" ||
                      !source.sourceId.trim() ||
                      typeof source.path !== "string" ||
                      !/^(?:[A-Za-z]:\\|\/)/u.test(source.path) ||
                      typeof source.sha256 !== "string" ||
                      !/^[A-Fa-f0-9]{64}$/u.test(source.sha256) ||
                      typeof source.observedAt !== "string" ||
                      Number.isNaN(Date.parse(source.observedAt))
                    ) {
                      throw new Error(
                        `Snapshot record ${record.id} source reference is invalid.`,
                      );
                    }
                    return source;
                  })
                : (() => {
                    throw new Error(
                      `Snapshot record ${record.id} has no source reference.`,
                    );
                  })(),
          })),
        },
      ];
    }),
  ) as Record<ViewKey, ViewData>;

  return {
    ...value,
    schemaVersion: "1.0",
    mode: "READ_ONLY",
    generatedAt: value.generatedAt,
    views,
  };
}

export function freshnessState(
  generatedAt: string,
  now = Date.now(),
): EvidenceState {
  const age = now - Date.parse(generatedAt);
  if (!Number.isFinite(age) || age < 0) return "UNKNOWN";
  return age > 24 * 60 * 60 * 1000 ? "STALE" : "ACTIVE";
}
