import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type MatchBaseApplication,
  type RequestContext,
} from "@matchbase/application";
import { sha256Base64Url } from "@matchbase/auth";
import { createPool, migrateUp, type ConnectionPool } from "@matchbase/data";
import type { WebConfig } from "./config";
import { closeFetchRuntime, handleRoute } from "./fetch-runtime";
import { createWebRuntime } from "./runtime";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe.sequential : describe.skip;
const digestKeyText = "admin-runs-postgres-cursor-key-32-bytes";
const fetchOrigin = "http://127.0.0.1:3299";

interface Actor {
  readonly accountId: string;
  readonly userId: string;
  readonly handle: string;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

describePostgres("Admin governance runs HTTP read boundary", () => {
  let pool: ConnectionPool;
  let controlPool: ConnectionPool;
  let isolatedDatabaseUrl: string;
  const isolatedDatabaseName = `matchbase_task074_${randomUUID().replaceAll("-", "")}`;
  let server: Server;
  let baseUrl: string;
  let allowed: Actor[];
  let denied: Actor[];
  let currentRunIds: string[];
  let crossAccountRunId: string;
  let accountId: string;
  const originalEnvironment = new Map<string, string | undefined>();

  async function addUser(
    targetAccountId: string,
    grantorId: string,
    role: string | null,
    tier = "admin",
  ): Promise<Actor> {
    const userId = randomUUID();
    const handle = `admin-runs-${randomUUID()}`;
    await pool.query(
      `INSERT INTO app_user(user_id,account_id,google_sub,email_verified,status)
       VALUES($1,$2,$3,true,'active')`,
      [userId, targetAccountId, `admin-runs-${userId}`],
    );
    await pool.query(
      `INSERT INTO entitlement_grant
        (grant_id,account_id,user_id,tier,grant_actor_kind,granted_by_user_id,
         justification,effective_from)
       VALUES($1,$2,$3,$4,'user',$5,'admin runs fixture',clock_timestamp())`,
      [randomUUID(), targetAccountId, userId, tier, grantorId],
    );
    if (role) {
      await pool.query(
        `INSERT INTO admin_role_grant
          (admin_grant_id,account_id,user_id,sub_role,granted_by_user_id,
           justification,effective_from)
         VALUES($1,$2,$3,$4,$5,'admin runs fixture',clock_timestamp())`,
        [randomUUID(), targetAccountId, userId, role, grantorId],
      );
    }
    await pool.query(
      `INSERT INTO user_session
        (session_id,account_id,user_id,handle_hash,csrf_token_hash,
         absolute_expires_at,idle_expires_at)
       VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',
              clock_timestamp()+interval '30 minutes')`,
      [
        randomUUID(),
        targetAccountId,
        userId,
        Buffer.from(sha256Base64Url(handle), "base64url"),
        digest(`csrf-${handle}`),
      ],
    );
    return { accountId: targetAccountId, userId, handle };
  }

  async function addRun(
    targetAccountId: string,
    ownerId: string,
    canonicalId: string,
    modelPolicyId: string,
    scoringConfigId: string,
    state: string,
    governance?: {
      readonly to: string;
      readonly reason: string;
      readonly failure?: string;
      readonly actor?: string;
      readonly raisedAt?: Date;
    },
  ): Promise<string> {
    const runId = randomUUID();
    await pool.query(
      `INSERT INTO research_run
        (run_id,account_id,canonical_request_version_id,requested_by_user_id,
         tier_at_submission,state,state_reason,model_policy_version_id,
         scoring_config_version_id,idempotency_key_hash,queued_at)
       VALUES($1,$2,$3,$4,'standard',$5,
              'PRIVATE provider error marker REQUEST-CONTENT-DO-NOT-LEAK',$6,$7,$8,
              clock_timestamp())`,
      [
        runId,
        targetAccountId,
        canonicalId,
        ownerId,
        state,
        modelPolicyId,
        scoringConfigId,
        digest(runId),
      ],
    );
    if (governance) {
      await pool.query(
        `INSERT INTO audit_event
          (audit_id,occurred_at,account_id,actor_user_id,event_type,
           resource_kind,resource_id,outcome,request_correlation_id,
           deployment_id,detail)
         VALUES($1,COALESCE($7::timestamptz,clock_timestamp()),$2,$3,
                'governance.state_changed',
                'research_run',$4,'allow',$5,'admin-runs-test',$6::jsonb)`,
        [
          randomUUID(),
          targetAccountId,
          governance.actor ?? null,
          runId,
          randomUUID(),
          JSON.stringify({
            from: "Clear",
            to: governance.to,
            reason_code: governance.reason,
            trigger_rule_id: "CF-015",
            system_actor: "policy-engine",
            ...(governance.failure
              ? { failure_class: governance.failure }
              : {}),
            provider_error:
              "PRIVATE provider error marker REQUEST-CONTENT-DO-NOT-LEAK",
            evidence: "PRIVATE-EVIDENCE-DO-NOT-LEAK",
          }),
          governance.raisedAt ?? null,
        ],
      );
    }
    return runId;
  }

  beforeAll(async () => {
    const controlUrl = new URL(databaseUrl!);
    controlUrl.pathname = "/postgres";
    controlPool = createPool({
      connectionString: controlUrl.toString(),
      max: 1,
    });
    await controlPool.query(`CREATE DATABASE ${isolatedDatabaseName}`);
    const isolatedUrl = new URL(databaseUrl!);
    isolatedUrl.pathname = `/${isolatedDatabaseName}`;
    isolatedDatabaseUrl = isolatedUrl.toString();
    pool = createPool({ connectionString: isolatedDatabaseUrl, max: 10 });
    await migrateUp(pool);
    accountId = randomUUID();
    const grantorId = randomUUID();
    const ownerId = randomUUID();
    await pool.query(
      "INSERT INTO account(account_id,display_name,status) VALUES($1,'Admin runs test','active')",
      [accountId],
    );
    for (const [userId, label] of [
      [grantorId, "grantor"],
      [ownerId, "owner"],
    ]) {
      await pool.query(
        `INSERT INTO app_user(user_id,account_id,google_sub,email_verified,status)
         VALUES($1,$2,$3,true,'active')`,
        [userId, accountId, `admin-runs-${label}-${userId}`],
      );
    }
    allowed = [];
    for (const role of ["support", "analyst", "super_admin"]) {
      allowed.push(await addUser(accountId, grantorId, role));
    }
    denied = [
      await addUser(accountId, grantorId, "consultant_manager"),
      await addUser(accountId, grantorId, "product"),
      await addUser(accountId, grantorId, "security_audit"),
      await addUser(accountId, grantorId, null, "demo"),
    ];

    const modelPolicyId = randomUUID();
    const scoringConfigId = randomUUID();
    const canonicalizationRunId = randomUUID();
    const requestId = randomUUID();
    const canonicalId = randomUUID();
    const versions = await pool.query<{ next_version: number }>(
      `SELECT GREATEST(
          COALESCE((SELECT max(version) FROM model_policy_version),0),
          COALESCE((SELECT max(version) FROM scoring_config_version),0)
        )+1 AS next_version`,
    );
    const version = versions.rows[0]!.next_version;
    await pool.query(
      `INSERT INTO model_policy_version
        (model_policy_version_id,version,capability_map,content_sha256,released_at)
       VALUES($1,$2,'{}'::jsonb,$3,clock_timestamp())`,
      [modelPolicyId, version, digest(`model-${version}-${modelPolicyId}`)],
    );
    await pool.query(
      `INSERT INTO scoring_config_version
        (scoring_config_version_id,version,weights_bp,gate_definitions,
         content_sha256,released_at,product_owner_approval_ref,
         sme_approval_ref,evaluation_run_ref)
       VALUES($1,$2,'{}'::jsonb,'{}'::jsonb,$3,clock_timestamp(),
              'po-test','sme-test','eval-test')`,
      [scoringConfigId, version, digest(`score-${version}-${scoringConfigId}`)],
    );
    await pool.query(
      `INSERT INTO canonicalization_execution_run
        (canonicalization_run_id,account_id,user_id,subject_request_id,
         request_correlation_id,started_at)
       VALUES($1,$2,$3,$4,$5,clock_timestamp())`,
      [canonicalizationRunId, accountId, ownerId, requestId, randomUUID()],
    );
    await pool.query(
      `INSERT INTO sourcing_request
        (request_id,account_id,created_by_user_id,canonicalization_run_id,
         lifecycle_state)
       VALUES($1,$2,$3,$4,'confirmed')`,
      [requestId, accountId, ownerId, canonicalizationRunId],
    );
    await pool.query(
      `INSERT INTO canonical_request_version
        (canonical_request_version_id,request_id,account_id,version,
         canonical_document,match_readiness,created_by_user_id)
       VALUES($1,$2,$3,1,'{"product":"fixture"}'::jsonb,'ready',$4)`,
      [canonicalId, requestId, accountId, ownerId],
    );
    await pool.query(
      `INSERT INTO canonical_confirmation
        (confirmation_id,canonical_request_version_id,account_id,actor_user_id,
         accepted,confirmed_at)
       VALUES($1,$2,$3,$4,true,clock_timestamp())`,
      [randomUUID(), canonicalId, accountId, ownerId],
    );
    currentRunIds = [
      await addRun(
        accountId,
        ownerId,
        canonicalId,
        modelPolicyId,
        scoringConfigId,
        "escalated",
        {
          to: "Review Required",
          reason: "customer_acme_private_failure",
        },
      ),
      await addRun(
        accountId,
        ownerId,
        canonicalId,
        modelPolicyId,
        scoringConfigId,
        "escalated",
        {
          to: "Escalated to Human",
          reason: "confidence_below_threshold",
          failure: "timeout",
        },
      ),
      await addRun(
        accountId,
        ownerId,
        canonicalId,
        modelPolicyId,
        scoringConfigId,
        "restricted",
        {
          to: "Output Restricted",
          reason: "restricted_party_signal",
        },
      ),
      await addRun(
        accountId,
        ownerId,
        canonicalId,
        modelPolicyId,
        scoringConfigId,
        "failed",
        {
          to: "Evaluation Failed",
          reason: "evaluation_acceptance_failed",
          failure: "evidence_subsystem_unavailable",
        },
      ),
    ];
    await addRun(
      accountId,
      ownerId,
      canonicalId,
      modelPolicyId,
      scoringConfigId,
      "failed",
    );
    const crossAccountId = randomUUID();
    const crossOwnerId = randomUUID();
    const crossCanonicalizationId = randomUUID();
    const crossRequestId = randomUUID();
    const crossCanonicalId = randomUUID();
    await pool.query(
      "INSERT INTO account(account_id,display_name,status) VALUES($1,'Cross-account Admin runs test','active')",
      [crossAccountId],
    );
    await pool.query(
      `INSERT INTO app_user(user_id,account_id,google_sub,email_verified,status)
       VALUES($1,$2,$3,true,'active')`,
      [crossOwnerId, crossAccountId, `admin-runs-cross-${crossOwnerId}`],
    );
    await pool.query(
      `INSERT INTO canonicalization_execution_run
        (canonicalization_run_id,account_id,user_id,subject_request_id,
         request_correlation_id,started_at)
       VALUES($1,$2,$3,$4,$5,clock_timestamp())`,
      [
        crossCanonicalizationId,
        crossAccountId,
        crossOwnerId,
        crossRequestId,
        randomUUID(),
      ],
    );
    await pool.query(
      `INSERT INTO sourcing_request
        (request_id,account_id,created_by_user_id,canonicalization_run_id,
         lifecycle_state)
       VALUES($1,$2,$3,$4,'confirmed')`,
      [crossRequestId, crossAccountId, crossOwnerId, crossCanonicalizationId],
    );
    await pool.query(
      `INSERT INTO canonical_request_version
        (canonical_request_version_id,request_id,account_id,version,
         canonical_document,match_readiness,created_by_user_id)
       VALUES($1,$2,$3,1,'{"product":"cross fixture"}'::jsonb,'ready',$4)`,
      [crossCanonicalId, crossRequestId, crossAccountId, crossOwnerId],
    );
    await pool.query(
      `INSERT INTO canonical_confirmation
        (confirmation_id,canonical_request_version_id,account_id,actor_user_id,
         accepted,confirmed_at)
       VALUES($1,$2,$3,$4,true,clock_timestamp())`,
      [randomUUID(), crossCanonicalId, crossAccountId, crossOwnerId],
    );
    crossAccountRunId = await addRun(
      crossAccountId,
      crossOwnerId,
      crossCanonicalId,
      modelPolicyId,
      scoringConfigId,
      "restricted",
      { to: "Output Restricted", reason: "restricted_party_signal" },
    );

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
      deploymentId: "admin-runs-postgres-test",
      databaseUrl: isolatedDatabaseUrl,
      oidcSimulatorEnabled: false,
      syntheticFixtureEnabled: true,
      digestKey: Buffer.from(digestKeyText),
      port: 0,
    };
    const listener = createWebRuntime({
      config,
      pool,
      application: fakeApplication,
    });
    server = createServer(
      (request, response) => void listener(request, response),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port.");
    baseUrl = `http://127.0.0.1:${address.port}`;
    config.origin = baseUrl;

    for (const key of [
      "DATABASE_URL",
      "MATCHBASE_ENVIRONMENT",
      "MATCHBASE_ORIGIN",
      "MATCHBASE_DEPLOYMENT_ID",
      "MATCHBASE_OIDC_SIMULATOR",
      "MATCHBASE_SYNTHETIC_FIXTURE",
      "MATCHBASE_DIGEST_KEY",
    ]) {
      originalEnvironment.set(key, process.env[key]);
    }
    Object.assign(process.env, {
      DATABASE_URL: isolatedDatabaseUrl,
      MATCHBASE_ENVIRONMENT: "test",
      MATCHBASE_ORIGIN: fetchOrigin,
      MATCHBASE_DEPLOYMENT_ID: "admin-runs-fetch-test",
      MATCHBASE_OIDC_SIMULATOR: "false",
      MATCHBASE_SYNTHETIC_FIXTURE: "true",
      MATCHBASE_DIGEST_KEY: digestKeyText,
    });
  }, 30_000);

  afterAll(async () => {
    await closeFetchRuntime();
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    if (pool) await pool.end();
    if (controlPool) {
      await controlPool.query(
        `DROP DATABASE IF EXISTS ${isolatedDatabaseName} WITH (FORCE)`,
      );
      await controlPool.end();
    }
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function nativeRead(actor: Actor, query = ""): Promise<Response> {
    return fetch(`${baseUrl}/api/v1/admin/runs${query}`, {
      headers: { cookie: `__Host-matchbase_session=${actor.handle}` },
    });
  }

  it("native and Fetch runtimes return the same bounded status projection", async () => {
    const native = await nativeRead(allowed[0]!);
    const fetchResponse = await handleRoute(
      new Request(`${fetchOrigin}/api/v1/admin/runs`, {
        headers: { cookie: `matchbase_session=${allowed[0]!.handle}` },
      }),
    );
    expect(native.status).toBe(200);
    expect(fetchResponse.status).toBe(200);
    const nativeBody = await native.json();
    const fetchBody = await fetchResponse.json();
    expect(fetchBody).toEqual(nativeBody);
    expect(nativeBody.items).toHaveLength(4);
    expect(
      new Set(nativeBody.items.map((item: { run_id: string }) => item.run_id)),
    ).toEqual(new Set(currentRunIds));
    expect(JSON.stringify(nativeBody)).not.toContain(crossAccountRunId);
    for (const item of nativeBody.items) {
      expect(Object.keys(item).sort()).toEqual([
        "automated_path_blocked",
        "governance_state",
        "human_action_required",
        "raised_at",
        "reason_code",
        "run_id",
        "run_state",
        "trigger_rule_id",
      ]);
      expect(item.reason_code).toBe("reason_unavailable");
      expect(item.human_action_required).toBe(true);
      expect(item.automated_path_blocked).toBe(true);
    }
    expect(
      Object.fromEntries(
        nativeBody.items.map(
          (item: { governance_state: string; run_state: string }) => [
            item.governance_state,
            item.run_state,
          ],
        ),
      ),
    ).toEqual({
      "Review Required": "escalated",
      "Escalated to Human": "escalated",
      "Output Restricted": "restricted",
      "Evaluation Failed": "failed",
    });
    const raw = JSON.stringify(nativeBody);
    for (const forbidden of [
      "REQUEST-CONTENT-DO-NOT-LEAK",
      "PRIVATE-EVIDENCE-DO-NOT-LEAK",
      "provider_error",
      "evidence",
      "candidate",
      "state_reason",
      "customer_acme_private_failure",
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("authorizes exactly the stored allowed sub-roles and ignores forged claims", async () => {
    for (const actor of allowed)
      expect((await nativeRead(actor)).status).toBe(200);
    for (const actor of denied) {
      const response = await fetch(
        `${baseUrl}/api/v1/admin/runs?tier=admin&admin_sub_role=super_admin`,
        {
          headers: {
            cookie: `__Host-matchbase_session=${actor.handle}`,
            authorization: "Bearer forged.admin.super_admin",
            "x-matchbase-tier": "admin",
            "x-matchbase-admin-sub-role": "super_admin",
          },
        },
      );
      expect(response.status).toBe(400);
      const plain = await nativeRead(actor);
      expect(plain.status).toBe(403);
      expect(await plain.json()).toMatchObject({
        type: "about:matchbase/errors/resource-not-visible",
        code: "MB-403-ADMIN-RUNS",
      });
    }
  });

  it("binds cursors to actor and filters while preserving tenant scope", async () => {
    const first = await nativeRead(allowed[0]!, "?limit=1");
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.page.has_more).toBe(true);
    const cursor = firstBody.page.next_cursor as string;
    const next = await nativeRead(
      allowed[0]!,
      `?limit=1&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(next.status).toBe(200);
    expect((await next.json()).items).toHaveLength(1);
    expect(
      (
        await nativeRead(
          allowed[1]!,
          `?limit=1&cursor=${encodeURIComponent(cursor)}`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await nativeRead(
          allowed[0]!,
          `?limit=1&failure_class=timeout&cursor=${encodeURIComponent(cursor)}`,
        )
      ).status,
    ).toBe(400);
    const filtered = await nativeRead(
      allowed[0]!,
      "?governance_state=Output%20Restricted&run_state=restricted",
    );
    expect(filtered.status).toBe(200);
    const filteredBody = await filtered.json();
    expect(filteredBody.items).toHaveLength(1);
    expect(filteredBody.items[0].governance_state).toBe("Output Restricted");
  });

  it("fails closed when audit label and enforcement state disagree", async () => {
    const fixture = await pool.query<{
      canonical_request_version_id: string;
      requested_by_user_id: string;
      model_policy_version_id: string;
      scoring_config_version_id: string;
    }>(
      `SELECT canonical_request_version_id,requested_by_user_id,
              model_policy_version_id,scoring_config_version_id
         FROM research_run WHERE run_id=$1`,
      [currentRunIds[0]],
    );
    const row = fixture.rows[0]!;
    await addRun(
      accountId,
      row.requested_by_user_id,
      row.canonical_request_version_id,
      row.model_policy_version_id,
      row.scoring_config_version_id,
      "complete",
      {
        to: "Output Restricted",
        reason: "restricted_party_signal",
        raisedAt: new Date("2000-01-01T00:00:00.000Z"),
      },
    );
    const response = await nativeRead(allowed[0]!, "?limit=1");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      type: "about:matchbase/errors/integrity-error",
      code: "MB-503-INTEGRITY",
    });
  });
});
