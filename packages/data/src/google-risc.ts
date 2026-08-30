import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { appendAuditEvent } from "./audit.js";
import type { TransactionClient } from "./database.js";

const GOOGLE_RISC_ISSUER = "https://accounts.google.com";
const EVENT_TYPES = new Set([
  "https://schemas.openid.net/secevent/risc/event-type/sessions-revoked",
  "https://schemas.openid.net/secevent/oauth/event-type/tokens-revoked",
  "https://schemas.openid.net/secevent/oauth/event-type/token-revoked",
  "https://schemas.openid.net/secevent/risc/event-type/account-disabled",
  "https://schemas.openid.net/secevent/risc/event-type/account-enabled",
  "https://schemas.openid.net/secevent/risc/event-type/account-credential-change-required",
  "https://schemas.openid.net/secevent/risc/event-type/verification",
]);
const GOOGLE_RISC_TOKEN_REVOKED_EVENT =
  "https://schemas.openid.net/secevent/oauth/event-type/token-revoked";

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

export interface ApplyGoogleRiscEventInput {
  readonly eventId: string;
  readonly issuer: string;
  readonly audience: string;
  readonly issuedAt: number;
  readonly eventType: string;
  readonly googleSubject?: string;
  readonly oauthTokenIdentifier?: {
    readonly algorithm: "prefix" | "hash_base64_sha512_sha512";
    readonly value: string;
  };
  readonly terminateSessions: boolean;
  readonly reason?: string;
  readonly verificationState?: string;
  readonly correlationId: string;
  readonly deploymentId: string;
}

export interface AppliedGoogleRiscEvent {
  readonly receiptId: string;
  readonly replayed: boolean;
  readonly affectedSessionCount: number;
}

export interface PurgeGoogleRiscReceiptsInput {
  readonly cutoffAt: Date;
  readonly reasonCode: "retention_expired" | "privacy_request";
  readonly correlationId: string;
  readonly deploymentId: string;
}

export interface PurgedGoogleRiscReceipts {
  readonly purgeBatchId: string;
  readonly purgedCount: number;
}

