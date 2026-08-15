import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = (direction) =>
  new URL(
    `../../../packages/data/migrations/0003_slice_3_live_research.${direction}.sql`,
    import.meta.url,
  );

test("Slice 3 migration is ordered, tenant-bound, append-only, and reversible", async () => {
  const [up, down, registry] = await Promise.all([
    readFile(migration("up"), "utf8"),
    readFile(migration("down"), "utf8"),
    readFile(
      new URL("../../../packages/data/src/migrations.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(
    registry,
    /0001_slice_1_foundation[\s\S]*0002_slice_2_standard_workspace[\s\S]*0003_slice_3_live_research/,
  );
  for (const table of [
    "research_route_policy",
    "research_route_snapshot",
    "provider_attempt",
    "search_attempt",
    "fetch_attempt",
    "source_document",
    "live_source_provenance",
    "candidate_identity_resolution",
    "live_cost_reconciliation",
    "live_research_terminal",
    "live_research_execution_reservation_event",
    "research_route_health_observation",
    "live_qualification_evidence",
  ]) {
    assert.match(up, new RegExp(`CREATE TABLE ${table} \\(`));
    assert.match(up, new RegExp(`CREATE TRIGGER ${table}_immutable`));
    assert.match(down, new RegExp(`DROP TABLE IF EXISTS ${table}`));
  }
  assert.match(up, /CREATE TABLE live_research_execution_reservation \(/);
  assert.match(
    down,
    /DROP TABLE IF EXISTS live_research_execution_reservation/,
  );
  assert.match(
    up,
    /event_type text NOT NULL CHECK \(event_type IN \('claimed','reclaimed_after_expiry','terminal_committed'\)\)/,
  );
  assert.match(up, /terminal_record jsonb NOT NULL/);
  assert.match(
    up,
    /research_mode text NOT NULL DEFAULT 'synthetic_reference'[\s\S]*qualified_live_research/,
  );
  assert.match(up, /CREATE TABLE provider_route_capability \(/);
  assert.match(
    up,
    /capability text NOT NULL CHECK \(capability IN \('CAP-SEARCH','CAP-STRUCTURED-GENERATION'\)\)/,
  );
  assert.match(up, /source_request_url text NOT NULL/);
  assert.match(
    up,
    /claim_evidence_account_run_claim_evidence_uk[\s\S]*UNIQUE \(account_id, run_id, claim_id, evidence_item_id\)/,
  );
  assert.match(up, /CREATE TRIGGER claim_evidence_scope/);
  assert.match(
    up,
    /FOREIGN KEY \(account_id, run_id, claim_id, evidence_item_id\)[\s\S]*REFERENCES claim_evidence\(account_id, run_id, claim_id, evidence_item_id\)/,
  );
  assert.match(down, /DROP TRIGGER IF EXISTS claim_evidence_scope/);
  assert.match(down, /DROP COLUMN IF EXISTS run_id/);
  assert.match(
    up,
    /UNIQUE \(search_attempt_id, source_request_url, canonical_url, redirect_hop\)/,
  );
  assert.match(
    up,
    /checkpoint_stage text NOT NULL DEFAULT 'reserved'[\s\S]*source_discovered[\s\S]*terminal_no_source/,
  );
  assert.match(up, /generation bigint NOT NULL CHECK \(generation >= 1\)/);
  assert.match(up, /execution_lease_slot smallint NOT NULL/);
  assert.match(
    up,
    /execution_lease_generation integer NOT NULL CHECK \(execution_lease_generation >= 1\)/,
  );
  assert.match(
    up,
    /FOREIGN KEY \(execution_lease_slot\) REFERENCES execution_lease\(slot_no\)/,
  );
  assert.match(down, /DROP TABLE IF EXISTS provider_route_capability/);
  assert.match(down, /DROP COLUMN IF EXISTS research_mode/);
  assert.match(up, /research_route_snapshot_id text PRIMARY KEY/);
  assert.match(
    up,
    /provider_attempt[\s\S]*research_route_snapshot_id text NOT NULL/,
  );
  assert.match(up, /http_status IN \(301,302,303,307,308\)/);
  assert.match(up, /expected_served_model = requested_model/);
  assert.match(up, /expected_served_provider = requested_provider/);
  assert.match(up, /terminal_disposition = 'ok'/);
  assert.match(
    up,
    /untrusted_data_only boolean NOT NULL CHECK \(untrusted_data_only\)/,
  );
  assert.match(up, /reconciliation_state = 'closed'/);
  assert.match(up, /cost_state <> 'unknown'/);
  assert.match(up, /'probe_eligible'/);
  assert.match(
    up,
    /\(circuit_disposition = 'half_open'\) = \(observation = 'probe_eligible'\)/,
  );
  assert.match(up, /secret_free/);
  assert.doesNotMatch(
    up,
    /api_key|authorization_header|raw_provider_payload|source_request_text/i,
  );
});
