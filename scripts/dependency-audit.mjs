// MB-SEC-DEPENDENCIES-001 L01: a temporary, evidence-bound mitigation gate.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const mitigation = Object.freeze({
  advisory: "GHSA-vfj7-8cjw-p6xm",
  version: "3.0.3",
  expires: "2026-10-17T00:00:00.000Z",
  paths: Object.freeze([
    "apps__web>tailwindcss>chokidar>braces",
    "apps__web>tailwindcss>fast-glob>micromatch>braces",
    "apps__web>tailwindcss>micromatch>braces",
  ]),
});

// Immutable review inputs. Changes require a new review, never an environment override.
export const sourcePins = Object.freeze({
  ".gitattributes":
    "46a8595eebc71f2b069459f4a91418b8fe37861de4f2d33d55790221e4e77f9f",
  ".npmrc": "12a6922c64f54920e90f12b4208627df1c65f98a512930dde309518fb1dbb809",
  "apps/dashboard/package.json":
    "46a021ef1ca3b56a0f452401457243399824bdf3dcfeeeda4a2ccc6332563def",
  "apps/web/package.json":
    "58b7743621b55b390e9df62be4a3ed86c87d4675e7f967df6948d994d38c623e",
  "package.json":
    "193222bb063d7f19e6403747a14bc90ac47aef9331d54cf9fb91480510395d62",
  "packages/ai-evidence/package.json":
    "59982a3674987c21152f0c97870a99da8de507bd87b00f0106406abace6a7196",
  "packages/application/package.json":
    "97a6291e61dfaf750fb241b19533b36645d03fba6ef537b55a81148c9ed6efab",
  "packages/artifact-indexer/package.json":
    "70b3b68f6b160e48d57c9b3c7def15d78f3c494659f8cb486307aba476408f45",
  "packages/auth/package.json":
    "8daf65e57985f7b3999a55be6c893a6da4fe83e6fa39578fed89d39fddc2916f",
  "packages/contracts/package.json":
    "ca99120b0b2ddf70ee5030ca176a0f2cd5e58866cf2ba7ead5445219ae491fce",
  "packages/data/package.json":
    "3bd3158df17ea259e6a611983fd9c3898ef50c7ccfaaa3c87854579901168453",
  "packages/reporting/package.json":
    "0b57810fd11633ca49644f8f811d3802bbaeca5c487b1fa2d806dd49131fbaf8",
  "packages/security/package.json":
    "5fb38c19587a5f827de8cde9156867fe68672e6f2946040927a13e5a7f5e5308",
  "patches/braces@3.0.3.patch":
    "2e009478d42176867620d40a15ba687ee53b283df866152f5ed2ed4f9fd2580f",
  "pnpm-lock.yaml":
    "72ca6d86db8c5be46d5d390c11511aaa4348bdfc3843082464b1636c0c0da551",
  "pnpm-workspace.yaml":
    "8cf568fc77014da46027d31f59d2468461df6594af3a34e30f0d0ba9b2497fbc",
  "test/security/braces-patch.test.mjs":
    "cd62e1ee53d1317647a5edee6e0f0154ffd75870d6e358295e94c6216b502840",
});
export const installedPins = Object.freeze({
  "index.js":
    "332ea07c7b006361aad12aa994ca75dc1db8e8382b884909e2f38f10b85c88a4",
  "lib/compile.js":
    "20cb5629d1becfa9d8127b925237d525b80c77833fcb02201ca22bb8b1d51507",
  "lib/constants.js":
    "9edba78fc1e1c56bafdd0cfa350e78d0ff16d8689a45a0bb58663b9232744dad",
  "lib/expand.js":
    "1132f78ac87510e7bc3071891d71f549ce427121a1a8ac2ae261e344ccc81dd8",
  "lib/parse.js":
    "70d120d4675f8e531890fc0783f56153c2100e48b670b07578785f6e33bc5a16",
  "lib/stringify.js":
    "92ad7732d73284f4a75d1dd09cc26f8272cb158ccf7b8f56db4c9714c12e34c4",
  "lib/utils.js":
    "5cf071378f3a62524fc2d220ace666b6946c2a431cf255d9084efb1413616f4e",
  LICENSE: "35bdd8a44339719441900fb50fbefc5e2dca1ca662cbaed7a687de842c8b70f2",
  "package.json":
    "56f08b888a4f30dc7cf8a7dbb36ffe92b737912ba36abe9d069d32167c957ac7",
  "README.md":
    "947b0fc3cc12eaaa070207126213fbdf9ab2bf8cd13dcc6e4007b36b79309866",
});
// pnpm 11.19.0's native serialization from the qualified frozen installation.
// The independently pinned repository lock uses Prettier's YAML serialization.
export const installedLockPin =
  "9bac9fcdbe9821e85d895993d96a0ec18c97f54f81880579671ccd62356a1ead";
