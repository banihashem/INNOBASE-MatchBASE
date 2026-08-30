import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

const REQUIRED_FILES = [
  "packages/ai-evidence/src/index.ts",
  "packages/ai-evidence/src/standard.ts",
  "packages/ai-evidence/src/projection/demo.ts",
  "packages/ai-evidence/src/projection/standard.ts",
  "packages/ai-evidence/src/projection/server-result.ts",
  "packages/application/src/service.ts",
  "packages/application/src/standard-workspace.ts",
  "apps/web/src/standard-route-core.ts",
];
const LEGACY_DISCLOSURE_SYMBOLS = [
  "projectDemoResult",
  "projectStandardResult",
  "prepareStandardRelease",
];
const INTERNAL_BUILDERS = new Map([
  [
    "buildDemoProjection",
    new Set([
      "packages/ai-evidence/src/projection/demo.ts",
      "packages/ai-evidence/src/projection/server-result.ts",
    ]),
  ],
  [
    "buildStandardProjection",
    new Set([
      "packages/ai-evidence/src/projection/standard.ts",
      "packages/ai-evidence/src/projection/server-result.ts",
    ]),
  ],
]);

function sourceFiles(root) {
  const sources = new Map();
  const walk = (directory) => {
    for (const name of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, name.name);
      if (name.isDirectory()) {
        if (
          name.name !== "dist" &&
          name.name !== "node_modules" &&
          name.name !== ".next" &&
          name.name !== "coverage"
        )
          walk(path);
      } else if (
        /\.(?:ts|tsx|js|mjs)$/u.test(name.name) &&
        !/\.(?:test|spec)\./u.test(name.name)
      ) {
        sources.set(
          relative(root, path).replaceAll("\\", "/"),
          readFileSync(path, "utf8"),
        );
      }
    }
  };
  for (const directory of ["packages", "apps"]) walk(resolve(root, directory));
  return sources;
}

function completeResultBuilderReachesSerializer(source) {
  const builderAliases = new Set(["buildCompleteResultFoundation"]);
  const taintedValues = new Set();
  for (const match of source.matchAll(
    /\bbuildCompleteResultFoundation\s+as\s+([A-Za-z_$][\w$]*)/gu,
  ))
    builderAliases.add(match[1]);

  const assignments = [
    ...source.matchAll(
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\r\n]+)/gu,
    ),
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of assignments) {
      const [, target, expression] = match;
      if (!target || !expression) continue;
      if (
        [...builderAliases].some(
          (name) => expression.trim() === name && !builderAliases.has(target),
        )
      ) {
        builderAliases.add(target);
        changed = true;
        continue;
      }
      if (
        [...builderAliases].some((name) =>
          new RegExp(`\\b${name}\\s*\\(`, "u").test(expression),
        ) ||
        [...taintedValues].some((name) =>
          new RegExp(`\\b${name}\\b`, "u").test(expression),
        )
      ) {
        if (!taintedValues.has(target)) {
          taintedValues.add(target);
          changed = true;
        }
      }
    }
  }

  for (const match of source.matchAll(
    /(?:JSON\.stringify|Response\.json|\bjson)\s*\(([^)]*)\)/gsu,
  )) {
    const expression = match[1] ?? "";
    if (
      [...builderAliases].some((name) =>
        new RegExp(`\\b${name}\\s*\\(`, "u").test(expression),
      ) ||
      [...taintedValues].some((name) =>
        new RegExp(`\\b${name}\\b`, "u").test(expression),
      )
    )
      return true;
  }
  return false;
}

