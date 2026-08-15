import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import {
  isPublicUnicastAddress,
  type DnsResolver,
  type PinnedFetchTransport,
  type SourceAccessEvaluator,
} from "./secure-fetch.js";

export const resolvePublicDns: DnsResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return Object.freeze([...new Set(records.map((record) => record.address))]);
};

export const nodePinnedFetchTransport: PinnedFetchTransport = async (input) => {
  const url = new URL(input.url);
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.hostname !== input.serverName ||
    !isPublicUnicastAddress(input.connectAddress)
  )
    throw new Error("Pinned HTTPS request identity is invalid.");
  return await new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: url.hostname,
        servername: input.serverName,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: input.headers,
        timeout: input.timeoutMs,
        rejectUnauthorized: true,
        lookup: (_hostname, _options, callback) =>
          callback(
            null,
            input.connectAddress,
            isIP(input.connectAddress) as 4 | 6,
          ),
      },
      (response) => {
        if (
          response.headers["content-encoding"] &&
          response.headers["content-encoding"] !== "identity"
        ) {
          response.destroy(new Error("Compressed HTTP bodies are prohibited."));
          return;
        }
        let compressedBytes = 0;
        const body = (async function* () {
          for await (const chunk of response) {
            const bytes =
              chunk instanceof Uint8Array ? chunk : Buffer.from(chunk);
            compressedBytes += bytes.byteLength;
            yield bytes;
          }
        })();
        const headers: Record<string, string | undefined> = {};
        for (const [name, value] of Object.entries(response.headers))
          headers[name] = Array.isArray(value) ? value.join(", ") : value;
        resolve({
          status: response.statusCode ?? 0,
          headers,
          body,
          get compressedBytes() {
            return compressedBytes;
          },
        });
      },
    );
    const abort = () => request.destroy(new Error("Pinned request cancelled."));
    input.signal.addEventListener("abort", abort, { once: true });
    request.once("error", reject);
    request.once("close", () =>
      input.signal.removeEventListener("abort", abort),
    );
    request.end();
  });
};

export function createPinnedRobotsEvaluator(options: {
  resolver: DnsResolver;
  transport: PinnedFetchTransport;
}): SourceAccessEvaluator {
  return async (target, signal) => {
    const url = new URL(target);
    const robotsUrl = new URL("/robots.txt", url.origin);
    try {
      const addresses = [
        ...new Set(await options.resolver(robotsUrl.hostname)),
      ];
      if (
        addresses.length === 0 ||
        addresses.some((address) => !isPublicUnicastAddress(address))
      )
        return "unavailable";
      const response = await options.transport({
        url: robotsUrl.href,
        connectAddress: addresses[0]!,
        serverName: robotsUrl.hostname,
        headers: {
          Accept: "text/plain",
          "User-Agent": "MatchBASE-Evidence-Fetch/1.0",
        },
        timeoutMs: 10_000,
        signal,
      });
      if (response.status === 404 || response.status === 410) return "allowed";
      if (response.status === 401 || response.status === 403)
        return "disallowed";
      if (response.status < 200 || response.status >= 300) return "unavailable";
      const chunks: Uint8Array[] = [];
      let size = 0;
      const iterable =
        response.body instanceof Uint8Array ? [response.body] : response.body;
      for await (const chunk of iterable) {
        size += chunk.byteLength;
        if (size > 256 * 1024) return "unavailable";
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      let applies = false;
      const disallowed: string[] = [];
      for (const raw of body.split(/\r?\n/u)) {
        const line = raw.replace(/#.*$/u, "").trim();
        const separator = line.indexOf(":");
        if (separator < 0) continue;
        const field = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim();
        if (field === "user-agent") applies = value === "*";
        else if (field === "disallow" && applies && value)
          disallowed.push(value);
      }
      return disallowed.some((path) => url.pathname.startsWith(path))
        ? "disallowed"
        : "allowed";
    } catch {
      return "unavailable";
    }
  };
}
