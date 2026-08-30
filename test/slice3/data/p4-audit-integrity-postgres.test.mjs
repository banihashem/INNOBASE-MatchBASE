import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  appendAuditEvent,
  createAuditIntegrityCheckpoint,
  createPool,
  migrateDown,
  migrateUp,
  verifyLatestAuditIntegrityCheckpoint,
} from "../../../packages/data/dist/index.js";

const databaseUrl = process.env.DATABASE_URL;
const postgresTest = databaseUrl ? test : test.skip;

postgresTest(
  "P4 audit checkpoint detects an out-of-band mutation and records its affected range",
  async () => {
    const pool = createPool({ connectionString: databaseUrl, max: 4 });
    try {
      await migrateDown(pool).catch(() => false);
      await migrateUp(pool);
      const accountId = randomUUID();
      const userId = randomUUID();
      await pool.query(
        "INSERT INTO account(account_id,display_name,status) VALUES($1,'P4 audit integrity','active')",
        [accountId],
      );
      await pool.query(
        "INSERT INTO app_user(user_id,account_id,google_sub,email_verified,status) VALUES($1,$2,$3,true,'active')",
        [userId, accountId, `p4-audit-${userId}`],
      );
      const auditId = await appendAuditEvent(pool, {
        accountId,
        actorUserId: userId,
        actorTier: "admin",
        actorAdminSubRole: "security_audit",
        eventType: "audit.queried",
        resourceKind: "audit_event",
        outcome: "allow",
        correlationId: randomUUID(),
        deploymentId: "p4-audit-integrity-test",
        detail: { scope: "synthetic" },
      });
      const checkpoint = await createAuditIntegrityCheckpoint(pool, accountId);
      assert.equal(checkpoint.rowCount, 1);
      assert.equal(
        (await verifyLatestAuditIntegrityCheckpoint(pool, accountId))
          .consistent,
        true,
      );

      await assert.rejects(
        pool.query(
          "UPDATE audit_event SET detail='{}'::jsonb WHERE audit_id=$1",
          [auditId],
        ),
        /append-only/u,
      );

      await pool.query(
        "ALTER TABLE audit_event DISABLE TRIGGER audit_event_append_only",
      );
      try {
        await pool.query(
          'UPDATE audit_event SET detail=\'{"scope":"out-of-band-tamper"}\'::jsonb WHERE audit_id=$1',
          [auditId],
        );
      } finally {
        await pool.query(
          "ALTER TABLE audit_event ENABLE ALWAYS TRIGGER audit_event_append_only",
        );
      }

      const verification = await verifyLatestAuditIntegrityCheckpoint(
        pool,
        accountId,
      );
      assert.equal(verification.consistent, false);
      assert.deepEqual(verification.affectedRange, {
        fromAt: verification.affectedRange?.fromAt,
        fromAuditId: auditId,
        toAt: verification.affectedRange?.toAt,
        toAuditId: auditId,
      });
      await assert.rejects(
        pool.query(
          "DELETE FROM audit_integrity_verification WHERE verification_id=$1",
          [verification.verificationId],
        ),
        /append-only/u,
      );
    } finally {
      await migrateDown(pool).catch(() => false);
      await pool.end();
    }
  },
);
