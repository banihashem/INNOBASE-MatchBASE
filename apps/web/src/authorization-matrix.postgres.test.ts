import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ADMIN_SUB_ROLES,
  PERSISTED_TIERS,
  type AdminSubRole,
  type PersistedTier,
} from "@matchbase/contracts";
import {
  SLICE1_AUTHENTICATED_ENDPOINTS,
  type MatchBaseApplication,
  type RequestContext,
} from "@matchbase/application";
import { sha256Base64Url } from "@matchbase/auth";
import {
  createPool,
  inTransaction,
  migrateUp,
  resolveStoredAuthorization,
  type ConnectionPool,
} from "@matchbase/data";
import { createWebRuntime } from "./runtime";
import type { WebConfig } from "./config";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe.sequential : describe.skip;
const objectId = "00000000-0000-4000-8000-000000000001";
const csrf = "matrix-csrf-token-with-at-least-16-bytes";

interface MatrixSubject {
  name: string;
  accountId: string;
  userId: string;
  tier: PersistedTier;
  adminSubRoles: readonly AdminSubRole[];
  handle: string;
}

const endpointRequests = [
  { contract: "GET /api/v1/me", method: "GET", path: "/api/v1/me" },
  {
    contract: "POST /api/v1/requests",
    method: "POST",
    path: "/api/v1/requests",
    body: {
      sourceText: "synthetic input",
      fixtureCanonicalText: "synthetic canonical input",
      fixtureCanonicalFields: [],
      presentedFields: [],
    },
  },
  {
    contract: "GET /api/v1/requests/:requestId",
    method: "GET",
    path: `/api/v1/requests/${objectId}`,
  },
  {
    contract: "POST /api/v1/requests/:requestId/versions",
    method: "POST",
    path: `/api/v1/requests/${objectId}/versions`,
    body: { canonicalText: "synthetic", fields: [], readiness: "ready" },
  },
  {
    contract: "POST /api/v1/requests/:requestId/versions/:version/confirmation",
    method: "POST",
    path: `/api/v1/requests/${objectId}/versions/1/confirmation`,
    body: { accepted: true },
  },
  {
    contract: "POST /api/v1/runs",
    method: "POST",
    path: "/api/v1/runs",
    body: { request_id: objectId, version: 1 },
  },
  { contract: "GET /api/v1/runs", method: "GET", path: "/api/v1/runs" },
  {
    contract: "GET /api/v1/runs/:runId",
    method: "GET",
    path: `/api/v1/runs/${objectId}`,
  },
  {
    contract: "GET /api/v1/runs/:runId/result",
    method: "GET",
    path: `/api/v1/runs/${objectId}/result`,
  },
  {
    contract: "POST /api/v1/runs/:runId/cancellation",
    method: "POST",
    path: `/api/v1/runs/${objectId}/cancellation`,
    body: {},
  },
] as const;