const regressionPath = "test/security/braces-patch.test.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const textHash = (bytes) =>
  hash(bytes.toString("utf8").replace(/\r\n/gu, "\n"));
const requireCondition = (condition, reason) => {
  if (!condition) throw new Error(reason);
};

export function isolatedEnvironment(source = process.env) {
  const allowed = new Set([
    "PATH",
    "SYSTEMROOT",
    "WINDIR",
    "PATHEXT",
    "COMSPEC",
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
  ]);
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => allowed.has(key.toUpperCase())),
  );
}

export function parseAudit(result) {
  requireCondition(
    !result.error && !result.signal && [0, 1].includes(result.status),
    "Raw audit failed or timed out.",
  );
  const report = JSON.parse(result.stdout);
  requireCondition(
    report &&
      typeof report === "object" &&
      !Array.isArray(report) &&
      !report.error,
    "Invalid audit report.",
  );
  requireCondition(
    report.advisories &&
      typeof report.advisories === "object" &&
      !Array.isArray(report.advisories),
    "Missing audit advisories.",
  );
  const counts = report.metadata?.vulnerabilities;
  const observed = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const advisory of Object.values(report.advisories)) {
    requireCondition(
      advisory &&
        Object.hasOwn(observed, advisory.severity) &&
        typeof advisory.github_advisory_id === "string" &&
        Array.isArray(advisory.findings) &&
        advisory.findings.length > 0,
      "Malformed advisory.",
    );
    observed[advisory.severity] += 1;
  }
  for (const severity of Object.keys(observed)) {
    requireCondition(
      Number.isSafeInteger(counts?.[severity]) &&
        counts[severity] >= 0 &&
        counts[severity] === observed[severity],
      "Audit counts disagree with the complete advisory inventory.",
    );
  }
  requireCondition(
    result.status === (Object.values(observed).some(Boolean) ? 1 : 0),
    "Audit exit status disagrees with findings.",
  );
  return report;
}

export function classifyAudit(report, now = Date.now()) {
  const advisories = Object.values(report.advisories);
  const blocking = advisories.filter((a) =>
    ["high", "critical"].includes(a.severity),
  );
  if (!blocking.length)
    return { mitigated: false, findings: advisories.length };
  requireCondition(
    blocking.length === 1,
    "Unmitigated High/Critical advisories remain.",
  );
  const advisory = blocking[0];
  requireCondition(
    advisory.github_advisory_id === mitigation.advisory &&
      advisory.module_name === "braces" &&
      advisory.severity === "high" &&
      advisory.url === `https://github.com/advisories/${mitigation.advisory}` &&
      advisory.vulnerable_versions === "<=3.0.3",
    "Unreviewed High/Critical advisory.",
  );
  requireCondition(
    Number.isFinite(now) &&
      now >= Date.parse("2026-10-03T00:00:00Z") &&
      now < Date.parse(mitigation.expires),
    "Braces mitigation expired or clock is invalid.",
  );
  requireCondition(
    advisory.findings.length === 1,
    "Braces finding inventory changed.",
  );
  const finding = advisory.findings[0];
  requireCondition(
    finding.version === mitigation.version &&
      finding.dev === true &&
      finding.optional === false &&
      finding.bundled === false,
    "Braces version or development-only exposure changed.",
  );
  requireCondition(
    Array.isArray(finding.paths) &&
      JSON.stringify([...finding.paths].sort()) ===
        JSON.stringify([...mitigation.paths].sort()),
    "Braces dependency paths changed.",
  );
  return { mitigated: true, findings: advisories.length };
}

function contained(base, candidate) {
  const difference = relative(base, candidate);
  return (
    difference !== ".." &&
    !difference.startsWith(`..${sep}`) &&
    !isAbsolute(difference)
  );
}

