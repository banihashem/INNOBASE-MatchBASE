import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MatchBaseApplication } from "@matchbase/application";
import { sha256Base64Url } from "@matchbase/auth";
import {
  createPool,
  migrateDown,
  migrateUp,
  type ConnectionPool,
} from "@matchbase/data";
import type { WebConfig } from "./config";
import { createWebRuntime } from "./runtime";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe.sequential : describe.skip;

function cookiePair(response: Response, name: string): string {
  const value = response.headers
    .getSetCookie()
    .find((item) => item.startsWith(`${name}=`));
  if (!value) throw new Error(`Missing ${name} cookie.`);
  return value.split(";", 1)[0]!;
}

describePostgres("native runtime signed simulator parity", () => {
  let pool: ConnectionPool;
  let server: Server;
  let baseUrl: string;
  let config: WebConfig;

  beforeAll(async () => {
    pool = createPool({ connectionString: databaseUrl!, max: 4 });
    await migrateDown(pool).catch(() => false);
    await migrateUp(pool);
    config = {
      environment: "test",
      origin: "http://127.0.0.1",
      deploymentId: "slice2-native-simulator",
      databaseUrl: databaseUrl!,
      oidcSimulatorEnabled: true,
      syntheticFixtureEnabled: true,
      digestKey: Buffer.from("slice2-native-simulator-digest-key-00001"),
      port: 0,
    };
    const application = {
      readiness: async () => true,
    } as unknown as MatchBaseApplication;
    const listener = createWebRuntime({ config, pool, application });
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
  });

  afterAll(async () => {
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    if (pool) {
      await migrateDown(pool).catch(() => false);
      await pool.end();
    }
  });

  async function start(fixture: "demo" | "standard"): Promise<Response> {
    return fetch(`${baseUrl}/auth/simulator/start?fixture=${fixture}`, {
      redirect: "manual",
    });
  }

  it("binds signed single-use transactions to Demo and Standard fixtures", async () => {
    for (const fixture of ["demo", "standard"] as const) {
      const started = await start(fixture);
      expect(started.status).toBe(302);
      const location = started.headers.get("location")!;
      const transactionCookie = cookiePair(
        started,
        "__Host-matchbase_simulator_transaction",
      );
      const callback = await fetch(`${baseUrl}${location}`, {
        headers: { cookie: transactionCookie },
      });
      expect(callback.status).toBe(200);
      const sessionPair = cookiePair(callback, "__Host-matchbase_session");
      const handle = decodeURIComponent(sessionPair.split("=", 2)[1]!);
      const stored = await pool.query<{ tier: string }>(
        `SELECT eg.tier
           FROM user_session us
           JOIN entitlement_grant eg
             ON eg.account_id=us.account_id AND eg.user_id=us.user_id
          WHERE us.handle_hash=$1 AND eg.revoked_at IS NULL`,
        [Buffer.from(sha256Base64Url(handle), "base64url")],
      );
      expect(stored.rows).toEqual([{ tier: fixture }]);
      expect(
        (
          await fetch(`${baseUrl}${location}`, {
            headers: { cookie: transactionCookie },
          })
        ).status,
      ).toBe(404);
    }
  });

  it("rejects direct, tampered, cross-fixture, and production callbacks", async () => {
    expect(
      (await fetch(`${baseUrl}/auth/simulator/callback?fixture=standard`))
        .status,
    ).toBe(404);

    const started = await start("standard");
    const location = new URL(started.headers.get("location")!, baseUrl);
    const transactionCookie = cookiePair(
      started,
      "__Host-matchbase_simulator_transaction",
    );
    location.searchParams.set("fixture", "demo");
    expect(
      (
        await fetch(location, {
          headers: { cookie: transactionCookie },
        })
      ).status,
    ).toBe(404);
    location.searchParams.set("fixture", "standard");
    location.searchParams.set("ticket", "tampered");
    expect(
      (
        await fetch(location, {
          headers: { cookie: transactionCookie },
        })
      ).status,
    ).toBe(404);

    config.environment = "production";
    expect((await start("standard")).status).toBe(404);
    config.environment = "test";
  });
});
