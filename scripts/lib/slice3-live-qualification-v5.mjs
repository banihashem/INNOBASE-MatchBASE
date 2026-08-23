import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import {
  initializeOneUseCredentialLedger,
  validateOneUseCredentialLedger,
  validateOneUseCredentialReservation,
} from "./slice3-v5-one-use-ledger.mjs";
import { createOneUseOpaqueCapabilityRegistry } from "./slice3-v5-capability-registry.mjs";
import {
  readCanonicalV5CredentialsOnce,
  verifyCanonicalV5CredentialFileControls,
} from "./slice3-v5-credential-file-controls.mjs";
import {
  readExactRegularContainedSource,
  verifyImmutableV5PredecessorLedger,
} from "./slice3-v5-source-verifier.mjs";
import {
  assertSameV5Acceptance,
  loadCurrentPinnedV5Acceptance,
} from "./slice3-v5-role2-source-binding.mjs";
import {
  inspectCanonicalV5ReplayRegistry,
  reserveCanonicalV5ReplayIdentity,
  verifyCanonicalV5ReplayReservation,
} from "./slice3-v5-replay-registry.mjs";
import { V5_TPM_CONTRACT } from "./slice3-v5-role2-tpm-verifier.mjs";
import {
  assertV5SanitizedEnvelopeShape,
  V5_RESPONSE_ALLOWED_DATA_KEYS,
} from "./slice3-v5-response-contract.mjs";
import {
  assertCanonicalV5ManagementRoot,
  assertCanonicalV5Workspace,
} from "./slice3-v5-canonical-workspace.mjs";

const PM_ROOT = "C:\\INNOBASE\\MatchBASE\\01_Product_Management";
const STATE_ROOT = join(PM_ROOT, ".slice3-live-qualification-state");
const CREDENTIAL_FILE = resolve("APIKeys.md");
const POLICY_FILE = resolve("config/slice3/research-route-policy.v1.json");
const OWNER_FILE = join(
  PM_ROOT,
  "OWNER_DECISION_PO_001_SLICE_3_V5_ONE_GET_2026-08-22.md",
);
const ALLOCATION_FILE = join(
  PM_ROOT,
  "ROLE2_ALLOCATION_PO_001_SLICE_3_V5_ONE_GET_PRE_EXECUTION_PENDING.md",
);
const PRIOR_401_FILE = join(
  PM_ROOT,
  "ROLE3_SLICE_3_OPENROUTER_CREDENTIAL_PREFLIGHT_V4.json",
);
const V4_STATE_FILE = join(
  PM_ROOT,
  "ROLE3_SLICE_3_V4_SAFE_BLOCKED_STATE_2026-08-18.json",
);
const V4_VALIDATION_FILE = join(
  PM_ROOT,
  "ROLE3_SLICE_3_V4_SAFE_BLOCKED_CORRECTION_VALIDATION_2026-08-18.md",
);
const V4_AUDITS_FILE = join(
  PM_ROOT,
  "ROLE3_SLICE_3_V4_SAFE_BLOCKED_SIX_AUDIT_RESULT_2026-08-18.json",
);
const V4_CRITIC_FILE = join(
  PM_ROOT,
  "ROLE3_SLICE_3_V4_SAFE_BLOCKED_FINAL_INTEGRATION_CRITIC_2026-08-18.json",
);
const ACCEPTED_ROLE2_FILE = join(
  PM_ROOT,
  "ROLE2_FINAL_INDEPENDENT_REAUDIT_PO_001_SLICE_3_V4_FIXTURE_ONLY_REPOSITORY_RELEASE.md",
);
const ROLE2_SIGNING_REVOCATION_FILE = join(
  PM_ROOT,
  "ROLE2_SIGNING_AUTHORITY_PO_001_SLICE_3_V5_ED25519_REVOCATION.md",
);
const ROLE2_REPLAY_REGISTRY_INITIALIZATION_FILE = join(
  PM_ROOT,
  "ROLE2_SIGNER_REPLAY_REGISTRY_INITIALIZATION_PO_001_SLICE_3_V5.json",
);
const ROLE2_REPLAY_REGISTRY_INITIALIZATION_DIGEST =
  "DF6F2B352BCE80ECC1B4BCFDC70041B3015E4866C5494A00F3DF94DF116EA146";
const ROLE2_SIGNING_REVOCATION_DIGEST =
  "D38D03154C6C87576DEED07EB97A3557271D47E79EE4227D7005CFE7140A1665";
const V5_SESSION_ID = V5_TPM_CONTRACT.sessionId;
const V5_AUTHORIZATION_ID = "PO-001-S3-OPENROUTER-V5-CREDENTIAL-GET-S3";
const ENDPOINT = "https://openrouter.ai/api/v1/key";
const OWNER_DIGEST =
  "7B9DC0E27F2DA3B0E20ED2A4220DFE26AA95B76FA4EC1B37D9B559AE3D0AD916";
const ALLOCATION_DIGEST =
  "484B8F82E08E97CBC40CA0E01115D735FA0446FB19D093DE06F41691CCF1C0C6";
const POLICY_DIGEST =
  "46FCAF0C2D2B66F8BAB8526C48E448A24B2E9F65B065AAA99135CA6AF048DB23";
const PRIOR_401_DIGEST =
  "144E77DE086FF53BFE2FCDD75A4CA750951C4026EA10ECF41FCAE983F9B87C08";
const ACCEPTED_ROLE2_DIGEST =
  "4C40E20137062DD34ED9D16F5B787E74E51934106DBB99A7CFB09E9A6A6D9184";
