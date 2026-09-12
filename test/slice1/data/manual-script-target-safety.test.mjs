import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  resolveScriptDatabaseUrl,
  resolveScriptTestTargets,
} from "../../../scripts/lib/database-config.mjs";

const disposable = "postgresql://postgres@127.0.0.1:54329/matchbase_test";
const isolatedHttp = "http://127.0.0.1:43119";
const safe = {
  DATABASE_URL: disposable,
  MATCHBASE_DISPOSABLE_TEST_DATABASE_URL: disposable,
  MATCHBASE_DISPOSABLE_TEST_BASE_URL: isolatedHttp,
};
const root = new URL("../../../", import.meta.url);
const scripts = readdirSync(new URL("scripts/", root)).filter((name) => {
  if (!/^test-.*\.mjs$/u.test(name)) return false;
  return /\bfetch\(/u.test(
    readFileSync(new URL(`scripts/${name}`, root), "utf8"),
  );
});

test("MB-UX-QUALITY-001 L06 DB-only manual test scripts also enter the disposable guard", () => {
  const databaseUrl = "postgresql://postgres@127.0.0.1:55433/matchbase_slice1";
  for (const script of [
    "/repo/scripts/test-db.mjs",
    "C:\\repo\\scripts\\test-db.mjs",
    "/repo/test/db.test.mjs",
  ]) {
    assert.throws(
      () =>
        resolveScriptDatabaseUrl({ DATABASE_URL: databaseUrl }, [
          "node",
          script,
        ]),
      /Unsafe test database refused before connection/u,
    );
    assert.equal(resolveScriptDatabaseUrl(safe, ["node", script]), disposable);
  }
  assert.equal(
    resolveScriptDatabaseUrl({ DATABASE_URL: databaseUrl }, [
      "node",
      "/repo/scripts/runtime-operation.mjs",
    ]),
    databaseUrl,
  );
});

test("MB-UX-QUALITY-001 L06 manual script targets require disposable database ownership before HTTP", () => {
  for (const environment of [
    {},
    { ...safe, MATCHBASE_DISPOSABLE_TEST_DATABASE_URL: undefined },
    {
      ...safe,
      DATABASE_URL: "postgresql://postgres@127.0.0.1:55433/matchbase_slice1",
    },
    {
      ...safe,
      MATCHBASE_DATABASE_URL:
        "postgresql://postgres@127.0.0.1:55433/matchbase_slice1",
    },
    {
      ...safe,
      MATCHBASE_CONSULTANT_TEST_DATABASE_URL:
        "postgresql://postgres@127.0.0.1:55433/matchbase_slice1",
    },
    { ...safe, DATABASE_URL: disposable.replace("54329", "55433") },
    { ...safe, DATABASE_URL: `${disposable}?host=remote.invalid` },
  ]) {
    let requested = false;
    assert.throws(
      () =>
        resolveScriptTestTargets(environment, () => {
          requested = true;
        }),
      /Database configuration missing|Unsafe test database refused before connection/u,
    );
    assert.equal(requested, false);
  }
});

test("MB-UX-QUALITY-001 L06 manual HTTP tests never infer the running product as their target", () => {
  for (const value of [
    undefined,
    "",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://[::1]:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1",
    "http://remote.invalid:43119",
    "http://127.0.0.1.remote.invalid:43119",
    "http://192.168.50.10:3000",
    "https://127.0.0.1:43119",
    `${isolatedHttp}/api`,
    `${isolatedHttp}?target=runtime`,
    `${isolatedHttp}#runtime`,
    "http://fixture@127.0.0.1:43119",
  ]) {
    assert.throws(
      () =>
        resolveScriptTestTargets({
          ...safe,
          MATCHBASE_DISPOSABLE_TEST_BASE_URL: value,
        }),
      /Unsafe test HTTP target refused before request/u,
    );
  }
  for (const value of ["http://127.0.0.1:3000", "http://127.0.0.1:43120"]) {
    assert.throws(
      () => resolveScriptTestTargets({ ...safe, BASE_URL: value }),
      /Unsafe test HTTP target refused before request/u,
    );
  }
});

test("MB-UX-QUALITY-001 L06 guarded requests stay on the explicitly owned origin and do not follow redirects", async () => {
  const calls = [];
  const targets = resolveScriptTestTargets(
    { ...safe, BASE_URL: `${isolatedHttp}/` },
    async (...args) => {
      calls.push(args);
      return { status: 200 };
    },
  );
  assert.equal(targets.databaseUrl, disposable);
  assert.equal(targets.baseUrl, isolatedHttp);
  assert.equal(calls.length, 0);
  assert.equal(
    (
      await targets.fetch(`${isolatedHttp}/api/v1/consultant/workflow`, {
        method: "POST",
        redirect: "follow",
        body: "fixture",
      })
    ).status,
    200,
  );
  assert.equal(calls[0][1].redirect, "manual");
  assert.equal(calls[0][1].body, "fixture");
  for (const target of [
    "http://127.0.0.1:3000/",
    "http://remote.invalid/",
    "invalid",
    "http://fixture@127.0.0.1:43119/",
  ]) {
    assert.throws(
      () => targets.fetch(target),
      /Unsafe test HTTP target refused/u,
    );
  }
  assert.equal(calls.length, 1);
});

test("MB-UX-QUALITY-001 L06 all manual HTTP test entrypoints use the target guard before their first request", () => {
  assert.ok(scripts.includes("test-consultant-v3-draft-isolation.mjs"));
  assert.ok(scripts.includes("test-consultant-v3-draft-concurrency.mjs"));
  for (const name of scripts) {
    const source = readFileSync(new URL(`scripts/${name}`, root), "utf8");
    assert.match(
      source,
      /\bfetch,?\s*\}\s*=\s*resolveScriptTestTargets\(\)/u,
      name,
    );
    assert.ok(
      source.indexOf("resolveScriptTestTargets();") < source.indexOf("fetch("),
      name,
    );
    assert.doesNotMatch(source, /process\.env\.BASE_URL\s*\|\|/u, name);
    if (source.includes("chromium.launch(")) {
      assert.match(source, /await createBrowserContext\(browser\)/u, name);
      assert.doesNotMatch(source, /browser\.newContext\(/u, name);
    }
  }
});

test("MB-UX-QUALITY-001 L06 browser tests block foreign resources and redirects before following them", async () => {
  let routeHandler;
  let socketHandler;
  let contextOptions;
  const context = {
    route: async (pattern, handler) => {
      assert.equal(pattern, "**/*");
      routeHandler = handler;
    },
    routeWebSocket: async (pattern, handler) => {
      assert.equal(pattern, "**/*");
      socketHandler = handler;
    },
  };
  const targets = resolveScriptTestTargets(safe);
  assert.equal(
    await targets.createBrowserContext({
      newContext: async (options) => {
        contextOptions = options;
        return context;
      },
    }),
    context,
  );
  assert.deepEqual(contextOptions, { serviceWorkers: "block" });
  for (const [requestUrl, status, location, expected] of [
    ["http://127.0.0.1:3000/auth", 200, undefined, "abort"],
    ["http://remote.invalid/script.js", 200, undefined, "abort"],
    [
      `${isolatedHttp}/auth/start`,
      302,
      "http://127.0.0.1:3000/auth/callback",
      "abort",
    ],
    [`${isolatedHttp}/auth/start`, 302, "//remote.invalid/auth", "abort"],
    [`${isolatedHttp}/auth/start`, 302, "/auth/callback", "fulfill"],
    [`${isolatedHttp}/app.js`, 200, undefined, "fulfill"],
  ]) {
    const actions = [];
    let fetched = false;
    const response = { status: () => status, headers: () => ({ location }) };
    await routeHandler({
      request: () => ({ url: () => requestUrl }),
      fetch: async (options) => {
        assert.deepEqual(options, { maxRedirects: 0 });
        fetched = true;
        return response;
      },
      abort: async (reason) => {
        assert.equal(reason, "blockedbyclient");
        actions.push("abort");
      },
      fulfill: async (options) => {
        assert.equal(options.response, response);
        actions.push("fulfill");
      },
    });
    assert.deepEqual(actions, [expected]);
    assert.equal(fetched, requestUrl.startsWith(isolatedHttp));
  }
  let socketClosed = false;
  socketHandler({
    close: () => {
      socketClosed = true;
    },
  });
  assert.equal(socketClosed, true);
});

test("MB-UX-QUALITY-001 L06 actual manual entrypoints refuse inherited runtime targets before database or network access", () => {
  for (const name of scripts) {
    for (const unsafe of [
      {
        ...safe,
        DATABASE_URL: "postgresql://postgres@127.0.0.1:55433/matchbase_slice1",
      },
      { ...safe, BASE_URL: "http://127.0.0.1:3000" },
      {
        ...safe,
        MATCHBASE_DISPOSABLE_TEST_BASE_URL: undefined,
        BASE_URL: isolatedHttp,
      },
    ]) {
      const script = new URL(`scripts/${name}`, root).href;
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
        import net from 'node:net';
        import tls from 'node:tls';
        const refuseIO = () => { throw new Error('UNEXPECTED_NETWORK_OR_DATABASE_ACCESS'); };
        globalThis.fetch = refuseIO;
        net.Socket.prototype.connect = refuseIO;
        tls.connect = refuseIO;
        await import(${JSON.stringify(script)});
      `,
        ],
        {
          cwd: fileURLToPath(root),
          env: {
            PATH: process.env.PATH ?? "",
            SystemRoot: process.env.SystemRoot ?? "",
            ...unsafe,
          },
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      assert.equal(result.error, undefined, name);
      assert.equal(result.status, 1, name);
      assert.match(
        result.stderr,
        /Unsafe test (?:database|HTTP target) refused/u,
        name,
      );
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /UNEXPECTED_NETWORK_OR_DATABASE_ACCESS|postgres(?:ql)?:\/\//u,
        name,
      );
    }
  }
});
