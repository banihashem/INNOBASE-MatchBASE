import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, migrateUp, type ConnectionPool } from "@matchbase/data";
import { closeFetchRuntime, handleRoute } from "./fetch-runtime";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe.sequential : describe.skip;
const origin = "http://127.0.0.1:3199";
const deploymentId = `fetch-simulator-${randomUUID()}`;
const digestKey = "fetch-runtime-simulator-digest-key-000000000001";

type CookieJar = Map<string, string>;
type IdentityProjection = {
  tier: "demo" | "standard";
  subject: { account_id: string; user_id: string };
  display_name: string;
};

const runtimeEnvironmentKeys = [
  "DATABASE_URL",
  "MATCHBASE_ENVIRONMENT",
  "MATCHBASE_ORIGIN",
  "MATCHBASE_DEPLOYMENT_ID",
  "MATCHBASE_OIDC_SIMULATOR",
  "MATCHBASE_SYNTHETIC_FIXTURE",
  "MATCHBASE_LIVE_RESEARCH_ENABLED",
  "MATCHBASE_TEST_LIVE_POLICY_PATH",
  "MATCHBASE_GEMINI_API_KEY",
  "MATCHBASE_OPENROUTER_API_KEY",
  "MATCHBASE_DIGEST_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
] as const;

function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function responseCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

function absorbCookies(jar: CookieJar, response: Response): void {
  for (const setCookie of responseCookies(response)) {
    const [pair] = setCookie.split(";", 1);
    if (!pair) continue;
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (/;\s*Max-Age=0(?:;|$)/iu.test(setCookie)) jar.delete(name);
    else jar.set(name, value);
  }
}

async function request(
  path: string,
  jar: CookieJar = new Map(),
): Promise<Response> {
  const cookies = cookieHeader(jar);
  return handleRoute(
    new Request(
      new URL(path, origin),
      cookies ? { headers: { cookie: cookies } } : {},
    ),
  );
}

async function begin(
  fixture: "demo" | "standard",
): Promise<{ callback: string; jar: CookieJar }> {
  const jar = new Map<string, string>();
  const response = await request(
    `/auth/simulator/start?fixture=${fixture}`,
    jar,
  );
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toContain(`fixture=${fixture}`);
  expect(response.headers.get("location")).toContain("state=");
  expect(response.headers.get("location")).toContain("ticket=");
  absorbCookies(jar, response);
  expect(jar.has("matchbase_simulator_transaction")).toBe(true);
  return { callback: response.headers.get("location")!, jar };
}

async function authenticate(fixture: "demo" | "standard"): Promise<{
  identity: IdentityProjection;
  jar: CookieJar;
  callback: string;
  transactionJar: CookieJar;
}> {
  const started = await begin(fixture);
  const transactionJar = new Map(started.jar);
  const callbackResponse = await request(started.callback, started.jar);
  expect(callbackResponse.status).toBe(303);
  expect(callbackResponse.headers.get("location")).toBe("/");
  absorbCookies(started.jar, callbackResponse);
  expect(started.jar.has("matchbase_simulator_transaction")).toBe(false);
  expect(started.jar.has("matchbase_session")).toBe(true);
  expect(started.jar.has("matchbase_csrf")).toBe(true);

  const me = await request("/api/v1/me", started.jar);
  expect(me.status).toBe(200);
  const identity = (await me.json()) as IdentityProjection;
  expect(identity.tier).toBe(fixture);
  return {
    identity,
    jar: started.jar,
    callback: started.callback,
    transactionJar,
  };
}

