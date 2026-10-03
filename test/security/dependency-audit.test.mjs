import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  classifyAudit,
  isolatedEnvironment,
  mitigation,
  parseAudit,
  regularFile,
  runAuditGate,
  verifyInstalledPins,
  verifyInstalledLock,
  verifyRegressionResult,
  verifySourcePins,
  verifyWorkspaceManifestInventory,
} from "../../scripts/dependency-audit.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function report() {
  return {
    advisories: {
      1240992: {
        module_name: "braces",
        github_advisory_id: mitigation.advisory,
        url: `https://github.com/advisories/${mitigation.advisory}`,
        vulnerable_versions: "<=3.0.3",
        severity: "high",
        findings: [
          {
            version: "3.0.3",
            dev: true,
            optional: false,
            bundled: false,
            paths: [...mitigation.paths],
          },
        ],
      },
    },
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 },
    },
  };
}
const result = (value = report()) => ({
  status: 1,
  stdout: JSON.stringify(value),
});
const current = Date.parse("2026-10-03T12:00:00Z");
function temporary(t) {
  const base = resolve(root, ".artifacts/security-gate-tests");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(resolve(base, "case-"));
  t.after(() => {
    assert.ok(directory.startsWith(`${base}${sep}`));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test("only the exact unexpired development finding is eligible for mitigation", () => {
  assert.deepEqual(classifyAudit(parseAudit(result()), current), {
    mitigated: true,
    findings: 1,
  });
  for (const mutate of [
    (a) => {
      a.module_name = "other";
    },
    (a) => {
      a.github_advisory_id = "GHSA-new-advisory";
    },
    (a) => {
      a.severity = "critical";
    },
    (a) => {
      a.vulnerable_versions = "<=3.0.4";
    },
    (a) => {
      a.findings[0].version = "3.0.4";
    },
    (a) => {
      a.findings[0].dev = false;
    },
    (a) => {
      delete a.findings[0].dev;
    },
    (a) => {
      a.findings[0].optional = true;
    },
    (a) => {
      a.findings[0].paths.push("apps__web>braces");
    },
    (a) => {
      a.findings[0].paths.pop();
    },
    (a) => {
      a.findings[0].paths[0] = a.findings[0].paths[1];
    },
    (a) => {
      a.findings.push(structuredClone(a.findings[0]));
    },
  ]) {
    const value = report();
    mutate(value.advisories["1240992"]);
    assert.throws(() => classifyAudit(value, current));
  }
  for (const date of [
    NaN,
    Date.parse("2026-10-02"),
    Date.parse(mitigation.expires),
  ]) {
    assert.throws(() => classifyAudit(report(), date), /expired|clock/u);
  }
  const unknown = report();
  unknown.advisories.other = {
    ...unknown.advisories["1240992"],
    github_advisory_id: "GHSA-new",
  };
  assert.throws(() => classifyAudit(unknown, current), /Unmitigated/u);
});

test("transport failures, incomplete JSON, hidden findings, and exit disagreement fail closed", () => {
  for (const broken of [
    { ...result(), error: new Error("timeout") },
    { ...result(), signal: "SIGTERM" },
    { ...result(), status: null },
    { ...result(), status: 2 },
    { ...result(), status: 0 },
    { status: 1, stdout: "{" },
    { status: 1, stdout: '{"error":"offline"}' },
    { status: 0, stdout: "{}" },
  ])
    assert.throws(() => parseAudit(broken));
  const hidden = report();
  hidden.metadata.vulnerabilities.high += 1;
  assert.throws(() => parseAudit(result(hidden)), /counts disagree/u);
  hidden.metadata.vulnerabilities.high = 1;
  delete hidden.advisories["1240992"].findings;
  assert.throws(() => parseAudit(result(hidden)), /Malformed/u);
});

test("lower findings stay visible while preserving the High/Critical acceptance threshold", () => {
  const low = report();
  low.advisories["1240992"].severity = "moderate";
  low.advisories["1240992"].github_advisory_id = "GHSA-other";
  low.metadata.vulnerabilities.high = 0;
  low.metadata.vulnerabilities.moderate = 1;
  assert.deepEqual(classifyAudit(parseAudit(result(low)), current), {
    mitigated: false,
    findings: 1,
  });
  const empty = {
    advisories: {},
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
    },
  };
  assert.equal(
    classifyAudit(
      parseAudit({ status: 0, stdout: JSON.stringify(empty) }),
      current,
    ).findings,
    0,
  );
});

test("raw audit executes first, prints complete findings and cannot suppress transport failures", () => {
  const output = [];
  const calls = [];
  assert.throws(
    () =>
      runAuditGate(root, "/reviewed/pnpm.cjs", {
        now: current,
        output: (value) => output.push(value),
        run: (command, args, options) => {
          calls.push({ command, args, options });
          return {
            status: null,
            error: new Error("offline"),
            stdout: "raw transport response",
          };
        },
      }),
    /failed or timed out/u,
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes("audit"));
  assert.ok(calls[0].args.includes("--json"));
  assert.ok(calls[0].args.includes("--ignore-scripts"));
  assert.ok(calls[0].args.includes("--ignore-pnpmfile"));
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.timeout, 120000);
  assert.match(output.join(""), /raw transport response/u);
});

test("source pins require matching tracked Git blobs, not only plausible working files", (t) => {
  const directory = temporary(t);
  const runGit = (...args) => {
    const execution = spawnSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
      env: isolatedEnvironment(),
      shell: false,
    });
    assert.equal(execution.status, 0, execution.stderr);
  };
  runGit("init", "--quiet");
  writeFileSync(resolve(directory, ".gitattributes"), "* text eol=lf\n");
  writeFileSync(resolve(directory, "patch.txt"), "qualified\n");
  const pins = { "patch.txt": hash("qualified\n") };
  assert.throws(() => verifySourcePins(directory, pins), /tracked index/u);
  runGit("add", "patch.txt", ".gitattributes");
  verifySourcePins(directory, pins);
  writeFileSync(resolve(directory, "patch.txt"), "qualified\r\n");
  verifySourcePins(directory, pins);
  writeFileSync(resolve(directory, "patch.txt"), "tampered\n");
  assert.throws(() => verifySourcePins(directory, pins), /source changed/u);
  assert.throws(
    () => verifySourcePins(directory, { "patch.txt": hash("tampered\n") }),
    /index does not bind/u,
  );
  assert.throws(() => verifySourcePins(directory, {}), /not qualified/u);
});