interface ReceiptRow {
  receipt_id: string;
  issuer: string;
  audience_sha256: Uint8Array;
  event_type: string;
  subject_sha256: Uint8Array | null;
  action: "sessions_revoked" | "recorded";
  affected_session_count: number;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function equal(left: Uint8Array | null, right: Uint8Array | null): boolean {
  if (left === null || right === null) return left === right;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.byteLength === rightBuffer.byteLength &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function bounded(value: string | undefined, maximum: number): boolean {
  return (
    value !== undefined &&
    value.length > 0 &&
    value.length <= maximum &&
    !hasControlCharacter(value)
  );
}

function validate(input: ApplyGoogleRiscEventInput): void {
  if (
    !bounded(input.eventId, 512) ||
    input.issuer !== GOOGLE_RISC_ISSUER ||
    !bounded(input.audience, 512) ||
    !Number.isSafeInteger(input.issuedAt) ||
    input.issuedAt < 1 ||
    !EVENT_TYPES.has(input.eventType) ||
    !bounded(input.correlationId, 512) ||
    !bounded(input.deploymentId, 512) ||
    (input.googleSubject !== undefined && !bounded(input.googleSubject, 255)) ||
    (input.oauthTokenIdentifier !== undefined &&
      (!["prefix", "hash_base64_sha512_sha512"].includes(
        input.oauthTokenIdentifier.algorithm,
      ) ||
        !bounded(input.oauthTokenIdentifier.value, 512))) ||
    (input.googleSubject !== undefined &&
      input.oauthTokenIdentifier !== undefined) ||
    (input.eventType === GOOGLE_RISC_TOKEN_REVOKED_EVENT) !==
      (input.oauthTokenIdentifier !== undefined) ||
    (input.eventType === GOOGLE_RISC_TOKEN_REVOKED_EVENT &&
      input.terminateSessions) ||
    (input.terminateSessions && !input.googleSubject) ||
    (input.reason !== undefined && !bounded(input.reason, 64)) ||
    (input.verificationState !== undefined &&
      !bounded(input.verificationState, 512))
  ) {
    throw new Error("Google RISC event application input is invalid.");
  }
}

function coarseReason(reason: string | undefined): string | null {
  if (reason === undefined) return null;
  if (reason === "hijacking" || reason === "bulk-account") return reason;
  return "other";
}

export async function applyGoogleRiscEvent(
  database: TransactionClient,
  input: ApplyGoogleRiscEventInput,
): Promise<AppliedGoogleRiscEvent> {
  validate(input);
  const eventIdSha256 = digest(input.eventId);
  const audienceSha256 = digest(input.audience);
  const subjectSha256 = input.googleSubject
    ? digest(input.googleSubject)
    : input.oauthTokenIdentifier
      ? digest(
          `${input.oauthTokenIdentifier.algorithm}:${input.oauthTokenIdentifier.value}`,
        )
      : null;
  const action = input.terminateSessions ? "sessions_revoked" : "recorded";

  await database.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [eventIdSha256.toString("hex")],
  );
  const prior = await database.query<ReceiptRow>(
    `SELECT receipt_id,issuer,audience_sha256,event_type,subject_sha256,
            action,affected_session_count
       FROM google_risc_event_receipt
      WHERE event_id_sha256=$1`,
    [eventIdSha256],
  );
  const existing = prior.rows[0];
  if (existing) {
    if (
      existing.issuer !== input.issuer ||
      !equal(existing.audience_sha256, audienceSha256) ||
      existing.event_type !== input.eventType ||
      !equal(existing.subject_sha256, subjectSha256) ||
      existing.action !== action
    ) {
      throw new Error("Google RISC event replay binding mismatch.");
    }
    return Object.freeze({
      receiptId: existing.receipt_id,
      replayed: true,
      affectedSessionCount: existing.affected_session_count,
    });
  }

  const receiptId = randomUUID();
  const affected = input.terminateSessions
    ? await database.query<{
        session_id: string;
        account_id: string;
        user_id: string;
      }>(
        `UPDATE user_session AS session
            SET revoked_at=clock_timestamp(),
                revoked_reason='google_risc_security_event'
           FROM app_user AS subject
          WHERE subject.google_sub=$1
            AND subject.account_id=session.account_id
            AND subject.user_id=session.user_id
            AND session.revoked_at IS NULL
        RETURNING session.session_id,session.account_id,session.user_id`,
        [input.googleSubject],
      )
    : { rows: [], rowCount: 0 };
  const affectedSessionCount = affected.rowCount ?? affected.rows.length;
  await database.query(
    `INSERT INTO google_risc_event_receipt
       (receipt_id,event_id_sha256,issuer,audience_sha256,event_type,issued_at,
        subject_sha256,action,affected_session_count,reason_code,
        verification_state_sha256,request_correlation_id,deployment_id)
     VALUES($1,$2,$3,$4,$5,to_timestamp($6),$7,$8,$9,$10,$11,$12,$13)`,
    [
      receiptId,
      eventIdSha256,
      input.issuer,
      audienceSha256,
      input.eventType,
      input.issuedAt,
      subjectSha256,
      action,
      affectedSessionCount,
      coarseReason(input.reason),
      input.verificationState ? digest(input.verificationState) : null,
      input.correlationId,
      input.deploymentId,
    ],
  );

  const auditedUsers = new Set<string>();
  for (const session of affected.rows) {
    const key = `${session.account_id}:${session.user_id}`;
    if (auditedUsers.has(key)) continue;
    auditedUsers.add(key);
    await appendAuditEvent(database, {
      accountId: session.account_id,
      eventType: "session.revoked",
      resourceKind: "app_user",
      resourceId: session.user_id,
      outcome: "allow",
      correlationId: input.correlationId,
      deploymentId: input.deploymentId,
      detail: {
        reasonCode: "google_risc_security_event",
        riscEventType: input.eventType,
        receiptId,
      },
    });
  }
  await appendAuditEvent(database, {
    eventType: "identity.risc_event_received",
    resourceKind: "google_risc_event_receipt",
    resourceId: receiptId,
    outcome: "allow",
    correlationId: input.correlationId,
    deploymentId: input.deploymentId,
    detail: {
      eventType: input.eventType,
      action,
      affectedSessionCount,
      receiptId,
    },
  });
  return Object.freeze({
    receiptId,
    replayed: false,
    affectedSessionCount,
  });
}

export async function purgeGoogleRiscReceipts(
  database: TransactionClient,
  input: PurgeGoogleRiscReceiptsInput,
): Promise<PurgedGoogleRiscReceipts> {
  if (
    !(input.cutoffAt instanceof Date) ||
    !Number.isFinite(input.cutoffAt.getTime()) ||
    input.cutoffAt.getTime() > Date.now() - 30 * 24 * 60 * 60 * 1_000 ||
    !["retention_expired", "privacy_request"].includes(input.reasonCode) ||
    !bounded(input.correlationId, 512) ||
    !bounded(input.deploymentId, 512)
  ) {
    throw new Error("Google RISC receipt purge input is invalid.");
  }
  const purgeBatchId = randomUUID();
  const result = await database.query<{ purged_count: number }>(
    `SELECT matchbase_purge_google_risc_receipts($1,$2,$3,$4,$5) AS purged_count`,
    [
      purgeBatchId,
      input.cutoffAt,
      input.reasonCode,
      input.correlationId,
      input.deploymentId,
    ],
  );
  const purgedCount = result.rows[0]?.purged_count;
  if (!Number.isSafeInteger(purgedCount) || Number(purgedCount) < 0) {
    throw new Error("Google RISC receipt purge result is invalid.");
  }
  await appendAuditEvent(database, {
    eventType: "identity.risc_receipt_retention_purged",
    resourceKind: "google_risc_receipt_purge_audit",
    resourceId: purgeBatchId,
    outcome: "allow",
    correlationId: input.correlationId,
    deploymentId: input.deploymentId,
    detail: {
      purgeBatchId,
      cutoffAt: input.cutoffAt.toISOString(),
      purgedCount: Number(purgedCount),
      reasonCode: input.reasonCode,
    },
  });
  return Object.freeze({
    purgeBatchId,
    purgedCount: Number(purgedCount),
  });
}
