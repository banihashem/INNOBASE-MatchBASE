import { lstat, open, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  assertCanonicalV5Workspace,
  V5_CANONICAL_REPOSITORY_ROOT,
} from "./slice3-v5-canonical-workspace.mjs";

export async function verifyCanonicalV5CredentialFileControls() {
  const root = await assertCanonicalV5Workspace();
  const credentialFile = resolve(root, "APIKeys.md");
  const item = await lstat(credentialFile);
  if (
    !item.isFile() ||
    item.isSymbolicLink() ||
    item.nlink !== 1 ||
    (await realpath(credentialFile)) !== credentialFile
  )
    throw new Error("V5 canonical credential path is invalid.");
  const ignored = spawnSync(
    "git",
    ["check-ignore", "--quiet", "--", "APIKeys.md"],
    { cwd: root },
  );
  const tracked = spawnSync(
    "git",
    ["ls-files", "--error-unmatch", "--", "APIKeys.md"],
    { cwd: root },
  );
  if (ignored.status !== 0 || tracked.status === 0)
    throw new Error("V5 credential file must be ignored and untracked.");
  return Object.freeze({ path: credentialFile, ignored: true, tracked: false });
}

function canonicalCredentialLine(line) {
  const match = line.match(
    /^\s*(?:[-*]\s*)?`?(MATCHBASE_(?:GEMINI|OPENROUTER)_API_KEY)`?\s*[:=]\s*`?([^`\s]+)`?\s*$/u,
  );
  return match ? [match[1], match[2]] : null;
}

export async function readCanonicalV5CredentialsOnce() {
  const controls = await verifyCanonicalV5CredentialFileControls();
  const handle = await open(controls.path, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1)
      throw new Error("V5 credential handle is invalid.");
    const text = await handle.readFile("utf8");
    const after = await handle.stat();
    const pathAfter = await lstat(controls.path);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      after.dev !== pathAfter.dev ||
      after.ino !== pathAfter.ino ||
      after.nlink !== 1 ||
      pathAfter.nlink !== 1
    )
      throw new Error("V5 credential identity changed during checked read.");
    const entries = text
      .split(/\r?\n/u)
      .map(canonicalCredentialLine)
      .filter(Boolean);
    const value = Object.fromEntries(entries);
    if (
      entries.length !== 2 ||
      Object.keys(value).length !== 2 ||
      !value.MATCHBASE_GEMINI_API_KEY ||
      !value.MATCHBASE_OPENROUTER_API_KEY ||
      Object.values(value).some(
        (secret) =>
          secret !== secret.trim() || /[\s\p{Cc}\p{Cf}]/u.test(secret),
      )
    )
      throw new Error("Canonical V5 credential file is invalid.");
    return Object.freeze(value);
  } finally {
    await handle.close();
  }
}

export const V5_CREDENTIAL_REPOSITORY_ROOT = V5_CANONICAL_REPOSITORY_ROOT;
