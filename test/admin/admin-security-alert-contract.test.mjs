import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = (direction) =>
  new URL(
    `../../packages/data/migrations/0004_task_105_security_alert.${direction}.sql`,
    import.meta.url,
  );

test("TASK-105-A security alert persistence is ordered, linked, append-only, and reversible", async () => {
  const [up, down, registry, repository] = await Promise.all([
    readFile(migration("up"), "utf8"),
    readFile(migration("down"), "utf8"),
    readFile(
      new URL("../../packages/data/src/migrations.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../../packages/data/src/admin-entitlements.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(
    registry,
    /0003_slice_3_live_research[\s\S]*0004_task_105_security_alert/,
  );
  assert.match(registry, /SECURITY_ALERT_MIGRATION_ID/);
  assert.match(up, /CREATE TABLE security_alert \(/);
  assert.match(up, /audit_id uuid NOT NULL UNIQUE/);
  assert.match(up, /CHECK \(actor_user_id = subject_user_id\)/);
  assert.match(
    up,
    /FOREIGN KEY \(account_id, audit_id\)[\s\S]*REFERENCES audit_event\(account_id, audit_id\)/,
  );
  assert.match(up, /security\.self_elevation_attempted/);
  assert.match(up, /outcome = 'deny'/);
  assert.match(up, /linked\.detail ->> 'reasonCode' = NEW\.reason_code/);
  assert.match(
    up,
    /linked\.detail ->> 'entitlementKind' = NEW\.entitlement_kind/,
  );
  assert.match(
    up,
    /linked\.detail ->> 'entitlementValue' = NEW\.entitlement_value/,
  );
  assert.match(up, /CREATE TRIGGER security_alert_append_only/);
  assert.match(
    up,
    /ALTER TABLE security_alert ENABLE ALWAYS TRIGGER security_alert_append_only/,
  );
  assert.match(
    up,
    /REVOKE UPDATE, DELETE ON security_alert FROM PUBLIC, CURRENT_USER/,
  );
  assert.match(up, /External notification and pager delivery are outside/);
  assert.match(up, /PostgreSQL owners retain implicit privileges/);
  assert.match(down, /DROP TABLE IF EXISTS security_alert/);
  assert.match(down, /DROP CONSTRAINT IF EXISTS audit_event_account_audit_uk/);
  assert.match(repository, /INSERT INTO security_alert/);
  assert.match(repository, /security\.self_elevation_attempted/);
  assert.doesNotMatch(
    up,
    /justification|email|google_sub|raw_payload|api_key/iu,
  );
});
