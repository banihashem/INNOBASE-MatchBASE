import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { once, EventEmitter } from "node:events";
import test from "node:test";
import {
  admitGatewayRequest,
  createLanGateway,
  gatewayResponseHeaders,
  validateGatewayConfig,
} from "./lan-gateway.mjs";
import {
  reconcilePortableGateway,
  selectPortableAddress,
  transportEnvironment,
  runPortableAccess,
} from "./portable-access.mjs";

const config = { address: "10.24.5.7", port: 3000 };
function supervisorFixture() {
  return {
    events: new EventEmitter(),
    readFile: async () =>
      JSON.stringify({
        version: 1,
        interfaceGuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        port: 3000,
      }),
    execute: async () => ({
      stdout: JSON.stringify({ addresses: ["10.24.5.7"] }),
    }),
    writeFile: async () => {},
    rename: async () => {},
  };
}

test("MB-UX-OPS-002 L07 cold Windows discovery has a bounded thirty-second deadline and aborts on stop", async () => {
  const controls = supervisorFixture();
  let observed;
  let announce;
  const started = new Promise((resolve) => {
    announce = resolve;
  });
  controls.execute = async (_executable, _arguments, options) => {
    observed = options;
    announce();
    await new Promise((_, reject) =>
      options.signal.addEventListener(
        "abort",
        () =>
          reject(
            Object.assign(new Error("cancelled discovery"), {
              name: "AbortError",
            }),
          ),
        { once: true },
      ),
    );
  };
  controls.gatewayFactory = () => {
    throw new Error("No listener may be created after stop");
  };
  const running = runPortableAccess("synthetic-config", controls);
  await started;
  assert.equal(observed.timeout, 30000);
  assert.equal(observed.windowsHide, true);
  assert.equal(observed.signal.aborted, false);
  controls.events.emit("SIGTERM");
  await running;
  assert.equal(observed.signal.aborted, true);
  assert.equal(controls.events.listenerCount("SIGTERM"), 0);
});

for (const failure of ["writeFile", "rename"]) {
  test(`MB-UX-OPS-002 L07 ${failure} failure retries status while discovery and network reconciliation continue`, async () => {
    const controls = supervisorFixture();
    const activity = [];
    const stored = [];
    let discovery = 0;
    let attempts = 0;
    let pending;
    controls.execute = async () => ({
      stdout: JSON.stringify({
        addresses: [++discovery < 3 ? "10.24.5.7" : "192.168.1.20"],
      }),
    });
    controls.gatewayFactory = ({ address }) => ({
      listen: async () => activity.push(`listen:${address}`),
      close: async () => activity.push(`close:${address}`),
    });
    controls.writeFile = async (_, value) => {
      pending = JSON.parse(value);
    };
    controls.rename = async () => {
      stored.push(pending);
    };
    const original = controls[failure];
    controls[failure] = async (...args) => {
      if (++attempts === 1)
        throw Object.assign(new Error("synthetic unavailable status storage"), {
          code: "EACCES",
        });
      return original(...args);
    };
    controls.pause = async () => {
      if (discovery === 3) controls.events.emit("SIGTERM");
    };
    await runPortableAccess("synthetic-config", controls);
    assert.equal(discovery, 3);
    assert.equal(attempts, 3);
    assert.deepEqual(
      stored.map((value) => value.lan),
      ["http://10.24.5.7:3000", "http://192.168.1.20:3000"],
    );
    assert.deepEqual(activity, [
      "listen:10.24.5.7",
      "close:10.24.5.7",
      "listen:192.168.1.20",
      "close:192.168.1.20",
    ]);
    assert.equal(controls.events.listenerCount("SIGTERM"), 0);
    assert.equal(controls.events.listenerCount("SIGINT"), 0);
  });
}

