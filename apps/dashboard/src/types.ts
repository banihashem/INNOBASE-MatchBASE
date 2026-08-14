export const VIEW_KEYS = [
  "portfolio",
  "gates",
  "backlog",
  "decisions",
  "risks",
  "requirements",
  "tests",
  "defects",
  "deployments",
  "costs",
  "agents",
  "loops",
  "evidence",
] as const;

export type ViewKey = (typeof VIEW_KEYS)[number];
export type EvidenceState =
  "PASS" | "ACTIVE" | "BLOCKED" | "UNKNOWN" | "STALE" | "ERROR";

export interface SourceReference {
  sourceId: string;
  path: string;
  sha256?: string;
  lineStart?: number;
  lineEnd?: number;
  section?: string;
  observedAt?: string;
}

export interface DashboardRecord {
  id: string;
  title: string;
  summary: string;
  status: EvidenceState;
  owner?: string;
  stage?: string;
  updatedAt?: string;
  tags?: string[];
  facts?: Record<string, string | number | boolean | null>;
  sourceRefs: SourceReference[];
}

export interface ViewData {
  label: string;
  description: string;
  status: EvidenceState;
  records: DashboardRecord[];
}

export interface DashboardSnapshot {
  schemaVersion: "1.0";
  generatedAt: string;
  mode: "READ_ONLY";
  buildRef?: string;
  notice?: string;
  views: Record<ViewKey, ViewData>;
}

export interface LoadState {
  phase: "LOADING" | "READY" | "ERROR";
  snapshot?: DashboardSnapshot;
  message?: string;
}
