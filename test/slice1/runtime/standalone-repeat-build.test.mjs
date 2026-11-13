import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { pinnedPnpmCommand } from "./standalone-test-support.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

function pnpmProcess(argumentsList) {
  return pinnedPnpmCommand(argumentsList);
}

async function runPnpm(label, argumentsList) {
  const {
    command,
    arguments: commandArguments,
    environment,
  } = pnpmProcess(argumentsList);
  const child = spawn(command, commandArguments, {
    cwd: repositoryRoot,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  assert.equal(
    exitCode,
    0,
    `${label} failed. stdout=${stdout} stderr=${stderr}`,
  );
  return stdout;
}

test(
  "two consecutive standalone builds remain runnable from a cold exact package start",
  { timeout: 120_000 },
  async () => {
    const build = ["--filter", "@matchbase/web", "run", "build"];
    const firstBuild = await runPnpm("first standalone build", build);
    assert.match(firstBuild, /Packaged \d+ regular assets/u);
    const secondBuild = await runPnpm("second standalone build", build);
    assert.match(secondBuild, /Packaged \d+ regular assets/u);
    const coldOutput = await runPnpm("cold standalone start", [
      "--filter",
      "@matchbase/web",
      "run",
      "test:standalone",
    ]);
    assert.match(
      coldOutput,
      /exact package start cold-boots the owned standalone HTML, static, and API server/u,
    );
    assert.match(coldOutput, /(?:pass 2|# pass 2)/u);
  },
);
