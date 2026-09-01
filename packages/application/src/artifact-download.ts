import {
  inTransaction,
  retrieveArtifactWithGrant,
  type ArtifactObjectReader,
  type ConnectionPool,
  type RetrievedArtifact,
} from "@matchbase/data";
import { ApplicationFault, type RequestContext } from "./types.js";

const INVALID_GRANT_MESSAGE =
  "Artifact access grant is invalid, expired, revoked, or not entitled.";
const INTEGRITY_MESSAGE = "Artifact byte integrity verification failed.";

type RetrievalAttempt =
  | { readonly ok: true; readonly artifact: RetrievedArtifact }
  | { readonly ok: false; readonly error: unknown };

export class ArtifactDownloadApplication {
  constructor(
    private readonly pool: ConnectionPool,
    private readonly objectReader: ArtifactObjectReader,
  ) {}

  async download(
    context: RequestContext,
    grantId: string,
    token: string | null,
  ): Promise<RetrievedArtifact> {
    let attempt: RetrievalAttempt;
    try {
      attempt = await inTransaction(this.pool, async (client) => {
        try {
          return {
            ok: true,
            artifact: await retrieveArtifactWithGrant(
              client,
              this.objectReader,
              {
                grantId,
                token,
                accountId: context.accountId,
                subjectUserId: context.userId,
                correlationId: context.correlationId,
                deploymentId: context.deploymentId,
              },
            ),
          };
        } catch (error) {
          // Returning the failure commits the deny/error audit written by the
          // data primitive. The public fault is raised only after COMMIT.
          return { ok: false, error };
        }
      });
    } catch {
      throw new ApplicationFault(
        503,
        "artifact-retrieval-unavailable",
        "MB-503-ARTIFACT",
        "Artifact retrieval is unavailable.",
        true,
      );
    }
    if (attempt.ok) return attempt.artifact;
    const message =
      attempt.error instanceof Error ? attempt.error.message : "unknown";
    if (message === INVALID_GRANT_MESSAGE) {
      throw new ApplicationFault(
        403,
        "artifact-not-visible",
        "MB-403-ARTIFACT",
        "The artifact is not available.",
        false,
        {},
        true,
      );
    }
    if (message === INTEGRITY_MESSAGE) {
      throw new ApplicationFault(
        503,
        "artifact-integrity-unavailable",
        "MB-503-ARTIFACT-INTEGRITY",
        "Artifact retrieval is unavailable.",
        false,
        {},
        true,
      );
    }
    throw new ApplicationFault(
      503,
      "artifact-retrieval-unavailable",
      "MB-503-ARTIFACT",
      "Artifact retrieval is unavailable.",
      true,
    );
  }
}
