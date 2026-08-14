import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

function pnpmProcess(argumentsList) {
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
      arguments: ["/d", "/s", "/c", `pnpm ${argumentsList.join(" ")}`],
    };
  }
  return { command: "pnpm", arguments: argumentsList };
}

async function runPnpm(label, argumentsList) {
  const { command, arguments: commandArguments } = pnpmProcess(argumentsList);
  const child = spawn(command, commandArguments, {
    cwd: repositoryRoot,
    env: process.env,
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
}

test(
  "two consecutive standalone builds remain runnable from a cold exact package start",
  { timeout: 120_000 },
  async () => {
    const build = ["--filter", "@matchbase/web", "build"];
    await runPnpm("first standalone build", build);
    await runPnpm("second standalone build", build);
    await runPnpm("cold standalone start", [
      "--filter",
      "@matchbase/web",
      "test:standalone",
    ]);
  },
);
