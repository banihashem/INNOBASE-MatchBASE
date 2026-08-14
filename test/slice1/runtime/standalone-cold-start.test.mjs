import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const standaloneWebRoot = join(
  repositoryRoot,
  "apps",
  "web",
  ".next",
  "standalone",
  "apps",
  "web",
);
const host = "127.0.0.1";
const port = 3010;

async function provePortFree() {
  const reservation = createServer();
  await new Promise((resolveListen, reject) => {
    reservation.once("error", reject);
    reservation.listen(port, host, () => {
      reservation.off("error", reject);
      resolveListen();
    });
  });
  await new Promise((resolveClose, reject) =>
    reservation.close((error) => (error ? reject(error) : resolveClose())),
  );
}

function isProcessAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(child, timeoutMilliseconds) {
  if (child.exitCode !== null) return child.exitCode;
  return new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      reject(new Error("Owned standalone command did not exit in time"));
    }, timeoutMilliseconds);
    function onExit(code) {
      clearTimeout(timeout);
      resolveExit(code);
    }
    child.once("exit", onExit);
  });
}

function exactStartCommand() {
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
      arguments: ["/d", "/s", "/c", "pnpm --filter @matchbase/web start"],
    };
  }
  return {
    command: "pnpm",
    arguments: ["--filter", "@matchbase/web", "start"],
  };
}

test("exact package start cold-boots the owned standalone HTML, static, and API server", async (t) => {
  await provePortFree();
  const manifest = JSON.parse(
    await readFile(join(standaloneWebRoot, ".standalone-assets.json"), "utf8"),
  );
  assert.equal(manifest.runtimePackages.includes("@swc/helpers"), true);
  for (const asset of manifest.files) {
    const bytes = await readFile(
      join(standaloneWebRoot, ...asset.path.split("/")),
    );
    assert.equal(bytes.byteLength, asset.size);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      asset.sha256,
    );
  }
  const standaloneRequire = createRequire(
    join(standaloneWebRoot, "package.json"),
  );
  const swcHelperPath = standaloneRequire.resolve(
    "@swc/helpers/_/_interop_require_default",
  );
  assert.match(
    swcHelperPath,
    /@swc[\\/]helpers[\\/]cjs[\\/]_interop_require_default\.cjs$/u,
  );

  const { command, arguments: commandArguments } = exactStartCommand();
  const deploymentId = `standalone-cold-owned-${process.pid}-${Date.now()}`;
  const child = spawn(command, commandArguments, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      DATABASE_URL:
        "postgresql://fixture:fixture@127.0.0.1:1/local_fixture_only",
      MATCHBASE_ENVIRONMENT: "test",
      MATCHBASE_OIDC_SIMULATOR: "true",
      MATCHBASE_SYNTHETIC_FIXTURE: "true",
      MATCHBASE_ORIGIN: "http://127.0.0.1:3010",
      MATCHBASE_DIGEST_KEY: "local-synthetic-digest-key-32-bytes-minimum",
      MATCHBASE_DEPLOYMENT_ID: deploymentId,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  let runtimeProcessId;
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    const match = stdout.match(/MatchBASE standalone runtime pid=(\d+)/u);
    if (match) runtimeProcessId = Number(match[1]);
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(async () => {
    if (runtimeProcessId && isProcessAlive(runtimeProcessId)) {
      process.kill(runtimeProcessId, "SIGTERM");
    }
    try {
      await waitForExit(child, 5_000);
    } catch (error) {
      if (child.exitCode === null) child.kill("SIGTERM");
      throw error;
    }
    assert.equal(isProcessAlive(runtimeProcessId), false);
    await provePortFree();
  });

  const deadline = Date.now() + 15_000;
  let pageResponse;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Exact package start exited ${child.exitCode}. stdout=${stdout} stderr=${stderr}`,
      );
    }
    try {
      pageResponse = await fetch(`http://${host}:${port}/`);
      if (pageResponse.status === 200 && runtimeProcessId) break;
    } catch {
      // The cold server has not bound yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }

  assert.ok(runtimeProcessId, "starter did not identify its runtime process");
  assert.ok(pageResponse, "standalone page did not become reachable");
  assert.equal(pageResponse.status, 200);
  const html = await pageResponse.text();
  assert.match(html, /MatchBASE/);
  const assetPath = html.match(
    /(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/u,
  )?.[1];
  assert.ok(assetPath, "standalone HTML omitted its static asset reference");
  assert.equal(
    (await fetch(new URL(assetPath, `http://${host}:${port}`))).status,
    200,
  );
  const health = await fetch(`http://${host}:${port}/api/v1/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("mb-deployment-id"), deploymentId);
  assert.deepEqual(await health.json(), { status: "ok" });
  assert.equal(child.exitCode, null);
  assert.equal(isProcessAlive(runtimeProcessId), true);
});
