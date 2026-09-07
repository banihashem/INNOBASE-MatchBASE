import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { createHash } from "node:crypto";

export interface PrimaryEvidenceText {
  readonly url: string;
  readonly text: string;
  readonly content_sha256: string;
  readonly retrieved_at: string;
}

export function isPublicEvidenceAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return (
      a !== undefined &&
      b !== undefined &&
      a > 0 &&
      a < 224 &&
      a !== 10 &&
      a !== 127 &&
      !(a === 169 && b === 254) &&
      !(a === 172 && b >= 16 && b <= 31) &&
      !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) &&
      !(a === 100 && b >= 64 && b <= 127) &&
      !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) &&
      !(a === 203 && b === 0 && c === 113)
    );
  }
  // Only globally routed IPv6 unicast; exclude documentation and IPv4 translation tunnels.
  return (
    isIP(address) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(address) &&
    !/^(?:2001:(?:db8|0|2):|2002:)/i.test(address)
  );
}

export function extractPrimaryEvidenceText(content: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return content
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
      (whole, entity: string) => {
        if (!entity.startsWith("#"))
          return named[entity.toLowerCase()] ?? whole;
        const value =
          entity[1]?.toLowerCase() === "x"
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        return value >= 0 && value <= 0x10ffff
          ? String.fromCodePoint(value)
          : " ";
      },
    )
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fetch public source text without credentials, with pinned DNS, bounded bytes and redirects. */
export async function fetchPrimaryEvidenceText(
  value: string,
  redirects = 0,
): Promise<PrimaryEvidenceText | null> {
  try {
    const url = new URL(value);
    if (
      !new Set(["http:", "https:"]).has(url.protocol) ||
      url.username ||
      url.password ||
      (url.port && url.port !== "80" && url.port !== "443") ||
      redirects > 3
    )
      return null;
    if (
      !url.hostname.includes(".") ||
      /\.(?:local|internal|localhost|invalid)$/i.test(url.hostname)
    )
      return null;
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true }),
      new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Evidence DNS lookup timed out.")),
          5_000,
        );
        timer.unref();
      }),
    ]);
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isPublicEvidenceAddress(address))
    )
      return null;
    const pinned =
      addresses.find((entry) => entry.family === 4) ?? addresses[0]!;
    const fetched = await new Promise<{ redirect?: string; content?: string }>(
      (resolve) => {
        const send = url.protocol === "https:" ? httpsRequest : httpRequest;
        const request = send(
          url,
          {
            method: "GET",
            agent: false,
            signal: AbortSignal.timeout(10_000),
            headers: {
              "User-Agent": "MatchBASE-EvidenceVerifier/1.0",
              Accept: "text/html,text/plain;q=0.9",
              "Accept-Encoding": "identity",
            },
            lookup: (_hostname, options, callback) => {
              if (options.all) callback(null, [pinned]);
              else callback(null, pinned.address, pinned.family);
            },
          },
          (response) => {
            if (
              response.statusCode &&
              [301, 302, 303, 307, 308].includes(response.statusCode) &&
              response.headers.location
            ) {
              response.destroy();
              resolve({
                redirect: new URL(response.headers.location, url).href,
              });
              return;
            }
            const type = response.headers["content-type"] ?? "";
            if (
              response.statusCode !== 200 ||
              !/text\/html|text\/plain|application\/xhtml\+xml/i.test(type)
            ) {
              response.destroy();
              resolve({});
              return;
            }
            let bytes = 0;
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 2_000_000) {
                response.destroy();
                resolve({});
              } else chunks.push(chunk);
            });
            response.on("end", () =>
              resolve({ content: Buffer.concat(chunks).toString("utf8") }),
            );
            response.on("error", () => resolve({}));
          },
        );
        request.setTimeout(10_000, () => {
          request.destroy();
          resolve({});
        });
        request.on("error", () => resolve({}));
        request.end();
      },
    );
    if (fetched.redirect)
      return fetchPrimaryEvidenceText(fetched.redirect, redirects + 1);
    if (!fetched.content) return null;
    const text = extractPrimaryEvidenceText(fetched.content);
    if (!text) return null;
    return {
      url: url.href,
      text,
      content_sha256: createHash("sha256").update(text).digest("hex"),
      retrieved_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