function maskAuthorizedCompleteResultPersistence(path, source) {
  if (path !== "packages/application/src/standard-workspace.ts") return source;
  const authorized =
    /`INSERT INTO run_result\([^`]*complete_result_document[^`]*\)[^`]*`\s*,\s*\[[\s\S]*?JSON\.stringify\(completeResultFoundation\),\s*standardCompleteResultDocumentSha256\(completeResultFoundation\)/u.exec(
      source,
    );
  if (!authorized || authorized.index === undefined) return source;
  const serializer = "JSON.stringify(completeResultFoundation)";
  const relativeIndex = authorized[0].lastIndexOf(serializer);
  if (relativeIndex < 0) return source;
  const absoluteIndex = authorized.index + relativeIndex;
  return `${source.slice(0, absoluteIndex)}authorizedCompleteResultPersistence${source.slice(absoluteIndex + serializer.length)}`;
}

export function tierProjectionBoundaryViolations(sources) {
  const violations = [];
  for (const path of REQUIRED_FILES)
    if (!sources.has(path))
      violations.push(`${path}: required boundary file is missing`);

  const productionBoundaryPaths = [...sources.keys()].filter(
    (path) =>
      path.startsWith("packages/application/src/") ||
      path.startsWith("apps/web/src/") ||
      path === "packages/ai-evidence/src/index.ts" ||
      path === "packages/ai-evidence/src/standard.ts",
  );
  for (const path of productionBoundaryPaths) {
    const source = sources.get(path) ?? "";
    for (const symbol of LEGACY_DISCLOSURE_SYMBOLS)
      if (source.includes(symbol))
        violations.push(
          `${path}: legacy disclosure symbol ${symbol} bypasses the facade`,
        );
    if (
      path.startsWith("apps/web/src/") &&
      source.includes("complete_result_document")
    )
      violations.push(`${path}: web code reads a complete stored result`);
    const serializationSource = maskAuthorizedCompleteResultPersistence(
      path,
      source,
    );
    if (
      /(?:JSON\.stringify|Response\.json|\bjson)\s*\([^)]*(?:complete_result_document|completeResultFoundation)/su.test(
        serializationSource,
      ) ||
      completeResultBuilderReachesSerializer(serializationSource)
    )
      violations.push(`${path}: complete stored result reaches a serializer`);
  }

  for (const [path, source] of sources) {
    for (const [symbol, allowedPaths] of INTERNAL_BUILDERS)
      if (source.includes(symbol) && !allowedPaths.has(path))
        violations.push(
          `${path}: internal projection builder ${symbol} escaped its component`,
        );
  }

  const rootEntry = sources.get("packages/ai-evidence/src/index.ts") ?? "";
  const standardEntry =
    sources.get("packages/ai-evidence/src/standard.ts") ?? "";
  if (!rootEntry.includes('export * from "./projection/server-result.js"'))
    violations.push(
      "packages/ai-evidence/src/index.ts: central facade is not public",
    );
  if (standardEntry.includes("projection/server-result.js"))
    violations.push(
      "packages/ai-evidence/src/standard.ts: facade has a second public export path",
    );
  for (const [path, source] of [
    ["packages/ai-evidence/src/index.ts", rootEntry],
    ["packages/ai-evidence/src/standard.ts", standardEntry],
  ])
    if (/export \* from "\.\/projection\/(?:demo|standard)\.js"/u.test(source))
      violations.push(
        `${path}: wildcard export exposes an internal tier projector`,
      );

  const facade =
    sources.get("packages/ai-evidence/src/projection/server-result.ts") ?? "";
  if (!facade.includes("export function projectStoredResult"))
    violations.push(
      "central projection facade does not export projectStoredResult",
    );
  if (
    facade.indexOf('request.tier === "consultant"') < 0 ||
    facade.indexOf('request.tier === "consultant"') >
      facade.indexOf("request.completeResult")
  )
    violations.push(
      "Consultant does not fail closed before result payload access",
    );

  const demoApplication =
    sources.get("packages/application/src/service.ts") ?? "";
  if (!demoApplication.includes("projectStoredResult({"))
    violations.push("Demo result read does not use the central facade");
  const standardApplication =
    sources.get("packages/application/src/standard-workspace.ts") ?? "";
  if (!standardApplication.includes("projectStoredResult({"))
    violations.push("Standard result read does not use the central facade");
  if (
    !standardApplication.includes("transaction_timestamp() AS projection_as_of")
  )
    violations.push(
      "Standard result projection lacks a DB transaction timestamp",
    );
  if (/projectionAsOf:\s*new Date\s*\(/u.test(standardApplication))
    violations.push(
      "Standard result projection reads the application wall clock",
    );
  if (
    !standardApplication.includes(
      "standardEvidenceGraphFromStoredCompleteResult(",
    )
  )
    violations.push(
      "Standard result read does not validate the stored complete-result foundation",
    );
  const integrityCheckIndex = standardApplication.indexOf(
    "assertStoredCompleteResultIntegrity(",
  );
  const storedParserIndex = standardApplication.indexOf(
    "standardEvidenceGraphFromStoredCompleteResult(",
  );
  if (
    !standardApplication.includes("rs.result_sha256") ||
    integrityCheckIndex < 0 ||
    storedParserIndex < 0 ||
    integrityCheckIndex > storedParserIndex
  )
    violations.push(
      "Standard result read does not verify stored integrity before parsing",
    );
  if (
    !standardApplication.includes("preparedRelease.persistence_foundation") ||
    !standardApplication.includes("JSON.stringify(completeResultFoundation)") ||
    !standardApplication.includes(
      "standardCompleteResultDocumentSha256(completeResultFoundation)",
    )
  )
    violations.push(
      "Standard producer does not persist the complete-result foundation",
    );
  if (
    !standardApplication.includes("INSERT INTO run_result") ||
    !standardApplication.includes(
      "SELECT 1 FROM run_result WHERE run_id=$1 FOR SHARE",
    ) ||
    /(?:UPDATE\s+run_result|DELETE\s+FROM\s+run_result)/iu.test(
      standardApplication,
    )
  )
    violations.push(
      "Standard complete-result persistence is not append-only and race guarded",
    );

  return violations.sort((left, right) => left.localeCompare(right, "en"));
}

export function verifyTierProjectionBoundary(root) {
  return tierProjectionBoundaryViolations(sourceFiles(root));
}
