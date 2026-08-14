import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import {
  DASHBOARD_VIEWS,
  type ArtifactRecord,
  type ArtifactSnapshot,
  type ArtifactState,
  type DashboardView,
  type IndexerConfig,
  type SourceRootConfig,
} from "./types.js";
import {
  PathPolicyError,
  assertAbsolutePath,
  assertAllowedPath,
  containsForbiddenMepSegment,
  isWithinRoot,
  redactSensitiveText,
} from "./security.js";

const DEFAULT_TEXT_EXTENSIONS = new Set([
  ".csv",
  ".json",
  ".md",
  ".sha256",
  ".tsv",
  ".txt",
  ".yaml",
  ".yml",
]);
const ROOT_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/u;

interface ValidatedRoot {
  readonly id: string;
  readonly configuredPath: string;
  readonly realPath: string;
  readonly textExtensions: ReadonlySet<string>;
}

function normalizeExtension(extension: string): string {
  const normalized = extension.trim().toLowerCase();
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}

function normalizeRelativePath(path: string): string {
  return path.split(sep).join("/");
}

function sourceUriFor(rootId: string, relativePath: string): string {
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  return `matchbase://${rootId}/${encodedPath}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right, "en"),
    );
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(
    createReadStream(filePath),
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback();
      },
    }),
  );
  return hash.digest("hex");
}

async function readPrefix(
  filePath: string,
  maximumBytes: number,
): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maximumBytes);
    const { bytesRead } = await handle.read(buffer, 0, maximumBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8").replace(/\0/gu, "");
  } finally {
    await handle.close();
  }
}

function inferViews(relativePath: string): readonly DashboardView[] {
  const haystack = relativePath.toLowerCase();
  if (haystack.endsWith("registers.json")) {
    return [
      "requirements",
      "tests",
      "risks",
      "defects",
      "deployments",
      "costs",
      "loops",
      "evidence",
    ];
  }
  const mappings: readonly [DashboardView, readonly string[]][] = [
    ["portfolio", ["portfolio", "roadmap", "product"]],
    ["gates", ["gate", "approval", "readiness"]],
    ["backlog", ["backlog", "story", "stories", "work-item"]],
    ["decisions", ["decision", "overlay", "disposition"]],
    ["risks", ["risk", "threat", "privacy", "security"]],
    ["requirements", ["requirement", "prd", "brd", "traceability"]],
    ["tests", ["test", "qa", "validation", "verification", "eval"]],
    ["defects", ["defect", "bug", "incident"]],
    ["deployments", ["deploy", "release", "environment", "infrastructure"]],
    ["costs", ["cost", "budget", "billing", "finops"]],
    ["agents", ["agent", "orchestrat", "model", "provider"]],
    ["loops", ["loop", "cadence", "continuous-delivery"]],
    ["evidence", ["evidence", "audit", "hash", "source", "log"]],
  ];
  const matches = mappings
    .filter(([, terms]) => terms.some((term) => haystack.includes(term)))
    .map(([view]) => view);
  return matches.length > 0 ? matches : ["evidence"];
}

function determineState(
  modifiedMs: number,
  asOfMs: number,
  staleAfterMs: number,
  hasExcerpt: boolean,
): ArtifactState {
  if (!hasExcerpt) return "UNKNOWN";
  if (modifiedMs > asOfMs) return "UNKNOWN";
  return asOfMs - modifiedMs > staleAfterMs ? "STALE" : "CURRENT";
}

function safeErrorCode(error: unknown): string {
  if (error instanceof PathPolicyError) return error.code;
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = String((error as { code: unknown }).code);
    if (/^[A-Z0-9_]+$/u.test(code)) return code;
  }
  return "INDEX_READ_ERROR";
}

async function validateRoots(
  roots: readonly SourceRootConfig[],
): Promise<readonly ValidatedRoot[]> {
  if (roots.length === 0)
    throw new PathPolicyError("at least one source root is required");
  const ids = new Set<string>();
  const validated: ValidatedRoot[] = [];
  for (const root of roots) {
    if (!ROOT_ID_PATTERN.test(root.id) || ids.has(root.id)) {
      throw new PathPolicyError(
        `source root id is invalid or duplicated: ${root.id}`,
      );
    }
    ids.add(root.id);
    assertAbsolutePath(root.absolutePath, `root ${root.id}`);
    if (containsForbiddenMepSegment(root.absolutePath)) {
      throw new PathPolicyError(`MEP paths are forbidden for root ${root.id}`);
    }
    const configuredPath = resolve(root.absolutePath);
    const realPath = await realpath(configuredPath);
    const rootStats = await stat(realPath);
    if (!rootStats.isDirectory())
      throw new PathPolicyError(`root ${root.id} is not a directory`);
    validated.push({
      id: root.id,
      configuredPath,
      realPath,
      textExtensions: new Set(
        Array.from(
          root.textExtensions ?? DEFAULT_TEXT_EXTENSIONS,
          normalizeExtension,
        ),
      ),
    });
  }
  return validated.sort((left, right) => left.id.localeCompare(right.id, "en"));
}

async function walkRoot(
  root: ValidatedRoot,
  maximumFiles: number,
): Promise<readonly string[]> {
  const files: string[] = [];
  const pending = [root.realPath];
  const visitedDirectories = new Set<string>();
  while (pending.length > 0) {
    const directory = pending.shift();
    if (directory === undefined) break;
    assertAllowedPath(directory, [root.realPath]);
    const directoryRealPath = await realpath(directory);
    if (visitedDirectories.has(directoryRealPath)) continue;
    visitedDirectories.add(directoryRealPath);
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const candidate = join(directory, entry.name);
      if (containsForbiddenMepSegment(candidate)) continue;
      const candidateLstat = await lstat(candidate);
      if (candidateLstat.isSymbolicLink()) {
        const target = await realpath(candidate);
        if (!isWithinRoot(root.realPath, target)) {
          throw new PathPolicyError("symlink escapes configured source root");
        }
        const targetStats = await stat(target);
        if (targetStats.isDirectory()) pending.push(target);
        else if (targetStats.isFile()) files.push(target);
      } else if (candidateLstat.isDirectory()) {
        pending.push(candidate);
      } else if (candidateLstat.isFile()) {
        files.push(candidate);
      }
      if (files.length > maximumFiles)
        throw new PathPolicyError(`file limit exceeded for root ${root.id}`);
    }
    pending.sort((left, right) => left.localeCompare(right, "en"));
  }
  return [...new Set(files)].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

async function indexFile(
  root: ValidatedRoot,
  filePath: string,
  asOfMs: number,
  staleAfterMs: number,
  maxExcerptBytes: number,
): Promise<ArtifactRecord> {
  const safeRelativePath = normalizeRelativePath(
    relative(root.realPath, filePath),
  );
  const sourceUri = sourceUriFor(root.id, safeRelativePath);
  const extension = extname(filePath).toLowerCase();
  const base = {
    id: sha256Text(`${root.id}\0${safeRelativePath}`),
    sourceUri,
    sourceRootId: root.id,
    relativePath: safeRelativePath,
    extension,
    views: inferViews(safeRelativePath),
  } as const;
  try {
    const resolvedFile = await realpath(filePath);
    assertAllowedPath(resolvedFile, [root.realPath]);
    const fileStats = await stat(resolvedFile);
    const isText = root.textExtensions.has(extension);
    const redacted = isText
      ? redactSensitiveText(
          (await readPrefix(resolvedFile, maxExcerptBytes)).replace(
            /\r\n?/gu,
            "\n",
          ),
        )
      : { text: "", count: 0 };
    return {
      ...base,
      sizeBytes: fileStats.size,
      modifiedAt: fileStats.mtime.toISOString(),
      sha256: await sha256File(resolvedFile),
      state: determineState(fileStats.mtimeMs, asOfMs, staleAfterMs, isText),
      redactedExcerpt: isText ? redacted.text : null,
      redactionCount: redacted.count,
      errorCode: null,
    };
  } catch (error) {
    return {
      ...base,
      sizeBytes: null,
      modifiedAt: null,
      sha256: null,
      state: "ERROR",
      redactedExcerpt: null,
      redactionCount: 0,
      errorCode: safeErrorCode(error),
    };
  }
}

/**
 * Builds dashboard metadata without modifying sources. Raw source text is never emitted;
 * only a bounded, redacted excerpt is included for allowlisted textual extensions.
 */
export async function buildArtifactSnapshot(
  config: IndexerConfig,
): Promise<ArtifactSnapshot> {
  const asOfMs = Date.parse(config.asOf);
  if (!Number.isFinite(asOfMs))
    throw new TypeError("asOf must be an ISO-8601 timestamp");
  if (!Number.isSafeInteger(config.staleAfterMs) || config.staleAfterMs < 0) {
    throw new TypeError("staleAfterMs must be a non-negative safe integer");
  }
  const maxFiles = config.maxFiles ?? 10_000;
  const maxExcerptBytes = config.maxExcerptBytes ?? 4_096;
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1)
    throw new TypeError("maxFiles must be a positive safe integer");
  if (
    !Number.isSafeInteger(maxExcerptBytes) ||
    maxExcerptBytes < 1 ||
    maxExcerptBytes > 65_536
  ) {
    throw new TypeError("maxExcerptBytes must be between 1 and 65536");
  }

  const roots = await validateRoots(config.roots);
  const artifacts: ArtifactRecord[] = [];
  for (const root of roots) {
    const paths = await walkRoot(root, maxFiles);
    if (artifacts.length + paths.length > maxFiles) {
      throw new PathPolicyError("aggregate file limit exceeded");
    }
    for (const path of paths) {
      artifacts.push(
        await indexFile(
          root,
          path,
          asOfMs,
          config.staleAfterMs,
          maxExcerptBytes,
        ),
      );
    }
  }
  artifacts.sort((left, right) =>
    left.sourceUri.localeCompare(right.sourceUri, "en"),
  );

  const views = DASHBOARD_VIEWS.reduce<
    Record<DashboardView, readonly string[]>
  >(
    (result, view) => {
      result[view] = artifacts
        .filter((artifact) => artifact.views.includes(view))
        .map((artifact) => artifact.id);
      return result;
    },
    Object.create(null) as Record<DashboardView, readonly string[]>,
  );
  const summary = {
    total: artifacts.length,
    current: artifacts.filter(({ state }) => state === "CURRENT").length,
    unknown: artifacts.filter(({ state }) => state === "UNKNOWN").length,
    stale: artifacts.filter(({ state }) => state === "STALE").length,
    error: artifacts.filter(({ state }) => state === "ERROR").length,
    redactions: artifacts.reduce(
      (sum, artifact) => sum + artifact.redactionCount,
      0,
    ),
  };
  const content = {
    schemaVersion: "matchbase.artifact-snapshot/v1" as const,
    generatedAt: new Date(asOfMs).toISOString(),
    sourceRoots: roots.map((root) => ({
      id: root.id,
      sourceUri: `matchbase://${root.id}/`,
    })),
    artifacts,
    views,
    summary,
  };
  return { ...content, snapshotId: sha256Text(stableJson(content)) };
}

export function serializeArtifactSnapshot(snapshot: ArtifactSnapshot): string {
  return `${stableJson(snapshot)}\n`;
}
