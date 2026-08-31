import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const SECURE_FETCH_POLICY_VERSION = "secure-fetch-policy.v1" as const;
export const UNTRUSTED_SOURCE_BOUNDARY_VERSION =
  "untrusted-source-boundary.v1" as const;

const ALLOWED_CONTENT_TYPES = new Set([
  "text/html",
  "text/plain",
  "application/xhtml+xml",
  "application/json",
  "text/csv",
  "application/xml",
  "application/pdf",
]);

export interface SecureFetchPolicyV1 {
  policyVersion: typeof SECURE_FETCH_POLICY_VERSION;
  maxRedirects: number;
  maxCompressedBytes: number;
  maxDecompressedBytes: number;
  maxCompressionRatio: number;
  maxConcurrency: number;
  perHostConcurrency: 1;
  ttfbTimeoutMs: number;
  timeoutMs: number;
  allowedPorts: readonly [443];
  allowedContentTypes: readonly string[];
}

export const DEFAULT_SECURE_FETCH_POLICY: SecureFetchPolicyV1 = Object.freeze({
  policyVersion: SECURE_FETCH_POLICY_VERSION,
  maxRedirects: 3,
  maxCompressedBytes: 10 * 1024 * 1024,
  maxDecompressedBytes: 10 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxConcurrency: 4,
  perHostConcurrency: 1,
  ttfbTimeoutMs: 10_000,
  timeoutMs: 30_000,
  allowedPorts: [443] as const,
  allowedContentTypes: Object.freeze([...ALLOWED_CONTENT_TYPES]),
});

export type DnsResolver = (hostname: string) => Promise<readonly string[]>;
export type SourceAccessEvaluator = (
  url: string,
  signal: AbortSignal,
) => Promise<"allowed" | "disallowed" | "unavailable">;

export type RedirectIntermediaryEvaluator = (url: string) => boolean;

export interface PinnedFetchRequest {
  url: string;
  connectAddress: string;
  serverName: string;
  headers: Readonly<Record<string, string>>;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface PinnedFetchResponse {
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: Uint8Array | AsyncIterable<Uint8Array>;
  compressedBytes: number;
}

export type PinnedFetchTransport = (
  request: PinnedFetchRequest,
) => Promise<PinnedFetchResponse>;

export interface FetchAttemptRecord {
  policyVersion: typeof SECURE_FETCH_POLICY_VERSION;
  canonicalUrl: string;
  hostname: string;
  resolvedAddresses: readonly string[];
  connectedAddress: string | null;
  redirectHop: number;
  decision: "accepted" | "denied";
  reason: string;
  status: number | null;
  compressedBytes: number;
  decompressedBytes: number;
  robotsDisposition: "allowed" | "disallowed" | "unavailable" | "not_evaluated";
}

export interface SecureFetchResult {
  canonicalUrl: string;
  publisherDomain: string;
  contentType: string;
  body: Uint8Array;
  contentSha256: string;
  attempts: readonly FetchAttemptRecord[];
}

export class SecureFetchDenied extends Error {
  constructor(
    readonly reason: string,
    readonly attempts: readonly FetchAttemptRecord[],
  ) {
    super(`Secure fetch denied: ${reason}.`);
  }
}

function parseIpv4(address: string): readonly number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(address)) return null;
  const parts = address.split(".").map(Number);
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

function parseIpv6(address: string): bigint | null {
  const source = address.toLowerCase().split("%")[0] ?? "";
  if (isIP(source) !== 6) return null;
  const [leftRaw, rightRaw] = source.split("::");
  if (source.split("::").length > 2) return null;
  const expand = (part: string | undefined): string[] => {
    if (!part) return [];
    return part.split(":").flatMap((segment) => {
      const ipv4 = parseIpv4(segment);
      if (!ipv4) return [segment];
      return [
        ((ipv4[0]! << 8) | ipv4[1]!).toString(16),
        ((ipv4[2]! << 8) | ipv4[3]!).toString(16),
      ];
    });
  };
  const left = expand(leftRaw);
  const right = expand(rightRaw);
  const missing = 8 - left.length - right.length;
  if ((!source.includes("::") && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))
  )
    return null;
  return groups.reduce(
    (value, group) => (value << 16n) | BigInt(`0x${group}`),
    0n,
  );
}

