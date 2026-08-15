import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const upUrl = new URL(
  "../../../packages/data/migrations/0002_slice_2_standard_workspace.up.sql",
  import.meta.url,
);
const downUrl = new URL(
  "../../../packages/data/migrations/0002_slice_2_standard_workspace.down.sql",
  import.meta.url,
);
const registryUrl = new URL(
  "../../../packages/data/src/migrations.ts",
  import.meta.url,
);
const cliUrl = new URL("../../../packages/data/src/cli.ts", import.meta.url);

test("Slice 2 migration contract is ordered, append-only, private, and reversible", async () => {
  const [up, down, registry, cli] = await Promise.all([
    readFile(upUrl, "utf8"),
    readFile(downUrl, "utf8"),
    readFile(registryUrl, "utf8"),
    readFile(cliUrl, "utf8"),
  ]);

  assert.match(registry, /0001_slice_1_foundation/);
  assert.match(registry, /0002_slice_2_standard_workspace/);
  assert.match(registry, /migrateDownLatest/);
  assert.match(cli, /migrateDownLatest/);
  assert.match(up, /CREATE TABLE domain_pack \(/);
  assert.match(up, /CREATE TABLE domain_pack_version \(/);
  assert.match(up, /request_domain_pack_activation_threshold_guard/);
  assert.match(up, /low-confidence category requires explicit confirmation/);
  assert.match(up, /'not_applicable'/);
  assert.match(up, /CREATE TABLE conditional_requirement \(/);
  assert.match(up, /validation_digest_hmac_sha256 bytea/);
  assert.doesNotMatch(up, /source_text\s+text/i);
  assert.match(up, /canonical_contradiction_resolution_immutable/);
  assert.match(up, /match_readiness IN \('ready', 'partially_ready'\)/);
  assert.match(up, /projection_serving_immutable/);
  assert.match(up, /candidate_score_requires_six_dimensions/);
  assert.match(up, /category_product_fit' AND weight_percent = 25/);
  assert.match(up, /geographic_reach_fit' AND weight_percent = 10/);
  assert.match(up, /evidence_support/);
  assert.match(up, /candidate_evidenced_value/);
  assert.match(up, /research_run_owner_history_idx/);
  assert.doesNotMatch(up, /CREATE POLICY|ENABLE ROW LEVEL SECURITY/i);
  assert.match(down, /DROP TABLE IF EXISTS domain_pack/);
  assert.match(down, /DROP COLUMN IF EXISTS request_id/);
  assert.match(down, /COMMENT ON TABLE projection_serving IS NULL/);
});
