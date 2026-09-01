import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import {
  applyGoogleRiscEvent,
  createPool,
  getMigrationStatus,
  inTransaction,
  migrateDownLatest,
  migrateUp,
  purgeGoogleRiscReceipts,
} from "../../../packages/data/dist/index.js";

const databaseUrl = process.env.DATABASE_URL;
const postgresTest = databaseUrl ? test : test.skip;
const digest = (value) => createHash("sha256").update(value).digest();

postgresTest(
  "Google RISC receipt is data-minimized, replay-safe, reversible, and revokes all subject sessions",
  async () => {
    const databaseName = `matchbase_risc_${randomUUID().replaceAll("-", "")}`;
    const control = createPool({ connectionString: databaseUrl, max: 1 });
    let isolated;
    try {
      await control.query(`CREATE DATABASE ${databaseName}`);
      const url = new URL(databaseUrl);
      url.pathname = `/${databaseName}`;
      isolated = createPool({ connectionString: url.toString(), max: 4 });
      await migrateUp(isolated);
      assert.equal((await getMigrationStatus(isolated)).ready, true);

      const accountId = randomUUID();
      const userId = randomUUID();
      const googleSubject = `subject-${randomUUID()}`;
      await isolated.query(
        "INSERT INTO account(account_id,display_name,status) VALUES($1,'RISC fixture','active')",
        [accountId],
      );
      await isolated.query(
        `INSERT INTO app_user(user_id,account_id,google_sub,status)
         VALUES($1,$2,$3,'active')`,
        [userId, accountId, googleSubject],
      );
      for (let index = 0; index < 2; index += 1) {
        await isolated.query(
          `INSERT INTO user_session
             (session_id,account_id,user_id,handle_hash,csrf_token_hash,
              absolute_expires_at,idle_expires_at)
           VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',
                  clock_timestamp()+interval '30 minutes')`,
          [randomUUID(), accountId, userId, randomBytes(32), randomBytes(32)],
        );
      }

      const input = {
        eventId: "risc-event-1",
        issuer: "https://accounts.google.com",
        audience: "client-id.apps.googleusercontent.com",
        issuedAt: 1_700_000_000,
        eventType:
          "https://schemas.openid.net/secevent/risc/event-type/sessions-revoked",
        googleSubject,
        terminateSessions: true,
        correlationId: "risc-correlation-1",
        deploymentId: "risc-deployment-1",
      };
      const applied = await inTransaction(isolated, (client) =>
        applyGoogleRiscEvent(client, input),
      );
      assert.equal(applied.replayed, false);
      assert.equal(applied.affectedSessionCount, 2);
      const sessions = await isolated.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked
           FROM user_session WHERE account_id=$1 AND user_id=$2`,
        [accountId, userId],
      );
      assert.deepEqual(sessions.rows[0], { total: 2, revoked: 2 });

      const receipt = await isolated.query(
        `SELECT event_id_sha256,audience_sha256,subject_sha256,
                affected_session_count,action
           FROM google_risc_event_receipt`,
      );
      assert.equal(receipt.rows.length, 1);
      assert.deepEqual(receipt.rows[0].event_id_sha256, digest(input.eventId));
      assert.deepEqual(
        receipt.rows[0].subject_sha256,
        digest(input.googleSubject),
      );
      assert.equal(receipt.rows[0].affected_session_count, 2);
      assert.equal(receipt.rows[0].action, "sessions_revoked");
      const prohibitedColumns = await isolated.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='google_risc_event_receipt'
            AND column_name IN ('raw_token','event_id','google_subject','audience','verification_state')`,
      );
      assert.deepEqual(prohibitedColumns.rows, []);

      const replay = await inTransaction(isolated, (client) =>
        applyGoogleRiscEvent(client, input),
      );
      assert.equal(replay.replayed, true);
      assert.equal(replay.receiptId, applied.receiptId);
      assert.equal(replay.affectedSessionCount, 2);
      assert.equal(
        (
          await isolated.query(
            "SELECT count(*)::int AS count FROM google_risc_event_receipt",
          )
        ).rows[0].count,
        1,
      );
      await assert.rejects(
        inTransaction(isolated, (client) =>
          applyGoogleRiscEvent(client, {
            ...input,
            googleSubject: "binding-mismatch",
          }),
        ),
        /replay binding mismatch/iu,
      );
      await assert.rejects(
        isolated.query(
          "UPDATE google_risc_event_receipt SET affected_session_count=0",
        ),
        /retention-governed/iu,
      );
      assert.equal(
        (
          await isolated.query(
            `SELECT count(*)::int AS count FROM audit_event
              WHERE event_type IN ('session.revoked','identity.risc_event_received')`,
          )
        ).rows[0].count,
        2,
      );

      const tokenRevoked = await inTransaction(isolated, (client) =>
        applyGoogleRiscEvent(client, {
          eventId: "risc-token-revoked-1",
          issuer: "https://accounts.google.com",
          audience: input.audience,
          issuedAt: 1_700_000_001,
          eventType:
            "https://schemas.openid.net/secevent/oauth/event-type/token-revoked",
          oauthTokenIdentifier: {
            algorithm: "prefix",
            value: "1234567890abcdef",
          },
          terminateSessions: false,
          correlationId: "risc-token-revoked-correlation-1",
          deploymentId: "risc-deployment-1",
        }),
      );
      assert.equal(tokenRevoked.affectedSessionCount, 0);
      const tokenReceipt = await isolated.query(
        `SELECT subject_sha256,action FROM google_risc_event_receipt
          WHERE receipt_id=$1`,
        [tokenRevoked.receiptId],
      );
      assert.deepEqual(
        tokenReceipt.rows[0].subject_sha256,
        digest("prefix:1234567890abcdef"),
      );
      assert.equal(tokenReceipt.rows[0].action, "recorded");

      await isolated.query(
        `INSERT INTO google_risc_event_receipt
           (receipt_id,event_id_sha256,issuer,audience_sha256,event_type,issued_at,
            subject_sha256,action,affected_session_count,request_correlation_id,
            deployment_id,received_at)
         VALUES($1,$2,'https://accounts.google.com',$3,
           'https://schemas.openid.net/secevent/risc/event-type/verification',
           clock_timestamp()-interval '61 days',NULL,'recorded',0,$4,$5,
           clock_timestamp()-interval '60 days')`,
        [
          randomUUID(),
          digest("old-retention-event"),
          digest(input.audience),
          "risc-retention-fixture",
          "risc-deployment-1",
        ],
      );
      const purged = await inTransaction(isolated, (client) =>
        purgeGoogleRiscReceipts(client, {
          cutoffAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1_000),
          reasonCode: "retention_expired",
          correlationId: "risc-retention-purge-1",
          deploymentId: "risc-deployment-1",
        }),
      );
      assert.equal(purged.purgedCount, 1);
      assert.equal(
        (
          await isolated.query(
            "SELECT count(*)::int AS count FROM google_risc_event_receipt",
          )
        ).rows[0].count,
        2,
      );
      const purgeAudit = await isolated.query(
        `SELECT purged_count,event_type_counts,reason_code
           FROM google_risc_receipt_purge_audit WHERE purge_batch_id=$1`,
        [purged.purgeBatchId],
      );
      assert.equal(purgeAudit.rows[0].purged_count, 1);
      assert.equal(purgeAudit.rows[0].reason_code, "retention_expired");
      assert.equal(
        purgeAudit.rows[0].event_type_counts[
          "https://schemas.openid.net/secevent/risc/event-type/verification"
        ],
        1,
      );

      assert.equal(
        await migrateDownLatest(isolated),
        "0013_domain_pack_v2_and_legacy_annotation",
      );
      assert.equal(
        await migrateDownLatest(isolated),
        "0012_consultant_pdf_render_ledger",
      );
      assert.equal(
        await migrateDownLatest(isolated),
        "0011_admin_system_scope_and_run_tier_immutability",
      );
      assert.equal(
        await migrateDownLatest(isolated),
        "0010_p4_live_pipeline_extraction_v2",
      );
      assert.equal(
        await migrateDownLatest(isolated),
        "0009_p4_google_risc_retention",
      );
      assert.equal(
        await migrateDownLatest(isolated),
        "0008_p4_google_risc_receiver",
      );
      assert.equal(
        (
          await isolated.query(
            "SELECT to_regclass('public.google_risc_event_receipt') IS NULL AS removed",
          )
        ).rows[0].removed,
        true,
      );
      assert.equal(
        (
          await isolated.query(
            "SELECT to_regclass('public.app_user') IS NOT NULL AS preserved",
          )
        ).rows[0].preserved,
        true,
      );
      assert.equal(await migrateUp(isolated), true);
      assert.equal(await migrateUp(isolated), false);
    } finally {
      if (isolated) await isolated.end();
      await control.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",
        [databaseName],
      );
      await control.query(`DROP DATABASE IF EXISTS ${databaseName}`);
      await control.end();
    }
  },
);
