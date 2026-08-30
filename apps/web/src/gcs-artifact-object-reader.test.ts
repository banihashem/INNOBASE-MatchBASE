import { describe, expect, it, vi } from "vitest";
import {
  createCloudRunMetadataTokenProvider,
  createGcsArtifactObjectReader,
} from "./gcs-artifact-object-reader";

describe("GCS artifact object reader", () => {
  it("reads only the configured bucket with a bearer token", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response(Uint8Array.from([1, 2, 3]), {
          status: 200,
          headers: { "Content-Length": "3" },
        }),
    );
    const reader = createGcsArtifactObjectReader({
      bucket: "matchbase-artifacts-staging",
      accessTokenProvider: { accessToken: async () => "token-value" },
      fetchImplementation,
    });

    await expect(
      reader.read("gs://matchbase-artifacts-staging/folder/report 1.pdf"),
    ).resolves.toEqual(Uint8Array.from([1, 2, 3]));
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://storage.googleapis.com/download/storage/v1/b/matchbase-artifacts-staging/o/folder%2Freport%201.pdf?alt=media",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer token-value" },
        redirect: "error",
      }),
    );
  });

  it("returns null only for a missing object and rejects unsafe or foreign URIs", async () => {
    const reader = createGcsArtifactObjectReader({
      bucket: "matchbase-artifacts-staging",
      accessTokenProvider: { accessToken: async () => "token-value" },
      fetchImplementation: async () => new Response(null, { status: 404 }),
    });
    await expect(
      reader.read("gs://matchbase-artifacts-staging/missing.pdf"),
    ).resolves.toBeNull();
    await expect(
      reader.read("gs://another-bucket/missing.pdf"),
    ).rejects.toThrow(/outside the configured bucket/iu);
    await expect(
      reader.read("https://storage.googleapis.com/file.pdf"),
    ).rejects.toThrow(/storage URI is invalid/iu);
    await expect(
      reader.read("gs://matchbase-artifacts-staging/file.pdf?generation=1"),
    ).rejects.toThrow(/storage URI is invalid/iu);
  });

  it("rejects provider errors and responses above the configured byte limit", async () => {
    const base = {
      bucket: "matchbase-artifacts-staging",
      accessTokenProvider: { accessToken: async () => "token-value" },
      maximumBytes: 2,
    } as const;
    await expect(
      createGcsArtifactObjectReader({
        ...base,
        fetchImplementation: async () => new Response(null, { status: 403 }),
      }).read("gs://matchbase-artifacts-staging/report.pdf"),
    ).rejects.toThrow(/retrieval failed/iu);
    await expect(
      createGcsArtifactObjectReader({
        ...base,
        fetchImplementation: async () =>
          new Response(Uint8Array.from([1, 2, 3]), {
            status: 200,
            headers: { "Content-Length": "3" },
          }),
      }).read("gs://matchbase-artifacts-staging/report.pdf"),
    ).rejects.toThrow(/exceeds the byte limit/iu);
    await expect(
      createGcsArtifactObjectReader({
        ...base,
        fetchImplementation: async () =>
          new Response(Uint8Array.from([1, 2, 3]), { status: 200 }),
      }).read("gs://matchbase-artifacts-staging/report.pdf"),
    ).rejects.toThrow(/exceeds the byte limit/iu);
  });
});

describe("Cloud Run metadata token provider", () => {
  it("uses the metadata header, caches tokens, and refreshes near expiry", async () => {
    let now = 1_000_000;
    let sequence = 0;
    const fetchImplementation = vi.fn(async (_url, options) => {
      expect(options?.headers).toEqual({ "Metadata-Flavor": "Google" });
      sequence += 1;
      return Response.json({
        access_token: `token-${sequence}`,
        expires_in: 120,
        token_type: "Bearer",
      });
    });
    const provider = createCloudRunMetadataTokenProvider(
      fetchImplementation,
      () => now,
    );
    await expect(provider.accessToken()).resolves.toBe("token-1");
    await expect(provider.accessToken()).resolves.toBe("token-1");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    now += 61_000;
    await expect(provider.accessToken()).resolves.toBe("token-2");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed metadata responses", async () => {
    const provider = createCloudRunMetadataTokenProvider(async () =>
      Response.json({ access_token: "token", expires_in: 120 }),
    );
    await expect(provider.accessToken()).rejects.toThrow(
      /metadata token response is invalid/iu,
    );
  });
});
