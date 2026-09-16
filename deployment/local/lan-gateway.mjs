// MB-UX-OPS-002 L07. Local test transport only; never a production reverse proxy.
import http from "node:http";
import { isPrivateIPv4 } from "./config.mjs";

const maximumBodyBytes = 4 * 1024 * 1024;
const hopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function validateGatewayConfig({ address, port }) {
  if (
    !isPrivateIPv4(address) ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535
  )
    throw new Error(
      "Gateway requires a specific private IPv4 address and local port.",
    );
  return { address, port };
}

export function admitGatewayRequest(
  request,
  { address, port },
  upgrade = false,
) {
  const authority = `${address}:${port}`;
  // Reject duplicates rather than relying on Node's header coalescing rules.
  for (const name of ["host", "origin", "content-length"])
    if (
      request.rawHeaders.filter(
        (_, i) => i % 2 === 0 && request.rawHeaders[i].toLowerCase() === name,
      ).length > 1
    )
      return false;
  if (
    request.headers.host !== authority ||
    !request.url?.startsWith("/") ||
    request.url.startsWith("//")
  )
    return false;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  if (
    Object.keys(request.headers).some(
      (name) =>
        name === "forwarded" ||
        name.startsWith("x-forwarded-") ||
        name === "x-original-url" ||
        name === "x-rewrite-url",
    )
  )
    return false;
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== `http://${authority}`) return false;
  if (
    !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(
      request.method,
    )
  )
    return false;
  if (!["GET", "HEAD"].includes(request.method) && origin === undefined)
    return false;
  if (
    upgrade &&
    (request.method !== "GET" ||
      origin === undefined ||
      request.headers.upgrade?.toLowerCase() !== "websocket" ||
      !/^\/_next\/webpack-hmr(?:\?|$)/.test(request.url))
  )
    return false;
  return true;
}

function filteredHeaders(headers) {
  const connectionTokens = String(headers.connection ?? "")
    .toLowerCase()
    .split(",")
    .map((value) => value.trim());
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !hopHeaders.has(name) && !connectionTokens.includes(name),
    ),
  );
}

function upstreamHeaders(request, port, upgrade = false) {
  const headers = filteredHeaders(request.headers);
  headers.host = `localhost:${port}`;
  if (headers.origin) headers.origin = `http://localhost:${port}`;
  if (headers.referer) {
    const referer = new URL(headers.referer, `http://${request.headers.host}`);
    headers.referer =
      referer.origin === `http://${request.headers.host}`
        ? `http://localhost:${port}${referer.pathname}${referer.search}`
        : undefined;
    if (!headers.referer) delete headers.referer;
  }
  if (upgrade) {
    headers.connection = "Upgrade";
    headers.upgrade = "websocket";
  }
  return headers;
}

export function gatewayResponseHeaders(headers, { address, port }) {
  const result = filteredHeaders(headers);
  if (typeof result.location === "string") {
    try {
      const location = new URL(result.location);
      if (location.origin === `http://localhost:${port}`)
        result.location = `http://${address}:${port}${location.pathname}${location.search}${location.hash}`;
    } catch {
      /* Relative redirects remain relative to the client's own origin. */
    }
  }
  // Simulator cookies are host-only; do not introduce a Domain attribute or rewrite values.
  return result;
}

export function createLanGateway(input) {
  const config = validateGatewayConfig(input);
  const sockets = new Set();
  let closing;
  const server = http.createServer(
    { maxHeaderSize: 32768 },
    async (request, response) => {
      if (!admitGatewayRequest(request, config)) {
        response.writeHead(403).end("Local access request refused.");
        return;
      }
      if (Number(request.headers["content-length"] ?? 0) > maximumBodyBytes) {
        response.writeHead(413).end("Request too large.");
        return;
      }
      let body;
      try {
        const chunks = [];
        let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          if (length > maximumBodyBytes) {
            response.writeHead(413).end("Request too large.");
            return;
          }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
      } catch {
        response.destroy();
        return;
      }
      let headers;
      try {
        headers = upstreamHeaders(request, config.port);
      } catch {
        response.writeHead(400).end("Invalid local request.");
        return;
      }
      // Backend is always loopback, never a Host/header-selected target.
      const upstream = http.request(
        {
          hostname: "127.0.0.1",
          port: config.port,
          path: request.url,
          method: request.method,
          headers,
        },
        (incoming) => {
          response.writeHead(
            incoming.statusCode,
            gatewayResponseHeaders(incoming.headers, config),
          );
          incoming.on("error", () => response.destroy());
          incoming.pipe(response);
        },
      );
      upstream.on("error", () => {
        if (!response.headersSent)
          response
            .writeHead(502)
            .end(
              "MatchBASE is starting or unavailable. Use localhost on the host after Docker starts.",
            );
        else response.destroy();
      });
      response.on("close", () => upstream.destroy());
      upstream.end(body);
    },
  );
  server.requestTimeout = 600000;
  server.headersTimeout = 60000;
  server.maxConnections = 32;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("clientError", (_, socket) =>
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"),
  );
  server.on("upgrade", (request, client, head) => {
    if (!admitGatewayRequest(request, config, true)) {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    let headers;
    try {
      headers = upstreamHeaders(request, config.port, true);
    } catch {
      client.destroy();
      return;
    }
    const upstream = http.request({
      hostname: "127.0.0.1",
      port: config.port,
      path: request.url,
      method: "GET",
      headers,
    });
    upstream.on("upgrade", (incoming, backend, backendHead) => {
      const responseHeaders = gatewayResponseHeaders(incoming.headers, config);
      responseHeaders.connection = "Upgrade";
      responseHeaders.upgrade = "websocket";
      client.write(
        `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(responseHeaders)
          .map(([name, value]) => `${name}: ${value}`)
          .join("\r\n")}\r\n\r\n`,
      );
      if (backendHead.length) client.write(backendHead);
      if (head.length) backend.write(head);
      client.on("error", () => backend.destroy());
      backend.on("error", () => client.destroy());
      client.on("close", () => backend.destroy());
      backend.on("close", () => client.destroy());
      client.pipe(backend);
      backend.pipe(client);
    });
    upstream.on("response", (incoming) => {
      incoming.resume();
      client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    upstream.end();
  });
  return {
    server,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.address, () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
    },
    async close() {
      if (!closing) {
        for (const socket of sockets) socket.destroy();
        closing = new Promise((resolve) => server.close(resolve));
      }
      await closing;
    },
  };
}
