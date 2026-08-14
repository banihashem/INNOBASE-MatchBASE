import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  probeDatabaseReadiness,
  WorkerReadiness,
} from "../../../packages/application/dist/index.js";

const workerUrl = new URL(
  "../../../packages/application/dist/synthetic-worker.js",
  import.meta.url,
);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function waitForNotReady(child) {
  const deadline = Date.now() + 3_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Worker exited before health check with ${child.exitCode}`,
      );
    }
    try {
      const response = await fetch("http://127.0.0.1:3011/health");
      const body = await response.json();
      assert.equal(response.status, 503);
      assert.equal(body.status, "not_ready");
      return body;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastError ?? new Error("Worker health endpoint did not start");
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  try {
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Worker did not stop in time")),
          3_000,
        ),
      ),
    ]);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
}

function spawnWorker(databaseUrl, environmentOverrides = {}) {
  return spawn(process.execPath, [fileURLToPath(workerUrl)], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      MATCHBASE_ENVIRONMENT: "test",
      MATCHBASE_SYNTHETIC_FIXTURE: "true",
      MATCHBASE_DIGEST_KEY: "local-synthetic-digest-key-32-bytes-minimum",
      MATCHBASE_WORKER_DB_PROBE_TIMEOUT_MS: "150",
      MATCHBASE_WORKER_HEALTH_PORT: "3011",
      ...environmentOverrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("worker rejects every health port except 3011", async () => {
  const child = spawnWorker(
    "postgresql://fixture:fixture@127.0.0.1:1/fixture",
    { MATCHBASE_WORKER_HEALTH_PORT: "3012" },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /health port must be exactly 3011/);
});

test("readiness starts closed, opens only after a successful bounded probe, and closes on failures and shutdown", async () => {
  const readiness = new WorkerReadiness();
  assert.deepEqual(readiness.snapshot(), {
    status: "not_ready",
    reason: "startup_probe_pending",
  });

  let resolveProbe;
  const pendingDatabase = {
    query: () =>
      new Promise((resolve) => {
        resolveProbe = resolve;
      }),
  };
  const pending = probeDatabaseReadiness(pendingDatabase, readiness, 500);
  assert.equal(readiness.snapshot().status, "not_ready");
  resolveProbe({ rows: [{ readiness_probe: 1 }] });
  assert.equal(await pending, true);
  assert.deepEqual(readiness.snapshot(), { status: "ready", reason: null });

  assert.equal(
    await probeDatabaseReadiness(
      { query: async () => Promise.reject(new Error("refused")) },
      readiness,
      500,
    ),
    false,
  );
  assert.equal(readiness.snapshot().reason, "database_probe_failed");

  const startedAt = Date.now();
  assert.equal(
    await probeDatabaseReadiness(
      { query: () => new Promise(() => {}) },
      readiness,
      100,
    ),
    false,
  );
  assert.ok(Date.now() - startedAt >= 90);
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(readiness.snapshot().reason, "database_probe_timeout");

  readiness.markUnready("shutdown");
  assert.deepEqual(readiness.snapshot(), {
    status: "not_ready",
    reason: "shutdown",
  });
});

test("worker health remains not-ready for a refused local database", async () => {
  const reservation = createServer();
  const address = await listen(reservation);
  const refusedPort = address.port;
  await close(reservation);

  const child = spawnWorker(
    `postgresql://fixture:fixture@127.0.0.1:${refusedPort}/fixture`,
  );
  try {
    const health = await waitForNotReady(child);
    assert.ok(
      ["startup_probe_pending", "database_probe_failed"].includes(
        health.reason,
      ),
    );
  } finally {
    await stopChild(child);
  }
});

test("worker health becomes not-ready after a bounded local database blackhole", async () => {
  const sockets = new Set();
  const blackhole = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const address = await listen(blackhole);
  const child = spawnWorker(
    `postgresql://fixture:fixture@127.0.0.1:${address.port}/fixture`,
  );
  try {
    await waitForNotReady(child);
    const deadline = Date.now() + 2_000;
    let health;
    do {
      const response = await fetch("http://127.0.0.1:3011/health");
      health = await response.json();
      if (health.reason === "database_probe_timeout") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    assert.equal(health.reason, "database_probe_timeout");
  } finally {
    await stopChild(child);
    for (const socket of sockets) socket.destroy();
    await close(blackhole);
  }
});