for (const pendingOperation of ["discovery", "listen"]) {
  test(`MB-UX-OPS-002 L07 shutdown during pending ${pendingOperation} leaves no new listener or signal handler`, async () => {
    const controls = supervisorFixture();
    let active = false;
    let binds = 0;
    let closes = 0;
    let writes = 0;
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    let announce;
    const started = new Promise((resolve) => {
      announce = resolve;
    });
    if (pendingOperation === "discovery")
      controls.execute = async () => {
        announce();
        await pending;
        return { stdout: JSON.stringify({ addresses: ["10.24.5.7"] }) };
      };
    controls.gatewayFactory = () => ({
      listen: async () => {
        binds++;
        announce();
        await pending;
        active = true;
      },
      close: async () => {
        closes++;
        active = false;
      },
    });
    controls.writeFile = async () => {
      writes++;
    };
    const running = runPortableAccess("synthetic-config", controls);
    await started;
    controls.events.emit("SIGTERM");
    controls.events.emit("SIGINT");
    release();
    await running;
    assert.equal(active, false);
    assert.equal(binds, pendingOperation === "listen" ? 1 : 0);
    assert.equal(closes, pendingOperation === "listen" ? 1 : 0);
    assert.equal(writes, 0);
    assert.equal(controls.events.listenerCount("SIGTERM"), 0);
    assert.equal(controls.events.listenerCount("SIGINT"), 0);
  });
}

test("MB-UX-OPS-002 L07 fatal supervisor exit closes its listener before rejection", async () => {
  const controls = supervisorFixture();
  let active = false;
  let closes = 0;
  controls.gatewayFactory = () => ({
    listen: async () => {
      active = true;
    },
    close: async () => {
      active = false;
      closes++;
    },
  });
  controls.pause = async () => {
    throw new Error("synthetic fatal supervisor failure");
  };
  await assert.rejects(
    runPortableAccess("synthetic-config", controls),
    /synthetic fatal/,
  );
  assert.equal(active, false);
  assert.equal(closes, 1);
  assert.equal(controls.events.listenerCount("SIGTERM"), 0);
  assert.equal(controls.events.listenerCount("SIGINT"), 0);
});

