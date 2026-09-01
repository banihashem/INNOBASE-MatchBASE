import {
  ApplicationFault,
  ArtifactDownloadApplication,
  type RequestContext,
} from "@matchbase/application";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/u;
const PATH_PATTERN = /^\/api\/v1\/artifacts\/([^/]+)\/download$/u;

export interface ArtifactDownloadRouteRequest {
  readonly method: string;
  readonly pathname: string;
  readonly artifactToken: string | null;
  readonly context: RequestContext;
  readonly application: ArtifactDownloadApplication;
}

export interface ArtifactDownloadRouteResponse {
  readonly status: 200;
  readonly bytes: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

function neutralGrantFault(): never {
  throw new ApplicationFault(
    403,
    "artifact-not-visible",
    "MB-403-ARTIFACT",
    "The artifact is not available.",
  );
}

export async function handleArtifactDownloadRoute(
  request: ArtifactDownloadRouteRequest,
): Promise<ArtifactDownloadRouteResponse | null> {
  const match = PATH_PATTERN.exec(request.pathname);
  if (!match || request.method !== "GET") return null;
  const grantId = match[1] ?? "";
  if (
    !UUID_PATTERN.test(grantId) ||
    (request.artifactToken !== null &&
      !TOKEN_PATTERN.test(request.artifactToken))
  ) {
    return neutralGrantFault();
  }
  const artifact = await request.application.download(
    request.context,
    grantId,
    request.artifactToken,
  );
  return {
    status: 200,
    bytes: artifact.bytes,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(artifact.bytes.byteLength),
      "Content-Disposition": `attachment; filename="matchbase-artifact-${artifact.artifactId}-v${artifact.version}.pdf"`,
      ETag: `"sha256-${artifact.fileSha256}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  };
}