const V4_SOURCES = Object.freeze([
  Object.freeze({
    path: V4_STATE_FILE,
    digest: "D4A545B7AFB70A08E2ECE3556BA43670FF367F620BF3252648CA5881C05C8A53",
  }),
  Object.freeze({
    path: V4_VALIDATION_FILE,
    digest: "01DB7C3FBD86C770212E2DA89AB13BE193F73B65FA2535A1F8303A51741CFB5C",
  }),
  Object.freeze({
    path: V4_AUDITS_FILE,
    digest: "724188F36A174221760B1E140B53ACE6357C71B731BF77CECEB4FD1CF6DEEAA8",
  }),
  Object.freeze({
    path: V4_CRITIC_FILE,
    digest: "B731B1F14368C7DED583374D412609AAF5C52689053E04E8E60917A13BF680A7",
  }),
]);
const LEDGERS = Object.freeze([
  Object.freeze({
    sessionId: "session-7EA6B3997AF42571DBFE9483",
    digest: "D26108B406EBB23615E9A181ADBC40FED85EDFEE504D7BA144A7BC2277930FA8",
    files: Object.freeze([
      Object.freeze({
        name: "00-authorization.json",
        digest:
          "2D9BC3B21C89A2485A8C7B64889A5CC4247DB62EE96D72EC2E8A80AB79C1C95F",
      }),
      Object.freeze({
        name: "01-reserved.json",
        digest:
          "47063140C37C6B34D9C61350B90D35A63B3D99D2BD63DF29965524587C1CF201",
      }),
      Object.freeze({
        name: "01-result.json",
        digest:
          "70F694C514B5CA3586BC71911B2D0BD438310046A6DFF905A172092A64B24208",
      }),
      Object.freeze({
        name: "02-reserved.json",
        digest:
          "CC4C8DCEE909B07B5871D9727FDD496CA4BE04B92CEC8DE39BC351F3053381A8",
      }),
      Object.freeze({
        name: "02-result.json",
        digest:
          "E7F96045BD9FF5338BDBC390DE7610CED967D29B8901D83B77EC8F74C65EAC05",
      }),
    ]),
  }),
  Object.freeze({
    sessionId: "session-7327E59E65AA787E98E08968",
    digest: "DB247B6E332F02D38E0355B6359F7A3A72A7C02D64A23B6A7B33212D423EF748",
    files: Object.freeze([
      Object.freeze({
        name: "00-authorization.json",
        digest:
          "18920E8DFC602F8C3A998E18242E85F654D54A0CEDE45B8E88B63FC1A088CCCF",
      }),
      Object.freeze({
        name: "01-reserved.json",
        digest:
          "7F33161D8A96B593B49F86736732DC9F9EA9A786FC95DB0059C05911BB9FD497",
      }),
      Object.freeze({
        name: "01-result.json",
        digest:
          "D6E7295130F14E75FC47B9EA31D5D1859BBBC172B04B602BD4B45FF8A8C22DA2",
      }),
      Object.freeze({
        name: "02-reserved.json",
        digest:
          "F7348B969D9EE6733F4D6B2B0D870931704EE165AE493F84BC0C26A2F3210938",
      }),
      Object.freeze({
        name: "02-result.json",
        digest:
          "C294ECB11D3BCF49E371F232B1A5D08530A25DC177641178987FF4D17C35935C",
      }),
    ]),
  }),
  Object.freeze({
    sessionId: "session-19AD2D3117AF9064AF90F879",
    digest: "3030B12726EB31DA43BBEBD19E9D5C0E819AB5857371FBC843CF3F7D759F7BC8",
    files: Object.freeze([
      Object.freeze({
        name: "00-authorization.json",
        digest:
          "9C5A3489035F371685F852A13B0CB578745BBBB3EB673E079C9CFB44B2F7D890",
      }),
      Object.freeze({
        name: "01-reserved.json",
        digest:
          "AA62614A9936D071ECDE5284C4618A7111CF2EE4B8434FF8A308B7C3D8A5E6B9",
      }),
      Object.freeze({
        name: "01-result.json",
        digest:
          "BAF6AA089BD8BDDB6B2CE7CC32FF804A5E8A1C759E453A9994D80728BC7BC2BC",
      }),
      Object.freeze({
        name: "02-reserved.json",
        digest:
          "101AF85031C002AAB59BB73221771C80F559DFF2A0A89C638744C6FFA3A09161",
      }),
      Object.freeze({
        name: "02-result.json",
        digest:
          "09E4CF8E7176A8E5FADA216637D4983748D78FE2C761B1F5DD5B38AB9B67F265",
      }),
    ]),
  }),
]);
const SOURCE_BINDINGS = new WeakSet();
const EXECUTABLE_BINDINGS = new WeakSet();
const SOURCE_ATTESTATIONS = new WeakMap();
const CREDENTIAL_GATE_REGISTRY = createOneUseOpaqueCapabilityRegistry();

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex").toUpperCase();

async function absent(path) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

async function regularContained(path, root) {
  return readExactRegularContainedSource(path, root, null);
}

async function exactSource(path, root, digest) {
  const bytes = await regularContained(path, root);
  if (sha256(bytes) !== digest) throw new Error("V5 immutable source drifted.");
  return bytes;
}

async function ledgerDigest(sessionId) {
  const expected = LEDGERS.find((ledger) => ledger.sessionId === sessionId);
  if (!expected) throw new Error("V5 predecessor ledger identity is unknown.");
  return (
    await verifyImmutableV5PredecessorLedger({
      stateRoot: STATE_ROOT,
      sessionId,
      expectedDigest: expected.digest,
      expectedFiles: expected.files,
    })
  ).digest;
}