export function regularFile(base, name) {
  requireCondition(
    typeof name === "string" && name.length > 0 && !isAbsolute(name),
    "Unsafe source path.",
  );
  const candidate = resolve(base, name);
  requireCondition(contained(base, candidate), "Source path escapes its root.");
  let current = base;
  for (const part of relative(base, candidate).split(sep)) {
    current = resolve(current, part);
    requireCondition(
      !lstatSync(current).isSymbolicLink(),
      "Symlink in qualified source path.",
    );
  }
  requireCondition(
    lstatSync(candidate).isFile() &&
      contained(realpathSync(base), realpathSync(candidate)),
    "Qualified source is not a contained regular file.",
  );
  return candidate;
}

export function verifySourcePins(base, pins = sourcePins) {
  requireCondition(
    Object.keys(pins).length > 0,
    "Mitigation source pins are not qualified.",
  );
  const env = isolatedEnvironment();
  for (const [name, expected] of Object.entries(pins)) {
    const bytes = readFileSync(regularFile(base, name));
    requireCondition(
      textHash(bytes) === expected,
      `Qualified source changed: ${name}`,
    );
    const listing = spawnSync(
      "git",
      ["-C", base, "ls-files", "--stage", "--", name],
      { encoding: "utf8", env, shell: false, timeout: 10000 },
    );
    requireCondition(
      listing.status === 0 &&
        /^100644 [a-f0-9]{40,64} 0\t/u.test(listing.stdout) &&
        listing.stdout.trimEnd().endsWith(`\t${name}`) &&
        listing.stdout.trimEnd().split("\n").length === 1,
      `Qualified source is not a regular tracked index file: ${name}`,
    );
    const blob = spawnSync("git", ["-C", base, "show", `:${name}`], {
      env,
      shell: false,
      timeout: 10000,
      maxBuffer: 8 * 1024 * 1024,
    });
    requireCondition(
      blob.status === 0 && hash(blob.stdout) === expected,
      `Git index does not bind the qualified source: ${name}`,
    );
  }
}

export function verifyInstalledPins(packageRoot, pins = installedPins) {
  requireCondition(
    Object.keys(pins).length > 0,
    "Installed source pins are not qualified.",
  );
  const actual = [];
  function walk(directory, prefix = "") {
    for (const name of readdirSync(directory)) {
      const local = prefix ? `${prefix}/${name}` : name;
      const path = resolve(directory, name);
      const stat = lstatSync(path);
      requireCondition(
        !stat.isSymbolicLink(),
        "Symlink in installed braces source.",
      );
      if (stat.isDirectory()) walk(path, local);
      else if (stat.isFile()) actual.push(local);
      else throw new Error("Non-regular installed braces source.");
    }
  }
  walk(packageRoot);
  requireCondition(
    JSON.stringify(actual.sort()) === JSON.stringify(Object.keys(pins).sort()),
    "Installed braces file inventory changed.",
  );
  for (const [name, expected] of Object.entries(pins)) {
    requireCondition(
      hash(readFileSync(regularFile(packageRoot, name))) === expected,
      `Installed braces source changed: ${name}`,
    );
  }
}

export function verifyWorkspaceManifestInventory(base, pins = sourcePins) {
  const names = ["package.json"];
  for (const group of ["apps", "packages"]) {
    for (const entry of readdirSync(resolve(base, group), {
      withFileTypes: true,
    })) {
      requireCondition(
        !entry.isSymbolicLink(),
        "Symlink in workspace inventory.",
      );
      if (!entry.isDirectory()) continue;
      const name = `${group}/${entry.name}/package.json`;
      // Every workspace directory in this repository has a package manifest.
      regularFile(base, name);
      names.push(name);
    }
  }
  const expected = Object.keys(pins).filter(
    (name) =>
      name === "package.json" ||
      /^(apps|packages)\/[^/]+\/package\.json$/u.test(name),
  );
  requireCondition(
    JSON.stringify(names.sort()) === JSON.stringify(expected.sort()),
    "Workspace manifest inventory changed.",
  );
}

export function verifyInstalledLock(
  bytes,
  pins = { source: sourcePins["pnpm-lock.yaml"], installed: installedLockPin },
) {
  requireCondition(
    [pins.source, pins.installed].every((pin) => /^[a-f0-9]{64}$/u.test(pin)),
    "Installed lockfile serialization pins are not qualified.",
  );
  const digest = textHash(bytes);
  requireCondition(
    digest === pins.source || digest === pins.installed,
    "Installed lockfile is stale or differs from both qualified serializations.",
  );
}

