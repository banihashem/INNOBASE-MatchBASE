import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { appendAuditEvent } from "./audit.js";
import { resolveStoredAuthorization } from "./authorization.js";
import type { Queryable } from "./database.js";

export interface ArtifactObjectReader {
  read(storageUri: string): Promise<Uint8Array | null>;
}

export interface IssueArtifactAccessGrantInput {
  readonly artifactVersionId: string;
  readonly accountId: string;
  readonly subjectUserId: string;
  readonly subjectTier: "consultant" | "admin";
  readonly expiresAt: Date;
  readonly justification?: string;
  readonly token?: string;
}

export interface IssuedArtifactAccessGrant {
  readonly grantId: string;
  readonly token: string;
  readonly expiresAt: string;
}

export interface RetrieveArtifactWithGrantInput {
  readonly grantId: string;
  readonly token: string;
  readonly accountId: string;
  readonly subjectUserId: string;
  readonly correlationId: string;
  readonly deploymentId: string;
}

export interface RetrievedArtifact {
  readonly artifactVersionId: string;
  readonly artifactId: string;
  readonly version: number;
  readonly fileSha256: string;
  readonly bytes: Uint8Array;
}

interface GrantRow {
  grant_id: string;
  artifact_version_id: string;
  artifact_id: string;
  version: number;
  subject_tier: "consultant" | "admin";
  justification: string | null;
  expires_at: Date | string;
  unexpired: boolean;
  url_sha256: Uint8Array;
  projection_version_id: string;
  storage_uri: string;
  file_sha256: Uint8Array;
}

function sha256(value: string | Uint8Array): Buffer {
  return createHash("sha256").update(value).digest();
}

function secureDigestEqual(expected: Uint8Array, actual: Uint8Array): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.byteLength === actualBuffer.byteLength &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export async function issueArtifactAccessGrant(
  database: Queryable,
  input: IssueArtifactAccessGrantInput,
): Promise<IssuedArtifactAccessGrant> {
  const justification = input.justification?.trim() || null;
  if (input.subjectTier === "admin" && justification === null)
    throw new Error("Admin artifact access grants require justification.");
  if (
    !Number.isFinite(input.expiresAt.getTime()) ||
    input.expiresAt <= new Date()
  )
    throw new Error("Artifact access grant expiry must be in the future.");
  const released = await database.query<{ released: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM artifact_version
        WHERE artifact_version_id=$1 AND account_id=$2 AND state='released'
     ) AS released`,
    [input.artifactVersionId, input.accountId],
  );
  if (!released.rows[0]?.released)
    throw new Error("Access grants can be issued only for released artifacts.");
  const token = input.token ?? randomBytes(32).toString("base64url");
  if (!token) throw new Error("Artifact access token is required.");
  const grantId = randomUUID();
  await database.query(
    `INSERT INTO artifact_access_grant
       (grant_id,artifact_version_id,account_id,subject_user_id,subject_tier,
        justification,expires_at,url_sha256)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      grantId,
      input.artifactVersionId,
      input.accountId,
      input.subjectUserId,
      input.subjectTier,
      justification,
      input.expiresAt,
      sha256(token),
    ],
  );
  return Object.freeze({
    grantId,
    token,
    expiresAt: input.expiresAt.toISOString(),
  });
}

export async function revokeArtifactAccessGrant(
  database: Queryable,
  input: {
    readonly grantId: string;
    readonly accountId: string;
    readonly reason: string;
  },
): Promise<string> {
  if (!input.reason.trim())
    throw new Error("Grant revocation reason is required.");
  const revocationId = randomUUID();
  await database.query(
    `INSERT INTO artifact_access_grant_revocation
       (revocation_id,grant_id,account_id,reason)
     VALUES($1,$2,$3,$4)`,
    [revocationId, input.grantId, input.accountId, input.reason.trim()],
  );
  return revocationId;
}

async function appendRetrievalAudit(
  database: Queryable,
  input: RetrieveArtifactWithGrantInput,
  event: {
    readonly tier?: "consultant" | "admin";
    readonly artifactVersionId?: string;
    readonly projectionVersionId?: string;
    readonly outcome: "allow" | "deny" | "error";
    readonly fieldsReleased?: readonly string[];
    readonly justification?: string;
    readonly detail: Readonly<Record<string, unknown>>;
  },
): Promise<string> {
  return appendAuditEvent(database, {
    accountId: input.accountId,
    actorUserId: input.subjectUserId,
    ...(event.tier === undefined ? {} : { actorTier: event.tier }),
    eventType: "artifact.download",
    resourceKind: "artifact_version",
    resourceId: event.artifactVersionId ?? input.grantId,
    outcome: event.outcome,
    ...(event.projectionVersionId === undefined
      ? {}
      : { projectionVersionId: event.projectionVersionId }),
    ...(event.fieldsReleased === undefined
      ? {}
      : { fieldsReleased: event.fieldsReleased }),
    ...(event.justification === undefined
      ? {}
      : { justification: event.justification }),
    correlationId: input.correlationId,
    deploymentId: input.deploymentId,
    detail: event.detail,
  });
}

