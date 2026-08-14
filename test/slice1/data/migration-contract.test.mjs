import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../../packages/data/migrations/0001_slice_1_foundation.up.sql",
  import.meta.url,
);
const quotaUrl = new URL(
  "../../../packages/data/src/quota.ts",
  import.meta.url,
);

test("foundation migration encodes Slice 1 quota, lease, audit, evidence, and cost invariants", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const quota = await readFile(quotaUrl, "utf8");
  assert.match(quota, /interval '168 hours'/);
  assert.match(quota, /demo: 3/);
  assert.match(quota, /standard: 5/);
  assert.match(quota, /consultant: 20/);
  assert.match(
    sql,
    /INSERT INTO execution_lease \(slot_no\) VALUES \(1\), \(2\), \(3\)/,
  );
  assert.match(sql, /quota_ledger_append_only/);
  assert.match(sql, /audit_event_append_only/);
  assert.match(sql, /canonicalization_execution_run_immutable/);
  assert.match(sql, /sourcing_request_canonicalization_link_immutable/);
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(
    sql,
    /CHECK \(\(run_id IS NULL\) <> \(canonicalization_run_id IS NULL\)\)/,
  );
  assert.match(sql, /matchbase_assert_attempt_ledger_closed/);
  assert.match(sql, /dimension-matched provider call/);
  assert.match(sql, /dimension-matched cost event/);
  assert.match(
    sql,
    /without fabricating a research_run; a successful sourcing_request links it to later research runs/,
  );
  assert.match(
    sql,
    /pricing_state IN \('priced','explicit_zero','unknown','unpriced'\)/,
  );
  assert.match(sql, /model_id <> 'openrouter\/auto'/);
  assert.match(sql, /UNIQUE \(account_id, subject_user_id, route, key_hash\)/);
  assert.match(
    sql,
    /UNIQUE \(account_id, requested_by_user_id, idempotency_key_hash\)/,
  );
  assert.match(quota, /AND subject_user_id = \$2/);
  assert.doesNotMatch(
    sql,
    /CREATE TABLE[^;]+(?:raw_source_text|original_text\s+text)/is,
  );
  assert.doesNotMatch(sql, /sqlite/i);
});
