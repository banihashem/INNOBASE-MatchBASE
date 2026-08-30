import { createHash } from "node:crypto";
import type { Queryable, TransactionClient } from "./database.js";

export interface ConsultantProjectionConfigRelease {
  readonly configId: string;
  readonly version: string;
  readonly softCap: number;
  readonly contentSha256: Buffer;
}

export const DEFAULT_CONSULTANT_PROJECTION_CONFIG = Object.freeze({
  configId: "00000000-0000-4000-8000-000000000620",
  version: "consultant-soft-cap.default-20.v1",
  softCap: 20,
  contentSha256: Buffer.from(
    "3822131148bb2ff21d0cb81d7f1056a0a235c5d3aef58fca446a124a35e850f9",
    "hex",
  ),
}) satisfies ConsultantProjectionConfigRelease;

export function consultantProjectionConfigCanonicalJson(
  softCap: number,
): string {
  if (!Number.isSafeInteger(softCap) || softCap < 3)
    throw new Error(
      "Consultant result soft cap must be an integer of at least 3.",
    );
  return JSON.stringify({
    schema_version: "consultant-projection-config.v1",
    soft_cap: softCap,
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function consultantProjectionConfigSha256(softCap: number): Buffer {
  return createHash("sha256")
    .update(consultantProjectionConfigCanonicalJson(softCap), "utf8")
    .digest();
}

export function assertConsultantProjectionConfigRelease(
  release: ConsultantProjectionConfigRelease,
): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      release.configId,
    ) ||
    !release.version.trim() ||
    !Buffer.isBuffer(release.contentSha256) ||
    release.contentSha256.length !== 32 ||
    !release.contentSha256.equals(
      consultantProjectionConfigSha256(release.softCap),
    )
  )
    throw new Error("Consultant projection configuration release is invalid.");
}

export function consultantProjectionConfigFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): ConsultantProjectionConfigRelease {
  const capText = environment.MATCHBASE_CONSULTANT_RESULT_SOFT_CAP;
  const softCap = Number(
    capText ?? DEFAULT_CONSULTANT_PROJECTION_CONFIG.softCap,
  );
  if (!Number.isSafeInteger(softCap) || softCap < 3)
    throw new Error(
      "MATCHBASE_CONSULTANT_RESULT_SOFT_CAP must be an integer of at least 3.",
    );
  const explicit =
    capText !== undefined ||
    environment.MATCHBASE_CONSULTANT_PROJECTION_CONFIG_ID !== undefined ||
    environment.MATCHBASE_CONSULTANT_PROJECTION_CONFIG_VERSION !== undefined ||
    environment.MATCHBASE_CONSULTANT_PROJECTION_CONFIG_SHA256 !== undefined;
  if (!explicit) return DEFAULT_CONSULTANT_PROJECTION_CONFIG;
  const configId = environment.MATCHBASE_CONSULTANT_PROJECTION_CONFIG_ID;
  const version = environment.MATCHBASE_CONSULTANT_PROJECTION_CONFIG_VERSION;
  const digest = environment.MATCHBASE_CONSULTANT_PROJECTION_CONFIG_SHA256;
  if (
    !configId ||
    !version ||
    typeof digest !== "string" ||
    !/^[0-9a-f]{64}$/iu.test(digest)
  )
    throw new Error(
      "Custom Consultant projection configuration requires an ID, version, and SHA-256 release digest.",
    );
  const release = {
    configId,
    version,
    softCap,
    contentSha256: Buffer.from(digest, "hex"),
  };
  assertConsultantProjectionConfigRelease(release);
  return Object.freeze(release);
}

export async function bindConsultantProjectionPolicyAtResultProduction(
  client: Queryable,
  input: {
    readonly accountId: string;
    readonly runId: string;
    readonly release?: ConsultantProjectionConfigRelease;
  },
): Promise<void> {
  const release = input.release ?? DEFAULT_CONSULTANT_PROJECTION_CONFIG;
  assertConsultantProjectionConfigRelease(release);
  const run = await client.query<{ tier_at_submission: string }>(
    `SELECT tier_at_submission FROM research_run
      WHERE account_id=$1 AND run_id=$2 FOR SHARE`,
    [input.accountId, input.runId],
  );
  if (run.rows[0]?.tier_at_submission !== "consultant") return;
  const released = await client.query<{ definition: unknown }>(
    `SELECT definition
       FROM consultant_projection_config_release
      WHERE config_id=$1 AND version=$2 AND soft_cap=$3 AND content_sha256=$4`,
    [release.configId, release.version, release.softCap, release.contentSha256],
  );
  if (
    canonicalJson(released.rows[0]?.definition) !==
    consultantProjectionConfigCanonicalJson(release.softCap)
  )
    throw new Error("Released Consultant projection configuration drifted.");
  await client.query(
    `INSERT INTO consultant_result_projection_policy
       (account_id,run_id,config_id,config_version,soft_cap,config_content_sha256)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [
      input.accountId,
      input.runId,
      release.configId,
      release.version,
      release.softCap,
      release.contentSha256,
    ],
  );
}

export interface ConsultantProjectionPolicySnapshot {
  readonly configId: string;
  readonly configVersion: string;
  readonly softCap: number;
  readonly configContentSha256: Buffer;
  readonly boundAt: Date;
  readonly effectiveReleaseAt: Date;
}

export async function readConsultantProjectionPolicy(
  client: TransactionClient,
  input: {
    readonly accountId: string;
    readonly runId: string;
  },
): Promise<ConsultantProjectionPolicySnapshot> {
  const selected = await client.query<{
    config_id: string;
    config_version: string;
    soft_cap: number;
    config_content_sha256: Buffer;
    bound_at: Date;
    released_at: Date;
    definition: unknown;
  }>(
    `SELECT p.config_id,p.config_version,p.soft_cap,p.config_content_sha256,
            p.bound_at,r.released_at,r.definition
       FROM consultant_result_projection_policy p
       JOIN consultant_projection_config_release r
         ON r.config_id=p.config_id AND r.version=p.config_version
        AND r.soft_cap=p.soft_cap AND r.content_sha256=p.config_content_sha256
      WHERE p.account_id=$1 AND p.run_id=$2`,
    [input.accountId, input.runId],
  );
  const row = selected.rows[0];
  if (!row)
    throw new Error("Consultant result projection configuration drifted.");
  try {
    assertConsultantProjectionConfigRelease({
      configId: row.config_id,
      version: row.config_version,
      softCap: row.soft_cap,
      contentSha256: row.config_content_sha256,
    });
  } catch {
    throw new Error("Consultant result projection configuration drifted.");
  }
  if (
    canonicalJson(row.definition) !==
    consultantProjectionConfigCanonicalJson(row.soft_cap)
  )
    throw new Error("Consultant result projection configuration drifted.");
  return {
    configId: row.config_id,
    configVersion: row.config_version,
    softCap: row.soft_cap,
    configContentSha256: row.config_content_sha256,
    boundAt: row.bound_at,
    effectiveReleaseAt: row.released_at,
  };
}
