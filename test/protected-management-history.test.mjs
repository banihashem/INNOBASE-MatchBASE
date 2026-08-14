import assert from "node:assert/strict";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  aggregateProtectedEntries,
  sha256,
  validateManagementManifestBytes,
  verifyProtectedManagementHistory,
} from "../scripts/lib/protected-management-history.mjs";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const manifestPath = join(
  repositoryRoot,
  "config",
  "protected-management-history.v1.json",
);
const validatorPath = join(
  repositoryRoot,
  "scripts",
  "validate-protected-baseline.mjs",
);
const managementRoot = "C:\\INNOBASE\\MatchBASE\\01_Product_Management";
const committedExpectation = Object.freeze({
  manifestSha256:
    "5796E23E3937C19C1E5202453AB1D85B7F253EDD619C7C40E1DAE84E67E3437D",
  manifestId: "matchbase-protected-management-history-v1",
  rootIdentity: "01_Product_Management",
  fileCount: 36,
  legacyAggregateSha256:
    "BE407DA2BB59084F208AE6247B0CFFB0391CEEA021F480B64A9392F066F64803",
});

function fixtureManifest(entries) {
  const files = entries.map(([path, content]) => ({
    path,
    sha256: sha256(Buffer.from(content)),
  }));
  return {
    schemaVersion: 1,
    manifestId: "fixture-protected-management-history-v1",
    rootIdentity: "fixture-management",
    pathSemantics: "Unicode-NFC, case-sensitive, root-relative POSIX identity",
    aggregateAlgorithm:
      "SHA256(sorted(relativePath + NUL + uppercaseFileSha256 + LF))",
    fileCount: files.length,
    legacyAggregateSha256: aggregateProtectedEntries(files),
    files,
  };
}

function encodeManifest(manifest) {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
}

function validateFixtureManifest(manifest) {
  const bytes = encodeManifest(manifest);
  return validateManagementManifestBytes(bytes, {
    manifestSha256: sha256(bytes),
    manifestId: manifest.manifestId,
    rootIdentity: manifest.rootIdentity,
    fileCount: manifest.fileCount,
    legacyAggregateSha256: manifest.legacyAggregateSha256,
  });
}

