import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createPool,
  ensureLegacyMisclassifiedDomainPackAnnotation,
  inTransaction,
  migrateUp,
  readLegacyMisclassifiedDomainPackAnnotation,
} from "../../../packages/data/dist/index.js";

const databaseUrl = process.env.DATABASE_URL;
const postgresTest = databaseUrl ? test : test.skip;

const read = (name) =>
  readFile(
    new URL(`../../../packages/data/migrations/${name}`, import.meta.url),
    "utf8",
  );

test("0013 adds only an external governed annotation seam and never rewrites history", async () => {
  const up = await read("0013_domain_pack_v2_and_legacy_annotation.up.sql");
  assert.match(up, /CREATE TABLE request_governed_annotation/u);
  assert.match(up, /legacy_misclassified_domain_pack/u);
  assert.match(up, /ENABLE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(
    up,
    /\bUPDATE\b|canonical_request_version\s+SET|result_store\s+SET/iu,
  );
  const down = await read("0013_domain_pack_v2_and_legacy_annotation.down.sql");
  assert.match(down, /DROP TABLE IF EXISTS request_governed_annotation/u);
});

postgresTest(
  "0013 persists an account-isolated annotation without mutating canonical bytes",
  async () => {
    const databaseName = `matchbase_agri_annotation_${randomUUID().replaceAll("-", "")}`;
    const control = createPool({ connectionString: databaseUrl, max: 1 });
    let isolated;
    try {
      await control.query(`CREATE DATABASE ${databaseName}`);
      const url = new URL(databaseUrl);
      url.pathname = `/${databaseName}`;
      isolated = createPool({ connectionString: url.toString(), max: 2 });
      await migrateUp(isolated);
      const accountId = randomUUID();
      const userId = randomUUID();
      const requestId = randomUUID();
      const canonicalizationId = randomUUID();
      await isolated.query(
        "INSERT INTO account(account_id,display_name,status) VALUES($1,'Agricultural annotation','active')",
        [accountId],
      );
      await isolated.query(
        "INSERT INTO app_user(user_id,account_id,google_sub,status) VALUES($1,$2,$3,'active')",
        [userId, accountId, `agri-${userId}`],
      );
      await isolated.query(
        `INSERT INTO canonicalization_execution_run
           (canonicalization_run_id,account_id,user_id,subject_request_id,request_correlation_id,started_at)
         VALUES($1,$2,$3,$4,$5,clock_timestamp())`,
        [canonicalizationId, accountId, userId, requestId, `agri-${requestId}`],
      );
      await isolated.query(
        `INSERT INTO sourcing_request
           (request_id,account_id,created_by_user_id,canonicalization_run_id,lifecycle_state)
         VALUES($1,$2,$3,$4,'canonicalised')`,
        [requestId, accountId, userId, canonicalizationId],
      );
      const before = await isolated.query(
        "SELECT current_version,lifecycle_state FROM sourcing_request WHERE request_id=$1",
        [requestId],
      );
      const annotation = await inTransaction(isolated, async (client) => {
        await client.query("SELECT set_config('app.account_id',$1,true)", [
          accountId,
        ]);
        await ensureLegacyMisclassifiedDomainPackAnnotation(client, {
          accountId,
          requestId,
          observedCategory: "synthetic_industrial_components",
          correctedCategory: "food_agricultural_commodities",
        });
        return readLegacyMisclassifiedDomainPackAnnotation(client, {
          accountId,
          requestId,
        });
      });
      assert.equal(
        annotation?.corrected_category,
        "food_agricultural_commodities",
      );
      const after = await isolated.query(
        "SELECT current_version,lifecycle_state FROM sourcing_request WHERE request_id=$1",
        [requestId],
      );
      assert.deepEqual(after.rows, before.rows);
    } finally {
      await isolated?.end();
      await control.query(
        `DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`,
      );
      await control.end();
    }
  },
);
