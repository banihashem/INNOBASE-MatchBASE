import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  TRUSTED_ROOTS,
  assertSafeOutputPath,
  validateGeneratorConfig,
} from "../scripts/lib/snapshot-path-policy.mjs";
import { replaceRegularFileTransactionally } from "../scripts/lib/replace-regular-file.mjs";
import { validateSourceReferenceShape } from "../scripts/lib/dashboard-source-policy.mjs";

test("accepts only the exact governed source-root set", () => {
  const roots = [...TRUSTED_ROOTS].map(([id, absolutePath]) => ({
    id,
    absolutePath,
  }));
  assert.doesNotThrow(() => validateGeneratorConfig({ roots }));
  assert.throws(
    () =>
      validateGeneratorConfig({
        roots: [...roots.slice(0, -1), { id: "escape", absolutePath: "C:\\" }],
      }),
    /exactly the trusted roots|not trusted/,
  );
});

test("rejects traversal and weak source evidence before verification", () => {
  const root = "C:\\INNOBASE\\MatchBASE\\allowed";
  const valid = {
    sourceId: "matchbase://allowed/file.json",
    path: `${root}\\file.json`,
    sha256: "A".repeat(64),
    observedAt: "2026-08-14T00:00:00.000Z",
  };
  assert.doesNotThrow(() => validateSourceReferenceShape(valid, [root]));
  assert.throws(
    () =>
      validateSourceReferenceShape(
        { ...valid, path: `${root}\\..\\outside.json` },
        [root],
      ),
    /outside allowlisted roots/,
  );
  assert.throws(
    () =>
      validateSourceReferenceShape(
        { ...valid, path: `${root}\\nested\\..\\..\\outside.json` },
        [root],
      ),
    /outside allowlisted roots/,
  );
  assert.throws(
    () =>
      validateSourceReferenceShape(
        {
          ...valid,
          path: "C:\\INNOBASE\\MatchBASE\\allowed-prefix\\file.json",
        },
        [root],
      ),
    /outside allowlisted roots/,
  );
  assert.throws(
    () => validateSourceReferenceShape({ ...valid, sha256: undefined }, [root]),
    /invalid source hash/,
  );
});

test("transactionally replaces an existing regular file without residue", async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "matchbase-snapshot-replace-"),
  );
  const target = resolve(directory, "current-snapshot.json");
  try {
    await writeFile(target, "old", "utf8");
    await replaceRegularFileTransactionally(target, "new", target);
    assert.equal(await readFile(target, "utf8"), "new");
    assert.deepEqual(await readdir(directory), ["current-snapshot.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects output escape and symbolic-link targets", async (context) => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "matchbase-snapshot-policy-"),
  );
  const expected = resolve(directory, "current-snapshot.json");
  const outside = resolve(directory, "outside.json");
  try {
    await writeFile(outside, "{}", "utf8");
    await assert.rejects(
      assertSafeOutputPath(outside, expected),
      /outside the fixed/,
    );
    try {
      await symlink(outside, expected, "file");
    } catch (error) {
      context.skip(
        `symbolic link unavailable: ${error instanceof Error ? error.name : "unknown"}`,
      );
      return;
    }
    await assert.rejects(
      assertSafeOutputPath(expected, expected),
      /regular file or absent/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