function git(args) {
  const result = spawnSync("git", args, {
    cwd: resolve("."),
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error("V5 repository identity could not be read.");
  return result.stdout.trim();
}

const futureRole2Acceptance = () => loadCurrentPinnedV5Acceptance();

async function computeV5SourceAttestation() {
  await Promise.all([
    assertCanonicalV5Workspace(),
    assertCanonicalV5ManagementRoot(),
  ]);
  await Promise.all([
    exactSource(OWNER_FILE, PM_ROOT, OWNER_DIGEST),
    exactSource(ALLOCATION_FILE, PM_ROOT, ALLOCATION_DIGEST),
    exactSource(PRIOR_401_FILE, PM_ROOT, PRIOR_401_DIGEST),
    exactSource(POLICY_FILE, dirname(POLICY_FILE), POLICY_DIGEST),
    exactSource(ACCEPTED_ROLE2_FILE, PM_ROOT, ACCEPTED_ROLE2_DIGEST),
    exactSource(
      ROLE2_SIGNING_REVOCATION_FILE,
      PM_ROOT,
      ROLE2_SIGNING_REVOCATION_DIGEST,
    ),
    exactSource(
      ROLE2_REPLAY_REGISTRY_INITIALIZATION_FILE,
      PM_ROOT,
      ROLE2_REPLAY_REGISTRY_INITIALIZATION_DIGEST,
    ),
    ...V4_SOURCES.map(({ path, digest }) => exactSource(path, PM_ROOT, digest)),
  ]);
  for (const ledger of LEDGERS)
    if ((await ledgerDigest(ledger.sessionId)) !== ledger.digest)
      throw new Error("V5 predecessor ledger digest drifted.");
  const acceptance = await futureRole2Acceptance();
  const payload = Object.freeze({
    schemaVersion: "matchbase.slice3-v5-source-attestation/v1",
    ownerDigest: OWNER_DIGEST,
    allocationDigest: ALLOCATION_DIGEST,
    policyDigest: POLICY_DIGEST,
    prior401Digest: PRIOR_401_DIGEST,
    acceptedRole2Digest: ACCEPTED_ROLE2_DIGEST,
    role2SigningRevocationDigest: ROLE2_SIGNING_REVOCATION_DIGEST,
    role2ReplayRegistryInitializationDigest:
      ROLE2_REPLAY_REGISTRY_INITIALIZATION_DIGEST,
    ledgerDigests: Object.freeze(
      LEDGERS.map(({ sessionId, digest }) =>
        Object.freeze({ sessionId, digest }),
      ),
    ),
    v4Digests: Object.freeze(V4_SOURCES.map(({ digest }) => digest)),
    repositoryCommit: git(["rev-parse", "HEAD"]),
    repositoryTree: git(["rev-parse", "HEAD^{tree}"]),
    originMain: git(["rev-parse", "origin/main"]),
    worktreeClean: git(["status", "--porcelain"]) === "",
    role2PayloadSha256: acceptance?.payloadSha256 ?? null,
    role2SignatureSha256: acceptance?.signatureSha256 ?? null,
    role2TpmPublicSpkiSha256: V5_TPM_CONTRACT.publicSpkiDerSha256,
    role2SchemaV3Sha256: V5_TPM_CONTRACT.schemaSha256,
    role2ContractV3Sha256: V5_TPM_CONTRACT.contractSha256,
    role2ContractV2SupersessionSha256: V5_TPM_CONTRACT.supersessionSha256,
  });
  return Object.freeze({
    payload,
    digest: sha256(JSON.stringify(payload)),
    acceptance,
  });
}

export async function createV5SourceBinding() {
  const attestation = await computeV5SourceAttestation();
  const sessionDirectory = join(STATE_ROOT, V5_SESSION_ID);
  if (
    !(await absent(sessionDirectory)) ||
    !(await absent(`${sessionDirectory}.authorization.lock`)) ||
    !(await absent(`${sessionDirectory}.run.lock`))
  )
    throw new Error("V5 one-use allocation is already consumed or locked.");
  const acceptance = attestation.acceptance;
  let replayReady = false;
  let replayExhausted = false;
  if (acceptance) {
    const replay = await inspectCanonicalV5ReplayRegistry(
      acceptance.payload.replayIdentity,
    );
    replayReady =
      replay.digest ===
        acceptance.payload.replayIdentity.registryPreSignSha256 &&
      replay.byteLength ===
        acceptance.payload.replayIdentity.registryPreSignBytes &&
      replay.records.length ===
        acceptance.payload.replayIdentity.registryPreSignRecordCount &&
      replay.records.at(-1)?.sequence ===
        acceptance.payload.replayIdentity.registryPreSignLastSequence &&
      replay.lastRecordSha256 ===
        acceptance.payload.replayIdentity.registryPreSignTailSha256 &&
      !replay.identityUsed &&
      (await absent(`${V5_TPM_CONTRACT.replayRegistryPath}.lock`));
    replayExhausted = !replayReady;
  }
  const binding = Object.freeze({
    schemaVersion: "matchbase.slice3-v5-source-binding/v1",
    authorizationId: V5_AUTHORIZATION_ID,
    sessionId: V5_SESSION_ID,
    disposition: replayExhausted
      ? "TERMINAL_REPLAY_EXHAUSTED"
      : replayReady
        ? "READY_FOR_ONE_CREDENTIAL_GET"
        : "PRE_EXECUTION_PENDING",
    reason: replayExhausted
      ? "ROLE2_REPLAY_IDENTITY_STALE_OR_CONSUMED"
      : replayReady
        ? null
        : "ROLE2_ACCEPTANCE_PAYLOAD_ABSENT",
    activation: false,
    sourceAttestationDigest: attestation.digest,
  });
  SOURCE_BINDINGS.add(binding);
  SOURCE_ATTESTATIONS.set(binding, attestation);
  if (replayReady) EXECUTABLE_BINDINGS.add(binding);
  return binding;
}

export function assessCurrentV5Disposition(binding) {
  if (!SOURCE_BINDINGS.has(binding))
    throw new Error("V5 source capability is invalid.");
  return Object.freeze({
    ...binding,
    credentialGets: 0,
    modelPosts: 0,
    searchCalls: 0,
    activation: false,
  });
}

async function boundedBytes(response, controller, timeoutMs = 10_000) {
  const limit = 32_768;
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit)
    throw new Error("V5 response declared oversize.");
  if (!response.body) throw new Error("V5 response body is absent.");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let didTimeout = false;
  let rejectTimeout;
  const timedOut = new Promise((_, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort("v5_total_timeout");
    void reader.cancel("v5_total_timeout");
    rejectTimeout(new Error("V5 response body timed out."));
  }, timeoutMs);
  timer.unref();
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timedOut]);
      if (didTimeout) throw new Error("V5 response body timed out.");
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("v5_response_limit");
        throw new Error("V5 response streamed oversize.");
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  return Buffer.concat(
    chunks.map((value) => Buffer.from(value)),
    total,
  );
}

