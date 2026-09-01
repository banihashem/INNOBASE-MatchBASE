import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  type ArtifactDownloadApplication,
  type RequestContext,
} from "@matchbase/application";
import { handleArtifactDownloadRoute } from "./artifact-download-route-core";

const context: RequestContext = {
  accountId: randomUUID(),
  userId: randomUUID(),
  tier: "consultant",
  adminSubRoles: [],
  correlationId: randomUUID(),
  deploymentId: "artifact-route-test",
};

function applicationWithDownload(
  download: ArtifactDownloadApplication["download"],
): ArtifactDownloadApplication {
  return { download } as ArtifactDownloadApplication;
}

describe("artifact download route core", () => {
  it("returns verified PDF bytes without exposing storage identity or token", async () => {
    const artifactId = randomUUID();
    const grantId = randomUUID();
    const token = "A".repeat(43);
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const download = vi.fn(async () => ({
      artifactVersionId: randomUUID(),
      artifactId,
      version: 7,
      fileSha256: "0".repeat(64),
      bytes,
    }));

    const response = await handleArtifactDownloadRoute({
      method: "GET",
      pathname: `/api/v1/artifacts/${grantId}/download`,
      artifactToken: token,
      context,
      application: applicationWithDownload(download),
    });

    expect(download).toHaveBeenCalledWith(context, grantId, token);
    expect(response?.status).toBe(200);
    expect(response?.bytes).toEqual(bytes);
    expect(response?.headers).toEqual({
      "Content-Type": "application/pdf",
      "Content-Length": "5",
      "Content-Disposition": `attachment; filename="matchbase-artifact-${artifactId}-v7.pdf"`,
      ETag: `"sha256-${"0".repeat(64)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    expect(JSON.stringify(response)).not.toContain(token);
    expect(JSON.stringify(response)).not.toContain("storage_uri");
  });

  it.each([
    ["not-a-uuid", "A".repeat(43)],
    [randomUUID(), "short"],
    [randomUUID(), `${"A".repeat(32)}!`],
  ])(
    "fails malformed grant/token input closed with the same raw-body fault",
    async (grantId, token) => {
      const download = vi.fn();
      const operation = handleArtifactDownloadRoute({
        method: "GET",
        pathname: `/api/v1/artifacts/${grantId}/download`,
        artifactToken: token,
        context,
        application: applicationWithDownload(download),
      });

      await expect(operation).rejects.toMatchObject({
        status: 403,
        code: "MB-403-ARTIFACT",
        message: "The artifact is not available.",
        auditRecorded: false,
      });
      expect(download).not.toHaveBeenCalled();
    },
  );

  it("passes a tokenless authenticated product-UI grant to application authorization", async () => {
    const grantId = randomUUID();
    const download = vi.fn(async () => ({
      artifactVersionId: randomUUID(),
      artifactId: randomUUID(),
      version: 1,
      fileSha256: "0".repeat(64),
      bytes: Uint8Array.from([37, 80, 68, 70]),
    }));
    await handleArtifactDownloadRoute({
      method: "GET",
      pathname: `/api/v1/artifacts/${grantId}/download`,
      artifactToken: null,
      context,
      application: applicationWithDownload(download),
    });
    expect(download).toHaveBeenCalledWith(context, grantId, null);
  });

  it("does not claim unrelated paths or methods", async () => {
    const application = applicationWithDownload(vi.fn());
    await expect(
      handleArtifactDownloadRoute({
        method: "POST",
        pathname: `/api/v1/artifacts/${randomUUID()}/download`,
        artifactToken: "A".repeat(43),
        context,
        application,
      }),
    ).resolves.toBeNull();
    await expect(
      handleArtifactDownloadRoute({
        method: "GET",
        pathname: "/api/v1/artifacts",
        artifactToken: "A".repeat(43),
        context,
        application,
      }),
    ).resolves.toBeNull();
  });
});
