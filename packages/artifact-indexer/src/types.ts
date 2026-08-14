export const DASHBOARD_VIEWS = [
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

export type DashboardView = (typeof DASHBOARD_VIEWS)[number];
export type ArtifactState = "CURRENT" | "UNKNOWN" | "STALE" | "ERROR";

export interface SourceRootConfig {
  /** Stable, non-sensitive identifier shown in dashboard source URIs. */
  readonly id: string;
  /** Explicit absolute path. Relative paths are rejected. */
  readonly absolutePath: string;
  /** File extensions eligible for a redacted excerpt. Hashing still covers other files. */
  readonly textExtensions?: readonly string[];
}

export interface IndexerConfig {
  readonly roots: readonly SourceRootConfig[];
  /** Caller-supplied clock makes the output reproducible. */
  readonly asOf: string;
  readonly staleAfterMs: number;
  readonly maxFiles?: number;
  readonly maxExcerptBytes?: number;
}

export interface ArtifactRecord {
  readonly id: string;
  readonly sourceUri: string;
  readonly sourceRootId: string;
  readonly relativePath: string;
  readonly extension: string;
  readonly sizeBytes: number | null;
  readonly modifiedAt: string | null;
  readonly sha256: string | null;
  readonly state: ArtifactState;
  readonly views: readonly DashboardView[];
  readonly redactedExcerpt: string | null;
  readonly redactionCount: number;
  readonly errorCode: string | null;
}

export interface ArtifactSummary {
  readonly total: number;
  readonly current: number;
  readonly unknown: number;
  readonly stale: number;
  readonly error: number;
  readonly redactions: number;
}

export interface ArtifactSnapshot {
  readonly schemaVersion: "matchbase.artifact-snapshot/v1";
  readonly snapshotId: string;
  readonly generatedAt: string;
  readonly sourceRoots: readonly {
    readonly id: string;
    readonly sourceUri: string;
  }[];
  readonly artifacts: readonly ArtifactRecord[];
  readonly views: Readonly<Record<DashboardView, readonly string[]>>;
  readonly summary: ArtifactSummary;
}
