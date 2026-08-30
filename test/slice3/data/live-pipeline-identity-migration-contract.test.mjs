import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const file = (name) =>
  new URL(`../../../packages/data/${name}`, import.meta.url);

test("TASK137 live pipeline identity migration is bounded and reversible", async () => {
  const [up, down, registry] = await Promise.all([
    readFile(
      file("migrations/0005_task_137_live_pipeline_identity.up.sql"),
      "utf8",
    ),
    readFile(
      file("migrations/0005_task_137_live_pipeline_identity.down.sql"),
      "utf8",
    ),
    readFile(file("src/migrations.ts"), "utf8"),
  ]);

  assert.match(
    registry,
    /0004_task_105_security_alert[\s\S]*0005_task_137_live_pipeline_identity/,
  );
  assert.match(
    up,
    /ALTER TABLE live_research_execution_reservation[\s\S]*ADD COLUMN pipeline_identity_record jsonb/,
  );
  assert.match(up, /jsonb_typeof\(pipeline_identity_record\) = 'object'/);
  assert.match(up, /pipeline_identity_record \?& ARRAY/);
  assert.match(up, /pipeline_identity_record - ARRAY[\s\S]*= '\{\}'::jsonb/);
  assert.match(up, /modelPolicyVersionId[\s\S]*modelPolicyContentSha256/);
  assert.match(up, /scoringConfigVersionId[\s\S]*scoringConfigContentSha256/);
  assert.match(up, /researchRoutePolicyId[\s\S]*routePolicyCanonicalSha256/);
  assert.match(up, /CREATE TRIGGER live_research_pipeline_identity_immutable/);
  assert.match(
    up,
    /CREATE TRIGGER live_research_pipeline_identity_delete_guard/,
  );
  assert.match(up, /OLD\.pipeline_identity_record IS NOT NULL/);
  assert.match(up, /ADD COLUMN content_sha256 bytea/);
  assert.match(up, /qualified_route_policy_content_digest/);
  assert.match(up, /outputSchemaCanonicalSha256' = '[0-9a-f]{64}'/);
  assert.doesNotMatch(up, /credential_handle|api_key|secret_value/i);
  assert.match(down, /DROP COLUMN IF EXISTS pipeline_identity_record/);
  assert.match(
    down,
    /DROP FUNCTION IF EXISTS matchbase_preserve_live_pipeline_identity/,
  );
  assert.match(down, /DROP COLUMN IF EXISTS content_sha256/);
});