function fixture(extra = {}) {
  const headers = { host: "10.24.5.7:3000", ...extra.headers };
  return {
    url: "/consultant/workflow",
    method: "GET",
    ...extra,
    headers,
    rawHeaders: Object.entries(headers).flat(),
  };
}
test("MB-UX-OPS-002 L07 admission blocks foreign origins, spoofed routing and cross-site access", () => {
  assert.equal(admitGatewayRequest(fixture(), config), true);
  assert.equal(
    admitGatewayRequest(
      fixture({ method: "POST", headers: { origin: "http://10.24.5.7:3000" } }),
      config,
    ),
    true,
  );
  for (const candidate of [
    fixture({ headers: { host: "evil.example:3000" } }),
    fixture({ headers: { origin: "null" } }),
    fixture({ headers: { origin: "http://10.24.5.7:3001" } }),
    fixture({ headers: { "sec-fetch-site": "cross-site" } }),
    fixture({ headers: { "x-forwarded-host": "localhost:3000" } }),
    fixture({ headers: { forwarded: "host=localhost" } }),
    fixture({ headers: { "x-original-url": "/admin" } }),
    fixture({ method: "POST" }),
    fixture({ method: "CONNECT" }),
    fixture({ url: "http://evil.example/" }),
    fixture({ url: "//evil.example/" }),
  ])
    assert.equal(
      admitGatewayRequest(candidate, config),
      false,
      JSON.stringify(candidate),
    );
  const duplicate = fixture();
  duplicate.rawHeaders.push("Host", "10.24.5.7:3000");
  assert.equal(admitGatewayRequest(duplicate, config), false);
});
test("MB-UX-OPS-002 L07 WebSocket admission is restricted to same-origin Next development transport", () => {
  const request = fixture({
    url: "/_next/webpack-hmr?test=1",
    headers: { origin: "http://10.24.5.7:3000", upgrade: "websocket" },
  });
  assert.equal(admitGatewayRequest(request, config, true), true);
  for (const changed of [
    { url: "/api/anything" },
    { headers: { ...request.headers, origin: undefined } },
    { headers: { ...request.headers, origin: "http://evil.example" } },
  ])
    assert.equal(
      admitGatewayRequest({ ...request, ...changed }, config, true),
      false,
    );
});
test("MB-UX-OPS-002 L07 public/wildcard/VPN addresses and multiple private addresses fail closed", () => {
  for (const address of [
    "0.0.0.0",
    "127.0.0.1",
    "100.96.0.1",
    "8.8.8.8",
    "::",
    "10.0.0.01",
  ])
    assert.throws(() => validateGatewayConfig({ ...config, address }));
  assert.equal(selectPortableAddress(["100.96.0.1", "169.254.1.3"]), null);
  assert.equal(selectPortableAddress(["192.168.1.20"]), "192.168.1.20");
  assert.equal(selectPortableAddress(["10.2.3.4", "192.168.1.20"]), null);
});
test("MB-UX-OPS-002 L07 network movement replaces only the LAN listener and leaves no stale listener", async () => {
  const events = [];
  const factory = ({ address }) => ({
    listen: async () => events.push(`listen:${address}`),
    close: async () => events.push(`close:${address}`),
  });
  let current = await reconcilePortableGateway(
    { gateway: null, address: null },
    "192.168.1.20",
    3000,
    factory,
  );
  current = await reconcilePortableGateway(
    current,
    "192.168.1.20",
    3000,
    factory,
  );
  current = await reconcilePortableGateway(current, "10.24.5.7", 3000, factory);
  current = await reconcilePortableGateway(current, null, 3000, factory);
  assert.deepEqual(events, [
    "listen:192.168.1.20",
    "close:192.168.1.20",
    "listen:10.24.5.7",
    "close:10.24.5.7",
  ]);
  assert.equal(current.gateway, null);
  const failed = await reconcilePortableGateway(
    current,
    "10.24.5.7",
    3000,
    () => ({
      listen: async () => {
        throw new Error("unassigned after inspection");
      },
      close: async () => events.push("failed-listener-closed"),
    }),
  );
  assert.equal(failed.address, null);
  assert.equal(failed.state, "lan-port-unavailable");
});
test("MB-UX-OPS-002 L07 transport processes receive no application or provider credentials", () => {
  assert.deepEqual(
    transportEnvironment({
      PATH: "system",
      MATCHBASE_OPENROUTER_API_KEY: "fixture",
      DATABASE_URL: "fixture",
      OPENROUTER_API_KEY: "fixture",
      NODE_OPTIONS: "--inspect",
      USERPROFILE: "fixture-profile",
    }),
    { PATH: "system", USERPROFILE: "fixture-profile" },
  );
});
test("MB-UX-OPS-002 L07 redirects and host-only cookies preserve the client origin without rewriting unrelated targets", () => {
  const cookie = ["session=synthetic; HttpOnly; SameSite=Lax; Path=/"];
  assert.deepEqual(
    gatewayResponseHeaders(
      {
        location: "http://localhost:3000/auth/callback?q=1#part",
        "set-cookie": cookie,
      },
      config,
    ),
    {
      location: "http://10.24.5.7:3000/auth/callback?q=1#part",
      "set-cookie": cookie,
    },
  );
  for (const location of [
    "/auth/callback",
    "http://localhost:3001/",
    "http://evil.example/",
  ])
    assert.equal(
      gatewayResponseHeaders({ location }, config).location,
      location,
    );
});
async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}
function request(port, headers, options = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: options.path ?? "/api/fixture",
        method: options.method ?? "GET",
        headers,
      },
      (incoming) => {
        const chunks = [];
        incoming.on("data", (chunk) => chunks.push(chunk));
        incoming.on("end", () =>
          resolve({
            status: incoming.statusCode,
            headers: incoming.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end(options.body);
  });
}
test("MB-UX-OPS-002 L07 real HTTP forwarding preserves bodies, cookies and enforces origin before upstream", async (t) => {
  let count = 0;
  const backend = http.createServer(async (incoming, outgoing) => {
    count++;
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    outgoing.setHeader(
      "set-cookie",
      "session=synthetic; HttpOnly; SameSite=Lax; Path=/",
    );
    outgoing.end(
      JSON.stringify({
        host: incoming.headers.host,
        origin: incoming.headers.origin,
        body: Buffer.concat(chunks).toString(),
      }),
    );
  });
  const backendPort = await listen(backend);
  const gateway = createLanGateway({
    address: config.address,
    port: backendPort,
  });
  // Test only: bind the HTTP server to an ephemeral loopback socket; production listen() uses the qualified private address.
  const port = await listen(gateway.server);
  t.after(async () => {
    await gateway.close();
    await new Promise((resolve) => backend.close(resolve));
  });
  const authority = `${config.address}:${backendPort}`;
  const result = await request(
    port,
    { host: authority, origin: `http://${authority}` },
    { method: "POST", body: "approved request fixture" },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), {
    host: `localhost:${backendPort}`,
    origin: `http://localhost:${backendPort}`,
    body: "approved request fixture",
  });
  assert.match(result.headers["set-cookie"][0], /HttpOnly/);
  assert.equal(
    (
      await request(
        port,
        { host: authority, origin: "http://evil.example" },
        { method: "POST" },
      )
    ).status,
    403,
  );
  assert.equal(count, 1);
  assert.equal(
    (
      await request(
        port,
        {
          host: authority,
          origin: `http://${authority}`,
          "content-length": String(5 * 1024 * 1024),
        },
        { method: "POST" },
      )
    ).status,
    413,
  );
  assert.equal(count, 1);
});
test("MB-UX-OPS-002 L07 unavailable Docker backend produces a recoverable response without crashing gateway", async (t) => {
  const vacant = http.createServer();
  const backendPort = await listen(vacant);
  await new Promise((resolve) => vacant.close(resolve));
  const gateway = createLanGateway({
    address: config.address,
    port: backendPort,
  });
  const port = await listen(gateway.server);
  t.after(() => gateway.close());
  const result = await request(port, {
    host: `${config.address}:${backendPort}`,
  });
  assert.equal(result.status, 502);
  const backend = http.createServer((_, response) => response.end("recovered"));
  backend.listen(backendPort, "127.0.0.1");
  await once(backend, "listening");
  t.after(() => new Promise((resolve) => backend.close(resolve)));
  assert.equal(
    (await request(port, { host: `${config.address}:${backendPort}` })).body,
    "recovered",
  );
});
test(
  "MB-UX-OPS-002 L07 real WebSocket upgrade relays the canonical origin and closes with its LAN listener",
  { timeout: 5000 },
  async (t) => {
    let observedOrigin;
    const backend = http.createServer();
    backend.on("upgrade", (incoming, socket) => {
      observedOrigin = incoming.headers.origin;
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
      );
      socket.on("data", (data) => socket.write(data));
      socket.on("end", () => socket.end());
    });
    const backendPort = await listen(backend);
    const gateway = createLanGateway({
      address: config.address,
      port: backendPort,
    });
    const port = await listen(gateway.server);
    t.after(async () => {
      await gateway.close();
      await new Promise((resolve) => backend.close(resolve));
    });
    const client = net.connect(port, "127.0.0.1");
    await once(client, "connect");
    client.write(
      `GET /_next/webpack-hmr HTTP/1.1\r\nHost: ${config.address}:${backendPort}\r\nOrigin: http://${config.address}:${backendPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`,
    );
    const [handshake] = await once(client, "data");
    assert.match(handshake.toString(), /101 Switching/);
    assert.equal(observedOrigin, `http://localhost:${backendPort}`);
    client.write("fixture-frame");
    const [echo] = await once(client, "data");
    assert.equal(echo.toString(), "fixture-frame");
    await gateway.close();
    await once(client, "close");
  },
);