test("installed-source pins reject tamper, extra code, absent files, and unsafe paths", (t) => {
  const directory = temporary(t);
  writeFileSync(resolve(directory, "index.js"), "qualified\n");
  const pins = { "index.js": hash("qualified\n") };
  verifyInstalledPins(directory, pins);
  assert.throws(() => regularFile(directory, "../escape"), /escapes/u);
  assert.throws(
    () => regularFile(directory, resolve(directory, "index.js")),
    /Unsafe/u,
  );
  writeFileSync(resolve(directory, "index.js"), "unpatched\n");
  assert.throws(() => verifyInstalledPins(directory, pins), /source changed/u);
  writeFileSync(resolve(directory, "extra.js"), "extra\n");
  assert.throws(
    () => verifyInstalledPins(directory, pins),
    /inventory changed/u,
  );
  assert.throws(() => verifyInstalledPins(directory, {}), /not qualified/u);
  assert.throws(() => verifyInstalledPins(resolve(directory, "missing"), pins));
});

test("directory symlinks cannot substitute qualified files", (t) => {
  const directory = temporary(t);
  const actual = resolve(directory, "actual");
  mkdirSync(actual);
  writeFileSync(resolve(actual, "code.js"), "test\n");
  symlinkSync(
    actual,
    resolve(directory, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => regularFile(directory, "link/code.js"), /Symlink/u);
});

test("new workspace manifests cannot evade the frozen dependency graph", (t) => {
  const directory = temporary(t);
  mkdirSync(resolve(directory, "apps"));
  mkdirSync(resolve(directory, "packages"));
  verifyWorkspaceManifestInventory(directory, { "package.json": "fixture" });
  mkdirSync(resolve(directory, "apps/new"));
  writeFileSync(resolve(directory, "apps/new/package.json"), "{}\n");
  assert.throws(
    () =>
      verifyWorkspaceManifestInventory(directory, {
        "package.json": "fixture",
      }),
    /inventory changed/u,
  );
});

test("only the two pinned lock serializations qualify, while graph drift fails", () => {
  const source = 'lockfileVersion: "9.0"\npackages:\n  braces@3.0.3: {}\n';
  const native = "lockfileVersion: '9.0'\n\npackages:\n\n  braces@3.0.3: {}\n";
  const pins = { source: hash(source), installed: hash(native) };
  verifyInstalledLock(Buffer.from(source), pins);
  verifyInstalledLock(Buffer.from(native), pins);
  verifyInstalledLock(Buffer.from(native.replace(/\n/gu, "\r\n")), pins);
  for (const serialization of [source, native]) {
    assert.throws(
      () =>
        verifyInstalledLock(
          Buffer.from(serialization.replace("braces@3.0.3", "braces@3.0.2")),
          pins,
        ),
      /stale/u,
    );
    assert.throws(
      () =>
        verifyInstalledLock(
          Buffer.from(`${serialization}  unreviewed@1.0.0: {}\n`),
          pins,
        ),
      /stale/u,
    );
  }
  assert.throws(
    () =>
      verifyInstalledLock(Buffer.from(native), {
        source: pins.source,
        installed: "",
      }),
    /not qualified/u,
  );
  assert.throws(
    () => verifyInstalledLock(Buffer.from(`${native}\n`), pins),
    /stale/u,
  );
});

test("regression timeout, signal, and nonzero status cannot qualify mitigation", () => {
  verifyRegressionResult({ status: 0 });
  for (const broken of [
    { status: 1 },
    { status: null },
    { status: 0, signal: "SIGTERM" },
    { status: 0, error: new Error("timeout") },
  ]) {
    assert.throws(() => verifyRegressionResult(broken), /failed or timed out/u);
  }
});

test("child processes inherit no provider, database, Node injection, or audit-ignore settings", () => {
  assert.deepEqual(
    isolatedEnvironment({
      PATH: "bin",
      TEMP: "temp",
      MATCHBASE_OPENROUTER_API_KEY: "fixture",
      DATABASE_URL: "fixture",
      AWS_SECRET_ACCESS_KEY: "fixture",
      NODE_OPTIONS: "--require unsafe.js",
      npm_config_audit_level: "critical",
      npm_config_ignore_advisories: "all",
    }),
    { PATH: "bin", TEMP: "temp" },
  );
});