const V5_REQUIRED_KEY_STATUS_FIELDS = Object.freeze(
  V5_RESPONSE_ALLOWED_DATA_KEYS.filter((key) => key !== "expires_at"),
);
const V5_RATE_LIMIT_KEYS = Object.freeze(["requests", "interval", "note"]);
const V5_PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const V5_MAX_JSON_DEPTH = 8;

function assertNoDuplicateOrHostileJsonKeys(text) {
  let index = 0;
  const whitespace = () => {
    while (/\s/u.test(text[index] ?? "")) index += 1;
  };
  const stringToken = () => {
    const start = index;
    if (text[index++] !== '"') throw new Error("invalid-json");
    while (index < text.length) {
      const character = text[index++];
      if (character === '"') return JSON.parse(text.slice(start, index));
      if (character === "\\") {
        const escaped = text[index++];
        if (escaped === "u") {
          if (!/^[0-9a-fA-F]{4}$/u.test(text.slice(index, index + 4)))
            throw new Error("invalid-json");
          index += 4;
        } else if (!'"\\/bfnrt'.includes(escaped ?? "")) {
          throw new Error("invalid-json");
        }
      } else if (character.charCodeAt(0) < 0x20) {
        throw new Error("invalid-json");
      }
    }
    throw new Error("invalid-json");
  };
  const value = (depth) => {
    whitespace();
    if (depth > V5_MAX_JSON_DEPTH) throw new Error("invalid-json");
    if (text[index] === "{") {
      index += 1;
      whitespace();
      const keys = new Set();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      while (true) {
        whitespace();
        const key = stringToken();
        if (keys.has(key) || V5_PROTOTYPE_KEYS.has(key))
          throw new Error("invalid-json");
        keys.add(key);
        whitespace();
        if (text[index++] !== ":") throw new Error("invalid-json");
        value(depth + 1);
        whitespace();
        if (text[index] === "}") {
          index += 1;
          return;
        }
        if (text[index++] !== ",") throw new Error("invalid-json");
      }
    }
    if (text[index] === "[") {
      index += 1;
      whitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      while (true) {
        value(depth + 1);
        whitespace();
        if (text[index] === "]") {
          index += 1;
          return;
        }
        if (text[index++] !== ",") throw new Error("invalid-json");
      }
    }
    if (text[index] === '"') {
      stringToken();
      return;
    }
    const token = text
      .slice(index)
      .match(
        /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u,
      )?.[0];
    if (!token) throw new Error("invalid-json");
    if (/^-?\d/u.test(token) && !Number.isFinite(Number(token)))
      throw new Error("invalid-json");
    index += token.length;
  };
  value(1);
  whitespace();
  if (index !== text.length) throw new Error("invalid-json");
}

function validRfc3339DateTime(value) {
  if (typeof value !== "string") return false;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u,
  );
  if (!match) return false;
  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] =
    match.map((item) => (item === undefined ? item : Number(item)));
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    (offsetHour !== undefined && (offsetHour > 23 || offsetMinute > 59))
  )
    return false;
  return Number.isFinite(Date.parse(value));
}

const finiteNonnegative = (value) => Number.isFinite(value) && value >= 0;

