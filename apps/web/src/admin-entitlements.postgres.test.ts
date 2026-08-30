import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type MatchBaseApplication,
  type RequestContext,
} from "@matchbase/application";
import { sha256Base64Url } from "@matchbase/auth";
import type { AdminSubRole } from "@matchbase/contracts";
import {
  createPool,
  migrateUp,
  readEntitlementSnapshot,
  type ConnectionPool,
} from "@matchbase/data";
import type { WebConfig } from "./config";
import { createWebRuntime } from "./runtime";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe.sequential : describe.skip;
const task105IsolatedDatabase =
  process.env.MATCHBASE_TASK105_ISOLATED_DATABASE === "true";
const csrf = "admin-entitlements-csrf-token-32-bytes";

interface Subject {
  readonly accountId: string;
  readonly userId: string;
  readonly handle: string;
}

interface AdminSubject extends Subject {
  readonly role: AdminSubRole;
}

describePostgres("admin entitlement HTTP write boundary", () => {
  let pool: ConnectionPool;
  let server: Server;
  let baseUrl: string;
  let superAdmin: Subject;
  let deniedActors: AdminSubject[];
  let target: Subject;
  let crossAccountTarget: Subject;

  beforeAll(async () => {
    pool = createPool({ connectionString: databaseUrl!, max: 8 });
    if (task105IsolatedDatabase) {
      const current = await pool.query<{ current_database: string }>(
        "SELECT current_database()",
      );
      if (!current.rows[0]?.current_database.startsWith("matchbase_task105_")) {
        throw new Error(
          "TASK-105 failure injection requires a named isolated database.",
        );
      }
    }
    await migrateUp(pool);
    const accountId = randomUUID();
    const grantorId = randomUUID();
    const superAdminId = randomUUID();
    const targetId = randomUUID();
    const superHandle = `super-${randomUUID()}`;
    const deniedFixtures = (
      [
        "support",
        "analyst",
        "consultant_manager",
        "product",
        "security_audit",
      ] as const
    ).map((role) => ({
      role,
      userId: randomUUID(),
      handle: `${role}-${randomUUID()}`,
    }));
    await pool.query(
      "INSERT INTO account(account_id,display_name,status) VALUES($1,'Admin entitlement test','active')",
      [accountId],
    );
    for (const [userId, label] of [
      [grantorId, "grantor"],
      [superAdminId, "super"],
      ...deniedFixtures.map(({ userId, role }) => [userId, role] as const),
      [targetId, "target"],
    ] as const) {
      await pool.query(
        `INSERT INTO app_user
          (user_id,account_id,google_sub,email_verified,status)
         VALUES($1,$2,$3,true,'active')`,
        [userId, accountId, `admin-entitlement-${label}-${userId}`],
      );
    }
    for (const [userId, tier] of [
      [superAdminId, "admin"],
      ...deniedFixtures.map(({ userId }) => [userId, "admin"] as const),
      [targetId, "demo"],
    ] as const) {
      await pool.query(
        `INSERT INTO entitlement_grant
          (grant_id,account_id,user_id,tier,grant_actor_kind,granted_by_user_id,
           justification,effective_from)
         VALUES($1,$2,$3,$4,$5,$6,'admin entitlement fixture',clock_timestamp())`,
        [
          randomUUID(),
          accountId,
          userId,
          tier,
          tier === "demo" ? "system" : "user",
          tier === "demo" ? null : grantorId,
        ],
      );
    }
    for (const [userId, role] of [
      [superAdminId, "super_admin"],
      ...deniedFixtures.map(({ userId, role }) => [userId, role] as const),
    ] as const) {
      await pool.query(
        `INSERT INTO admin_role_grant
          (admin_grant_id,account_id,user_id,sub_role,granted_by_user_id,
           justification,effective_from)
         VALUES($1,$2,$3,$4,$5,'admin entitlement fixture',clock_timestamp())`,
        [randomUUID(), accountId, userId, role, grantorId],
      );
    }
    for (const [userId, handle] of [
      [superAdminId, superHandle],
      ...deniedFixtures.map(({ userId, handle }) => [userId, handle] as const),
    ] as const) {
      await pool.query(
        `INSERT INTO user_session
          (session_id,account_id,user_id,handle_hash,csrf_token_hash,
           absolute_expires_at,idle_expires_at)
         VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',
                clock_timestamp()+interval '30 minutes')`,
        [
          randomUUID(),
          accountId,
          userId,
          Buffer.from(sha256Base64Url(handle), "base64url"),
          Buffer.from(sha256Base64Url(csrf), "base64url"),
        ],
      );
    }
    superAdmin = { accountId, userId: superAdminId, handle: superHandle };
    deniedActors = deniedFixtures.map(({ role, userId, handle }) => ({
      accountId,
      role,
      userId,
      handle,
    }));
    target = { accountId, userId: targetId, handle: "" };
    const crossAccountId = randomUUID();
    const crossAccountTargetId = randomUUID();
    await pool.query(
      "INSERT INTO account(account_id,display_name,status) VALUES($1,'Cross-account entitlement test','active')",
      [crossAccountId],
    );
    await pool.query(
      `INSERT INTO app_user
        (user_id,account_id,google_sub,email_verified,status)
       VALUES($1,$2,$3,true,'active')`,
      [
        crossAccountTargetId,
        crossAccountId,
        `admin-entitlement-cross-account-${crossAccountTargetId}`,
      ],
    );
    await pool.query(
      `INSERT INTO entitlement_grant
        (grant_id,account_id,user_id,tier,grant_actor_kind,justification,
         effective_from)
       VALUES($1,$2,$3,'demo','system','cross-account fixture',clock_timestamp())`,
      [randomUUID(), crossAccountId, crossAccountTargetId],
    );
    crossAccountTarget = {
      accountId: crossAccountId,
      userId: crossAccountTargetId,
      handle: "",
    };

    const fakeApplication = {
      readiness: async () => true,
      me: async (context: RequestContext) => ({
        tier: context.tier,
        admin_sub_roles: context.adminSubRoles,
      }),
    } as unknown as MatchBaseApplication;
    const config: WebConfig = {
      environment: "test",
      origin: "http://127.0.0.1",
      deploymentId: "admin-entitlements-test",
      databaseUrl: databaseUrl!,
      oidcSimulatorEnabled: false,
      syntheticFixtureEnabled: true,
      digestKey: Buffer.from("admin-entitlements-test-key-32-bytes"),
      port: 0,
    };
    const listener = createWebRuntime({
      config,
      pool,
      application: fakeApplication,
    });
    server = createServer((request, response) => {
      void listener(request, response);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port.");
    baseUrl = `http://127.0.0.1:${address.port}`;
    config.origin = baseUrl;
  }, 30_000);

  afterAll(async () => {
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    if (pool) await pool.end();
  });

  async function mutate(
    actor: Subject,
    body: Record<string, unknown>,
    key: string,
    forged = false,
  ): Promise<Response> {
    const suffix = forged
      ? "?tier=admin&admin_sub_role=super_admin&oidc_role=super_admin"
      : "";
    return fetch(`${baseUrl}/api/v1/admin/entitlements${suffix}`, {
      method: "POST",
      headers: {
        cookie: `__Host-matchbase_session=${actor.handle}`,
        origin: baseUrl,
        "x-csrf-token": csrf,
        "idempotency-key": key,
        "content-type": "application/json",
        ...(forged
          ? {
              authorization:
                "Bearer forged.oidc.claims.tier-admin-role-super-admin",
              "x-matchbase-tier": "admin",
              "x-matchbase-admin-sub-role": "super_admin",
              "x-oidc-tier": "admin",
              "x-oidc-role": "super_admin",
            }
          : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async function read(
    actor: Subject,
    subjectUserId: string,
  ): Promise<Response> {
    return fetch(
      `${baseUrl}/api/v1/admin/entitlements?subject_user_id=${encodeURIComponent(subjectUserId)}`,
      {
        headers: {
          cookie: `__Host-matchbase_session=${actor.handle}`,
        },
      },
    );
  }

  async function createTierActor(
    tier: "demo" | "standard" | "consultant",
  ): Promise<Subject> {
    const userId = randomUUID();
    const handle = `${tier}-${randomUUID()}`;
    await pool.query(
      `INSERT INTO app_user
        (user_id,account_id,google_sub,email_verified,status)
       VALUES($1,$2,$3,true,'active')`,
      [userId, superAdmin.accountId, `admin-self-${tier}-${userId}`],
    );
    await pool.query(
      `INSERT INTO entitlement_grant
        (grant_id,account_id,user_id,tier,grant_actor_kind,granted_by_user_id,
         justification,effective_from)
       VALUES($1,$2,$3,$4,$5,$6,'self-elevation matrix fixture',clock_timestamp())`,
      [
        randomUUID(),
        superAdmin.accountId,
        userId,
        tier,
        tier === "demo" ? "system" : "user",
        tier === "demo" ? null : superAdmin.userId,
      ],
    );
    await pool.query(
      `INSERT INTO user_session
        (session_id,account_id,user_id,handle_hash,csrf_token_hash,
         absolute_expires_at,idle_expires_at)
       VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',
              clock_timestamp()+interval '30 minutes')`,
      [
        randomUUID(),
        superAdmin.accountId,
        userId,
        Buffer.from(sha256Base64Url(handle), "base64url"),
        Buffer.from(sha256Base64Url(csrf), "base64url"),
      ],
    );
    return { accountId: superAdmin.accountId, userId, handle };
  }

  const grantStandard = () => ({
    action: "grant",
    subject_user_id: target.userId,
    entitlement_kind: "tier",
    entitlement_value: "standard",
    justification: "Approved synthetic admin entitlement test",
  });

  it("grants through the super-admin boundary and replays without a second audit", async () => {
    const key = `admin-grant-${randomUUID()}`;
    const first = await mutate(superAdmin, grantStandard(), key);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { audit_id: string };
    expect(
      await readEntitlementSnapshot(pool, target.accountId, target.userId),
    ).toEqual({ tier: "standard", adminSubRoles: [] });

    const replay = await mutate(superAdmin, grantStandard(), key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("mb-idempotent-replay")).toBe("true");
    expect(await replay.json()).toEqual(firstBody);
    const audit = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_event WHERE audit_id=$1",
      [firstBody.audit_id],
    );
    expect(audit.rows[0]?.count).toBe("1");
  });

  it("requires, persists, audits, replays and naturally expires a Consultant grant", async () => {
    const consultantUserId = randomUUID();
    await pool.query(
      `INSERT INTO app_user
        (user_id,account_id,google_sub,email_verified,status)
       VALUES($1,$2,$3,true,'active')`,
      [
        consultantUserId,
        superAdmin.accountId,
        `consultant-expiry-${consultantUserId}`,
      ],
    );
    await pool.query(
      `INSERT INTO entitlement_grant
        (grant_id,account_id,user_id,tier,grant_actor_kind,justification,
         effective_from)
       VALUES($1,$2,$3,'demo','system','consultant expiry fixture',clock_timestamp())`,
      [randomUUID(), superAdmin.accountId, consultantUserId],
    );
    const base = {
      action: "grant",
      subject_user_id: consultantUserId,
      entitlement_kind: "tier",
      entitlement_value: "consultant",
      justification: "Approved time-bounded Consultant access",
    };

    expect(
      (await mutate(superAdmin, base, `consultant-missing-${randomUUID()}`))
        .status,
    ).toBe(422);
    expect(
      (
        await mutate(
          superAdmin,
          { ...base, expires_at: "not-rfc3339" },
          `consultant-malformed-${randomUUID()}`,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await mutate(
          superAdmin,
          { ...base, expires_at: "2000-01-01T00:00:00Z" },
          `consultant-past-${randomUUID()}`,
        )
      ).status,
    ).toBe(422);

    const expiresAt = new Date(Date.now() + 4_000).toISOString();
    const key = `consultant-future-${randomUUID()}`;
    const request = { ...base, expires_at: expiresAt };
    const grant = await mutate(superAdmin, request, key);
    expect(grant.status).toBe(200);
    const grantBody = (await grant.json()) as {
      audit_id: string;
      expires_at: string;
      after: { tier: string };
    };
    expect(grantBody).toMatchObject({
      expires_at: expiresAt,
      after: { tier: "consultant" },
    });
    const replay = await mutate(superAdmin, request, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get("mb-idempotent-replay")).toBe("true");
    expect(await replay.json()).toEqual(grantBody);

    const stored = await pool.query<{
      effective_to: Date;
      detail: { expires_at: string };
    }>(
      `SELECT entitlement.effective_to,audit.detail
         FROM entitlement_grant entitlement
         JOIN audit_event audit ON audit.audit_id=$4
        WHERE entitlement.account_id=$1 AND entitlement.user_id=$2
          AND entitlement.tier='consultant'
          AND entitlement.granted_by_user_id=$3
        ORDER BY entitlement.created_at DESC LIMIT 1`,
      [
        superAdmin.accountId,
        consultantUserId,
        superAdmin.userId,
        grantBody.audit_id,
      ],
    );
    expect(stored.rows[0]?.effective_to.toISOString()).toBe(expiresAt);
    expect(stored.rows[0]?.detail.expires_at).toBe(expiresAt);

    const activeRead = await read(superAdmin, consultantUserId);
    expect(activeRead.status).toBe(200);
    const activeBody = (await activeRead.json()) as {
      current: { tier: string | null; tier_expires_at: string | null };
      history: Array<{
        value: string;
        effective_to: string | null;
        justification: string;
      }>;
    };
    expect(activeBody.current).toMatchObject({
      tier: "consultant",
      tier_expires_at: expiresAt,
    });
    expect(activeBody.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "consultant",
          effective_to: expiresAt,
          justification: base.justification,
        }),
      ]),
    );
    expect(JSON.stringify(activeBody)).not.toMatch(
      /email|google_sub|display_name/iu,
    );

    await new Promise((resolve) => setTimeout(resolve, 4_200));
    const expiredRead = await read(superAdmin, consultantUserId);
    expect(expiredRead.status).toBe(200);
    const expiredBody = (await expiredRead.json()) as typeof activeBody;
    expect(expiredBody.current).toMatchObject({
      tier: null,
      tier_expires_at: null,
    });
    expect(expiredBody.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "consultant",
          effective_to: expiresAt,
        }),
      ]),
    );
  }, 15_000);

  it("ignores forged OIDC/client authority and audits a denied unchanged action", async () => {
    const support = deniedActors.find(({ role }) => role === "support")!;
    const before = await readEntitlementSnapshot(
      pool,
      target.accountId,
      target.userId,
    );
    const response = await mutate(
      support,
      {
        ...grantStandard(),
        entitlement_value: "consultant",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        justification: "Forged authority must not change entitlement",
      },
      `forged-${randomUUID()}`,
      true,
    );
    expect(response.status).toBe(403);
    expect(
      await readEntitlementSnapshot(pool, target.accountId, target.userId),
    ).toEqual(before);
    const denial = await pool.query<{
      actor_user_id: string;
      detail: { reasonCode?: string };
    }>(
      `SELECT actor_user_id,detail FROM audit_event
        WHERE account_id=$1 AND event_type='authz.denied'
        ORDER BY occurred_at DESC LIMIT 1`,
      [target.accountId],
    );
    expect(denial.rows[0]).toMatchObject({
      actor_user_id: support.userId,
      detail: { reasonCode: "super-admin-required" },
    });
  });

  it("denies tier and sub-role writes from every non-super-admin sub-role", async () => {
    const before = await readEntitlementSnapshot(
      pool,
      target.accountId,
      target.userId,
    );
    const auditBefore = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_event
        WHERE account_id=$1 AND event_type='authz.denied'`,
      [target.accountId],
    );
    for (const actor of deniedActors) {
      for (const body of [
        {
          ...grantStandard(),
          entitlement_value: "consultant",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          justification: `${actor.role} tier denial`,
        },
        {
          ...grantStandard(),
          entitlement_kind: "admin_sub_role",
          entitlement_value: "analyst",
          justification: `${actor.role} sub-role denial`,
        },
      ]) {
        expect(
          (await mutate(actor, body, `denied-${randomUUID()}`)).status,
        ).toBe(403);
      }
    }
    expect(
      await readEntitlementSnapshot(pool, target.accountId, target.userId),
    ).toEqual(before);
    const auditAfter = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_event
        WHERE account_id=$1 AND event_type='authz.denied'`,
      [target.accountId],
    );
    expect(Number(auditAfter.rows[0]?.count)).toBe(
      Number(auditBefore.rows[0]?.count) + 10,
    );
  });

  it("grants and revokes a sub-role with attributable before/after audit history", async () => {
    expect(
      (
        await mutate(
          superAdmin,
          {
            ...grantStandard(),
            entitlement_value: "admin",
            justification: "Prepare target for sub-role acceptance",
          },
          `admin-tier-${randomUUID()}`,
        )
      ).status,
    ).toBe(200);
    const grant = await mutate(
      superAdmin,
      {
        ...grantStandard(),
        entitlement_kind: "admin_sub_role",
        entitlement_value: "analyst",
        justification: "Approved analyst assignment",
      },
      `role-grant-${randomUUID()}`,
    );
    expect(grant.status).toBe(200);
    const grantBody = (await grant.json()) as { audit_id: string };
    expect(
      await readEntitlementSnapshot(pool, target.accountId, target.userId),
    ).toEqual({ tier: "admin", adminSubRoles: ["analyst"] });

    const revoke = await mutate(
      superAdmin,
      {
        action: "revoke",
        subject_user_id: target.userId,
        entitlement_kind: "admin_sub_role",
        entitlement_value: "analyst",
        justification: "Approved analyst revocation",
      },
      `role-revoke-${randomUUID()}`,
    );
    expect(revoke.status).toBe(200);
    const revokeBody = (await revoke.json()) as { audit_id: string };
    expect(
      await readEntitlementSnapshot(pool, target.accountId, target.userId),
    ).toEqual({ tier: "admin", adminSubRoles: [] });

    const audits = await pool.query<{
      actor_user_id: string;
      resource_id: string;
      occurred_at: Date;
      detail: {
        tier: string | null;
        sub_role: string | null;
        expires_at: string | null;
        before: { admin_sub_roles: string[] };
        after: { admin_sub_roles: string[] };
      };
    }>(
      `SELECT actor_user_id,resource_id,occurred_at,detail FROM audit_event
        WHERE audit_id=ANY($1::uuid[]) ORDER BY occurred_at`,
      [[grantBody.audit_id, revokeBody.audit_id]],
    );
    expect(audits.rows).toHaveLength(2);
    expect(audits.rows[0]).toMatchObject({
      actor_user_id: superAdmin.userId,
      resource_id: target.userId,
      detail: {
        tier: null,
        sub_role: "analyst",
        expires_at: null,
        before: { admin_sub_roles: [] },
        after: { admin_sub_roles: ["analyst"] },
      },
    });
    expect(audits.rows[1]).toMatchObject({
      actor_user_id: superAdmin.userId,
      resource_id: target.userId,
      detail: {
        tier: null,
        sub_role: "analyst",
        expires_at: null,
        before: { admin_sub_roles: ["analyst"] },
        after: { admin_sub_roles: [] },
      },
    });
    expect(
      audits.rows.every(({ occurred_at }) => occurred_at instanceof Date),
    ).toBe(true);
  });

  it("returns the tenant-scoped current entitlement and immutable grant history", async () => {
    const response = await read(superAdmin, target.userId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      subject_user_id: string;
      current: {
        tier: string | null;
        admin_sub_roles: string[];
        tier_expires_at: string | null;
      };
      history: Array<{
        kind: string;
        value: string;
        effective_from: string;
        effective_to: string | null;
        revoked_at: string | null;
        grant_actor_kind: "system" | "user";
        granted_by: string | null;
        revoked_by: string | null;
        justification: string;
      }>;
    };
    expect(body.subject_user_id).toBe(target.userId);
    expect(body.current).toEqual({
      tier: "admin",
      admin_sub_roles: [],
      tier_expires_at: null,
    });
    expect(body.history.length).toBeGreaterThanOrEqual(4);
    expect(body.history.map(({ kind, value }) => ({ kind, value }))).toEqual(
      expect.arrayContaining([
        { kind: "tier", value: "demo" },
        { kind: "tier", value: "standard" },
        { kind: "tier", value: "admin" },
        { kind: "admin_sub_role", value: "analyst" },
      ]),
    );
    const analyst = body.history.find(
      ({ kind, value }) => kind === "admin_sub_role" && value === "analyst",
    );
    expect(analyst).toMatchObject({
      grant_actor_kind: "user",
      granted_by: superAdmin.userId,
      revoked_by: superAdmin.userId,
      justification: "Approved analyst assignment",
      effective_to: null,
    });
    expect(analyst?.effective_from).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(analyst?.revoked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(
      body.history.find(
        ({ kind, value }) => kind === "tier" && value === "demo",
      ),
    ).toMatchObject({
      grant_actor_kind: "system",
      granted_by: null,
    });
    expect(JSON.stringify(body)).not.toMatch(/email|google_sub|display_name/iu);
  });

  it("returns one uniform 403 for non-super and cross-account reads", async () => {
    const support = deniedActors.find(({ role }) => role === "support")!;
    const nonSuper = await read(support, target.userId);
    const crossAccount = await read(superAdmin, crossAccountTarget.userId);
    expect(nonSuper.status).toBe(403);
    expect(crossAccount.status).toBe(403);
    const nonSuperBody = (await nonSuper.json()) as Record<string, unknown>;
    const crossAccountBody = (await crossAccount.json()) as Record<
      string,
      unknown
    >;
    const { correlation_id: nonSuperCorrelation, ...nonSuperRefusal } =
      nonSuperBody;
    const { correlation_id: crossAccountCorrelation, ...crossAccountRefusal } =
      crossAccountBody;
    expect(nonSuperCorrelation).toEqual(expect.any(String));
    expect(crossAccountCorrelation).toEqual(expect.any(String));
    expect(nonSuperRefusal).toEqual(crossAccountRefusal);
  });

  it("refuses revocation of the last active security-audit assignment", async () => {
    const securityAudit = deniedActors.find(
      ({ role }) => role === "security_audit",
    )!;
    const response = await mutate(
      superAdmin,
      {
        action: "revoke",
        subject_user_id: securityAudit.userId,
        entitlement_kind: "admin_sub_role",
        entitlement_value: "security_audit",
        justification: "Attempt final security-audit revocation",
      },
      `last-security-audit-${randomUUID()}`,
    );
    expect(response.status).toBe(422);
    expect(
      await readEntitlementSnapshot(
        pool,
        securityAudit.accountId,
        securityAudit.userId,
      ),
    ).toEqual({ tier: "admin", adminSubRoles: ["security_audit"] });
  });

  it("rejects key reuse and unknown DTO fields", async () => {
    const reused = `reuse-${randomUUID()}`;
    expect((await mutate(superAdmin, grantStandard(), reused)).status).toBe(
      200,
    );
    expect(
      (
        await mutate(
          superAdmin,
          {
            ...grantStandard(),
            entitlement_value: "consultant",
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
          reused,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await mutate(
          superAdmin,
          { ...grantStandard(), oidc_role: "super_admin" },
          `closed-${randomUUID()}`,
        )
      ).status,
    ).toBe(422);
  });

  it("persists exactly one linked durable alert for every tier and Admin sub-role self-elevation refusal", async () => {
    const tierActors = await Promise.all(
      (["demo", "standard", "consultant"] as const).map(createTierActor),
    );
    const cases = [
      ...tierActors.map((actor) => ({
        actor,
        body: {
          action: "grant",
          subject_user_id: actor.userId,
          entitlement_kind: "tier",
          entitlement_value: "admin",
          justification: "Synthetic tier self-elevation refusal",
        },
      })),
      ...[superAdmin, ...deniedActors].map((actor) => ({
        actor,
        body: {
          action: "grant",
          subject_user_id: actor.userId,
          entitlement_kind: "admin_sub_role",
          entitlement_value: "super_admin",
          justification: "Synthetic sub-role self-elevation refusal",
        },
      })),
    ];
    const alertBefore = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM security_alert WHERE account_id=$1",
      [superAdmin.accountId],
    );
    const snapshots = new Map(
      await Promise.all(
        cases.map(
          async ({ actor }) =>
            [
              actor.userId,
              await readEntitlementSnapshot(
                pool,
                actor.accountId,
                actor.userId,
              ),
            ] as const,
        ),
      ),
    );

    for (const { actor, body } of cases) {
      expect(
        (await mutate(actor, body, `self-matrix-${randomUUID()}`)).status,
      ).toBe(403);
      expect(
        await readEntitlementSnapshot(pool, actor.accountId, actor.userId),
      ).toEqual(snapshots.get(actor.userId));
    }

    const alerts = await pool.query<{
      audit_id: string;
      account_id: string;
      actor_user_id: string;
      subject_user_id: string;
      event_type: string;
      severity: string;
      reason_code: string;
      entitlement_kind: string;
      entitlement_value: string;
      request_correlation_id: string;
      deployment_id: string;
      occurred_at: Date;
      audit_account_id: string;
      audit_actor_user_id: string;
      audit_resource_id: string;
      audit_event_type: string;
      audit_outcome: string;
      audit_correlation_id: string;
      audit_deployment_id: string;
      audit_occurred_at: Date;
    }>(
      `SELECT alert.audit_id,alert.account_id,alert.actor_user_id,
              alert.subject_user_id,alert.event_type,alert.severity,
              alert.reason_code,alert.entitlement_kind,alert.entitlement_value,
              alert.request_correlation_id,alert.deployment_id,alert.occurred_at,
              audit.account_id AS audit_account_id,
              audit.actor_user_id AS audit_actor_user_id,
              audit.resource_id AS audit_resource_id,
              audit.event_type AS audit_event_type,audit.outcome AS audit_outcome,
              audit.request_correlation_id AS audit_correlation_id,
              audit.deployment_id AS audit_deployment_id,
              audit.occurred_at AS audit_occurred_at
         FROM security_alert alert
         JOIN audit_event audit ON audit.audit_id=alert.audit_id
        WHERE alert.account_id=$1
        ORDER BY alert.occurred_at DESC
        LIMIT $2`,
      [superAdmin.accountId, cases.length],
    );
    expect(Number(alertBefore.rows[0]?.count) + cases.length).toBe(
      Number(
        (
          await pool.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM security_alert WHERE account_id=$1",
            [superAdmin.accountId],
          )
        ).rows[0]?.count,
      ),
    );
    expect(alerts.rows).toHaveLength(cases.length);
    for (const alert of alerts.rows) {
      expect(alert).toMatchObject({
        account_id: alert.audit_account_id,
        actor_user_id: alert.audit_actor_user_id,
        subject_user_id: alert.audit_resource_id,
        event_type: "security.self_elevation_attempted",
        audit_event_type: "security.self_elevation_attempted",
        severity: "high",
        reason_code: "self-mutation-refused",
        audit_outcome: "deny",
        request_correlation_id: alert.audit_correlation_id,
        deployment_id: alert.audit_deployment_id,
        occurred_at: alert.audit_occurred_at,
      });
    }
  });

  it("does not duplicate the durable alert on an exact idempotent replay", async () => {
    const key = `self-replay-${randomUUID()}`;
    const body = {
      action: "grant",
      subject_user_id: superAdmin.userId,
      entitlement_kind: "admin_sub_role",
      entitlement_value: "super_admin",
      justification: "Synthetic replay-safe self-elevation refusal",
    };
    const before = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM security_alert WHERE account_id=$1 AND actor_user_id=$2",
      [superAdmin.accountId, superAdmin.userId],
    );
    expect((await mutate(superAdmin, body, key)).status).toBe(403);
    const replay = await mutate(superAdmin, body, key);
    expect(replay.status).toBe(403);
    expect(replay.headers.get("mb-idempotent-replay")).toBe("true");
    const after = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM security_alert WHERE account_id=$1 AND actor_user_id=$2",
      [superAdmin.accountId, superAdmin.userId],
    );
    expect(Number(after.rows[0]?.count)).toBe(
      Number(before.rows[0]?.count) + 1,
    );
  });

  it("keeps cross-account refusal non-disclosing without creating a self-elevation alert", async () => {
    const before = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM security_alert WHERE account_id=$1",
      [superAdmin.accountId],
    );
    const response = await mutate(
      superAdmin,
      {
        ...grantStandard(),
        subject_user_id: crossAccountTarget.userId,
        justification: "Synthetic cross-account refusal",
      },
      `cross-account-${randomUUID()}`,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      status: 403,
      code: "MB-403-ENTITLEMENT",
      title: "Forbidden",
    });
    const after = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM security_alert WHERE account_id=$1",
      [superAdmin.accountId],
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it.runIf(task105IsolatedDatabase)(
    "rolls back audit, alert and idempotency reservation when durable alert persistence fails",
    async () => {
      const key = `self-alert-failure-${randomUUID()}`;
      const body = {
        action: "grant",
        subject_user_id: superAdmin.userId,
        entitlement_kind: "tier",
        entitlement_value: "admin",
        justification: "Synthetic injected durable alert failure",
      };
      const entitlementBefore = await readEntitlementSnapshot(
        pool,
        superAdmin.accountId,
        superAdmin.userId,
      );
      let failedCorrelation = "";
      try {
        await pool.query(`
        CREATE FUNCTION matchbase_test_fail_security_alert() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'injected security alert persistence failure';
        END;
        $$;
        CREATE TRIGGER security_alert_00_injected_failure
        BEFORE INSERT ON security_alert
        FOR EACH ROW EXECUTE FUNCTION matchbase_test_fail_security_alert();
      `);
        const response = await mutate(superAdmin, body, key);
        expect(response.status).toBe(503);
        const fault = (await response.json()) as {
          code: string;
          correlation_id: string;
        };
        expect(fault.code).toBe("MB-503-AUDIT");
        failedCorrelation = fault.correlation_id;
      } finally {
        await pool.query(
          "DROP TRIGGER IF EXISTS security_alert_00_injected_failure ON security_alert",
        );
        await pool.query(
          "DROP FUNCTION IF EXISTS matchbase_test_fail_security_alert()",
        );
      }
      const rolledBack = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_event
        WHERE request_correlation_id=$1
          AND event_type='security.self_elevation_attempted'`,
        [failedCorrelation],
      );
      expect(rolledBack.rows[0]?.count).toBe("0");
      expect(
        await readEntitlementSnapshot(
          pool,
          superAdmin.accountId,
          superAdmin.userId,
        ),
      ).toEqual(entitlementBefore);

      const retry = await mutate(superAdmin, body, key);
      expect(retry.status).toBe(403);
      expect(retry.headers.get("mb-idempotent-replay")).toBeNull();
      const durable = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM security_alert alert
         JOIN audit_event audit ON audit.audit_id=alert.audit_id
        WHERE alert.account_id=$1 AND alert.actor_user_id=$2
          AND alert.entitlement_kind='tier' AND alert.entitlement_value='admin'
          AND audit.justification=$3`,
        [superAdmin.accountId, superAdmin.userId, body.justification],
      );
      expect(durable.rows[0]?.count).toBe("1");
    },
  );

  it("rejects UPDATE and DELETE against durable security alerts", async () => {
    const alert = await pool.query<{ security_alert_id: string }>(
      "SELECT security_alert_id FROM security_alert WHERE account_id=$1 LIMIT 1",
      [superAdmin.accountId],
    );
    expect(alert.rows[0]?.security_alert_id).toEqual(expect.any(String));
    await expect(
      pool.query(
        "UPDATE security_alert SET severity='high' WHERE security_alert_id=$1",
        [alert.rows[0]!.security_alert_id],
      ),
    ).rejects.toThrow(/append-only|permission denied/u);
    await expect(
      pool.query("DELETE FROM security_alert WHERE security_alert_id=$1", [
        alert.rows[0]!.security_alert_id,
      ]),
    ).rejects.toThrow(/append-only|permission denied/u);
  });

  it("rejects forged actor/subject and entitlement metadata at the database alert boundary", async () => {
    const auditId = randomUUID();
    const correlationId = randomUUID();
    await pool.query(
      `INSERT INTO audit_event
        (audit_id,account_id,actor_user_id,actor_tier,actor_admin_sub_role,
         event_type,resource_kind,resource_id,outcome,justification,
         request_correlation_id,deployment_id,detail)
       VALUES($1,$2,$3,'admin','super_admin','security.self_elevation_attempted',
              'app_user',$3,'deny','Synthetic database invariant probe',$4,$5,
              $6::jsonb)`,
      [
        auditId,
        superAdmin.accountId,
        superAdmin.userId,
        correlationId,
        "admin-entitlements-test",
        JSON.stringify({
          reasonCode: "self-mutation-refused",
          entitlementKind: "tier",
          entitlementValue: "admin",
        }),
      ],
    );
    const insert = (
      subjectUserId: string,
      entitlementKind: "tier" | "admin_sub_role",
      entitlementValue: string,
    ) =>
      pool.query(
        `INSERT INTO security_alert
          (security_alert_id,audit_id,account_id,actor_user_id,subject_user_id,
           event_type,severity,reason_code,entitlement_kind,entitlement_value,
           request_correlation_id,deployment_id,occurred_at)
         SELECT $1,audit_id,account_id,actor_user_id,$3,event_type,'high',
                'self-mutation-refused',$4,$5,request_correlation_id,
                deployment_id,occurred_at
           FROM audit_event WHERE audit_id=$2`,
        [
          randomUUID(),
          auditId,
          subjectUserId,
          entitlementKind,
          entitlementValue,
        ],
      );

    await expect(insert(target.userId, "tier", "admin")).rejects.toThrow();
    await expect(
      insert(superAdmin.userId, "admin_sub_role", "super_admin"),
    ).rejects.toThrow(/canonical deny audit event/u);
    const forged = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM security_alert WHERE audit_id=$1",
      [auditId],
    );
    expect(forged.rows[0]?.count).toBe("0");
  });
});