function installedBraces(base) {
  const web = createRequire(resolve(base, "apps/web/package.json"));
  const tailwind = createRequire(web.resolve("tailwindcss"));
  const glob = createRequire(tailwind.resolve("fast-glob"));
  const parents = [
    createRequire(tailwind.resolve("chokidar")),
    createRequire(tailwind.resolve("micromatch")),
    createRequire(glob.resolve("micromatch")),
  ];
  const paths = parents.map((parent) =>
    realpathSync(parent.resolve("braces/package.json")),
  );
  requireCondition(
    paths.every(
      (path) =>
        path === paths[0] &&
        contained(realpathSync(resolve(base, "node_modules/.pnpm")), path),
    ),
    "Installed braces resolution escaped the reviewed package graph.",
  );
  const packageRoot = dirname(paths[0]);
  verifyInstalledPins(packageRoot);
  const manifest = JSON.parse(readFileSync(paths[0], "utf8"));
  requireCondition(
    manifest.name === "braces" &&
      manifest.version === mitigation.version &&
      manifest.main === "index.js",
    "Installed braces manifest changed.",
  );
  verifyInstalledLock(
    readFileSync(regularFile(base, "node_modules/.pnpm/lock.yaml")),
  );
}

export function verifyRegressionResult(result) {
  requireCondition(
    !result.error && !result.signal && result.status === 0,
    "Installed braces regression failed or timed out.",
  );
}

function pnpmEntrypoint() {
  const supplied = process.env.npm_execpath;
  requireCondition(
    typeof supplied === "string" && isAbsolute(supplied),
    "Invoke this gate through pnpm run dependency:audit.",
  );
  const entry = realpathSync(supplied);
  const packageRoot = resolve(dirname(entry), "..");
  requireCondition(
    ["bin/pnpm.cjs", "bin/pnpm.mjs"].some(
      (name) => entry === resolve(packageRoot, name),
    ),
    "Unexpected package-manager entrypoint.",
  );
  const manifest = JSON.parse(
    readFileSync(resolve(packageRoot, "package.json"), "utf8"),
  );
  requireCondition(
    manifest.name === "pnpm" && manifest.version === "11.19.0",
    "The reviewed pnpm version is required.",
  );
  return entry;
}

export function runAuditGate(
  base,
  entry,
  {
    run = spawnSync,
    output = (value) => process.stdout.write(value),
    now = Date.now(),
  } = {},
) {
  const env = isolatedEnvironment();
  const audit = run(
    process.execPath,
    [
      entry,
      "audit",
      "--json",
      "--audit-level=low",
      "--ignore-scripts",
      "--ignore-pnpmfile",
      "--registry=https://registry.npmjs.org",
      `--config.userconfig=${resolve(base, ".npmrc")}`,
      `--config.globalconfig=${resolve(base, ".npmrc")}`,
    ],
    {
      cwd: base,
      encoding: "utf8",
      shell: false,
      env,
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  output(`Raw pnpm audit --json (unmodified):\n${audit.stdout ?? ""}\n`);
  if (audit.stderr) output(audit.stderr);
  const report = parseAudit(audit);
  const classification = classifyAudit(report, now);
  // A suppressed/empty registry response must not bypass the source binding.
  verifySourcePins(base);
  verifyWorkspaceManifestInventory(base);
  installedBraces(base);
  if (classification.mitigated) {
    const regression = run(process.execPath, ["--test", regressionPath], {
      cwd: base,
      encoding: "utf8",
      shell: false,
      env,
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
    });
    output(regression.stdout ?? "");
    if (regression.stderr) output(regression.stderr);
    verifyRegressionResult(regression);
    output(
      `dependency audit: MITIGATED ${mitigation.advisory}; raw High remains; expires ${mitigation.expires}.\n`,
    );
  } else {
    output(
      `dependency audit: PASS at High/Critical threshold; ${classification.findings} raw lower-severity advisories remain.\n`,
    );
  }
  return classification;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    runAuditGate(root, pnpmEntrypoint());
  } catch (error) {
    console.error(`dependency audit: FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
