import { createServer, type Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ApplicationFault,
  StandardWorkspaceApplication,
  type MatchBaseApplication,
  type RequestContext,
} from "@matchbase/application";
import { SYNTHETIC_DOMAIN_PACK } from "@matchbase/ai-evidence/standard";
import { sha256Base64Url } from "@matchbase/auth";
import {
  createPool,
  migrateDown,
  migrateUp,
  type ConnectionPool,
} from "@matchbase/data";
import { createWebRuntime } from "./runtime";
import type { WebConfig } from "./config";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe.sequential : describe.skip;
const csrf = "slice2-live-runtime-csrf-token-0001";
const digestKey = Buffer.from("slice2-live-runtime-digest-key-000000000001");

interface Subject {
  accountId: string;
  userId: string;
  handle: string;
  tier: "standard" | "demo" | "consultant" | "admin";
  adminSubRole?:
    | "support"
    | "analyst"
    | "consultant_manager"
    | "product"
    | "security_audit"
    | "super_admin";
}

describePostgres("Slice 2 native live HTTP contract", () => {
  let pool: ConnectionPool;
  let server: Server;
  let baseUrl: string;
  let standardApplication: StandardWorkspaceApplication;
  const subjects: Subject[] = [];

  beforeAll(async () => {
    pool = createPool({ connectionString: databaseUrl!, max: 12 });
    await migrateDown(pool).catch(() => false);
    await migrateUp(pool);
    const version = Math.floor(Math.random() * 1_000_000_000) + 1;
    await pool.query(
      `INSERT INTO model_policy_version(model_policy_version_id,version,capability_map,content_sha256,released_at) VALUES($1,$2,'{}'::jsonb,$3,clock_timestamp())`,
      [
        randomUUID(),
        version,
        createHash("sha256").update("live-model").digest(),
      ],
    );
    await pool.query(
      `INSERT INTO scoring_config_version(scoring_config_version_id,version,weights_bp,gate_definitions,content_sha256,released_at,product_owner_approval_ref,sme_approval_ref,evaluation_run_ref) VALUES($1,$2,'{}'::jsonb,'{}'::jsonb,$3,clock_timestamp(),'po-live','sme-live','eval-live')`,
      [
        randomUUID(),
        version,
        createHash("sha256").update("live-score").digest(),
      ],
    );
    const subjectCases: ReadonlyArray<Pick<Subject, "tier" | "adminSubRole">> =
      [
        { tier: "standard" },
        { tier: "demo" },
        { tier: "consultant" },
        { tier: "admin" },
        { tier: "admin", adminSubRole: "support" },
        { tier: "admin", adminSubRole: "analyst" },
        { tier: "admin", adminSubRole: "consultant_manager" },
        { tier: "admin", adminSubRole: "product" },
        { tier: "admin", adminSubRole: "security_audit" },
        { tier: "admin", adminSubRole: "super_admin" },
      ];
    for (const { tier, adminSubRole } of subjectCases) {
      const subject = {
        accountId: randomUUID(),
        userId: randomUUID(),
        handle: `s2-${randomUUID()}`,
        tier,
        ...(adminSubRole ? { adminSubRole } : {}),
      };
      const grantor = randomUUID();
      await pool.query(
        "INSERT INTO account(account_id,display_name,status) VALUES($1,$2,'active')",
        [subject.accountId, `Live ${tier}`],
      );
      await pool.query(
        `INSERT INTO app_user(user_id,account_id,google_sub,email_verified,status) VALUES($1,$2,$3,true,'active'),($4,$2,$5,true,'active')`,
        [
          subject.userId,
          subject.accountId,
          `live-${subject.userId}`,
          grantor,
          `grantor-${grantor}`,
        ],
      );
      if (adminSubRole)
        await pool.query(
          `INSERT INTO admin_role_grant(admin_grant_id,account_id,user_id,sub_role,granted_by_user_id,justification,effective_from) VALUES($1,$2,$3,$4,$5,'slice2 denied workflow matrix',clock_timestamp())`,
          [
            randomUUID(),
            subject.accountId,
            subject.userId,
            adminSubRole,
            grantor,
          ],
        );
      await pool.query(
        `INSERT INTO entitlement_grant(grant_id,account_id,user_id,tier,grant_actor_kind,granted_by_user_id,justification,effective_from) VALUES($1,$2,$3,$4,$5,$6,'slice2 live matrix',clock_timestamp())`,
        [
          randomUUID(),
          subject.accountId,
          subject.userId,
          tier,
          tier === "demo" ? "system" : "user",
          tier === "demo" ? null : grantor,
        ],
      );
      await pool.query(
        `INSERT INTO user_session(session_id,account_id,user_id,handle_hash,csrf_token_hash,absolute_expires_at,idle_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '30 minutes')`,
        [
          randomUUID(),
          subject.accountId,
          subject.userId,
          Buffer.from(sha256Base64Url(subject.handle), "base64url"),
          Buffer.from(sha256Base64Url(csrf), "base64url"),
        ],
      );
      subjects.push(subject);
    }
    standardApplication = new StandardWorkspaceApplication({
      pool,
      privacyKey: digestKey,
    });
    const notVisible = () => {
      throw new ApplicationFault(
        403,
        "resource-not-visible",
        "MB-403-RESOURCE",
        "Resource is not visible.",
      );
    };
    const fakeDemo = {
      readiness: async () => true,
      getRequest: notVisible,
      assertRequestVisible: notVisible,
      getRunResult: notVisible,
      cancelRun: notVisible,
      getRunStatus: notVisible,
      listRuns: async () => ({ items: [], next_cursor: null }),
    } as unknown as MatchBaseApplication;
    const config: WebConfig = {
      environment: "test",
      origin: "http://127.0.0.1",
      deploymentId: "slice2-live-http",
      databaseUrl: databaseUrl!,
      oidcSimulatorEnabled: false,
      syntheticFixtureEnabled: true,
      digestKey,
      port: 0,
    };
    const listener = createWebRuntime({
      config,
      pool,
      application: fakeDemo,
      standardApplication,
    });
    server = createServer(
      (request, response) => void listener(request, response),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No HTTP port.");
    baseUrl = `http://127.0.0.1:${address.port}`;
    config.origin = baseUrl;
  }, 30_000);

  afterAll(async () => {
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    if (pool) {
      await migrateDown(pool).catch(() => false);
      await pool.end();
    }
  });

  function subject(tier: Subject["tier"]): Subject {
    return subjects.find((item) => item.tier === tier)!;
  }
  async function call(
    who: Subject,
    path: string,
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        cookie: `__Host-matchbase_session=${who.handle}`,
        ...(method === "POST"
          ? {
              origin: baseUrl,
              "x-csrf-token": csrf,
              "idempotency-key": `live-${randomUUID()}`,
              "content-type": "application/json",
            }
          : {}),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  it("serves the closed Standard path and preserves audited 304/refusal invariants", async () => {
    const owner = subject("standard");
    for (const denied of [
      subject("demo"),
      subject("consultant"),
      subject("admin"),
    ]) {
      const response = await call(
        denied,
        "/api/v1/domain-packs/synthetic_industrial_components",
      );
      expect(response.status).toBe(403);
    }
    const source = "Industrial component scenario_three.";
    const resolutionResponse = await call(
      owner,
      "/api/v1/domain-packs/resolution",
      "POST",
      {
        source_text: source,
        confirmed_category_id: "synthetic_industrial_components",
      },
    );
    expect(resolutionResponse.status).toBe(200);
    const resolution = (await resolutionResponse.json()) as {
      activation_token: string;
    };
    expect(
      (
        await call(
          owner,
          "/api/v1/domain-packs/synthetic_industrial_components",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          owner,
          "/api/v1/domain-packs/synthetic_industrial_components",
          "GET",
          undefined,
          { "mb-domain-pack-activation": resolution.activation_token },
        )
      ).status,
    ).toBe(200);
    const fields = [
      ...SYNTHETIC_DOMAIN_PACK.core_fields,
      ...SYNTHETIC_DOMAIN_PACK.domain_fields,
    ].map((definition) => ({
      field_id: definition.field_id,
      macro_parameter: definition.macro_parameter,
      typed_value:
        definition.requirement !== "required"
          ? { value_state: "not_asked" }
          : definition.field_id === "component_material"
            ? { value_state: "provided", value: "alloy" }
            : definition.kind === "quantity"
              ? { value_state: "provided", value: "45" }
              : {
                  value_state: "provided",
                  value: "Industrial component model MX900",
                },
    }));
    const intake = {
      schema_version: "standard-intake-submission.v1",
      domain_pack_activation_token: resolution.activation_token,
      source_language: "en",
      source_text: source,
      fields,
      hard_constraints: [],
      exclusions: [],
      conditional_requirements: [],
    };
    const createResponse = await call(
      owner,
      "/api/v1/requests",
      "POST",
      intake,
    );
    expect(createResponse.status).toBe(201);
    expect(createResponse.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    const created = (await createResponse.json()) as {
      request_id: string;
      version: number;
    };

    const detail = await call(owner, `/api/v1/requests/${created.request_id}`);
    expect(detail.status).toBe(200);
    expect(detail.headers.get("vary")).toContain("Cookie");
    const detailBody = (await detail.json()) as {
      schema_version: string;
      canonical: { request_id: string };
      version_history: unknown[];
    };
    expect(detailBody.schema_version).toBe("standard-request-detail.v1");
    expect(detailBody.canonical.request_id).toBe(created.request_id);
    expect(detailBody.version_history).toHaveLength(1);
    const etag = detail.headers.get("etag")!;
    const auditBefore304 = Number(
      (
        await pool.query(
          "SELECT count(*) AS count FROM audit_event WHERE event_type='projection.served'",
        )
      ).rows[0]!.count,
    );
    const notModified = await call(
      owner,
      `/api/v1/requests/${created.request_id}`,
      "GET",
      undefined,
      { "if-none-match": etag },
    );
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("cache-control")).toBe("private, no-store");
    expect(notModified.headers.get("vary")).toContain("Cookie");
    const auditAfter304 = Number(
      (
        await pool.query(
          "SELECT count(*) AS count FROM audit_event WHERE event_type='projection.served'",
        )
      ).rows[0]!.count,
    );
    expect(auditAfter304 - auditBefore304).toBe(1);
    const notModifiedAudit = await pool.query<{
      fields_released: string[];
      detail: { bodyReleased: boolean; notModified: boolean };
    }>(
      `SELECT fields_released,detail
         FROM audit_event
        WHERE event_type='projection.served'
        ORDER BY occurred_at DESC,audit_id DESC LIMIT 1`,
    );
    expect(notModifiedAudit.rows[0]?.fields_released).toEqual([]);
    expect(notModifiedAudit.rows[0]?.detail).toEqual(
      expect.objectContaining({ bodyReleased: false, notModified: true }),
    );

    const confirmation = await call(
      owner,
      `/api/v1/requests/${created.request_id}/versions/1/confirmation`,
      "POST",
      { accepted: true, contradiction_resolutions: [] },
    );
    expect(confirmation.status).toBe(200);
    const runResponse = await call(owner, "/api/v1/runs", "POST", {
      request_id: created.request_id,
      canonical_request_version: 1,
    });

    expect(runResponse.status).toBe(202);
    const run = (await runResponse.json()) as { run_id: string };
    const ctx: RequestContext = {
      accountId: owner.accountId,
      userId: owner.userId,
      tier: "standard",
      adminSubRoles: [],
      correlationId: randomUUID(),
      deploymentId: "slice2-live-http",
    };
    expect(await standardApplication.executeSyntheticRun(ctx, run.run_id)).toBe(
      true,
    );
    for (const [path, status] of [
      ["/api/v1/requests", 200],
      [`/api/v1/requests/${created.request_id}/versions`, 200],
      ["/api/v1/runs", 200],
      [`/api/v1/runs/${run.run_id}`, 200],
      [`/api/v1/runs/${run.run_id}/result`, 200],
    ] as const) {
      const response = await call(owner, path);
      expect(response.status, path).toBe(status);
    }

    const beforeRefusal = await pool.query(
      `SELECT (SELECT count(*) FROM audit_event)::int AS audits,(SELECT count(*) FROM run_result)::int AS results,(SELECT count(*) FROM cost_event)::int AS costs,(SELECT count(*) FROM quota_ledger)::int AS quota`,
    );
    for (const path of [
      `/api/v1/runs/${run.run_id}/export`,
      "/api/v1/requests/not-a-uuid",
      `/api/v1/candidates/${randomUUID()}`,
      `/api/v1/evidence/${randomUUID()}`,
    ])
      expect((await call(owner, path)).status).toBe(403);
    const afterRefusal = await pool.query(
      `SELECT (SELECT count(*) FROM audit_event)::int AS audits,(SELECT count(*) FROM run_result)::int AS results,(SELECT count(*) FROM cost_event)::int AS costs,(SELECT count(*) FROM quota_ledger)::int AS quota`,
    );
    expect(afterRefusal.rows[0]!.audits - beforeRefusal.rows[0]!.audits).toBe(
      4,
    );
    expect(afterRefusal.rows[0]!.results).toBe(beforeRefusal.rows[0]!.results);
    expect(afterRefusal.rows[0]!.costs).toBe(beforeRefusal.rows[0]!.costs);
    expect(afterRefusal.rows[0]!.quota).toBe(beforeRefusal.rows[0]!.quota);
    expect((await call(owner, "/api/v1/requests?filter=forged")).status).toBe(
      400,
    );
    expect(
      (await call(owner, "/api/v1/requests?cursor=forged.cursor&filter=all"))
        .status,
    ).toBe(400);
  }, 30_000);

  it("exercises every Slice 2 endpoint across Demo, Consultant, Admin without role, and all six Admin sub-roles", async () => {
    const id = "40000000-0000-4000-8000-000000000001";
    const endpointMatrix: ReadonlyArray<{
      method: "GET" | "POST";
      path: string;
      body?: unknown;
      demoStatus: number;
    }> = [
      {
        method: "GET",
        path: "/api/v1/domain-packs/synthetic_industrial_components",
        demoStatus: 403,
      },
      {
        method: "POST",
        path: "/api/v1/domain-packs/resolution",
        body: {},
        demoStatus: 403,
      },
      {
        method: "POST",
        path: "/api/v1/requests",
        body: { schema_version: "standard-intake-submission.v1" },
        demoStatus: 403,
      },
      { method: "GET", path: "/api/v1/requests", demoStatus: 404 },
      { method: "GET", path: `/api/v1/requests/${id}`, demoStatus: 403 },
      {
        method: "GET",
        path: `/api/v1/requests/${id}/versions`,
        demoStatus: 404,
      },
      {
        method: "POST",
        path: `/api/v1/requests/${id}/versions`,
        body: { structured_request: {} },
        demoStatus: 403,
      },
      {
        method: "POST",
        path: `/api/v1/requests/${id}/versions/1/confirmation`,
        body: { contradiction_resolutions: [] },
        demoStatus: 403,
      },
      {
        method: "POST",
        path: "/api/v1/runs",
        body: { canonical_request_version: 1 },
        demoStatus: 403,
      },
      { method: "GET", path: "/api/v1/runs", demoStatus: 200 },
      { method: "GET", path: `/api/v1/runs/${id}`, demoStatus: 403 },
      { method: "GET", path: `/api/v1/runs/${id}/result`, demoStatus: 403 },
      {
        method: "POST",
        path: `/api/v1/runs/${id}/cancellation`,
        demoStatus: 403,
      },
      {
        method: "GET",
        path: `/api/v1/runs/${id}/attachments`,
        demoStatus: 404,
      },
      { method: "GET", path: `/api/v1/runs/${id}/exports`, demoStatus: 404 },
      {
        method: "POST",
        path: `/api/v1/runs/${id}/rescore`,
        body: {},
        demoStatus: 404,
      },
      {
        method: "POST",
        path: `/api/v1/runs/${id}/reresearch`,
        body: {},
        demoStatus: 404,
      },
    ];
    const deniedSubjects = subjects.filter((item) => item.tier !== "standard");
    expect(deniedSubjects).toHaveLength(9);
    for (const denied of deniedSubjects)
      for (const endpoint of endpointMatrix) {
        const response = await call(
          denied,
          endpoint.path,
          endpoint.method,
          endpoint.body,
        );
        const expectedStatus =
          denied.tier === "demo" ? endpoint.demoStatus : 403;
        expect(
          response.status,
          `${denied.tier}/${denied.adminSubRole ?? "none"} ${endpoint.method} ${endpoint.path}`,
        ).toBe(expectedStatus);
        if (denied.tier !== "demo" || endpoint.demoStatus === 403)
          await expect(response.json()).resolves.toMatchObject({
            status: 403,
          });
      }

    const standard = subject("standard");
    const demoShaped = await call(standard, "/api/v1/requests", "POST", {
      source_text: "Synthetic Demo input",
      presented_fields: [
        "need",
        "mandatory_constraints",
        "preferences_context",
      ],
      unknown_fields: [],
    });
    expect(demoShaped.status).toBe(422);
  }, 30_000);
});