async function fixtureRoot(t, files) {
  const root = await mkdtemp(join(tmpdir(), "matchbase-protected-management-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of files) {
    await writeFile(join(root, path), content);
  }
  return root;
}

test("the committed v1 manifest decisively preserves the original 36 identities", async () => {
  const bytes = await readFile(manifestPath);
  const manifest = validateManagementManifestBytes(bytes, committedExpectation);
  assert.equal(manifest.files.length, 36);
  assert.equal(
    aggregateProtectedEntries(manifest.files),
    "BE407DA2BB59084F208AE6247B0CFFB0391CEEA021F480B64A9392F066F64803",
  );
  if (process.platform !== "win32") return;
  const result = await verifyProtectedManagementHistory(
    managementRoot,
    manifest,
  );
  assert.equal(result.fileCount, 36);
  assert.ok(result.newArtifactCount >= 4);
});

test("a new non-overwriting management artifact is permitted", async (t) => {
  const entries = [["Protected.md", "frozen bytes\n"]];
  const root = await fixtureRoot(t, entries);
  const manifest = validateFixtureManifest(fixtureManifest(entries));
  await writeFile(join(root, "ROLE3_NEW_VALIDATION.md"), "new evidence\n");
  const result = await verifyProtectedManagementHistory(root, manifest);
  assert.deepEqual(result, { fileCount: 1, newArtifactCount: 1 });
});

test("protected mutation, deletion, rename, and substitution fail", async (t) => {
  const entries = [["Protected.md", "frozen bytes\n"]];
  const manifest = validateFixtureManifest(fixtureManifest(entries));
  const scenarios = [
    [
      "mutation",
      async (root) => writeFile(join(root, "Protected.md"), "changed\n"),
    ],
    ["deletion", async (root) => unlink(join(root, "Protected.md"))],
    [
      "rename",
      async (root) =>
        rename(join(root, "Protected.md"), join(root, "Renamed.md")),
    ],
    [
      "substitution",
      async (root) => writeFile(join(root, "Protected.md"), "other artifact\n"),
    ],
  ];
  for (const [name, attack] of scenarios) {
    await t.test(name, async (scenario) => {
      const root = await fixtureRoot(scenario, entries);
      await attack(root);
      await assert.rejects(
        verifyProtectedManagementHistory(root, manifest),
        /missing|hash mismatch/u,
      );
    });
  }
});

test("case mismatch, case collision, and duplicate content fail", async (t) => {
  const entries = [["Protected.md", "frozen bytes\n"]];
  const manifest = validateFixtureManifest(fixtureManifest(entries));

  await t.test("case-mismatched identity", async (scenario) => {
    const root = await fixtureRoot(scenario, [
      ["protected.md", "frozen bytes\n"],
    ]);
    await assert.rejects(
      verifyProtectedManagementHistory(root, manifest),
      /case collision or identity mismatch/u,
    );
  });

  await t.test("duplicate protected bytes", async (scenario) => {
    const root = await fixtureRoot(scenario, entries);
    await writeFile(join(root, "Copied.md"), "frozen bytes\n");
    await assert.rejects(
      verifyProtectedManagementHistory(root, manifest),
      /duplicates protected history/u,
    );
  });

  await t.test("hard-linked protected identity", async (scenario) => {
    const root = await fixtureRoot(scenario, entries);
    await link(join(root, "Protected.md"), join(root, "HardLink.md"));
    await assert.rejects(
      verifyProtectedManagementHistory(root, manifest),
      /hard link refused/u,
    );
  });
});

test("a protected identity replaced by a symlink is refused", async (t) => {
  const entries = [["Protected.md", "frozen bytes\n"]];
  const manifest = validateFixtureManifest(fixtureManifest(entries));
  const root = await fixtureRoot(t, []);
  const target = join(root, "target-directory");
  await mkdir(target);
  await symlink(
    target,
    join(root, "Protected.md"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    verifyProtectedManagementHistory(root, manifest),
    /symlink refused/u,
  );
});

test("manifest traversal, duplication, case collision, and non-canonical order fail", () => {
  const attacks = [
    fixtureManifest([["../Protected.md", "a"]]),
    fixtureManifest([
      ["Protected.md", "a"],
      ["Protected.md", "b"],
    ]),
    fixtureManifest([
      ["Protected.md", "a"],
      ["protected.md", "b"],
    ]),
    fixtureManifest([
      ["Z.md", "a"],
      ["A.md", "b"],
    ]),
  ];
  for (const manifest of attacks) {
    assert.throws(
      () => validateFixtureManifest(manifest),
      /entry is invalid|duplicates an identity|case collision|not canonical/u,
    );
  }
});

test("hosted anchor semantics pin the exact manifest bytes", async () => {
  const bytes = await readFile(manifestPath);
  assert.throws(
    () =>
      validateManagementManifestBytes(
        Buffer.concat([bytes, Buffer.from(" ")]),
        committedExpectation,
      ),
    /identity\/hash mismatch/u,
  );

  const hosted = spawnSync(process.execPath, [validatorPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "true",
      MATCHBASE_EXTERNAL_EVIDENCE_MODE: "ANCHOR_ONLY_CI",
    },
  });
  assert.equal(hosted.status, 0, hosted.stderr);
  assert.match(hosted.stdout, /MANIFEST_ANCHOR_CI/u);

  const refused = spawnSync(process.execPath, [validatorPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "false",
      MATCHBASE_EXTERNAL_EVIDENCE_MODE: "ANCHOR_ONLY_CI",
    },
  });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /restricted to CI=true/u);
});
