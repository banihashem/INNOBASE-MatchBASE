import type { ArtifactObjectReader } from "@matchbase/data";

const METADATA_TOKEN_ENDPOINT =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/u;

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

export interface GcsAccessTokenProvider {
  accessToken(): Promise<string>;
}

export interface GcsArtifactObjectReaderOptions {
  readonly bucket: string;
  readonly accessTokenProvider: GcsAccessTokenProvider;
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maximumBytes?: number;
}

function positiveInteger(
  value: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} is outside its allowed range.`);
  }
  return value;
}

function objectName(storageUri: string, expectedBucket: string): string {
  if (
    !storageUri.startsWith("gs://") ||
    hasControlCharacter(storageUri) ||
    storageUri.includes("\\") ||
    storageUri.includes("?") ||
    storageUri.includes("#")
  ) {
    throw new Error("Artifact storage URI is invalid.");
  }
  const separator = storageUri.indexOf("/", 5);
  if (separator < 0) throw new Error("Artifact storage URI is invalid.");
  const bucket = storageUri.slice(5, separator);
  const name = storageUri.slice(separator + 1);
  if (
    bucket !== expectedBucket ||
    !name ||
    Buffer.byteLength(name, "utf8") > 1_024
  ) {
    throw new Error("Artifact storage URI is outside the configured bucket.");
  }
  return name;
}

async function boundedResponseBytes(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error("Artifact GCS object exceeds the byte limit.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createGcsArtifactObjectReader(
  options: GcsArtifactObjectReaderOptions,
): ArtifactObjectReader {
  if (!BUCKET_PATTERN.test(options.bucket)) {
    throw new Error("Artifact GCS bucket name is invalid.");
  }
  const timeoutMs = positiveInteger(
    options.timeoutMs ?? 10_000,
    100,
    30_000,
    "Artifact GCS timeout",
  );
  const maximumBytes = positiveInteger(
    options.maximumBytes ?? 8 * 1_024 * 1_024,
    1,
    8 * 1_024 * 1_024,
    "Artifact GCS byte limit",
  );
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return Object.freeze({
    async read(storageUri: string): Promise<Uint8Array | null> {
      const name = objectName(storageUri, options.bucket);
      const token = await options.accessTokenProvider.accessToken();
      if (!token || token.length > 8_192 || /\s/u.test(token)) {
        throw new Error("Artifact GCS access token is invalid.");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImplementation(
          `https://storage.googleapis.com/download/storage/v1/b/${encodeURIComponent(options.bucket)}/o/${encodeURIComponent(name)}?alt=media`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
            redirect: "error",
            signal: controller.signal,
          },
        );
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Artifact GCS retrieval failed.");
        const contentLength = response.headers.get("content-length");
        if (
          contentLength !== null &&
          (!/^\d+$/u.test(contentLength) ||
            Number(contentLength) > maximumBytes)
        ) {
          throw new Error("Artifact GCS object exceeds the byte limit.");
        }
        return boundedResponseBytes(response, maximumBytes);
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

interface MetadataTokenResponse {
  readonly access_token?: unknown;
  readonly expires_in?: unknown;
  readonly token_type?: unknown;
}

export function createCloudRunMetadataTokenProvider(
  fetchImplementation: typeof fetch = fetch,
  now: () => number = Date.now,
): GcsAccessTokenProvider {
  let cached:
    { readonly token: string; readonly expiresAt: number } | undefined;
  let pending:
    Promise<{ readonly token: string; readonly expiresAt: number }> | undefined;

  async function refresh(): Promise<{
    readonly token: string;
    readonly expiresAt: number;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetchImplementation(METADATA_TOKEN_ENDPOINT, {
        method: "GET",
        headers: { "Metadata-Flavor": "Google" },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("GCP metadata token request failed.");
      const payload = (await response.json()) as MetadataTokenResponse;
      if (
        typeof payload.access_token !== "string" ||
        !payload.access_token ||
        payload.access_token.length > 8_192 ||
        /\s/u.test(payload.access_token) ||
        payload.token_type !== "Bearer" ||
        typeof payload.expires_in !== "number" ||
        !Number.isSafeInteger(payload.expires_in) ||
        payload.expires_in < 60 ||
        payload.expires_in > 86_400
      ) {
        throw new Error("GCP metadata token response is invalid.");
      }
      return {
        token: payload.access_token,
        expiresAt: now() + payload.expires_in * 1_000,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    async accessToken(): Promise<string> {
      if (cached && cached.expiresAt - now() > 60_000) return cached.token;
      pending ??= refresh().finally(() => {
        pending = undefined;
      });
      cached = await pending;
      return cached.token;
    },
  });
}