describePostgres(
  "real-PostgreSQL complete Slice 1 endpoint authorization matrix",
  () => {
    let pool: ConnectionPool;
    let server: Server;
    let baseUrl: string;
    const subjects: MatrixSubject[] = [];

    beforeAll(async () => {
      pool = createPool({ connectionString: databaseUrl!, max: 16 });
      await migrateUp(pool);
      const subjectCases: ReadonlyArray<{
        name: string;
        tier: PersistedTier;
        adminSubRoles: readonly AdminSubRole[];
      }> = [
        { name: "Demo", tier: "demo", adminSubRoles: [] },
        { name: "Standard", tier: "standard", adminSubRoles: [] },
        { name: "Consultant", tier: "consultant", adminSubRoles: [] },
        { name: "Admin/no-sub-role", tier: "admin", adminSubRoles: [] },
        ...ADMIN_SUB_ROLES.map((role) => ({
          name: `Admin/${role}`,
          tier: "admin" as const,
          adminSubRoles: [role] as const,
        })),
      ];
      for (const subjectCase of subjectCases) {
        const accountId = randomUUID();
        const userId = randomUUID();
        const grantorId = randomUUID();
        const handle = `matrix-${randomUUID()}`;
        await pool.query(
          "INSERT INTO account (account_id, display_name, status) VALUES ($1,$2,'active')",
          [accountId, subjectCase.name],
        );
        await pool.query(
          `INSERT INTO app_user
           (user_id, account_id, google_sub, email_verified, status)
         VALUES ($1,$2,$3,true,'active'),($4,$2,$5,true,'active')`,
          [
            userId,
            accountId,
            `matrix-subject-${userId}`,
            grantorId,
            `matrix-grantor-${grantorId}`,
          ],
        );
        await pool.query(
          `INSERT INTO entitlement_grant
           (grant_id, account_id, user_id, tier, grant_actor_kind,
            granted_by_user_id, justification, effective_from)
         VALUES ($1,$2,$3,$4,$5,$6,'authorization matrix',clock_timestamp())`,
          [
            randomUUID(),
            accountId,
            userId,
            subjectCase.tier,
            subjectCase.tier === "demo" ? "system" : "user",
            subjectCase.tier === "demo" ? null : grantorId,
          ],
        );
        for (const role of subjectCase.adminSubRoles) {
          await pool.query(
            `INSERT INTO admin_role_grant
             (admin_grant_id, account_id, user_id, sub_role, granted_by_user_id,
              justification, effective_from)
           VALUES ($1,$2,$3,$4,$5,'authorization matrix',clock_timestamp())`,
            [randomUUID(), accountId, userId, role, grantorId],
          );
        }
        await pool.query(
          `INSERT INTO user_session
           (session_id, account_id, user_id, handle_hash, csrf_token_hash,
            absolute_expires_at, idle_expires_at)
         VALUES ($1,$2,$3,$4,$5,clock_timestamp() + interval '1 hour',
                 clock_timestamp() + interval '30 minutes')`,
          [
            randomUUID(),
            accountId,
            userId,
            Buffer.from(sha256Base64Url(handle), "base64url"),
            Buffer.from(sha256Base64Url(csrf), "base64url"),
          ],
        );
        subjects.push({ ...subjectCase, accountId, userId, handle });
      }

      const fakeApplication = {
        readiness: async () => true,
        me: async (context: RequestContext) => ({
          tier: context.tier,
          admin_sub_roles: context.adminSubRoles,
        }),
        createRequest: async () => ({ idempotent_replay: false }),
        getRequest: async () => ({}),
        createVersion: async () => ({}),
        assertRequestVisible: async () => undefined,
        confirmVersion: async () => ({}),
        submitRun: async () => ({ idempotent_replay: false }),
        listRuns: async () => ({ items: [] }),
        getRunResult: async () => ({ body: {} }),
        cancelRun: async () => ({}),
        getRunStatus: async () => ({
          state: "queued",
          progress: { monotonic_sequence: 0 },
          poll_after_ms: 10_000,
        }),
      } as unknown as MatchBaseApplication;
      const config: WebConfig = {
        environment: "test",
        origin: "http://127.0.0.1",
        deploymentId: "authorization-matrix-test",
        databaseUrl: databaseUrl!,
        oidcSimulatorEnabled: false,
        syntheticFixtureEnabled: true,
        digestKey: Buffer.from("authorization-matrix-digest-key-32-bytes"),
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
      if (!address || typeof address === "string")
        throw new Error("No test port.");
      baseUrl = `http://127.0.0.1:${address.port}`;
      config.origin = baseUrl;
    }, 30_000);

    afterAll(async () => {
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      if (pool) await pool.end();
    });

    async function requestFor(
      subject: MatrixSubject | null,
      endpoint: (typeof endpointRequests)[number],
      overrides: {
        origin?: string;
        csrf?: string;
        injectAuthority?: boolean;
      } = {},
    ): Promise<Response> {
      const injected = overrides.injectAuthority
        ? `${endpoint.path}${endpoint.path.includes("?") ? "&" : "?"}tier=demo&admin_sub_role=super_admin`
        : endpoint.path;
      const headers: Record<string, string> = {
        ...(subject
          ? { cookie: `__Host-matchbase_session=${subject.handle}` }
          : {}),
        ...(endpoint.method === "POST"
          ? {
              origin: overrides.origin ?? baseUrl,
              "x-csrf-token": overrides.csrf ?? csrf,
              "idempotency-key": `matrix-${randomUUID()}`,
              "content-type": "application/json",
            }
          : {}),
        ...(overrides.injectAuthority
          ? {
              "x-matchbase-tier": "demo",
              "x-matchbase-admin-sub-role": "super_admin",
              "x-oauth-scope":
                "matchbase:tier:demo matchbase:admin:super_admin",
              authorization: "Bearer injected-client-authority",
            }
          : {}),
      };
      return fetch(`${baseUrl}${injected}`, {
        method: endpoint.method,
        headers,
        ...(endpoint.method === "POST"
          ? {
              body: JSON.stringify(
                overrides.injectAuthority
                  ? {
                      ...endpoint.body,
                      tier: "demo",
                      admin_sub_role: "super_admin",
                    }
                  : endpoint.body,
              ),
            }
          : {}),
        redirect: "manual",
      });
    }

    it("keeps code and PostgreSQL tier/sub-role constraints in exact parity", async () => {
      const constraints = await pool.query<{
        table_name: string;
        constraint_name: string;
        definition: string;
      }>(
        `SELECT c.relname AS table_name, k.conname AS constraint_name,
              pg_get_constraintdef(k.oid) AS definition
         FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
        WHERE c.relname IN ('entitlement_grant','admin_role_grant')
          AND k.contype = 'c'`,
      );
      const valuesFor = (table: string, column: string): string[] => {
        const definition = constraints.rows
          .filter(
            (row) =>
              row.table_name === table &&
              row.constraint_name === `${table}_${column}_check`,
          )
          .map((row) => row.definition)
          .join(" ");
        return [...definition.matchAll(/'([^']+)'::text/gu)]
          .map((match) => match[1]!)
          .filter((value, index, values) => values.indexOf(value) === index);
      };
      expect(valuesFor("entitlement_grant", "tier").sort()).toEqual(
        [...PERSISTED_TIERS].sort(),
      );
      expect(valuesFor("admin_role_grant", "sub_role").sort()).toEqual(
        [...ADMIN_SUB_ROLES].sort(),
      );
    });

    it("executes 100 explicit tier/sub-role by endpoint allow/deny cells", async () => {
      expect(endpointRequests.map((entry) => entry.contract)).toEqual(
        SLICE1_AUTHENTICATED_ENDPOINTS,
      );
      let cells = 0;
      let allowed = 0;
      let denied = 0;
      for (const subject of subjects) {
        const stored = await resolveStoredAuthorization(
          pool,
          subject.accountId,
          subject.userId,
        );
        expect(stored).toEqual({
          tier: subject.tier,
          adminSubRoles: subject.adminSubRoles,
        });
        for (const endpoint of endpointRequests) {
          const response = await requestFor(subject, endpoint);
          const expected =
            subject.tier !== "demo" && endpoint.contract !== "GET /api/v1/me"
              ? 403
              : endpoint.method === "POST"
                ? endpoint.contract === "POST /api/v1/runs"
                  ? 202
                  : endpoint.contract ===
                      "POST /api/v1/runs/:runId/cancellation"
                    ? 202
                    : endpoint.contract === "POST /api/v1/requests" ||
                        endpoint.contract ===
                          "POST /api/v1/requests/:requestId/versions"
                      ? 201
                      : 200
                : 200;
          expect(response.status, `${subject.name} ${endpoint.contract}`).toBe(
            expected,
          );
          if (expected === 403) denied += 1;
          else allowed += 1;
          cells += 1;
        }
      }
      expect(cells).toBe(100);
      expect({ allowed, denied }).toEqual({ allowed: 19, denied: 81 });
    }, 30_000);

    it("denies 10 anonymous endpoint attempts and expired/revoked sessions", async () => {
      for (const endpoint of endpointRequests) {
        expect(
          (await requestFor(null, endpoint)).status,
          endpoint.contract,
        ).toBe(401);
      }
      const demo = subjects[0]!;
      await pool.query(
        "UPDATE user_session SET revoked_at = clock_timestamp(), revoked_reason = 'matrix' WHERE account_id = $1",
        [demo.accountId],
      );
      expect((await requestFor(demo, endpointRequests[0]!)).status).toBe(401);
      await pool.query(
        `UPDATE user_session SET revoked_at = NULL,
              absolute_expires_at = created_at + interval '1 millisecond',
              idle_expires_at = created_at + interval '1 millisecond'
        WHERE account_id = $1`,
        [demo.accountId],
      );
      expect((await requestFor(demo, endpointRequests[0]!)).status).toBe(401);
    });

    it("rejects client authority injection on all 10 endpoints", async () => {
      const admin = subjects.find((entry) => entry.name === "Admin/product")!;
      for (const endpoint of endpointRequests) {
        const response = await requestFor(admin, endpoint, {
          injectAuthority: true,
        });
        expect(response.status, endpoint.contract).toBe(
          endpoint.contract === "GET /api/v1/me" ? 200 : 403,
        );
      }
      const me = (await (
        await requestFor(admin, endpointRequests[0]!, { injectAuthority: true })
      ).json()) as { tier: string; admin_sub_roles: string[] };
      expect(me.tier).toBe("admin");
      expect(me.admin_sub_roles).toEqual(["product"]);
    });

    it("denies cross-account/cross-subject resolution and guessed identifiers", async () => {
      const left = subjects[1]!;
      const right = subjects[2]!;
      expect(
        await resolveStoredAuthorization(pool, left.accountId, right.userId),
      ).toBeNull();
      expect(
        await resolveStoredAuthorization(pool, right.accountId, left.userId),
      ).toBeNull();
      expect(
        await resolveStoredAuthorization(pool, randomUUID(), randomUUID()),
      ).toBeNull();
    });

    it("fails closed when a non-Admin entitlement carries a stored Admin sub-role", async () => {
      const standard = subjects[1]!;
      const grantor = await pool.query<{ user_id: string }>(
        "SELECT user_id FROM app_user WHERE account_id = $1 AND user_id <> $2 ORDER BY user_id LIMIT 1",
        [standard.accountId, standard.userId],
      );
      await expect(
        inTransaction(pool, async (client) => {
          await client.query(
            `INSERT INTO admin_role_grant
             (admin_grant_id, account_id, user_id, sub_role, granted_by_user_id,
              justification, effective_from)
           VALUES ($1,$2,$3,'support',$4,'negative parity fixture',clock_timestamp())`,
            [
              randomUUID(),
              standard.accountId,
              standard.userId,
              grantor.rows[0]!.user_id,
            ],
          );
          await resolveStoredAuthorization(
            client,
            standard.accountId,
            standard.userId,
          );
        }),
      ).rejects.toThrow(/non-Admin entitlement/u);
    });

    it("denies wrong Origin and CSRF on every unsafe endpoint", async () => {
      const standard = subjects[1]!;
      for (const endpoint of endpointRequests.filter(
        (entry) => entry.method === "POST",
      )) {
        expect(
          (
            await requestFor(standard, endpoint, {
              origin: "https://attacker.invalid",
            })
          ).status,
          `${endpoint.contract} Origin`,
        ).toBe(403);
        expect(
          (await requestFor(standard, endpoint, { csrf: "wrong-csrf" })).status,
          `${endpoint.contract} CSRF`,
        ).toBe(403);
      }
    });
  },
);