function extractKeyStatusDecision(parsed, verificationInstantMs) {
  const diagnostics = new Set();
  const add = (value) => diagnostics.add(value);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !Object.hasOwn(parsed, "data") ||
    !parsed.data ||
    typeof parsed.data !== "object" ||
    Array.isArray(parsed.data)
  ) {
    add("MISSING_REQUIRED_FIELD");
    return {
      schemaValid: false,
      paidCredential: null,
      failureClass: "INVALID_200_SCHEMA",
      diagnostics,
    };
  }
  if (Object.keys(parsed).some((key) => key !== "data"))
    add("UNKNOWN_FIELDS_DISCARDED");
  const data = parsed.data;
  if (
    Object.keys(data).some(
      (key) => !V5_RESPONSE_ALLOWED_DATA_KEYS.includes(key),
    )
  )
    add("UNKNOWN_FIELDS_DISCARDED");
  const missing = V5_REQUIRED_KEY_STATUS_FIELDS.filter(
    (key) => !Object.hasOwn(data, key),
  );
  if (missing.length > 0) add("MISSING_REQUIRED_FIELD");
  if (!Object.hasOwn(data, "is_free_tier")) add("MISSING_PAID_STATUS");
  if (
    !Object.hasOwn(data, "is_management_key") ||
    !Object.hasOwn(data, "is_provisioning_key")
  )
    add("KEY_CLASS_UNPROVEN");
  if (!Object.hasOwn(data, "expires_at")) add("EXPIRY_UNPROVEN");
  if (!Object.hasOwn(data, "limit_remaining")) add("QUOTA_UNPROVEN");

  const booleanKeys = [
    "include_byok_in_limit",
    "is_free_tier",
    "is_management_key",
    "is_provisioning_key",
  ];
  const numberKeys = [
    "usage",
    "usage_daily",
    "usage_weekly",
    "usage_monthly",
    "byok_usage",
    "byok_usage_daily",
    "byok_usage_weekly",
    "byok_usage_monthly",
  ];
  let typeMismatch =
    booleanKeys.some(
      (key) => Object.hasOwn(data, key) && typeof data[key] !== "boolean",
    ) ||
    numberKeys.some(
      (key) => Object.hasOwn(data, key) && !finiteNonnegative(data[key]),
    ) ||
    (Object.hasOwn(data, "label") && typeof data.label !== "string") ||
    (Object.hasOwn(data, "creator_user_id") &&
      data.creator_user_id !== null &&
      typeof data.creator_user_id !== "string") ||
    ["limit", "limit_remaining"].some(
      (key) =>
        Object.hasOwn(data, key) &&
        data[key] !== null &&
        !finiteNonnegative(data[key]),
    ) ||
    (Object.hasOwn(data, "limit_reset") &&
      data.limit_reset !== null &&
      typeof data.limit_reset !== "string") ||
    (Object.hasOwn(data, "expires_at") &&
      data.expires_at !== null &&
      !validRfc3339DateTime(data.expires_at));

  if (
    typeof data.limit_reset === "string" &&
    !["daily", "weekly", "monthly"].includes(data.limit_reset)
  )
    add("UNKNOWN_FIELDS_DISCARDED");

  if (Object.hasOwn(data, "rate_limit")) {
    const rate = data.rate_limit;
    if (!rate || typeof rate !== "object" || Array.isArray(rate)) {
      typeMismatch = true;
    } else {
      if (Object.keys(rate).some((key) => !V5_RATE_LIMIT_KEYS.includes(key)))
        add("UNKNOWN_FIELDS_DISCARDED");
      if (V5_RATE_LIMIT_KEYS.some((key) => !Object.hasOwn(rate, key)))
        add("MISSING_REQUIRED_FIELD");
      // The narrow Role2 amendment permits the legacy -1 sentinel, not values below it.
      if (
        (Object.hasOwn(rate, "requests") &&
          (!Number.isSafeInteger(rate.requests) || rate.requests < -1)) ||
        (Object.hasOwn(rate, "interval") &&
          typeof rate.interval !== "string") ||
        (Object.hasOwn(rate, "note") && typeof rate.note !== "string")
      )
        typeMismatch = true;
    }
  }
  if (typeMismatch) add("KNOWN_FIELD_TYPE_MISMATCH");
  const schemaValid =
    missing.length === 0 &&
    !diagnostics.has("MISSING_REQUIRED_FIELD") &&
    !diagnostics.has("MISSING_PAID_STATUS") &&
    !diagnostics.has("KNOWN_FIELD_TYPE_MISMATCH");
  if (!schemaValid)
    return {
      schemaValid: false,
      paidCredential: null,
      failureClass: "INVALID_200_SCHEMA",
      diagnostics,
    };

  const paidCredential = data.is_free_tier === false;
  if (data.limit_remaining === null) add("QUOTA_UNPROVEN");
  else if (data.limit_remaining === 0) add("QUOTA_EXHAUSTED");
  let failureClass = null;
  if (!paidCredential) failureClass = "UNPAID_CREDENTIAL";
  else if (data.is_management_key) failureClass = "INELIGIBLE_MANAGEMENT_KEY";
  else if (data.is_provisioning_key)
    failureClass = "INELIGIBLE_PROVISIONING_KEY";
  else if (!Object.hasOwn(data, "expires_at")) failureClass = "EXPIRY_UNPROVEN";
  else if (
    data.expires_at !== null &&
    Date.parse(data.expires_at) <= verificationInstantMs
  )
    failureClass = "EXPIRED_KEY";
  else if (data.limit_remaining === null) {
    failureClass = "QUOTA_UNPROVEN";
  } else if (data.limit_remaining === 0) {
    failureClass = "QUOTA_EXHAUSTED";
  }
  return { schemaValid: true, paidCredential, failureClass, diagnostics };
}

