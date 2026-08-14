import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  buildArtifactSnapshot,
  serializeArtifactSnapshot,
} from "../src/indexer.js";
import { PathPolicyError } from "../src/security.js";

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const fixtureRoot = resolve(packageRoot, "test", "fixtures", "source");

test("snapshot is deterministic, sorted, redacted, and classifies unknown files", async () => {
  const config = {
    roots: [{ id: "fixture", absolutePath: fixtureRoot }],
    asOf: "2099-08-14T00:00:00.000Z",
    staleAfterMs: Number.MAX_SAFE_INTEGER,
  } as const;
  const first = await buildArtifactSnapshot(config);
  const second = await buildArtifactSnapshot(config);
  assert.deepEqual(first, second);
  assert.equal(
    serializeArtifactSnapshot(first),
    serializeArtifactSnapshot(second),
  );
  assert.equal(first.summary.total, 2);
  assert.equal(first.summary.unknown, 1);
  assert.equal(
    first.artifacts[0]?.sourceUri,
    "matchbase://fixture/DECISION_REGISTER.md",
  );
  assert.equal(
    first.artifacts[0]?.redactedExcerpt?.includes("[REDACTED:EMAIL]"),
    true,
  );
  assert.equal(
    first.artifacts.some(
      ({ relativePath }) => resolve(relativePath) === relativePath,
    ),
    false,
  );
  assert.equal(first.snapshotId.length, 64);
});

test("stale state is based only on the caller-supplied clock", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "matchbase-indexer-"));
  try {
    const file = resolve(directory, "risk.md");
    await writeFile(file, "# Risk\n", "utf8");
    await utimes(
      file,
      new Date("2025-01-01T00:00:00.000Z"),
      new Date("2025-01-01T00:00:00.000Z"),
    );
    const snapshot = await buildArtifactSnapshot({
      roots: [{ id: "temporary", absolutePath: directory }],
      asOf: "2026-01-01T00:00:00.000Z",
      staleAfterMs: 24 * 60 * 60 * 1_000,
    });
    assert.equal(snapshot.artifacts[0]?.state, "STALE");
    assert.deepEqual(snapshot.artifacts[0]?.views, ["risks"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("future modification times remain UNKNOWN and compound registers reach control views", async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "matchbase-indexer-clock-"),
  );
  try {
    const file = resolve(directory, "registers.json");
    await writeFile(file, '{"schemaVersion":1}\n', "utf8");
    await utimes(
      file,
      new Date("2026-01-02T00:00:00.000Z"),
      new Date("2026-01-02T00:00:00.000Z"),
    );
    const snapshot = await buildArtifactSnapshot({
      roots: [{ id: "governance", absolutePath: directory }],
      asOf: "2026-01-01T00:00:00.000Z",
      staleAfterMs: 24 * 60 * 60 * 1_000,
    });
    assert.equal(snapshot.artifacts[0]?.state, "UNKNOWN");
    assert.equal(snapshot.views.defects.length, 1);
    assert.equal(snapshot.views.requirements.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("root configuration rejects relative and MEP paths", async () => {
  await assert.rejects(
    buildArtifactSnapshot({
      roots: [{ id: "relative", absolutePath: "." }],
      asOf: "2026-01-01T00:00:00Z",
      staleAfterMs: 0,
    }),
    PathPolicyError,
  );
  await assert.rejects(
    buildArtifactSnapshot({
      roots: [{ id: "mep", absolutePath: resolve(fixtureRoot, "MEP") }],
      asOf: "2026-01-01T00:00:00Z",
      staleAfterMs: 0,
    }),
    PathPolicyError,
  );
});

test("symlinks escaping an allowlisted root are rejected when supported", async (context) => {
  const directory = await mkdtemp(resolve(tmpdir(), "matchbase-indexer-link-"));
  const outside = await mkdtemp(
    resolve(tmpdir(), "matchbase-indexer-outside-"),
  );
  try {
    await writeFile(resolve(outside, "outside.md"), "must not be read", "utf8");
    try {
      await symlink(outside, resolve(directory, "escape"), "junction");
    } catch (error) {
      context.skip(
        `symlink unavailable: ${error instanceof Error ? error.name : "unknown"}`,
      );
      return;
    }
    await assert.rejects(
      buildArtifactSnapshot({
        roots: [{ id: "linked", absolutePath: directory }],
        asOf: "2026-01-01T00:00:00Z",
        staleAfterMs: 0,
      }),
      PathPolicyError,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