function inV4(parts: readonly number[], first: number, mask: number): boolean {
  const value =
    (((parts[0]! << 24) >>> 0) |
      (parts[1]! << 16) |
      (parts[2]! << 8) |
      parts[3]!) >>>
    0;
  const networkMask = mask === 0 ? 0 : (0xffffffff << (32 - mask)) >>> 0;
  return (value & networkMask) === (first & networkMask);
}

export function isPublicUnicastAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4) {
    const blockedRanges: readonly (readonly [number, number])[] = [
      [0x00000000, 8],
      [0x0a000000, 8],
      [0x64400000, 10],
      [0x7f000000, 8],
      [0xa9fe0000, 16],
      [0xac100000, 12],
      [0xc0000000, 24],
      [0xc0000200, 24],
      [0xc0586300, 24],
      [0xc0a80000, 16],
      [0xc6120000, 15],
      [0xc6336400, 24],
      [0xcb007100, 24],
      [0xe0000000, 4],
      [0xf0000000, 4],
    ];
    return !blockedRanges.some(([network, mask]) => inV4(v4, network, mask));
  }
  const v6 = parseIpv6(address);
  if (v6 === null) return false;
  const prefix = (bits: number) => v6 >> BigInt(128 - bits);
  if (v6 === 0n || v6 === 1n) return false;
  if (prefix(8) === 0xffn) return false;
  if (prefix(7) === 0x7en) return false;
  if (prefix(10) === 0x3fan) return false;
  if (prefix(32) === 0x20010db8n) return false;
  if (prefix(96) === 0n || prefix(96) === 0xffffn) return false;
  return true;
}

function canonicalizeSourceUrl(value: string): URL {
  if (!value || value !== value.trim() || value.length > 2_048)
    throw new Error("url_shape");
  if (
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code > 0x7e;
    }) ||
    /\\|%(?:25|2f|5c|00)/iu.test(value)
  )
    throw new Error("ambiguous_encoding");
  const authority = /^https:\/\/([^/?#]+)/u.exec(value)?.[1] ?? "";
  if (!authority || authority.includes("%"))
    throw new Error("ambiguous_encoding");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("url_parse");
  }
  if (url.protocol !== "https:") throw new Error("scheme");
  if (url.username || url.password) throw new Error("credentials");
  if (url.hash) throw new Error("fragment");
  if (url.port && url.port !== "443") throw new Error("port");
  if (isIP(url.hostname) !== 0 || /^\[|\]$/u.test(url.hostname))
    throw new Error("numeric_address");
  if (
    url.hostname !== url.hostname.toLowerCase() ||
    url.hostname.endsWith(".") ||
    url.hostname.length > 253 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      url.hostname,
    )
  )
    throw new Error("hostname_shape");
  if (url.href !== value && url.href !== `${value}/`)
    throw new Error("non_canonical_url");
  return url;
}

const POLICY_FIELDS = new Set([
  "policyVersion",
  "maxRedirects",
  "maxCompressedBytes",
  "maxDecompressedBytes",
  "maxCompressionRatio",
  "maxConcurrency",
  "perHostConcurrency",
  "ttfbTimeoutMs",
  "timeoutMs",
  "allowedPorts",
  "allowedContentTypes",
]);
let activeFetches = 0;
const activeFetchesByHost = new Map<string, number>();

function validatePolicy(value: SecureFetchPolicyV1): SecureFetchPolicyV1 {
  if (
    !value ||
    Object.keys(value).some((field) => !POLICY_FIELDS.has(field)) ||
    value.policyVersion !== SECURE_FETCH_POLICY_VERSION ||
    !Number.isInteger(value.maxRedirects) ||
    value.maxRedirects < 0 ||
    value.maxRedirects > 3 ||
    !Number.isInteger(value.maxCompressedBytes) ||
    value.maxCompressedBytes < 1 ||
    value.maxCompressedBytes > 10 * 1024 * 1024 ||
    !Number.isInteger(value.maxDecompressedBytes) ||
    value.maxDecompressedBytes < 1 ||
    value.maxDecompressedBytes > 10 * 1024 * 1024 ||
    !Number.isFinite(value.maxCompressionRatio) ||
    value.maxCompressionRatio < 1 ||
    value.maxCompressionRatio > 100 ||
    !Number.isInteger(value.maxConcurrency) ||
    value.maxConcurrency < 1 ||
    value.maxConcurrency > 8 ||
    value.perHostConcurrency !== 1 ||
    !Number.isInteger(value.ttfbTimeoutMs) ||
    value.ttfbTimeoutMs < 1 ||
    value.ttfbTimeoutMs > 10_000 ||
    !Number.isInteger(value.timeoutMs) ||
    value.timeoutMs < 1 ||
    value.timeoutMs > 30_000 ||
    value.ttfbTimeoutMs > value.timeoutMs ||
    JSON.stringify(value.allowedPorts) !== "[443]" ||
    !Array.isArray(value.allowedContentTypes) ||
    value.allowedContentTypes.length === 0 ||
    value.allowedContentTypes.some(
      (type) => !ALLOWED_CONTENT_TYPES.has(type),
    ) ||
    new Set(value.allowedContentTypes).size !== value.allowedContentTypes.length
  ) {
    throw new Error("Secure fetch policy is invalid or open-ended.");
  }
  return value;
}