export async function reduceV5CredentialResponse(
  response,
  controller = new AbortController(),
  { timeoutMs = 10_000, verificationInstantMs = Date.now() } = {},
) {
  const bytes = await boundedBytes(response, controller, timeoutMs);
  const contentTypeValid = /^application\/json(?:\s*;|$)/iu.test(
    response.headers.get("content-type") ?? "",
  );
  const urlValid = response.url === ENDPOINT;
  let parsed = null;
  let decision = null;
  try {
    const text = new TextDecoder("utf8", { fatal: true }).decode(bytes);
    assertNoDuplicateOrHostileJsonKeys(text);
    parsed = JSON.parse(text);
    decision =
      response.status === 200
        ? extractKeyStatusDecision(parsed, verificationInstantMs)
        : null;
  } catch {
    /* closed sanitized reduction */
  }
  const schemaValid =
    response.status === 200 &&
    urlValid &&
    contentTypeValid &&
    decision?.schemaValid === true;
  const paidCredential = schemaValid ? decision.paidCredential : null;
  const accepted =
    response.status === 200 && schemaValid && decision.failureClass === null;
  const diagnostics = decision
    ? Object.freeze(
        [
          "KNOWN_FIELD_TYPE_MISMATCH",
          "MISSING_REQUIRED_FIELD",
          "MISSING_PAID_STATUS",
          "KEY_CLASS_UNPROVEN",
          "EXPIRY_UNPROVEN",
          "QUOTA_UNPROVEN",
          "QUOTA_EXHAUSTED",
          "UNKNOWN_FIELDS_DISCARDED",
        ].filter((value) => decision.diagnostics.has(value)),
      )
    : Object.freeze(
        response.status === 200 ? ["KNOWN_FIELD_TYPE_MISMATCH"] : [],
      );
  const envelope = Object.freeze(
    assertV5SanitizedEnvelopeShape({
      endpointCapability: "OPENROUTER_KEY_STATUS_READ",
      httpStatus: response.status,
      callOccurred: true,
      urlValid,
      contentTypeValid,
      schemaValid,
      paidCredential,
      failureClass: accepted
        ? null
        : response.status === 401
          ? "HTTP_401"
          : response.status === 403
            ? "HTTP_403"
            : response.status >= 300 && response.status < 400
              ? "REDIRECT_RESPONSE"
              : response.status === 200
                ? schemaValid
                  ? decision.failureClass
                  : "INVALID_200_SCHEMA"
                : "OTHER_HTTP_STATUS",
      responseBodyPersisted: false,
      rawHeadersPersisted: false,
      decisionDiagnostics: diagnostics,
    }),
  );
  return Object.freeze({
    schemaVersion: "matchbase.slice3-v5-credential-result/v2",
    disposition: accepted
      ? "CREDENTIAL_GATE_PASS_AWAITING_SEPARATE_LIVE_QUALIFICATION"
      : "BLOCKED_CREDENTIAL",
    sanitizedEnvelope: envelope,
    sanitizedEnvelopeDigest: sha256(JSON.stringify(envelope)),
    allocationConsumed: true,
    credentialGets: 1,
    modelPosts: 0,
    searchCalls: 0,
    metadataGets: 0,
    retries: 0,
    fallbacks: 0,
    billableCalls: 0,
    providerQualificationCalls: 0,
    accountMutations: 0,
    cloudMutations: 0,
    deploymentMutations: 0,
    externalMutations: 0,
    activation: false,
    terminal: true,
  });
}

const canonicalObservedAt = () =>
  new Date(Math.floor(Date.now() / 1_000) * 1_000)
    .toISOString()
    .replace(".000Z", "Z");

async function assertHeldLock(path, handle) {
  const [held, item] = await Promise.all([handle.stat(), lstat(path)]);
  if (
    !held.isFile() ||
    held.nlink !== 1 ||
    !item.isFile() ||
    item.isSymbolicLink() ||
    item.nlink !== 1 ||
    held.dev !== item.dev ||
    held.ino !== item.ino
  )
    throw new Error("V5 exclusive parent/run lock ownership was lost.");
}

async function durableTerminalWrite(path, result) {
  const bytes = `${JSON.stringify(result)}\n`;
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    const item = await handle.stat();
    if (
      !item.isFile() ||
      item.nlink !== 1 ||
      item.size !== Buffer.byteLength(bytes)
    )
      throw new Error("V5 terminal result durability check failed.");
  } finally {
    await handle.close();
  }
}

function blockedTransportResult({
  sendState,
  responseStatus,
  responseContentTypeValid,
  responseUrlValid,
}) {
  const envelope = Object.freeze(
    assertV5SanitizedEnvelopeShape({
      endpointCapability: "OPENROUTER_KEY_STATUS_READ",
      httpStatus: responseStatus,
      callOccurred:
        sendState === "NOT_SENT"
          ? false
          : sendState === "RESPONSE_RECEIVED"
            ? true
            : null,
      urlValid: responseUrlValid,
      contentTypeValid: responseContentTypeValid,
      schemaValid: false,
      paidCredential: null,
      failureClass:
        sendState === "NOT_SENT"
          ? "CREDENTIAL_READ_OR_PRE_SEND_FAILURE"
          : sendState === "RESPONSE_RECEIVED"
            ? "RESPONSE_REDUCTION_FAILURE"
            : "UNKNOWN_TRANSPORT_TIMEOUT_OR_REDIRECT",
      responseBodyPersisted: false,
      rawHeadersPersisted: false,
      decisionDiagnostics: Object.freeze([]),
    }),
  );
  return Object.freeze({
    schemaVersion: "matchbase.slice3-v5-credential-result/v2",
    disposition: "BLOCKED_CREDENTIAL",
    sanitizedEnvelope: envelope,
    sanitizedEnvelopeDigest: sha256(JSON.stringify(envelope)),
    allocationConsumed: true,
    credentialGets:
      sendState === "NOT_SENT"
        ? 0
        : sendState === "RESPONSE_RECEIVED"
          ? 1
          : null,
    modelPosts: 0,
    searchCalls: 0,
    metadataGets: 0,
    retries: 0,
    fallbacks: 0,
    billableCalls: 0,
    providerQualificationCalls: 0,
    accountMutations: 0,
    cloudMutations: 0,
    deploymentMutations: 0,
    externalMutations: 0,
    activation: false,
    terminal: true,
  });
}

