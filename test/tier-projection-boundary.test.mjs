import assert from "node:assert/strict";
import test from "node:test";
import { tierProjectionBoundaryViolations } from "../scripts/lib/tier-projection-boundary.mjs";

function validSources() {
  return new Map([
    [
      "packages/ai-evidence/src/index.ts",
      'export * from "./projection/server-result.js";',
    ],
    ["packages/ai-evidence/src/standard.ts", "export const standard = true;"],
    [
      "packages/ai-evidence/src/projection/demo.ts",
      "export function buildDemoProjection() {}",
    ],
    [
      "packages/ai-evidence/src/projection/standard.ts",
      "export function buildStandardProjection() {}",
    ],
    [
      "packages/ai-evidence/src/projection/server-result.ts",
      'export function projectStoredResult(request) { if (request.tier === "consultant") throw new Error(); return request.completeResult; }\nbuildDemoProjection();\nbuildStandardProjection();',
    ],
    [
      "packages/application/src/service.ts",
      "const projected = projectStoredResult({ tier: 'demo' });",
    ],
    [
      "packages/application/src/standard-workspace.ts",
      "SELECT rs.result_sha256;\nassertStoredCompleteResultIntegrity(row.complete_result_document, row.result_sha256, runId);\nconst completeResult = standardEvidenceGraphFromStoredCompleteResult(row.complete_result_document);\nconst completeResultFoundation = preparedRelease.persistence_foundation;\nclient.query(`INSERT INTO run_result(run_id,complete_result_document,result_sha256) VALUES($1,$2::jsonb,$3)`, [runId, JSON.stringify(completeResultFoundation), standardCompleteResultDocumentSha256(completeResultFoundation)]);\nSELECT 1 FROM run_result WHERE run_id=$1 FOR SHARE;\nconst projected = projectStoredResult({ tier: 'standard' });\nSELECT transaction_timestamp() AS projection_as_of",
    ],
    ["apps/web/src/standard-route-core.ts", "serialize(projected.body);"],
  ]);
}

test("projection boundary verifier accepts one facade and DB-clock projection", () => {
  assert.deepEqual(tierProjectionBoundaryViolations(validSources()), []);
});

test("projection boundary verifier rejects legacy, raw-web, builder, and wall-clock bypasses", () => {
  const sources = validSources();
  sources.set(
    "packages/application/src/service.ts",
    "projectDemoResult(complete_result_document);",
  );
  sources.set(
    "apps/web/src/standard-route-core.ts",
    "Response.json(complete_result_document);\nResponse.json(completeResultFoundation);",
  );
  sources.set(
    "packages/application/src/rogue.ts",
    "buildStandardProjection(value);",
  );
  sources.set(
    "packages/application/src/standard-workspace.ts",
    "projectStoredResult({ projectionAsOf: new Date() });\nUPDATE run_result SET complete_result_document=$1;",
  );

  const violations = tierProjectionBoundaryViolations(sources).join("\n");
  assert.match(violations, /legacy disclosure symbol projectDemoResult/u);
  assert.match(violations, /complete stored result reaches a serializer/u);
  assert.match(
    violations,
    /internal projection builder buildStandardProjection/u,
  );
  assert.match(violations, /lacks a DB transaction timestamp/u);
  assert.match(violations, /reads the application wall clock/u);
  assert.match(violations, /does not validate the stored complete-result/u);
  assert.match(violations, /does not verify stored integrity before parsing/u);
  assert.match(violations, /does not persist the complete-result foundation/u);
  assert.match(violations, /not append-only and race guarded/u);
});

test("projection boundary rejects direct and aliased foundation-builder serialization", () => {
  const sources = validSources();
  sources.set(
    "apps/web/src/direct-foundation.ts",
    "Response.json(buildCompleteResultFoundation(graph));",
  );
  sources.set(
    "packages/application/src/aliased-foundation.ts",
    "const foundation = buildCompleteResultFoundation(graph);\nconst responseBody = foundation;\njson(responseBody);",
  );
  sources.set(
    "apps/web/src/aliased-builder.ts",
    "const createFoundation = buildCompleteResultFoundation;\nconst stored = createFoundation(graph);\nResponse.json(stored);",
  );

  const violations = tierProjectionBoundaryViolations(sources).filter((item) =>
    item.includes("complete stored result reaches a serializer"),
  );
  assert.deepEqual(violations, [
    "apps/web/src/aliased-builder.ts: complete stored result reaches a serializer",
    "apps/web/src/direct-foundation.ts: complete stored result reaches a serializer",
    "packages/application/src/aliased-foundation.ts: complete stored result reaches a serializer",
  ]);
});

test("authorized persistence does not exempt a second identical serialization", () => {
  const leakVariants = [
    'fetch("/leak", { body: JSON.stringify(completeResultFoundation) });',
    "console.log(JSON.stringify(completeResultFoundation));",
    "const exportPayload = JSON.stringify(completeResultFoundation);",
  ];
  for (const leak of leakVariants) {
    const sources = validSources();
    const path = "packages/application/src/standard-workspace.ts";
    sources.set(path, `${sources.get(path)}\n${leak}`);
    const violations = tierProjectionBoundaryViolations(sources);
    assert.ok(
      violations.includes(
        `${path}: complete stored result reaches a serializer`,
      ),
      leak,
    );
  }
});