async function collectBoundedBody(input: {
  body: Uint8Array | AsyncIterable<Uint8Array>;
  compressedBytes: number;
  policy: SecureFetchPolicyV1;
  firstByteDeadlineAt: number;
  totalDeadlineAt: number;
  controller: AbortController;
  signal: AbortSignal;
}): Promise<Uint8Array> {
  if (
    !Number.isInteger(input.compressedBytes) ||
    input.compressedBytes < 0 ||
    input.compressedBytes > input.policy.maxCompressedBytes
  )
    throw new Error("compressed_size");
  if (input.body instanceof Uint8Array) {
    if (input.body.byteLength > input.policy.maxDecompressedBytes)
      throw new Error("decompressed_size");
    return input.body;
  }
  const iterator = input.body[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let first = true;
  try {
    while (true) {
      const deadlineAt = first
        ? Math.min(input.firstByteDeadlineAt, input.totalDeadlineAt)
        : input.totalDeadlineAt;
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0)
        throw new Error(first ? "ttfb_timeout" : "total_timeout");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          input.controller.abort();
          reject(new Error(first ? "ttfb_timeout" : "total_timeout"));
        }, remaining);
      });
      let removeCancellation: () => void = () => undefined;
      const cancellation = new Promise<never>((_resolve, reject) => {
        const cancelled = () => reject(new Error("external_cancelled"));
        input.signal.addEventListener("abort", cancelled, { once: true });
        removeCancellation = () =>
          input.signal.removeEventListener("abort", cancelled);
        if (input.signal.aborted) cancelled();
      });
      const next = await Promise.race([
        iterator.next(),
        timeout,
        cancellation,
      ]).finally(() => {
        clearTimeout(timer);
        removeCancellation();
      });
      if (next.done) break;
      first = false;
      if (!(next.value instanceof Uint8Array))
        throw new Error("body_chunk_type");
      size += next.value.byteLength;
      if (size > input.policy.maxDecompressedBytes) {
        input.controller.abort();
        throw new Error("decompressed_size");
      }
      chunks.push(next.value);
    }
  } finally {
    if (typeof iterator.return === "function") {
      void iterator.return().catch(() => undefined);
    }
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function contentType(
  headers: Readonly<Record<string, string | undefined>>,
): string {
  return (
    (headers["content-type"] ?? headers["Content-Type"] ?? "").split(
      ";",
      1,
    )[0] ?? ""
  )
    .trim()
    .toLowerCase();
}

function redirectLocation(
  headers: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return headers.location ?? headers.Location;
}

function record(
  input: Omit<FetchAttemptRecord, "policyVersion" | "robotsDisposition"> &
    Partial<Pick<FetchAttemptRecord, "robotsDisposition">>,
): FetchAttemptRecord {
  return {
    policyVersion: SECURE_FETCH_POLICY_VERSION,
    robotsDisposition: input.robotsDisposition ?? "not_evaluated",
    ...input,
  };
}

export async function secureFetch(input: {
  url: string;
  resolver: DnsResolver;
  accessEvaluator: SourceAccessEvaluator;
  redirectIntermediaryEvaluator?: RedirectIntermediaryEvaluator;
  transport: PinnedFetchTransport;
  signal: AbortSignal;
  policy?: SecureFetchPolicyV1;
}): Promise<SecureFetchResult> {
  const policy = validatePolicy(input.policy ?? DEFAULT_SECURE_FETCH_POLICY);
  const attempts: FetchAttemptRecord[] = [];
  if (activeFetches >= policy.maxConcurrency)
    throw new SecureFetchDenied("concurrency_limit", attempts);
  const controller = new AbortController();
  const abort = () => controller.abort();
  input.signal.addEventListener("abort", abort, { once: true });
  if (input.signal.aborted) controller.abort();
  const totalDeadlineAt = Date.now() + policy.timeoutMs;
  const within = async <T>(
    operation: Promise<T>,
    deadlineAt: number,
    reason: string,
  ): Promise<T> => {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      controller.abort();
      throw new Error(reason);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let removeCancellation: () => void = () => undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(reason));
      }, remaining);
    });
    const cancellation = new Promise<never>((_resolve, reject) => {
      const cancelled = () => reject(new Error("external_cancelled"));
      input.signal.addEventListener("abort", cancelled, { once: true });
      removeCancellation = () =>
        input.signal.removeEventListener("abort", cancelled);
      if (input.signal.aborted) cancelled();
    });
    return Promise.race([operation, timeout, cancellation]).finally(() => {
      clearTimeout(timer);
      removeCancellation();
    });
  };
  activeFetches += 1;
  try {
    let current = input.url;
    for (let hop = 0; hop <= policy.maxRedirects; hop += 1) {
      let url: URL;
      try {
        url = canonicalizeSourceUrl(current);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "url_parse";
        attempts.push(
          record({
            canonicalUrl: current,
            hostname: "",
            resolvedAddresses: [],
            connectedAddress: null,
            redirectHop: hop,
            decision: "denied",
            reason,
            status: null,
            compressedBytes: 0,
            decompressedBytes: 0,
          }),
        );
        throw new SecureFetchDenied(reason, attempts);
      }
      let addresses: string[];
      try {
        addresses = [
          ...new Set(
            await within(
              input.resolver(url.hostname),
              totalDeadlineAt,
              "total_timeout",
            ),
          ),
        ].sort();
      } catch (error) {
        const reason =
          input.signal.aborted || controller.signal.aborted
            ? "timeout_or_cancelled"
            : "dns_failure";
        attempts.push(
          record({
            canonicalUrl: url.href,
            hostname: url.hostname,
            resolvedAddresses: [],
            connectedAddress: null,
            redirectHop: hop,
            decision: "denied",
            reason,
            status: null,
            compressedBytes: 0,
            decompressedBytes: 0,
          }),
        );
        void error;
        throw new SecureFetchDenied(reason, attempts);
      }
      if (
        addresses.length === 0 ||
        addresses.some((address) => !isPublicUnicastAddress(address))
      ) {
        const reason = addresses.length === 0 ? "dns_empty" : "dns_non_public";
        attempts.push(
          record({
            canonicalUrl: url.href,
            hostname: url.hostname,
            resolvedAddresses: addresses,
            connectedAddress: null,
            redirectHop: hop,
            decision: "denied",
            reason,
            status: null,
            compressedBytes: 0,
            decompressedBytes: 0,
          }),
        );
        throw new SecureFetchDenied(reason, attempts);
      }
      const connectedAddress = addresses[0]!;
      const hostCount = activeFetchesByHost.get(url.hostname) ?? 0;
      if (hostCount >= policy.perHostConcurrency) {
        attempts.push(
          record({
            canonicalUrl: url.href,
            hostname: url.hostname,
            resolvedAddresses: addresses,
            connectedAddress: null,
            redirectHop: hop,
            decision: "denied",
            reason: "per_host_concurrency_limit",
            status: null,
            compressedBytes: 0,
            decompressedBytes: 0,
          }),
        );
        throw new SecureFetchDenied("per_host_concurrency_limit", attempts);
      }
      activeFetchesByHost.set(url.hostname, hostCount + 1);
      let robotsDisposition:
        "allowed" | "disallowed" | "unavailable" | "not_evaluated" | undefined;
      let response: PinnedFetchResponse | undefined;
      let body: Uint8Array | undefined;
      const isRedirectIntermediary =
        input.redirectIntermediaryEvaluator?.(url.href) === true;
      try {
        robotsDisposition = isRedirectIntermediary
          ? "not_evaluated"
          : await within(
              input.accessEvaluator(url.href, controller.signal),
              totalDeadlineAt,
              "total_timeout",
            );
        if (!isRedirectIntermediary && robotsDisposition !== "allowed") {
          const reason =
            robotsDisposition === "disallowed"
              ? "robots_disallowed"
              : "robots_unavailable";
          attempts.push(
            record({
              canonicalUrl: url.href,
              hostname: url.hostname,
              resolvedAddresses: addresses,
              connectedAddress,
              redirectHop: hop,
              decision: "denied",
              reason,
              status: null,
              compressedBytes: 0,
              decompressedBytes: 0,
              robotsDisposition,
            }),
          );
          throw new SecureFetchDenied(reason, attempts);
        }
        const requestStartedAt = Date.now();
        response = await within(
          input.transport({
            url: url.href,
            connectAddress: connectedAddress,
            serverName: url.hostname,
            headers: Object.freeze({
              Accept: policy.allowedContentTypes.join(", "),
              "User-Agent": "MatchBASE-Evidence-Fetch/1.0",
            }),
            timeoutMs: policy.timeoutMs,
            signal: controller.signal,
          }),
          Math.min(totalDeadlineAt, requestStartedAt + policy.ttfbTimeoutMs),
          "ttfb_timeout",
        );
        body = await collectBoundedBody({
          body: response.body,
          compressedBytes: response.compressedBytes,
          policy,
          firstByteDeadlineAt: requestStartedAt + policy.ttfbTimeoutMs,
          totalDeadlineAt,
          controller,
          signal: input.signal,
        });
      } catch (error) {
        if (error instanceof SecureFetchDenied) throw error;
        const message = error instanceof Error ? error.message : "";
        const boundaryReasons = new Set([
          "compressed_size",
          "decompressed_size",
          "body_chunk_type",
          "ttfb_timeout",
          "total_timeout",
        ]);
        const reason = input.signal.aborted
          ? "timeout_or_cancelled"
          : boundaryReasons.has(message)
            ? message
            : controller.signal.aborted
              ? "timeout_or_cancelled"
              : "transport_failure";
        attempts.push(
          record({
            canonicalUrl: url.href,
            hostname: url.hostname,
            resolvedAddresses: addresses,
            connectedAddress,
            redirectHop: hop,
            decision: "denied",
            reason,
            status: null,
            compressedBytes: response?.compressedBytes ?? 0,
            decompressedBytes: 0,
            robotsDisposition: robotsDisposition ?? "unavailable",
          }),
        );
        void error;
        throw new SecureFetchDenied(reason, attempts);
      } finally {
        const active = activeFetchesByHost.get(url.hostname) ?? 1;
        if (active <= 1) activeFetchesByHost.delete(url.hostname);
        else activeFetchesByHost.set(url.hostname, active - 1);
      }
      if (!response || !body || !robotsDisposition)
        throw new SecureFetchDenied("transport_failure", attempts);
      if (
        isRedirectIntermediary &&
        ![301, 302, 303, 307, 308].includes(response.status)
      ) {
        attempts.push(
          record({
            canonicalUrl: url.href,
            hostname: url.hostname,
            resolvedAddresses: addresses,
            connectedAddress,
            redirectHop: hop,
            decision: "denied",
            reason: "redirect_intermediary_non_redirect",
            status: response.status,
            compressedBytes: response.compressedBytes,
            decompressedBytes: body.byteLength,
            robotsDisposition,
          }),
        );
        throw new SecureFetchDenied(
          "redirect_intermediary_non_redirect",
          attempts,
        );
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (
          response.compressedBytes > policy.maxCompressedBytes ||
          body.byteLength > policy.maxDecompressedBytes ||
          body.byteLength / Math.max(1, response.compressedBytes) >
            policy.maxCompressionRatio
        ) {
          attempts.push(
            record({
              canonicalUrl: url.href,
              hostname: url.hostname,
              resolvedAddresses: addresses,
              connectedAddress,
              redirectHop: hop,
              decision: "denied",
              reason: "redirect_body_boundary",
              status: response.status,
              compressedBytes: response.compressedBytes,
              decompressedBytes: body.byteLength,
              robotsDisposition,
            }),
          );
          throw new SecureFetchDenied("redirect_body_boundary", attempts);
        }
        const location = redirectLocation(response.headers);
        attempts.push(
          record({
            canonicalUrl: url.href,
            hostname: url.hostname,
            resolvedAddresses: addresses,
            connectedAddress,
            redirectHop: hop,
            decision: location ? "accepted" : "denied",
            reason: location
              ? "redirect_revalidate"
              : "redirect_without_location",
            status: response.status,
            compressedBytes: response.compressedBytes,
            decompressedBytes: body.byteLength,
            robotsDisposition,
          }),
        );
        if (!location)
          throw new SecureFetchDenied("redirect_without_location", attempts);
        if (hop === policy.maxRedirects)
          throw new SecureFetchDenied("redirect_limit", attempts);
        current = new URL(location, url).href;
        continue;
      }
      const type = contentType(response.headers);
      const ratio = body.byteLength / Math.max(1, response.compressedBytes);
      const denial =
        response.status < 200 || response.status >= 300
          ? "http_status"
          : !policy.allowedContentTypes.includes(type)
            ? "content_type"
            : response.compressedBytes > policy.maxCompressedBytes
              ? "compressed_size"
              : body.byteLength > policy.maxDecompressedBytes
                ? "decompressed_size"
                : ratio > policy.maxCompressionRatio
                  ? "compression_ratio"
                  : null;
      attempts.push(
        record({
          canonicalUrl: url.href,
          hostname: url.hostname,
          resolvedAddresses: addresses,
          connectedAddress,
          redirectHop: hop,
          decision: denial ? "denied" : "accepted",
          reason: denial ?? "fetched",
          status: response.status,
          compressedBytes: response.compressedBytes,
          decompressedBytes: body.byteLength,
          robotsDisposition,
        }),
      );
      if (denial) throw new SecureFetchDenied(denial, attempts);
      return {
        canonicalUrl: url.href,
        publisherDomain: url.hostname,
        contentType: type,
        body,
        contentSha256: createHash("sha256")
          .update(body)
          .digest("hex")
          .toUpperCase(),
        attempts,
      };
    }
    throw new SecureFetchDenied("redirect_limit", attempts);
  } finally {
    activeFetches -= 1;
    input.signal.removeEventListener("abort", abort);
  }
}