async function executeAttestedV5(binding) {
  const priorAttestation = SOURCE_ATTESTATIONS.get(binding);
  const currentAttestation = await computeV5SourceAttestation();
  const initialAcceptance = currentAttestation.acceptance;
  if (
    !priorAttestation ||
    !initialAcceptance ||
    priorAttestation.digest !== currentAttestation.digest ||
    currentAttestation.payload.worktreeClean !== true ||
    currentAttestation.payload.repositoryCommit !==
      currentAttestation.payload.originMain
  )
    throw new Error("V5 source attestation changed before reservation.");
  let lockedAcceptance;
  let lockedAttestation;
  let replayRecord;
  const initialized = await initializeOneUseCredentialLedger({
    stateRoot: STATE_ROOT,
    sessionId: V5_SESSION_ID,
    afterLock: async ({
      authorizationLock,
      authorizationLockHandle,
      runLock,
      runLockHandle,
    }) => {
      await Promise.all([
        assertHeldLock(authorizationLock, authorizationLockHandle),
        assertHeldLock(runLock, runLockHandle),
        verifyCanonicalCredentialPath(),
      ]);
      lockedAttestation = await computeV5SourceAttestation();
      lockedAcceptance = lockedAttestation.acceptance;
      if (lockedAttestation.digest !== currentAttestation.digest)
        throw new Error("V5 full source attestation changed after lock.");
      assertSameV5Acceptance(initialAcceptance, lockedAcceptance);
      const replay = await inspectCanonicalV5ReplayRegistry(
        lockedAcceptance.payload.replayIdentity,
      );
      if (
        replay.digest !==
          lockedAcceptance.payload.replayIdentity.registryPreSignSha256 ||
        replay.byteLength !==
          lockedAcceptance.payload.replayIdentity.registryPreSignBytes ||
        replay.records.length !==
          lockedAcceptance.payload.replayIdentity.registryPreSignRecordCount ||
        replay.records.at(-1)?.sequence !==
          lockedAcceptance.payload.replayIdentity.registryPreSignLastSequence ||
        replay.lastRecordSha256 !==
          lockedAcceptance.payload.replayIdentity.registryPreSignTailSha256 ||
        replay.identityUsed
      )
        throw new Error("V5 replay identity is stale or already consumed.");
    },
    buildEventsAfterLock: async () => {
      replayRecord = await reserveCanonicalV5ReplayIdentity({
        replayIdentity: lockedAcceptance.payload.replayIdentity,
        payloadSha256: lockedAcceptance.payloadSha256,
        observedAt: canonicalObservedAt(),
      });
      const authorizationEvent = {
        schemaVersion: "matchbase.slice3-v5-authorization/v2",
        authorizationId: V5_AUTHORIZATION_ID,
        sessionId: V5_SESSION_ID,
        sourceAttestationDigest: lockedAttestation.digest,
        role2PayloadSha256: lockedAcceptance.payloadSha256,
        role2SignatureSha256: lockedAcceptance.signatureSha256,
        role2ReplayIdentitySha256: lockedAcceptance.replayIdentitySha256,
        role2KeyId: V5_TPM_CONTRACT.keyId,
        role2Nonce: lockedAcceptance.payload.nonce,
        repositoryCommit: lockedAttestation.payload.repositoryCommit,
        repositoryTree: lockedAttestation.payload.repositoryTree,
        originMain: lockedAttestation.payload.originMain,
        observedAt: canonicalObservedAt(),
        maxCredentialGets: 1,
        modelPosts: 0,
        searchCalls: 0,
        activation: false,
      };
      const authorizationDigest = sha256(
        `${JSON.stringify(authorizationEvent)}\n`,
      );
      return {
        authorizationEvent,
        reservationEvent: {
          schemaVersion: "matchbase.slice3-v5-key-get-reservation/v2",
          authorizationId: V5_AUTHORIZATION_ID,
          sessionId: V5_SESSION_ID,
          authorizationDigest,
          replayRecordSha256: replayRecord.recordSha256,
          observedAt: canonicalObservedAt(),
          callNumber: 1,
          endpoint: ENDPOINT,
          method: "GET",
          retries: 0,
          fallbacks: 0,
          redirects: 0,
          allocationConsumed: true,
          activation: false,
        },
      };
    },
    executeWhileLocked: async ({
      sessionDirectory,
      authorizationLock,
      authorizationLockHandle,
      runLock,
      runLockHandle,
      authorizationDigest,
      reservationDigest,
    }) => {
      const controller = new AbortController();
      let timer;
      let result;
      let sendState = "NOT_SENT";
      let responseStatus = null;
      let responseContentTypeValid = false;
      let responseUrlValid = false;
      try {
        const preSendAttestation = await computeV5SourceAttestation();
        if (preSendAttestation.digest !== lockedAttestation.digest)
          throw new Error("V5 full source attestation changed before send.");
        const preSendAcceptance = preSendAttestation.acceptance;
        assertSameV5Acceptance(lockedAcceptance, preSendAcceptance);
        await Promise.all([
          assertHeldLock(authorizationLock, authorizationLockHandle),
          assertHeldLock(runLock, runLockHandle),
          verifyCanonicalV5ReplayReservation(replayRecord.recordSha256),
          validateOneUseCredentialReservation(sessionDirectory, {
            authorizationDigest,
            reservationDigest,
          }),
        ]);
        const credentials = await readCanonicalV5CredentialsOnce();
        const immediateAttestation = await computeV5SourceAttestation();
        if (immediateAttestation.digest !== lockedAttestation.digest)
          throw new Error(
            "V5 full source attestation changed at send boundary.",
          );
        assertSameV5Acceptance(
          preSendAcceptance,
          immediateAttestation.acceptance,
        );
        await Promise.all([
          assertHeldLock(authorizationLock, authorizationLockHandle),
          assertHeldLock(runLock, runLockHandle),
          verifyCanonicalV5ReplayReservation(replayRecord.recordSha256),
          validateOneUseCredentialReservation(sessionDirectory, {
            authorizationDigest,
            reservationDigest,
          }),
        ]);
        timer = setTimeout(() => controller.abort("v5_total_timeout"), 10_000);
        timer.unref();
        sendState = "UNKNOWN_AFTER_SEND";
        const response = await fetch(ENDPOINT, {
          method: "GET",
          redirect: "error",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${credentials.MATCHBASE_OPENROUTER_API_KEY}`,
          },
        });
        sendState = "RESPONSE_RECEIVED";
        responseStatus = response.status;
        responseUrlValid = response.url === ENDPOINT;
        responseContentTypeValid = /^application\/json(?:\s*;|$)/iu.test(
          response.headers.get("content-type") ?? "",
        );
        result = await reduceV5CredentialResponse(response, controller);
      } catch {
        result = blockedTransportResult({
          sendState,
          responseStatus,
          responseContentTypeValid,
          responseUrlValid,
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
      result = Object.freeze({
        ...result,
        observedAt: canonicalObservedAt(),
        authorizationDigest,
        reservationDigest,
      });
      await durableTerminalWrite(
        join(sessionDirectory, "02-key-get-result.json"),
        result,
      );
      await validateOneUseCredentialLedger(sessionDirectory, {
        authorizationId: V5_AUTHORIZATION_ID,
        sessionId: V5_SESSION_ID,
        sourceAttestationDigest: lockedAttestation.digest,
        role2PayloadSha256: lockedAcceptance.payloadSha256,
        role2SignatureSha256: lockedAcceptance.signatureSha256,
        role2ReplayIdentitySha256: lockedAcceptance.replayIdentitySha256,
        role2KeyId: V5_TPM_CONTRACT.keyId,
        role2Nonce: lockedAcceptance.payload.nonce,
        replayRecordSha256: replayRecord.recordSha256,
      });
      return Object.freeze({ terminalWritten: true, result });
    },
  });
  const result = initialized.execution.result;
  let capability = null;
  if (
    result.disposition ===
    "CREDENTIAL_GATE_PASS_AWAITING_SEPARATE_LIVE_QUALIFICATION"
  ) {
    capability = CREDENTIAL_GATE_REGISTRY.mint({
      sourceBinding: binding,
      sourceAttestationDigest: currentAttestation.digest,
      authorizationDigest: initialized.authorizationDigest,
      reservationDigest: initialized.reservationDigest,
    });
  }
  return Object.freeze({ evidence: result, capability });
}

export function consumeV5CredentialGateCapability(capability) {
  const attested = CREDENTIAL_GATE_REGISTRY.consume(capability);
  return Object.freeze({
    schemaVersion: "matchbase.slice3-v5-credential-gate-admission/v1",
    disposition: "CREDENTIAL_GATE_PASS_AWAITING_SEPARATE_LIVE_QUALIFICATION",
    sourceAttestationDigest: attested.sourceAttestationDigest,
    authorizationDigest: attested.authorizationDigest,
    reservationDigest: attested.reservationDigest,
    modelPosts: 0,
    searchCalls: 0,
    activation: false,
  });
}

async function verifyCanonicalCredentialPath() {
  const controls = await verifyCanonicalV5CredentialFileControls();
  if (controls.path !== CREDENTIAL_FILE)
    throw new Error("V5 credential path identity drifted.");
}

export async function executeCurrentV5CredentialGate(binding) {
  if (!SOURCE_BINDINGS.has(binding))
    throw new Error("V5 source capability is invalid.");
  if (!EXECUTABLE_BINDINGS.has(binding))
    return assessCurrentV5Disposition(binding);
  EXECUTABLE_BINDINGS.delete(binding);
  return executeAttestedV5(binding);
}

export const slice3V5QualificationConstants = Object.freeze({
  authorizationId: V5_AUTHORIZATION_ID,
  sessionId: V5_SESSION_ID,
  endpoint: ENDPOINT,
  ownerDigest: OWNER_DIGEST,
  allocationDigest: ALLOCATION_DIGEST,
  policyDigest: POLICY_DIGEST,
  prior401Digest: PRIOR_401_DIGEST,
  acceptedRole2Digest: ACCEPTED_ROLE2_DIGEST,
  ledgers: LEDGERS,
  v4Sources: V4_SOURCES,
  maxCredentialGets: 1,
  maxModelPosts: 0,
  maxSearchCalls: 0,
  timeoutMs: 10_000,
  maxResponseBytes: 32_768,
  role2PublicKeyPinned: true,
  role2TpmKeyId: V5_TPM_CONTRACT.keyId,
  role2PublicPemSha256: V5_TPM_CONTRACT.publicPemSha256,
  role2PublicSpkiDerSha256: V5_TPM_CONTRACT.publicSpkiDerSha256,
  role2SchemaV3Sha256: V5_TPM_CONTRACT.schemaSha256,
  role2ContractV3Sha256: V5_TPM_CONTRACT.contractSha256,
  role2ContractV2SupersessionSha256: V5_TPM_CONTRACT.supersessionSha256,
  role2SigningRevocationDigest: ROLE2_SIGNING_REVOCATION_DIGEST,
});
