import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  admissionFixture,
  isolatedCommandEnvironment,
  noEgressPreload,
  pinnedPnpmCommand,
  standaloneFixtureEnvironment,
} from "./standalone-test-support.mjs";

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
  return pinnedPnpmCommand(["--filter", "@matchbase/web", "run", "start"]);
}

test("standalone fixture strips inherited credentials and denies outbound services", () => {
  const environment = standaloneFixtureEnvironment(`sha256:${"a".repeat(64)}`, {
    PATH: process.env.PATH,
    OPENROUTER_API_KEY: "inherited-provider-fixture",
    GOOGLE_APPLICATION_CREDENTIALS: "inherited-cloud-fixture",
    DATABASE_URL: "postgresql://runtime.invalid/live",
    NODE_OPTIONS: "--require=untrusted-fixture",
  });
  assert.equal(environment.OPENROUTER_API_KEY, undefined);
  assert.equal(environment.GOOGLE_APPLICATION_CREDENTIALS, undefined);
  assert.equal(environment.MATCHBASE_OIDC_SIMULATOR, "false");
  assert.equal(environment.MATCHBASE_SYNTHETIC_FIXTURE, "false");
  assert.match(
    environment.DATABASE_URL,
    /127\.0\.0\.1:1\/local_fixture_only$/u,
  );
  assert.doesNotMatch(environment.NODE_OPTIONS, /untrusted/u);
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      noEgressPreload,
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import dgram from "node:dgram";
const denied = /MB-TEST-NO-EGRESS/u;
assert.throws(() => new net.Socket().connect(3000, "127.0.0.1"), denied);
assert.throws(() => tls.connect(443, "example.invalid"), denied);
assert.throws(() => dns.lookup("example.invalid", () => {}), denied);
await assert.rejects(dns.promises.lookup("example.invalid"), denied);
assert.throws(() => new dns.Resolver().resolve4("example.invalid", () => {}), denied);
await assert.rejects(new dns.promises.Resolver().resolve4("example.invalid"), denied);
const socket = dgram.createSocket("udp4");
assert.throws(() => socket.send("fixture", 53, "127.0.0.1"), denied);
socket.close();
await assert.rejects(fetch("https://example.invalid"), denied);
`,
    ],
    { env: isolatedCommandEnvironment(), encoding: "utf8", timeout: 10000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

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
  const helperRoot = join(standaloneWebRoot, "node_modules", "@swc", "helpers");
  assert.equal(
    standaloneRequire.resolve("@swc/helpers/package.json"),
    join(helperRoot, "package.json"),
  );
  // MB-SEC-DEPENDENCIES-001 L04: Node 24 can select the module-sync export.
  assert.ok(
    [
      join(helperRoot, "esm", "_interop_require_default.js"),
      join(helperRoot, "cjs", "_interop_require_default.cjs"),
    ].includes(swcHelperPath),
    `Unexpected standalone helper resolution: ${swcHelperPath}`,
  );
  const helper = standaloneRequire("@swc/helpers/_/_interop_require_default");
  const ordinaryModule = { value: "standalone-fixture" };
  const esModule = { __esModule: true, default: "standalone-fixture" };
  assert.equal(helper._(ordinaryModule).default, ordinaryModule);
  assert.equal(helper._(esModule), esModule);

  const commonJsFallback = spawnSync(
    process.execPath,
    [
      "--no-experimental-require-module",
      "--input-type=module",
      "-e",
      `import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(process.argv[1]);
const helper = require("@swc/helpers/_/_interop_require_default");
const ordinary = { value: "standalone-fixture" };
const esm = { __esModule: true, default: "standalone-fixture" };
assert.equal(helper._(ordinary).default, ordinary);
assert.equal(helper._(esm), esm);
process.stdout.write(require.resolve("@swc/helpers/_/_interop_require_default"));`,
      join(standaloneWebRoot, "package.json"),
    ],
    {
      env: isolatedCommandEnvironment(),
      encoding: "utf8",
      timeout: 10000,
      shell: false,
    },
  );
  assert.equal(commonJsFallback.error, undefined);
  assert.equal(commonJsFallback.signal, null);
  assert.equal(commonJsFallback.status, 0, commonJsFallback.stderr);
  assert.equal(
    commonJsFallback.stdout,
    join(helperRoot, "cjs", "_interop_require_default.cjs"),
  );
  assert.match(
    commonJsFallback.stdout,
    /@swc[\\/]helpers[\\/]cjs[\\/]_interop_require_default\.cjs$/u,
  );

  const { command, arguments: commandArguments } = exactStartCommand();
  const deploymentId = `sha256:${createHash("sha256").update(`standalone-cold-owned-${process.pid}-${Date.now()}`).digest("hex")}`;
  const child = spawn(command, commandArguments, {
    cwd: repositoryRoot,
    env: standaloneFixtureEnvironment(deploymentId),
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
  assert.equal(pageResponse.status, 200, stderr.slice(0, 4000));
  const html = await pageResponse.text();
  assert.match(html, /MatchBASE/);
  assert.doesNotMatch(html, /\/auth\/simulator/u);
  const assetPath = html.match(
    /(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/u,
  )?.[1];
  assert.ok(assetPath, "standalone HTML omitted its static asset reference");
  assert.equal(
    (await fetch(new URL(assetPath, `http://${host}:${port}`))).status,
    200,
  );
  const healthUrl = `http://${host}:${port}/api/v1/health`;
  assert.equal((await fetch(healthUrl)).status, 403);
  const health = await fetch(healthUrl, {
    headers: { "mb-origin-admission": admissionFixture },
  });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("mb-deployment-id"), deploymentId);
  assert.deepEqual(await health.json(), { status: "ok" });
  assert.equal(child.exitCode, null);
  assert.equal(isProcessAlive(runtimeProcessId), true);
});