export interface SealedUntrustedSource {
  boundaryVersion: typeof UNTRUSTED_SOURCE_BOUNDARY_VERSION;
  trust: "untrusted_source";
  normalizedText: string;
  contentSha256: string;
  permittedEffect: "claim_extraction_input_only";
  activeContentDisabled: true;
}

function decodeHtmlEntity(entity: string): string {
  const named: Readonly<Record<string, string>> = Object.freeze({
    "&amp;": "&",
    "&apos;": "'",
    "&gt;": ">",
    "&lt;": "<",
    "&nbsp;": " ",
    "&quot;": '"',
  });
  const known = named[entity.toLowerCase()];
  if (known !== undefined) return known;
  const hexadecimal = /^&#x([a-f0-9]+);$/iu.exec(entity);
  const decimal = /^&#([0-9]+);$/u.exec(entity);
  const value = hexadecimal
    ? Number.parseInt(hexadecimal[1]!, 16)
    : decimal
      ? Number.parseInt(decimal[1]!, 10)
      : Number.NaN;
  return Number.isSafeInteger(value) && value > 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : " ";
}

function visibleHtmlText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(
      /<(?:script|style|template|noscript|svg|canvas)\b[^>]*>[\s\S]*?<\/(?:script|style|template|noscript|svg|canvas)\s*>/giu,
      " ",
    )
    .replace(/<[^>]{0,4096}>/gu, " ")
    .replace(
      /&(?:amp|apos|gt|lt|nbsp|quot);|&#(?:[0-9]+|x[a-f0-9]+);/giu,
      (entity) => decodeHtmlEntity(entity),
    );
}

export function sealUntrustedSource(
  body: Uint8Array,
  contentType = "text/plain",
): SealedUntrustedSource {
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(body);
  const inactive = decoded
    .normalize("NFKC")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, " ");
  const claimText = /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/iu.test(
    contentType,
  )
    ? visibleHtmlText(inactive)
    : inactive;
  const normalizedText = [...claimText]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x08 ||
        (code >= 0x0b && code <= 0x0c) ||
        (code >= 0x0e && code <= 0x1f) ||
        code === 0x7f
        ? " "
        : character;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  return Object.freeze({
    boundaryVersion: UNTRUSTED_SOURCE_BOUNDARY_VERSION,
    trust: "untrusted_source",
    normalizedText,
    contentSha256: createHash("sha256")
      .update(body)
      .digest("hex")
      .toUpperCase(),
    permittedEffect: "claim_extraction_input_only",
    activeContentDisabled: true,
  });
}
