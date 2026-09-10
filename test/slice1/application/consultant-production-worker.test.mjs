import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  assertConsultantWorkerConfiguration,
  consultantWorkflowQueueIsReady,
} from "../../../packages/application/dist/consultant-worker-runtime.js";

test("MB-UX-PILOT-001 L01 production Consultant configuration fails closed without network calls", (t) => {
  const names = [
    "MATCHBASE_OPENROUTER_API_KEY",
    "OPENROUTER_API_KEY",
    "MATCHBASE_PROVIDER_ROUTES",
    "MATCHBASE_PROVIDER_GOOGLE",
    "MATCHBASE_PROVIDER_OPENAI",
    "MATCHBASE_MODEL_GEMINI",
    "MATCHBASE_MODEL_OPENAI",
    "MATCHBASE_MODEL_PREPARATION",
    "MATCHBASE_MODEL_SYNTHESIS",
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of previous)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  });
  for (const name of names) delete process.env[name];
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Configuration checks must not invoke a provider.");
  });
  assert.throws(assertConsultantWorkerConfiguration, /credential/);
  process.env.MATCHBASE_OPENROUTER_API_KEY = randomUUID();
  assert.throws(assertConsultantWorkerConfiguration, /provider route/);
  process.env.MATCHBASE_PROVIDER_GOOGLE = "google-ai-studio";
  process.env.MATCHBASE_PROVIDER_OPENAI = "openai";
  assert.doesNotThrow(assertConsultantWorkerConfiguration);
  process.env.MATCHBASE_MODEL_GEMINI = "openai/gpt-5.2";
  assert.throws(
    assertConsultantWorkerConfiguration,
    /separate Gemini and OpenAI/,
  );
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("Consultant queue readiness refuses absent grants, absent columns, and unavailable databases", async () => {
  const queries = [];
  const database = {
    async query(sql) {
      queries.push(sql);
      return { rows: [{ ready: true }] };
    },
  };
  assert.equal(await consultantWorkflowQueueIsReady(database), true);
  // PostgreSQL's comma-separated privilege list means ANY privilege, not ALL.
  assert.match(queries[0], /'consultant_workflow_job', 'SELECT'/);
  assert.match(queries[0], /'consultant_workflow_job', 'UPDATE'/);
  assert.doesNotMatch(queries[0], /'SELECT,UPDATE'/);
  assert.match(queries[1], /lease_token, lease_until.*LIMIT 0/);
  assert.equal(
    await consultantWorkflowQueueIsReady({
      async query() {
        return { rows: [{ ready: false }] };
      },
    }),
    false,
  );
  for (const failedQuery of [1, 2]) {
    let count = 0;
    assert.equal(
      await consultantWorkflowQueueIsReady({
        async query() {
          if (++count === failedQuery) throw new Error("database unavailable");
          return { rows: [{ ready: true }] };
        },
      }),
      false,
    );
  }
});

test("production image worker consumes the Consultant queue and preserves legacy research and PDF jobs", async () => {
  const worker = await readFile(
    new URL(
      "../../../packages/application/src/combined-worker.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const docker = await readFile(
    new URL("../../../Dockerfile", import.meta.url),
    "utf8",
  );
  assert.match(docker, /CMD \["node", "dist\/combined-worker\.js"\]/);
  assert.match(
    worker,
    /consultantWorkflowEnabled = environment === "production"/,
  );
  assert.match(
    worker,
    /if \(consultantWorkflowEnabled\) assertConsultantWorkerConfiguration\(\)/,
  );
  assert.ok(
    worker.indexOf("await consultantWorkflowQueueIsReady(pool)") <
      worker.indexOf("readiness.markReady()"),
  );
  assert.match(
    worker,
    /if \(consultantWorkflowEnabled\) await runNextConsultantWorkflowJob\(pool\)/,
  );
  assert.match(worker, /await liveDispatcher.dispatchNext/);
  assert.match(worker, /await executeNextConsultantPdfRenderJob/);
  assert.match(docker, /import\('\.\/dist\/consultant-workflow-worker\.js'\)/);
});
