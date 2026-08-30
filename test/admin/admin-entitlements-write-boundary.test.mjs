import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { mutateAdminEntitlement } from "../../packages/data/dist/index.js";

class BoundaryPool {
  constructor(
    actorId,
    subjectId,
    priorDigest = null,
    actorSubRole = "support",
    failAudit = false,
  ) {
    this.actorId = actorId;
    this.subjectId = subjectId;
    this.statements = [];
    this.priorDigest = priorDigest;
    this.actorSubRole = actorSubRole;
    this.failAudit = failAudit;
  }

  async connect() {
    return this;
  }

  release() {}

  async end() {}

  async query(text, values = []) {
    this.statements.push({ text, values });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/u.test(text))
      return { rows: [], rowCount: 0 };
    if (/DELETE FROM idempotency_record/u.test(text))
      return { rows: [], rowCount: 0 };
    if (/INSERT INTO idempotency_record/u.test(text))
      return this.priorDigest
        ? { rows: [], rowCount: 0 }
        : { rows: [{ idempotency_record_id: values[0] }], rowCount: 1 };
    if (/SELECT request_hash,response_body/u.test(text))
      return {
        rows: [
          {
            request_hash: this.priorDigest,
            response_body: { status: 200, code: "MB-200-ENTITLEMENT" },
          },
        ],
        rowCount: 1,
      };
    if (/FROM app_user/u.test(text))
      return {
        rows: [{ user_id: this.actorId }, { user_id: this.subjectId }],
        rowCount: 2,
      };
    if (/SELECT tier[\s\S]+FROM entitlement_grant/u.test(text)) {
      return values[1] === this.actorId
        ? { rows: [{ tier: "admin" }], rowCount: 1 }
        : { rows: [{ tier: "demo" }], rowCount: 1 };
    }
    if (/SELECT sub_role[\s\S]+FROM admin_role_grant/u.test(text)) {
      return values[1] === this.actorId
        ? { rows: [{ sub_role: this.actorSubRole }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (/SELECT clock_timestamp\(\) AS database_now/u.test(text)) {
      return {
        rows: [{ database_now: new Date("2026-08-25T12:00:00Z") }],
        rowCount: 1,
      };
    }
    if (/UPDATE entitlement_grant/u.test(text))
      return { rows: [], rowCount: 1 };
    if (/INSERT INTO entitlement_grant/u.test(text))
      return { rows: [], rowCount: 1 };
    if (/UPDATE admin_role_grant/u.test(text)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO audit_event/u.test(text)) {
      if (this.failAudit) throw new Error("Injected audit failure");
      return { rows: [], rowCount: 1 };
    }
    if (/UPDATE idempotency_record/u.test(text))
      return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected SQL in boundary test: ${text}`);
  }
}

test("repository boundary audits and denies a direct grant without stored super_admin", async () => {
  const actorId = randomUUID();
  const subjectId = randomUUID();
  const pool = new BoundaryPool(actorId, subjectId);
  const result = await mutateAdminEntitlement(pool, {
    accountId: randomUUID(),
    actorUserId: actorId,
    subjectUserId: subjectId,
    action: "grant",
    entitlementKind: "tier",
    entitlementValue: "standard",
    justification: "Direct repository boundary test",
    correlationId: randomUUID(),
    deploymentId: "admin-boundary-test",
    idempotencyKey: `boundary-${randomUUID()}`,
    requestDigest: createHash("sha256").update("request").digest(),
  });

  assert.equal(result.status, 403);
  assert.equal(result.reason, "super-admin-required");
  assert.equal(
    pool.statements.filter(({ text }) => /INSERT INTO audit_event/u.test(text))
      .length,
    1,
  );
  assert.equal(
    pool.statements.some(({ text }) =>
      /(?:INSERT INTO|UPDATE) (?:entitlement_grant|admin_role_grant)/u.test(
        text,
      ),
    ),
    false,
  );
  assert.equal(
    pool.statements.some(({ text }) => /^COMMIT$/u.test(text)),
    true,
  );
});

test("repository boundary audits a Consultant expiry that is not future by database time", async () => {
  const actorId = randomUUID();
  const subjectId = randomUUID();
  const pool = new BoundaryPool(actorId, subjectId, null, "super_admin");
  const expiresAt = "2026-08-25T11:59:59Z";
  const result = await mutateAdminEntitlement(pool, {
    accountId: randomUUID(),
    actorUserId: actorId,
    subjectUserId: subjectId,
    action: "grant",
    entitlementKind: "tier",
    entitlementValue: "consultant",
    expiresAt,
    justification: "Reject elapsed Consultant access",
    correlationId: randomUUID(),
    deploymentId: "admin-boundary-test",
    idempotencyKey: `boundary-${randomUUID()}`,
    requestDigest: createHash("sha256").update("expired request").digest(),
  });

  assert.equal(result.status, 422);
  assert.equal(result.reason, "expiry-not-future");
  assert.equal(
    pool.statements.some(({ text }) =>
      /(?:INSERT INTO|UPDATE) (?:entitlement_grant|admin_role_grant)/u.test(
        text,
      ),
    ),
    false,
  );
  const audit = pool.statements.find(({ text }) =>
    /INSERT INTO audit_event/u.test(text),
  );
  assert.equal(JSON.parse(audit.values[14]).expires_at, expiresAt);
});

test("repository boundary audits and rejects a calendar-invalid RFC3339 expiry", async () => {
  const actorId = randomUUID();
  const subjectId = randomUUID();
  const pool = new BoundaryPool(actorId, subjectId, null, "super_admin");
  const expiresAt = "2099-02-30T00:00:00Z";
  const result = await mutateAdminEntitlement(pool, {
    accountId: randomUUID(),
    actorUserId: actorId,
    subjectUserId: subjectId,
    action: "grant",
    entitlementKind: "tier",
    entitlementValue: "consultant",
    expiresAt,
    justification: "Reject calendar-invalid Consultant access",
    correlationId: randomUUID(),
    deploymentId: "admin-boundary-test",
    idempotencyKey: `boundary-${randomUUID()}`,
    requestDigest: createHash("sha256")
      .update("calendar-invalid request")
      .digest(),
  });

  assert.equal(result.status, 422);
  assert.equal(result.reason, "expiry-invalid");
  assert.equal(
    pool.statements.some(({ text }) =>
      /(?:INSERT INTO|UPDATE) (?:entitlement_grant|admin_role_grant)/u.test(
        text,
      ),
    ),
    false,
  );
  assert.equal(
    pool.statements.some(({ text }) =>
      /SELECT clock_timestamp\(\) AS database_now/u.test(text),
    ),
    false,
  );
  const audit = pool.statements.find(({ text }) =>
    /INSERT INTO audit_event/u.test(text),
  );
  assert.equal(JSON.parse(audit.values[14]).expires_at, expiresAt);
});

test("idempotency key reuse with a different payload returns 409 without subject disclosure", async () => {
  const actorId = randomUUID();
  const subjectId = randomUUID();
  const pool = new BoundaryPool(
    actorId,
    subjectId,
    createHash("sha256").update("prior request").digest(),
    "super_admin",
  );
  const result = await mutateAdminEntitlement(pool, {
    accountId: randomUUID(),
    actorUserId: actorId,
    subjectUserId: subjectId,
    action: "grant",
    entitlementKind: "tier",
    entitlementValue: "consultant",
    justification: "Different request payload",
    correlationId: randomUUID(),
    deploymentId: "admin-boundary-test",
    idempotencyKey: `boundary-${randomUUID()}`,
    requestDigest: createHash("sha256").update("new request").digest(),
  });

  assert.deepEqual(result, {
    status: 409,
    code: "MB-409-IDEMPOTENCY",
    reason: "idempotency-key-reuse",
    replayed: true,
  });
  assert.equal(JSON.stringify(result).includes(subjectId), false);
  assert.equal(
    pool.statements.some(({ text }) =>
      /(?:INSERT INTO|UPDATE) (?:entitlement_grant|admin_role_grant)/u.test(
        text,
      ),
    ),
    false,
  );
  assert.equal(
    pool.statements.some(({ text }) => /^COMMIT$/u.test(text)),
    true,
  );
});

test("different-payload replay denies current non-super-admin before conflict metadata", async () => {
  const actorId = randomUUID();
  const subjectId = randomUUID();
  const pool = new BoundaryPool(
    actorId,
    subjectId,
    createHash("sha256").update("prior request").digest(),
  );
  const result = await mutateAdminEntitlement(pool, {
    accountId: randomUUID(),
    actorUserId: actorId,
    subjectUserId: subjectId,
    action: "grant",
    entitlementKind: "tier",
    entitlementValue: "consultant",
    justification: "Unauthorized conflict must remain a policy denial",
    correlationId: randomUUID(),
    deploymentId: "admin-boundary-test",
    idempotencyKey: `boundary-${randomUUID()}`,
    requestDigest: createHash("sha256").update("different request").digest(),
  });

  assert.equal(result.status, 403);
  assert.equal(result.reason, "super-admin-required");
  assert.equal(
    pool.statements.filter(({ text }) => /INSERT INTO audit_event/u.test(text))
      .length,
    1,
  );
});

test("cached success replay re-resolves current stored authority and denies a revoked super-admin", async () => {
  const actorId = randomUUID();
  const subjectId = randomUUID();
  const requestDigest = createHash("sha256").update("same request").digest();
  const pool = new BoundaryPool(actorId, subjectId, requestDigest);
  const result = await mutateAdminEntitlement(pool, {
    accountId: randomUUID(),
    actorUserId: actorId,
    subjectUserId: subjectId,
    action: "grant",
    entitlementKind: "tier",
    entitlementValue: "standard",
    justification: "Replay after stored authority revocation",
    correlationId: randomUUID(),
    deploymentId: "admin-boundary-test",
    idempotencyKey: `boundary-${randomUUID()}`,
    requestDigest,
  });

  assert.equal(result.status, 403);
  assert.equal(result.reason, "super-admin-required");
  assert.equal(result.replayed, false);
  assert.equal(
    pool.statements.some(({ text }) => /FROM app_user/u.test(text)),
    true,
  );
  assert.equal(
    pool.statements.filter(({ text }) => /INSERT INTO audit_event/u.test(text))
      .length,
    1,
  );
  assert.equal(
    pool.statements.some(({ text }) =>
      /(?:INSERT INTO|UPDATE) (?:entitlement_grant|admin_role_grant)/u.test(
        text,
      ),
    ),
    false,
  );
});

test("audit-write failure rolls back the entitlement transaction", async () => {
  const actorId = randomUUID();
  const subjectId = randomUUID();
  const pool = new BoundaryPool(actorId, subjectId, null, "super_admin", true);
  await assert.rejects(
    mutateAdminEntitlement(pool, {
      accountId: randomUUID(),
      actorUserId: actorId,
      subjectUserId: subjectId,
      action: "grant",
      entitlementKind: "tier",
      entitlementValue: "standard",
      justification: "Injected audit rollback test",
      correlationId: randomUUID(),
      deploymentId: "admin-boundary-test",
      idempotencyKey: `boundary-${randomUUID()}`,
      requestDigest: createHash("sha256").update("audit failure").digest(),
    }),
    /Injected audit failure/u,
  );
  assert.equal(
    pool.statements.some(({ text }) => /^ROLLBACK$/u.test(text)),
    true,
  );
  assert.equal(
    pool.statements.some(({ text }) => /^COMMIT$/u.test(text)),
    false,
  );
});
