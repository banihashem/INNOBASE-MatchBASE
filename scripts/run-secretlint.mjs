import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectRepositoryCandidate,
  repositoryCandidateFiles,
} from "./lib/repository-files.mjs";

export function runSecretlint(
  root,
  executable = resolve(root, "node_modules/secretlint/bin/secretlint.js"),
) {
  const files = repositoryCandidateFiles(root);
  let scanned = 0;

  for (const [index, file] of files.entries()) {
    const { path, stat } = inspectRepositoryCandidate(root, file);
    if (!stat.isFile()) continue;
    const extension = extname(file) || ".txt";
    const safeFilename = `candidate-${String(index).padStart(6, "0")}${extension}`;
    const result = spawnSync(
      process.execPath,
      [executable, "--no-gitignore", `--stdinFileName=${safeFilename}`],
      {
        cwd: root,
        encoding: "utf8",
        input: readFileSync(path),
        maxBuffer: 10 * 1024 * 1024,
        shell: false,
      },
    );
    if (result.status !== 0) {
      return {
        passed: false,
        scanned,
        status: result.status,
        output: result.stderr || result.stdout || "secretlint failed\n",
      };
    }
    scanned += 1;
  }
  return { passed: true, scanned, status: 0, output: "" };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(".");
  const result = runSecretlint(root);
  if (!result.passed) {
    process.stderr.write(result.output);
    process.exitCode = 1;
  } else {
    console.log(`secretlint: PASS (${result.scanned} Git candidate files)`);
  }
}