describePostgres("active Fetch runtime signed simulator", () => {
  let pool: ConnectionPool;
  const originalEnvironment = new Map<string, string | undefined>();

  beforeAll(async () => {
    for (const key of runtimeEnvironmentKeys)
      originalEnvironment.set(key, process.env[key]);
    Object.assign(process.env, {
      DATABASE_URL: databaseUrl!,
      MATCHBASE_ENVIRONMENT: "test",
      MATCHBASE_ORIGIN: origin,
      MATCHBASE_DEPLOYMENT_ID: deploymentId,
      MATCHBASE_OIDC_SIMULATOR: "true",
      MATCHBASE_SYNTHETIC_FIXTURE: "true",
      MATCHBASE_DIGEST_KEY: digestKey,
    });
    pool = createPool({ connectionString: databaseUrl!, max: 4 });
    await migrateUp(pool);
  }, 30_000);

  afterAll(async () => {
    await closeFetchRuntime();
    if (pool) await pool.end();
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("refuses direct callbacks and every transaction substitution", async () => {
    const direct = await request("/auth/simulator/callback?fixture=standard");
    expect(direct.status).toBe(404);
    expect(await direct.json()).toMatchObject({ code: "MB-404-ROUTE" });

    const cases: ReadonlyArray<{
      name: string;
      mutate: (url: URL, jar: CookieJar) => void;
    }> = [
      {
        name: "fixture",
        mutate(url) {
          url.searchParams.set("fixture", "consultant");
        },
      },
      {
        name: "state",
        mutate(url) {
          url.searchParams.set("state", `${url.searchParams.get("state")}x`);
        },
      },
      {
        name: "ticket",
        mutate(url) {
          url.searchParams.set("ticket", `${url.searchParams.get("ticket")}x`);
        },
      },
      {
        name: "sealed cookie",
        mutate(_url, jar) {
          const value = jar.get("matchbase_simulator_transaction")!;
          jar.set("matchbase_simulator_transaction", `${value}x`);
        },
      },
      {
        name: "cross-fixture",
        mutate(url) {
          url.searchParams.set("fixture", "demo");
        },
      },
    ];

    for (const scenario of cases) {
      const started = await begin("standard");
      const url = new URL(started.callback, origin);
      scenario.mutate(url, started.jar);
      const refusal = await request(url.toString(), started.jar);
      expect(refusal.status, scenario.name).toBe(404);
      expect(await refusal.json(), scenario.name).toMatchObject({
        code: "MB-404-ROUTE",
      });
    }
  });

  it("issues isolated Demo and Standard identities and refuses callback replay", async () => {
    const standard = await authenticate("standard");
    const replay = await request(standard.callback, standard.transactionJar);
    expect(replay.status).toBe(403);
    expect(await replay.json()).toMatchObject({ code: "MB-403-REQUEST" });

    const demo = await authenticate("demo");
    expect(standard.identity).toMatchObject({
      tier: "standard",
      display_name: "Synthetic Standard",
    });
    expect(demo.identity).toMatchObject({
      tier: "demo",
      display_name: "Synthetic Demo",
    });
    expect(standard.identity.subject.account_id).not.toBe(
      demo.identity.subject.account_id,
    );
    expect(standard.identity.subject.user_id).not.toBe(
      demo.identity.subject.user_id,
    );

    const persisted = await pool.query<{
      google_sub: string;
      email: string | null;
    }>(
      `SELECT google_sub, email
         FROM app_user
        WHERE google_sub IN ($1,$2)
        ORDER BY google_sub`,
      [
        `simulator-demo-subject-v1:${deploymentId}`,
        `simulator-standard-subject-v1:${deploymentId}`,
      ],
    );
    expect(persisted.rows).toEqual([
      {
        google_sub: `simulator-demo-subject-v1:${deploymentId}`,
        email: "demo@example.invalid",
      },
      {
        google_sub: `simulator-standard-subject-v1:${deploymentId}`,
        email: "standard@example.invalid",
      },
    ]);
  });

  it("refuses to initialize the Fetch runtime with production fixtures", async () => {
    await closeFetchRuntime();
    Object.assign(process.env, {
      MATCHBASE_ENVIRONMENT: "production",
      MATCHBASE_OIDC_SIMULATOR: "true",
      MATCHBASE_SYNTHETIC_FIXTURE: "true",
      GOOGLE_CLIENT_ID: "production-client-id",
      GOOGLE_CLIENT_SECRET: "production-client-secret",
      GOOGLE_REDIRECT_URI: "https://matchbase.example/auth/google/callback",
    });
    await expect(
      request("/auth/simulator/start?fixture=standard"),
    ).rejects.toThrow(
      "Production startup refused: local identity or synthetic fixture mode is enabled.",
    );
  });
});