export async function retrieveArtifactWithGrant(
  database: Queryable,
  objectReader: ArtifactObjectReader,
  input: RetrieveArtifactWithGrantInput,
): Promise<RetrievedArtifact> {
  const authorization = await resolveStoredAuthorization(
    database,
    input.accountId,
    input.subjectUserId,
  );
  const grant = await database.query<GrantRow>(
    `SELECT g.grant_id,g.artifact_version_id,v.artifact_id,v.version,
            g.subject_tier,g.justification,g.expires_at,
            g.expires_at > clock_timestamp() AS unexpired,g.url_sha256,
            v.projection_version_id,v.storage_uri,v.file_sha256
       FROM artifact_access_grant g
       JOIN artifact_version v
         ON v.artifact_version_id=g.artifact_version_id AND v.account_id=g.account_id
      WHERE g.grant_id=$1 AND g.account_id=$2 AND g.subject_user_id=$3
        AND v.state='released'
        AND NOT EXISTS (
          SELECT 1 FROM artifact_access_grant_revocation r
           WHERE r.grant_id=g.grant_id AND r.account_id=g.account_id
        )`,
    [input.grantId, input.accountId, input.subjectUserId],
  );
  const row = grant.rows[0];
  const tokenDigest = sha256(input.token);
  const storedTier = authorization?.tier;
  const validTier = storedTier === "consultant" || storedTier === "admin";
  const permitted =
    row !== undefined &&
    authorization !== null &&
    validTier &&
    row.subject_tier === storedTier &&
    row.unexpired &&
    secureDigestEqual(row.url_sha256, tokenDigest);
  if (!permitted || row === undefined) {
    await appendRetrievalAudit(database, input, {
      ...(validTier ? { tier: storedTier } : {}),
      outcome: "deny",
      detail: { reason: "artifact_grant_not_authorized" },
    });
    throw new Error(
      "Artifact access grant is invalid, expired, revoked, or not entitled.",
    );
  }

  const bytes = await objectReader.read(row.storage_uri);
  if (bytes === null) {
    await appendRetrievalAudit(database, input, {
      tier: row.subject_tier,
      artifactVersionId: row.artifact_version_id,
      projectionVersionId: row.projection_version_id,
      outcome: "error",
      ...(row.justification === null
        ? {}
        : { justification: row.justification }),
      detail: {
        reason: "artifact_bytes_missing",
        expected_sha256: Buffer.from(row.file_sha256).toString("hex"),
        observed_sha256: null,
      },
    });
    throw new Error("Artifact byte integrity verification failed.");
  }
  const observedSha256 = sha256(bytes);
  if (!secureDigestEqual(row.file_sha256, observedSha256)) {
    await appendRetrievalAudit(database, input, {
      tier: row.subject_tier,
      artifactVersionId: row.artifact_version_id,
      projectionVersionId: row.projection_version_id,
      outcome: "error",
      ...(row.justification === null
        ? {}
        : { justification: row.justification }),
      detail: {
        reason: "artifact_hash_mismatch",
        expected_sha256: Buffer.from(row.file_sha256).toString("hex"),
        observed_sha256: observedSha256.toString("hex"),
      },
    });
    throw new Error("Artifact byte integrity verification failed.");
  }

  const auditId = await appendRetrievalAudit(database, input, {
    tier: row.subject_tier,
    artifactVersionId: row.artifact_version_id,
    projectionVersionId: row.projection_version_id,
    outcome: "allow",
    fieldsReleased: ["artifact_bytes"],
    ...(row.justification === null ? {} : { justification: row.justification }),
    detail: {
      grant_id: row.grant_id,
      file_sha256: observedSha256.toString("hex"),
      byte_size: bytes.byteLength,
    },
  });
  await database.query(
    `INSERT INTO artifact_access_grant_use(use_id,grant_id,account_id,audit_id)
     VALUES($1,$2,$3,$4)`,
    [randomUUID(), row.grant_id, input.accountId, auditId],
  );
  return Object.freeze({
    artifactVersionId: row.artifact_version_id,
    artifactId: row.artifact_id,
    version: row.version,
    fileSha256: observedSha256.toString("hex"),
    bytes: Uint8Array.from(bytes),
  });
}
