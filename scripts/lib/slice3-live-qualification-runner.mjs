import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";

const AUTHORIZATION_ID =
  "PO-001-SLICE3-LIVE-QUALIFICATION-REPLACEMENT-2026-08-16-V3";
const V1_AUTHORIZATION_ID = "PO-001-SLICE3-LIVE-QUALIFICATION-2026-08-16-V1";
const V2_AUTHORIZATION_ID =
  "PO-001-SLICE3-LIVE-QUALIFICATION-REPLACEMENT-2026-08-16-V2";
const V3_AUTHORIZATION_SIGNAL =
  "I_AUTHORIZE_TWO_REPLACEMENT_BILLABLE_SYNTHETIC_CALLS_V3";
// This remains null until the Product Owner issues the post-V1 replacement
// decision and its exact UTF-8 digest is reviewed and pinned in source.
const EXPECTED_OWNER_DECISION_DIGEST =
  "B112BF95B40F06787568F71207D6A0A5A1C9F022F9C6F5BB1353D212127FA362";
const EXPECTED_POLICY_DIGEST =
  "46FCAF0C2D2B66F8BAB8526C48E448A24B2E9F65B065AAA99135CA6AF048DB23";
const EXPECTED_CONSUMED_V1_LEDGER_DIGEST =
  "D26108B406EBB23615E9A181ADBC40FED85EDFEE504D7BA144A7BC2277930FA8";
const EXPECTED_CONSUMED_V2_LEDGER_DIGEST =
  "DB247B6E332F02D38E0355B6359F7A3A72A7C02D64A23B6A7B33212D423EF748";
const EXPECTED_PRECALL_STATE_DIGEST =
  "3093D90B8C1AEC943A2914C1D110AE3FCE836FFCC07FC4187F08BE9F0AADAB89";
const CANONICAL_STATE_DIRECTORY =
  "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\.slice3-live-qualification-state";
const MAX_CALLS = 2;
const MAX_COST_USD = 100;
const MAX_OUTPUT_TOKENS = 2048;
const OPENROUTER_REQUESTED_MODEL = "google/gemini-3.6-flash";
const OPENROUTER_SERVED_MODEL = "google/gemini-3.6-flash";
const OPENROUTER_PROVIDER_ALIAS = "google-vertex";
const OPENROUTER_SERVED_PROVIDER = "Google Vertex";
const ROUTE_PATHS = Object.freeze(["gemini_direct", "openrouter"]);
const DIGEST = /^[A-F0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const SECRET_NAMES = Object.freeze([
  "MATCHBASE_GEMINI_API_KEY",
  "MATCHBASE_OPENROUTER_API_KEY",
]);
const FINALIZED_ATTESTATIONS = new WeakSet();
const FINALIZED_ATTESTATION_BINDINGS = new WeakMap();
const AUTHORIZED_QUALIFICATION_BINDINGS = new WeakSet();
const AUTHORIZED_QUALIFICATION_BINDING_DIGESTS = new WeakMap();
const AUTHORIZATION_BINDING_FIELDS = new Set([
  "authorizationId",
  "ownerDecisionDigest",
  "policyDigest",
  "consumedV1LedgerDigest",
  "consumedV2LedgerDigest",
  "v1AuthorizationId",
  "v2AuthorizationId",
  "preCallManifestDigest",
  "restartPolicy",
  "maxCalls",
  "maxCostUsd",
]);
const OFFICIAL_EVIDENCE_REFS = Object.freeze([
  "https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash",
  "https://ai.google.dev/gemini-api/docs/pricing",
  "https://ai.google.dev/gemini-api/docs/zdr",
  "https://openrouter.ai/docs/guides/routing/provider-selection",
  "https://openrouter.ai/docs/guides/features/sovereign-ai",
  "https://openrouter.ai/api/v1/models/google/gemini-3.6-flash/endpoints",
  "https://openrouter.ai/api/v1/endpoints/zdr",
  "https://openrouter.ai/docs/api/api-reference/generations/get-generation",
  "https://openrouter.ai/docs/guides/features/router-metadata",
]);

const RESULT_FIELDS = new Set([
  "routePath",
  "routeId",
  "terminalDisposition",
  "reasonCode",
  "requestDigest",
  "responseContentDigest",
  "providerRequestIdDigest",
  "generationMetadataDigest",
  "routerMetadataDigest",
  "metadataReadCostEvent",
  "requestedProviderId",
  "requestedModelId",
  "servedProviderId",
  "servedModelId",
  "identityBasis",
  "inputTokens",
  "outputTokens",
  "searchQueryCount",
  "finishReason",
  "costState",
  "costAmountUsd",
  "currency",
  "pricingVersion",
  "sourceUrls",
  "endpointCatalogDigest",
  "officialEvidenceRefs",
  "startedAt",
  "completedAt",
]);

const FAILURE_FIELDS = new Set([
  "reasonCode",
  "phase",
  "httpStatus",
  "callOccurred",
  "servedProviderId",
  "servedModelId",
  "inputTokens",
  "outputTokens",
  "searchQueryCount",
  "finishReason",
  "costState",
  "costAmountUsd",
  "requestDigest",
  "responseContentDigest",
  "providerRequestIdDigest",
  "generationMetadataDigest",
  "routerMetadataDigest",
  "metadataReadCostEvent",
  "endpointCatalogDigest",
  "recordedAt",
]);

const FAILURE_PHASES = new Set([
  "PRE_SEND",
  "TRANSPORT",
  "HTTP_STATUS",
  "RESPONSE_PARSE",
  "IDENTITY",
  "USAGE",
  "SEARCH_GROUNDING",
  "FINISH_REASON",
  "COST",
  "EVIDENCE_VALIDATION",
  "GENERATION_METADATA",
]);

const METADATA_READ_EVENT_FIELDS = new Set([
  "capability",
  "calls",
  "amountUsd",
  "currency",
  "costState",
]);

function validateMetadataReadCostEvent(value, required) {
  if (value === null && !required) return null;
  const event = exactKeys(
    value,
    METADATA_READ_EVENT_FIELDS,
    "Generation metadata read cost event",
  );
  if (
    event.capability !== "OPENROUTER_GENERATION_METADATA_READ" ||
    event.calls !== 1 ||
    event.amountUsd !== 0 ||
    event.currency !== "USD" ||
    event.costState !== "explicit_zero"
  ) {
    throw new Error("Generation metadata read cost event is invalid.");
  }
  return event;
}

const OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["fixtureId", "answer", "sourceSummary"],
  properties: {
    fixtureId: { const: "S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN" },
    answer: { type: "string", minLength: 1, maxLength: 500 },
    sourceSummary: { type: "string", minLength: 1, maxLength: 500 },
  },
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function exactPreCallManifest() {
  return {
    schemaVersion: "slice3-live-qualification-precall-manifest.v1",
    authorizationId: AUTHORIZATION_ID,
    sessionId: `session-${sha256(AUTHORIZATION_ID).slice(0, 24)}`,
    stateDirectory: CANONICAL_STATE_DIRECTORY,
    policyDigest: EXPECTED_POLICY_DIGEST,
    consumedV1LedgerDigest: EXPECTED_CONSUMED_V1_LEDGER_DIGEST,
    consumedV2LedgerDigest: EXPECTED_CONSUMED_V2_LEDGER_DIGEST,
    v3SessionState: "ABSENT",
    v3AuthorizationLockState: "ABSENT",
    restartPolicy: "NON_RESUMABLE_NEW_ALLOCATION_REQUIRED",
  };
}

function validateQualificationAuthorizationBinding(value) {
  exactKeys(value, AUTHORIZATION_BINDING_FIELDS, "Authorization binding");
  for (const field of AUTHORIZATION_BINDING_FIELDS) {
    if (!(field in value)) {
      throw new Error(`Authorization binding omitted ${field}.`);
    }
  }
  if (
    value.authorizationId !== AUTHORIZATION_ID ||
    value.v1AuthorizationId !== V1_AUTHORIZATION_ID ||
    value.v2AuthorizationId !== V2_AUTHORIZATION_ID ||
    value.preCallManifestDigest !== EXPECTED_PRECALL_STATE_DIGEST ||
    value.restartPolicy !== "NON_RESUMABLE_NEW_ALLOCATION_REQUIRED" ||
    !DIGEST.test(value.ownerDecisionDigest) ||
    !DIGEST.test(value.policyDigest) ||
    !DIGEST.test(value.consumedV1LedgerDigest) ||
    !DIGEST.test(value.consumedV2LedgerDigest) ||
    value.maxCalls !== MAX_CALLS ||
    value.maxCostUsd !== MAX_COST_USD
  ) {
    throw new Error("Authorization binding is invalid.");
  }
  return Object.freeze({ ...value });
}

function requireAuthorizedQualificationBinding(value) {
  const expectedDigest =
    value && typeof value === "object"
      ? AUTHORIZED_QUALIFICATION_BINDING_DIGESTS.get(value)
      : undefined;
  if (
    !value ||
    !AUTHORIZED_QUALIFICATION_BINDINGS.has(value) ||
    !expectedDigest ||
    sha256(JSON.stringify(value)) !== expectedDigest ||
    !Object.isFrozen(value)
  ) {
    throw new Error(
      "Qualification requires a source-anchored authorization capability.",
    );
  }
  validateQualificationAuthorizationBinding(value);
  return value;
}

export function isQualificationAuthorizationBinding(value) {
  try {
    requireAuthorizedQualificationBinding(value);
    return true;
  } catch {
    return false;
  }
}

async function requireRegularFile(path, label) {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`${label} must be a regular file.`);
}

async function pathIsAbsent(path) {
  try {
    await stat(path);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

async function requireDirectory(path, label) {
  const metadata = await stat(path);
  if (!metadata.isDirectory()) throw new Error(`${label} must be a directory.`);
}

function exactV1Authorization(routeIds) {
  return {
    schemaVersion: "slice3-live-qualification-authorization.v1",
    authorizationId: V1_AUTHORIZATION_ID,
    maxCalls: MAX_CALLS,
    maxCostUsd: MAX_COST_USD,
    syntheticOnly: true,
    routeIds,
  };
}

async function readConsumedV1Ledger(stateDirectory) {
  const stem = `session-${sha256(V1_AUTHORIZATION_ID).slice(0, 24)}`;
  const directory = join(stateDirectory, stem);
  const names = [
    "00-authorization.json",
    "01-reserved.json",
    "01-result.json",
    "02-reserved.json",
    "02-result.json",
  ];
  const actualNames = (await readdir(directory)).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify([...names].sort())) {
    throw new Error("Consumed V1 ledger file set is invalid.");
  }
  const raw = await Promise.all(
    names.map(async (name) => {
      const path = join(directory, name);
      await requireRegularFile(path, `V1 ledger event ${name}`);
      return await readFile(path, "utf8");
    }),
  );
  const events = raw.map((text) => JSON.parse(text));
  const authorization = events[0];
  const routeIds = [
    "RT-GEMINI-DIRECT-3.6-FLASH-S3-V1",
    "RT-OPENROUTER-GOOGLE-GEMINI-3.6-FLASH-S3-V1",
  ];
  if (
    JSON.stringify(authorization) !==
    JSON.stringify(exactV1Authorization(routeIds))
  ) {
    throw new Error("Consumed V1 authorization is invalid.");
  }
  const authorizationDigest = sha256(JSON.stringify(authorization));
  for (let index = 0; index < MAX_CALLS; index += 1) {
    const reservation = events[index * 2 + 1];
    const result = events[index * 2 + 2];
    const callNumber = index + 1;
    const routeId = routeIds[index];
    if (
      reservation?.schemaVersion !==
        "slice3-live-qualification-reservation.v1" ||
      reservation.authorizationId !== V1_AUTHORIZATION_ID ||
      reservation.authorizationDigest !== authorizationDigest ||
      reservation.routeId !== routeId ||
      reservation.callNumber !== callNumber ||
      !DIGEST.test(reservation.requestDigest) ||
      !Number.isFinite(new Date(reservation.reservedAt).getTime())
    ) {
      throw new Error("Consumed V1 reservation is invalid.");
    }
    if (
      result?.schemaVersion !== "slice3-live-qualification-result-event.v1" ||
      result.authorizationId !== V1_AUTHORIZATION_ID ||
      result.authorizationDigest !== authorizationDigest ||
      result.routeId !== routeId ||
      result.callNumber !== callNumber ||
      result.reservationDigest !== sha256(JSON.stringify(reservation)) ||
      result.terminalDisposition !== "FAIL" ||
      result.evidence !== null ||
      result.failure?.reasonCode !==
        (index === 0
          ? "DIRECT_ROUTE_NOT_PASSED"
          : "OPENROUTER_ROUTE_NOT_PASSED") ||
      result.failure?.costState !== "unknown" ||
      !Number.isFinite(new Date(result.failure?.recordedAt).getTime())
    ) {
      throw new Error("Consumed V1 result is invalid.");
    }
  }
  return Object.freeze({
    authorizationId: V1_AUTHORIZATION_ID,
    ledgerDigest: sha256(
      JSON.stringify(
        names.map((name, index) => ({ name, digest: sha256(raw[index]) })),
      ),
    ),
  });
}

async function readConsumedV2Ledger(stateDirectory) {
  const stem = `session-${sha256(V2_AUTHORIZATION_ID).slice(0, 24)}`;
  const directory = join(stateDirectory, stem);
  const names = [
    "00-authorization.json",
    "01-reserved.json",
    "01-result.json",
    "02-reserved.json",
    "02-result.json",
  ];
  const actualNames = (await readdir(directory)).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify([...names].sort())) {
    throw new Error("Consumed V2 ledger file set is invalid.");
  }
  const raw = await Promise.all(
    names.map(async (name) => {
      const path = join(directory, name);
      await requireRegularFile(path, `V2 ledger event ${name}`);
      return await readFile(path, "utf8");
    }),
  );
  const events = raw.map((text) => JSON.parse(text));
  if (
    events[0]?.schemaVersion !== "slice3-live-qualification-authorization.v2" ||
    events[0]?.authorizationId !== V2_AUTHORIZATION_ID ||
    events[0]?.maxCalls !== MAX_CALLS ||
    events[0]?.maxCostUsd !== MAX_COST_USD ||
    events[0]?.syntheticOnly !== true
  ) {
    throw new Error("Consumed V2 authorization is invalid.");
  }
  for (let index = 0; index < MAX_CALLS; index += 1) {
    const reservation = events[index * 2 + 1];
    const result = events[index * 2 + 2];
    if (
      reservation?.authorizationId !== V2_AUTHORIZATION_ID ||
      reservation.callNumber !== index + 1 ||
      result?.authorizationId !== V2_AUTHORIZATION_ID ||
      result.callNumber !== index + 1 ||
      result.terminalDisposition !== "FAIL"
    ) {
      throw new Error("Consumed V2 ledger event is invalid.");
    }
  }
  return Object.freeze({
    authorizationId: V2_AUTHORIZATION_ID,
    ledgerDigest: sha256(
      JSON.stringify(
        names.map((name, index) => ({ name, digest: sha256(raw[index]) })),
      ),
    ),
  });
}

export async function createQualificationAuthorizationBinding(options) {
  if (
    EXPECTED_OWNER_DECISION_DIGEST === null ||
    options.stateDirectory !== CANONICAL_STATE_DIRECTORY
  ) {
    throw new Error("V3 owner reauthorization is not source-anchored.");
  }
  await requireRegularFile(options.ownerDecisionFile, "Owner decision");
  await requireRegularFile(options.policyFile, "Qualification policy");
  const ownerDecisionRaw = await readFile(options.ownerDecisionFile, "utf8");
  for (const marker of [
    AUTHORIZATION_ID,
    `session-${sha256(AUTHORIZATION_ID).slice(0, 24)}`,
    EXPECTED_POLICY_DIGEST,
    EXPECTED_CONSUMED_V1_LEDGER_DIGEST,
    EXPECTED_CONSUMED_V2_LEDGER_DIGEST,
    EXPECTED_PRECALL_STATE_DIGEST,
    "exactly two additional billable provider calls",
    "No third V3 call is authorized",
  ]) {
    if (!ownerDecisionRaw.includes(marker)) {
      throw new Error("V3 owner decision marker is absent or invalid.");
    }
  }
  if (/TO_BE_|PLACEHOLDER/iu.test(ownerDecisionRaw)) {
    throw new Error("V3 owner decision contains an unresolved placeholder.");
  }
  if (sha256(ownerDecisionRaw) !== EXPECTED_OWNER_DECISION_DIGEST) {
    throw new Error("V3 owner decision digest is not source-anchored.");
  }
  const policyRaw = await readFile(options.policyFile, "utf8");
  const parsedPolicy = JSON.parse(policyRaw);
  if (
    options.policy &&
    JSON.stringify(parsedPolicy) !== JSON.stringify(options.policy)
  ) {
    throw new Error("Qualification policy file does not match runtime policy.");
  }
  const consumedV1 = await readConsumedV1Ledger(options.stateDirectory);
  const consumedV2 = await readConsumedV2Ledger(options.stateDirectory);
  const preCallManifest = exactPreCallManifest();
  const preCallManifestDigest = sha256(JSON.stringify(preCallManifest));
  const sessionDirectory = join(
    options.stateDirectory,
    preCallManifest.sessionId,
  );
  const authorizationLockPath = join(
    options.stateDirectory,
    `${preCallManifest.sessionId}.authorization.lock`,
  );
  if (
    sha256(policyRaw) !== EXPECTED_POLICY_DIGEST ||
    consumedV1.ledgerDigest !== EXPECTED_CONSUMED_V1_LEDGER_DIGEST ||
    consumedV2.ledgerDigest !== EXPECTED_CONSUMED_V2_LEDGER_DIGEST ||
    preCallManifestDigest !== EXPECTED_PRECALL_STATE_DIGEST
  ) {
    throw new Error(
      "Qualification policy, predecessor ledgers, or pre-call manifest drifted.",
    );
  }
  if (
    !(await pathIsAbsent(sessionDirectory)) ||
    !(await pathIsAbsent(authorizationLockPath))
  ) {
    throw new Error(
      "V3 pre-call state is not pristine; this allocation is non-resumable.",
    );
  }
  const binding = deepFreeze(
    validateQualificationAuthorizationBinding({
      authorizationId: AUTHORIZATION_ID,
      ownerDecisionDigest: sha256(ownerDecisionRaw),
      policyDigest: sha256(policyRaw),
      consumedV1LedgerDigest: consumedV1.ledgerDigest,
      consumedV2LedgerDigest: consumedV2.ledgerDigest,
      v1AuthorizationId: consumedV1.authorizationId,
      v2AuthorizationId: consumedV2.authorizationId,
      preCallManifestDigest,
      restartPolicy: preCallManifest.restartPolicy,
      maxCalls: MAX_CALLS,
      maxCostUsd: MAX_COST_USD,
    }),
  );
  AUTHORIZED_QUALIFICATION_BINDINGS.add(binding);
  AUTHORIZED_QUALIFICATION_BINDING_DIGESTS.set(
    binding,
    sha256(JSON.stringify(binding)),
  );
  return binding;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.has(key))) {
    throw new Error(`${label} contains unsupported fields.`);
  }
  return value;
}

function finiteInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function money(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > MAX_COST_USD) {
    throw new Error(`${label} is invalid.`);
  }
  return Number(number.toFixed(9));
}

function safeIdentity(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function nullableSafeIdentity(value, label) {
  if (value === null) return null;
  return safeIdentity(value, label);
}

function nullableDigest(value, label) {
  if (value !== null && !DIGEST.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function nullableInteger(value, label) {
  if (value === null) return null;
  return finiteInteger(value, label);
}

function nullableMoney(value, label) {
  if (value === null) return null;
  return money(value, label);
}

function validateSanitizedQualificationFailure(value) {
  const failure = exactKeys(value, FAILURE_FIELDS, "Qualification failure");
  for (const field of FAILURE_FIELDS) {
    if (!(field in failure)) {
      throw new Error(`Qualification failure omitted ${field}.`);
    }
  }
  safeIdentity(failure.reasonCode, "failure reasonCode");
  if (!FAILURE_PHASES.has(failure.phase)) {
    throw new Error("Qualification failure phase is invalid.");
  }
  if (
    failure.httpStatus !== null &&
    (!Number.isSafeInteger(failure.httpStatus) ||
      failure.httpStatus < 100 ||
      failure.httpStatus > 599)
  ) {
    throw new Error("Qualification failure HTTP status is invalid.");
  }
  if (typeof failure.callOccurred !== "boolean") {
    throw new Error("Qualification failure call flag is invalid.");
  }
  nullableSafeIdentity(failure.servedProviderId, "failure servedProviderId");
  nullableSafeIdentity(failure.servedModelId, "failure servedModelId");
  nullableInteger(failure.inputTokens, "failure inputTokens");
  nullableInteger(failure.outputTokens, "failure outputTokens");
  nullableInteger(failure.searchQueryCount, "failure searchQueryCount");
  nullableSafeIdentity(failure.finishReason, "failure finishReason");
  if (
    !new Set(["unknown", "provider_reported", "conservative_estimate"]).has(
      failure.costState,
    )
  ) {
    throw new Error("Qualification failure cost state is invalid.");
  }
  nullableMoney(failure.costAmountUsd, "failure costAmountUsd");
  if (
    (failure.costState === "unknown" && failure.costAmountUsd !== null) ||
    (failure.costState !== "unknown" && failure.costAmountUsd === null)
  ) {
    throw new Error("Qualification failure cost binding is invalid.");
  }
  if (!DIGEST.test(failure.requestDigest)) {
    throw new Error("Qualification failure request digest is invalid.");
  }
  nullableDigest(failure.responseContentDigest, "failure response digest");
  nullableDigest(failure.providerRequestIdDigest, "failure request ID digest");
  nullableDigest(failure.generationMetadataDigest, "failure metadata digest");
  nullableDigest(
    failure.routerMetadataDigest,
    "failure router metadata digest",
  );
  validateMetadataReadCostEvent(
    failure.metadataReadCostEvent,
    failure.generationMetadataDigest !== null,
  );
  if (
    (failure.generationMetadataDigest === null) !==
    (failure.metadataReadCostEvent === null)
  ) {
    throw new Error("Qualification failure metadata binding is invalid.");
  }
  nullableDigest(failure.endpointCatalogDigest, "failure endpoint digest");
  if (!Number.isFinite(new Date(failure.recordedAt).getTime())) {
    throw new Error("Qualification failure time is invalid.");
  }
  if (!failure.callOccurred && failure.httpStatus !== null) {
    throw new Error("Pre-send failure cannot contain an HTTP status.");
  }
  const serialized = JSON.stringify(failure);
  if (
    /api[_-]?key|authorization|bearer|raw[_-]?(?:request|response|payload)|headers|error[_-]?(?:body|message)/iu.test(
      serialized,
    )
  ) {
    throw new Error("Qualification failure contains restricted material.");
  }
  return failure;
}

class SanitizedQualificationCallError extends Error {
  constructor(failure) {
    super("Qualification route failed with sanitized evidence.");
    this.name = "SanitizedQualificationCallError";
    this.failure = Object.freeze(
      validateSanitizedQualificationFailure(failure),
    );
  }
}

function safeUrls(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) {
    throw new Error("Qualification source URLs are invalid.");
  }
  return Object.freeze(
    value.map((candidate) => {
      const parsed = new URL(candidate);
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.port ||
        parsed.hash
      ) {
        throw new Error("Qualification source URL is unsafe.");
      }
      return parsed.href;
    }),
  );
}

function parseJsonText(value) {
  if (typeof value !== "string" || value.length > 32_768) {
    throw new Error("Provider structured content is invalid.");
  }
  const parsed = JSON.parse(value);
  exactKeys(
    parsed,
    new Set(["fixtureId", "answer", "sourceSummary"]),
    "Provider structured content",
  );
  if (
    parsed.fixtureId !== "S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN" ||
    typeof parsed.answer !== "string" ||
    !parsed.answer.trim() ||
    typeof parsed.sourceSummary !== "string" ||
    !parsed.sourceSummary.trim()
  ) {
    throw new Error("Provider structured content failed its frozen schema.");
  }
  return parsed;
}

async function readBoundedJson(response) {
  const limit = 2 * 1024 * 1024;
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) {
    throw new Error("Provider response exceeded the bounded JSON limit.");
  }
  if (!response.body) throw new Error("Provider response omitted its body.");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) {
        await reader.cancel("qualification_response_limit");
        throw new Error("Provider response exceeded the bounded JSON limit.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const parsed = JSON.parse(
    new TextDecoder("utf8", { fatal: true }).decode(bytes),
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Provider response is not a JSON object.");
  }
  return parsed;
}

async function oneJsonPost({
  url,
  headers,
  body,
  fetchImpl,
  onPhase,
  onResponse,
  timeoutMs = 30_000,
}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("qualification_timeout"),
    timeoutMs,
  );
  timer.unref();
  try {
    onPhase?.("TRANSPORT", null);
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { "content-type": "application/json", ...headers },
      body,
    });
    onResponse?.(response);
    onPhase?.("RESPONSE_PARSE", response.status);
    const envelope = await readBoundedJson(response);
    if (!response.ok) {
      onPhase?.("HTTP_STATUS", response.status);
      throw new Error(`Provider returned HTTP ${response.status}.`);
    }
    return envelope;
  } finally {
    clearTimeout(timer);
  }
}

async function oneJsonGet({
  url,
  headers,
  fetchImpl,
  onPhase,
  timeoutMs = 30_000,
}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("qualification_metadata_timeout"),
    timeoutMs,
  );
  timer.unref();
  try {
    onPhase?.("GENERATION_METADATA", null);
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers,
    });
    onPhase?.("GENERATION_METADATA", response.status);
    const envelope = await readBoundedJson(response);
    if (!response.ok) {
      throw new Error(`Generation metadata returned HTTP ${response.status}.`);
    }
    return envelope;
  } finally {
    clearTimeout(timer);
  }
}

function canonicalCredentialLine(line) {
  const match = line.match(
    /^\s*(?:[-*]\s*)?`?(MATCHBASE_(?:GEMINI|OPENROUTER)_API_KEY)`?\s*[:=]\s*`?([^`\s]+)`?\s*$/u,
  );
  return match ? [match[1], match[2]] : null;
}

export async function readCanonicalCredentials(filePath) {
  const text = await readFile(filePath, "utf8");
  const entries = text
    .split(/\r?\n/u)
    .map(canonicalCredentialLine)
    .filter(Boolean);
  if (
    entries.length !== 2 ||
    new Set(entries.map(([name]) => name)).size !== 2 ||
    entries.some(
      ([name, value]) =>
        !SECRET_NAMES.includes(name) ||
        !value ||
        value !== value.trim() ||
        /[\s\p{Cc}\p{Cf}]/u.test(value),
    )
  ) {
    throw new Error("Canonical qualification credential file is invalid.");
  }
  return validateCredentialObject(Object.fromEntries(entries));
}

function validateCredentialObject(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== SECRET_NAMES.length ||
    SECRET_NAMES.some(
      (name) =>
        !Object.prototype.hasOwnProperty.call(value, name) ||
        typeof value[name] !== "string" ||
        !value[name] ||
        value[name] !== value[name].trim() ||
        /[\s\p{Cc}\p{Cf}]/u.test(value[name]),
    )
  ) {
    throw new Error("Canonical qualification credentials are invalid.");
  }
  return Object.freeze({
    MATCHBASE_GEMINI_API_KEY: value.MATCHBASE_GEMINI_API_KEY,
    MATCHBASE_OPENROUTER_API_KEY: value.MATCHBASE_OPENROUTER_API_KEY,
  });
}

async function readJsonOrNull(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonExclusive(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function exactAuthorization(routeIds, authorizationBinding) {
  return {
    schemaVersion: "slice3-live-qualification-authorization.v3",
    authorizationId: AUTHORIZATION_ID,
    authorizationBinding:
      requireAuthorizedQualificationBinding(authorizationBinding),
    maxCalls: MAX_CALLS,
    maxCostUsd: MAX_COST_USD,
    syntheticOnly: true,
    routeIds: [...routeIds],
  };
}

function validateAuthorization(value, routeIds, authorizationBinding) {
  exactKeys(
    value,
    new Set([
      "schemaVersion",
      "authorizationId",
      "authorizationBinding",
      "maxCalls",
      "maxCostUsd",
      "syntheticOnly",
      "routeIds",
    ]),
    "Qualification authorization",
  );
  const expected = exactAuthorization(routeIds, authorizationBinding);
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new Error("Qualification authorization state drifted.");
  }
  return expected;
}

function reservationPath(directory, callNumber) {
  return join(
    directory,
    `${String(callNumber).padStart(2, "0")}-reserved.json`,
  );
}

function resultPath(directory, callNumber) {
  return join(directory, `${String(callNumber).padStart(2, "0")}-result.json`);
}

export async function initializeQualificationSessionDirectory(options) {
  await requireDirectory(options.stateDirectory, "Qualification state root");
  const sessionDirectory = join(options.stateDirectory, options.sessionId);
  const authorizationLockPath = join(
    options.stateDirectory,
    `${options.sessionId}.authorization.lock`,
  );
  if (
    !(await pathIsAbsent(sessionDirectory)) ||
    !(await pathIsAbsent(authorizationLockPath))
  ) {
    throw new Error(
      "Qualification V3 is non-resumable and its initial path is not absent.",
    );
  }
  let authorizationLock;
  try {
    authorizationLock = await open(authorizationLockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("Qualification V3 authorization race was fenced.");
    }
    throw error;
  }
  try {
    if (!(await pathIsAbsent(sessionDirectory))) {
      throw new Error(
        "Qualification V3 session appeared during authorization.",
      );
    }
    await mkdir(sessionDirectory);
    const statePath = join(sessionDirectory, "00-authorization.json");
    await writeJsonExclusive(statePath, options.authorization);
    return Object.freeze({ sessionDirectory, statePath });
  } finally {
    await authorizationLock.close();
    await rm(authorizationLockPath, { force: true });
  }
}

export async function createDurableQualificationSession(options) {
  const routeIds = options.routeIds;
  if (
    !Array.isArray(routeIds) ||
    routeIds.length !== MAX_CALLS ||
    new Set(routeIds).size !== MAX_CALLS ||
    routeIds.some((value) => !SAFE_ID.test(value))
  ) {
    throw new Error("Qualification session requires two exact route IDs.");
  }
  const authorizationBinding = requireAuthorizedQualificationBinding(
    options.authorizationBinding,
  );
  if (options.stateDirectory !== CANONICAL_STATE_DIRECTORY) {
    throw new Error("Qualification state root is not canonical.");
  }
  const stem = `session-${sha256(AUTHORIZATION_ID).slice(0, 24)}`;
  const authorization = exactAuthorization(routeIds, authorizationBinding);
  const initialized = await initializeQualificationSessionDirectory({
    stateDirectory: options.stateDirectory,
    sessionId: stem,
    authorization,
  });
  const { sessionDirectory, statePath } = initialized;
  const lockPath = join(options.stateDirectory, `${stem}.lock`);
  validateAuthorization(
    await readJsonOrNull(statePath),
    routeIds,
    authorizationBinding,
  );

  async function readState() {
    validateAuthorization(
      await readJsonOrNull(statePath),
      routeIds,
      authorizationBinding,
    );
    const routes = [];
    for (let index = 0; index < routeIds.length; index += 1) {
      const callNumber = index + 1;
      const routeId = routeIds[index];
      const reservation = await readJsonOrNull(
        reservationPath(sessionDirectory, callNumber),
      );
      const result = await readJsonOrNull(
        resultPath(sessionDirectory, callNumber),
      );
      if (reservation === null) {
        if (result !== null)
          throw new Error("Qualification result exists without reservation.");
        routes.push({ routeId, callNumber, state: "AVAILABLE" });
        continue;
      }
      exactKeys(
        reservation,
        new Set([
          "schemaVersion",
          "authorizationId",
          "authorizationDigest",
          "routeId",
          "callNumber",
          "requestDigest",
          "reservedAt",
        ]),
        "Qualification reservation",
      );
      if (
        reservation.schemaVersion !==
          "slice3-live-qualification-reservation.v3" ||
        reservation.authorizationId !== AUTHORIZATION_ID ||
        reservation.authorizationDigest !==
          sha256(JSON.stringify(authorization)) ||
        reservation.routeId !== routeId ||
        reservation.callNumber !== callNumber ||
        !DIGEST.test(reservation.requestDigest) ||
        !Number.isFinite(new Date(reservation.reservedAt).getTime())
      ) {
        throw new Error("Qualification reservation state drifted.");
      }
      if (result === null) {
        routes.push({ ...reservation, state: "RESERVED" });
        continue;
      }
      exactKeys(
        result,
        new Set([
          "schemaVersion",
          "authorizationId",
          "authorizationDigest",
          "routeId",
          "callNumber",
          "reservationDigest",
          "terminalDisposition",
          "evidence",
          "failure",
        ]),
        "Qualification result event",
      );
      if (
        result.schemaVersion !== "slice3-live-qualification-result-event.v3" ||
        result.authorizationId !== AUTHORIZATION_ID ||
        result.authorizationDigest !== sha256(JSON.stringify(authorization)) ||
        result.routeId !== routeId ||
        result.callNumber !== callNumber ||
        result.reservationDigest !== sha256(JSON.stringify(reservation)) ||
        !new Set(["PASS", "FAIL"]).has(result.terminalDisposition)
      ) {
        throw new Error("Qualification result event drifted.");
      }
      if (result.terminalDisposition === "PASS") {
        if (result.failure !== null)
          throw new Error("Passing result contains failure data.");
        validateSanitizedQualificationEvidence(result.evidence);
        if (
          result.evidence.routeId !== routeId ||
          result.evidence.requestDigest !== reservation.requestDigest ||
          result.evidence.terminalDisposition !== "PASS"
        ) {
          throw new Error("Qualification evidence route binding drifted.");
        }
      } else {
        if (result.evidence !== null)
          throw new Error("Failed result contains passing evidence.");
        validateSanitizedQualificationFailure(result.failure);
        if (result.failure.requestDigest !== reservation.requestDigest) {
          throw new Error("Qualification failure request binding drifted.");
        }
      }
      routes.push({
        ...reservation,
        state: result.terminalDisposition === "PASS" ? "PASSED" : "FAILED",
        ...(result.evidence ? { result: result.evidence } : {}),
        ...(result.failure ? { failure: result.failure } : {}),
      });
    }
    const finalPath = join(sessionDirectory, "03-final.json");
    const final = await readJsonOrNull(finalPath);
    if (final !== null) {
      exactKeys(
        final,
        new Set([
          "schemaVersion",
          "authorizationId",
          "authorizationDigest",
          "resultDigests",
          "totalCalls",
          "totalCostUsd",
          "finalizedAt",
        ]),
        "Qualification final event",
      );
      const resultEvents = await Promise.all(
        [1, 2].map((callNumber) =>
          readJsonOrNull(resultPath(sessionDirectory, callNumber)),
        ),
      );
      const expectedDigests = resultEvents.map((result) =>
        sha256(JSON.stringify(result)),
      );
      if (
        final.schemaVersion !== "slice3-live-qualification-final.v3" ||
        final.authorizationId !== AUTHORIZATION_ID ||
        final.authorizationDigest !== sha256(JSON.stringify(authorization)) ||
        JSON.stringify(final.resultDigests) !==
          JSON.stringify(expectedDigests) ||
        final.totalCalls !== MAX_CALLS ||
        routes.some((route) => route.state !== "PASSED") ||
        !Number.isFinite(final.totalCostUsd) ||
        final.totalCostUsd <= 0 ||
        final.totalCostUsd > MAX_COST_USD ||
        !Number.isFinite(new Date(final.finalizedAt).getTime())
      ) {
        throw new Error("Qualification final event drifted.");
      }
    }
    return {
      ...authorization,
      routes,
      finalized: final !== null,
      ...(final
        ? {
            totalCalls: final.totalCalls,
            totalCostUsd: final.totalCostUsd,
            finalizedAt: final.finalizedAt,
          }
        : {}),
    };
  }

  async function locked(operation) {
    let lock;
    try {
      lock = await open(lockPath, "wx");
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error("Qualification session is locked or crash-fenced.");
      }
      throw error;
    }
    try {
      return await operation();
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }

  return Object.freeze({
    authorizationId: AUTHORIZATION_ID,
    statePath,
    async read() {
      return await readState();
    },
    async reserve(routeId, requestDigest, at = new Date().toISOString()) {
      if (!DIGEST.test(requestDigest))
        throw new Error("Request digest is invalid.");
      return await locked(async () => {
        const state = await readState();
        if (state.finalized)
          throw new Error("Qualification session is finalized.");
        const route = state.routes.find((entry) => entry.routeId === routeId);
        if (!route) throw new Error("Qualification route is unauthorized.");
        if (route.state !== "AVAILABLE") {
          throw new Error("Qualification route call is already consumed.");
        }
        const event = {
          schemaVersion: "slice3-live-qualification-reservation.v3",
          authorizationId: AUTHORIZATION_ID,
          authorizationDigest: sha256(JSON.stringify(authorization)),
          routeId,
          callNumber: route.callNumber,
          requestDigest,
          reservedAt: new Date(at).toISOString(),
        };
        await writeJsonExclusive(
          reservationPath(sessionDirectory, route.callNumber),
          event,
        );
        return await readState();
      });
    },
    async record(routeId, evidence) {
      validateSanitizedQualificationEvidence(evidence);
      return await locked(async () => {
        const state = await readState();
        const route = state.routes.find((entry) => entry.routeId === routeId);
        if (!route || route.state !== "RESERVED") {
          throw new Error("Qualification result lacks a consumed route slot.");
        }
        if (route.requestDigest !== evidence.requestDigest) {
          throw new Error("Qualification result request binding mismatch.");
        }
        const reservation = await readJsonOrNull(
          reservationPath(sessionDirectory, route.callNumber),
        );
        await writeJsonExclusive(
          resultPath(sessionDirectory, route.callNumber),
          {
            schemaVersion: "slice3-live-qualification-result-event.v3",
            authorizationId: AUTHORIZATION_ID,
            authorizationDigest: sha256(JSON.stringify(authorization)),
            routeId,
            callNumber: route.callNumber,
            reservationDigest: sha256(JSON.stringify(reservation)),
            terminalDisposition: "PASS",
            evidence,
            failure: null,
          },
        );
        return await readState();
      });
    },
    async recordFailure(routeId, failure) {
      validateSanitizedQualificationFailure(failure);
      return await locked(async () => {
        const state = await readState();
        const route = state.routes.find((entry) => entry.routeId === routeId);
        if (!route || route.state !== "RESERVED") {
          throw new Error("Qualification failure lacks a consumed route slot.");
        }
        const reservation = await readJsonOrNull(
          reservationPath(sessionDirectory, route.callNumber),
        );
        await writeJsonExclusive(
          resultPath(sessionDirectory, route.callNumber),
          {
            schemaVersion: "slice3-live-qualification-result-event.v3",
            authorizationId: AUTHORIZATION_ID,
            authorizationDigest: sha256(JSON.stringify(authorization)),
            routeId,
            callNumber: route.callNumber,
            reservationDigest: sha256(JSON.stringify(reservation)),
            terminalDisposition: "FAIL",
            evidence: null,
            failure,
          },
        );
        return await readState();
      });
    },
    async finalize() {
      return await locked(async () => {
        const state = await readState();
        if (
          state.routes.length !== MAX_CALLS ||
          state.routes.some((route) => route.state !== "PASSED")
        ) {
          throw new Error(
            "Qualification cannot finalize without two route passes.",
          );
        }
        const total = Number(
          state.routes
            .reduce((sum, route) => sum + route.result.costAmountUsd, 0)
            .toFixed(9),
        );
        if (total <= 0 || total > state.maxCostUsd) {
          throw new Error("Qualification final cost is outside authorization.");
        }
        const resultEvents = await Promise.all(
          [1, 2].map((callNumber) =>
            readJsonOrNull(resultPath(sessionDirectory, callNumber)),
          ),
        );
        await writeJsonExclusive(join(sessionDirectory, "03-final.json"), {
          schemaVersion: "slice3-live-qualification-final.v3",
          authorizationId: AUTHORIZATION_ID,
          authorizationDigest: sha256(JSON.stringify(authorization)),
          resultDigests: resultEvents.map((result) =>
            sha256(JSON.stringify(result)),
          ),
          totalCalls: MAX_CALLS,
          totalCostUsd: total,
          finalizedAt: new Date().toISOString(),
        });
        return await readState();
      });
    },
    async attest(policy) {
      const state = await readState();
      validateFinalizedQualificationSession(state, policy);
      const eventPaths = [
        statePath,
        reservationPath(sessionDirectory, 1),
        resultPath(sessionDirectory, 1),
        reservationPath(sessionDirectory, 2),
        resultPath(sessionDirectory, 2),
        join(sessionDirectory, "03-final.json"),
      ];
      const eventDigests = await Promise.all(
        eventPaths.map(async (path) => sha256(await readFile(path, "utf8"))),
      );
      const immutableState = deepFreeze(structuredClone(state));
      const stateDigest = sha256(JSON.stringify(immutableState));
      const ledgerDigest = sha256(
        JSON.stringify({ eventDigests, stateDigest }),
      );
      const attestation = deepFreeze({
        schemaVersion: "slice3-live-qualification-attestation.v3",
        authorizationId: AUTHORIZATION_ID,
        ledgerDigest,
        stateDigest,
        state: immutableState,
      });
      FINALIZED_ATTESTATIONS.add(attestation);
      FINALIZED_ATTESTATION_BINDINGS.set(attestation, {
        ledgerDigest,
        stateDigest,
      });
      return attestation;
    },
  });
}

export function validateSanitizedQualificationEvidence(value) {
  const candidate = exactKeys(value, RESULT_FIELDS, "Qualification evidence");
  for (const field of RESULT_FIELDS) {
    if (!(field in candidate))
      throw new Error(`Qualification evidence omitted ${field}.`);
  }
  if (!ROUTE_PATHS.includes(candidate.routePath))
    throw new Error("Qualification path is invalid.");
  safeIdentity(candidate.routeId, "routeId");
  if (!new Set(["PASS", "FAIL"]).has(candidate.terminalDisposition)) {
    throw new Error("Qualification disposition is invalid.");
  }
  safeIdentity(candidate.reasonCode, "reasonCode");
  if (
    !DIGEST.test(candidate.requestDigest) ||
    !DIGEST.test(candidate.responseContentDigest)
  ) {
    throw new Error("Qualification content digest is invalid.");
  }
  if (
    candidate.providerRequestIdDigest !== null &&
    !DIGEST.test(candidate.providerRequestIdDigest)
  ) {
    throw new Error("Qualification provider request digest is invalid.");
  }
  nullableDigest(
    candidate.generationMetadataDigest,
    "generationMetadataDigest",
  );
  nullableDigest(candidate.routerMetadataDigest, "routerMetadataDigest");
  validateMetadataReadCostEvent(
    candidate.metadataReadCostEvent,
    candidate.routePath === "openrouter",
  );
  if (
    (candidate.routePath === "gemini_direct" &&
      (candidate.generationMetadataDigest !== null ||
        candidate.routerMetadataDigest !== null ||
        candidate.metadataReadCostEvent !== null)) ||
    (candidate.routePath === "openrouter" &&
      (candidate.generationMetadataDigest === null ||
        candidate.routerMetadataDigest === null))
  ) {
    throw new Error("Qualification generation metadata binding is invalid.");
  }
  safeIdentity(candidate.requestedProviderId, "requestedProviderId");
  safeIdentity(candidate.requestedModelId, "requestedModelId");
  safeIdentity(candidate.servedProviderId, "servedProviderId");
  safeIdentity(candidate.servedModelId, "servedModelId");
  if (
    candidate.identityBasis !==
    (candidate.routePath === "gemini_direct"
      ? "provider_reported_alias_direct_google_endpoint"
      : "provider_reported_alias_generation_metadata")
  ) {
    throw new Error("Qualification identity basis is invalid.");
  }
  finiteInteger(candidate.inputTokens, "inputTokens");
  finiteInteger(candidate.outputTokens, "outputTokens");
  if (candidate.outputTokens > MAX_OUTPUT_TOKENS) {
    throw new Error("Qualification output token limit was exceeded.");
  }
  finiteInteger(candidate.searchQueryCount, "searchQueryCount");
  safeIdentity(candidate.finishReason, "finishReason");
  if (
    (candidate.routePath === "gemini_direct" &&
      candidate.finishReason !== "STOP") ||
    (candidate.routePath === "openrouter" && candidate.finishReason !== "stop")
  ) {
    throw new Error("Qualification finish reason is invalid.");
  }
  if (
    !new Set(["provider_reported", "conservative_estimate"]).has(
      candidate.costState,
    )
  ) {
    throw new Error("Qualification cost state is invalid.");
  }
  money(candidate.costAmountUsd, "costAmountUsd");
  if (
    candidate.currency !== "USD" ||
    candidate.pricingVersion !== "gemini-3.6-conservative-upper.2026-08-16"
  ) {
    throw new Error("Qualification pricing identity is invalid.");
  }
  safeUrls(candidate.sourceUrls);
  if (
    candidate.endpointCatalogDigest !== null &&
    !DIGEST.test(candidate.endpointCatalogDigest)
  ) {
    throw new Error("Qualification endpoint catalog digest is invalid.");
  }
  if (
    !Array.isArray(candidate.officialEvidenceRefs) ||
    candidate.officialEvidenceRefs.length !== OFFICIAL_EVIDENCE_REFS.length ||
    candidate.officialEvidenceRefs.some(
      (entry, index) => entry !== OFFICIAL_EVIDENCE_REFS[index],
    )
  ) {
    throw new Error("Qualification official evidence references drifted.");
  }
  for (const field of ["startedAt", "completedAt"]) {
    if (!Number.isFinite(new Date(candidate[field]).getTime())) {
      throw new Error(`Qualification ${field} is invalid.`);
    }
  }
  const serialized = JSON.stringify(candidate);
  if (
    /api[_-]?key|authorization|bearer|raw[_-]?(?:request|response|payload)|choices|candidates|headers/iu.test(
      serialized,
    )
  ) {
    throw new Error(
      "Qualification evidence contains restricted provider material.",
    );
  }
  return candidate;
}

function prompt() {
  return [
    "This is a benign synthetic qualification request containing no user data.",
    "Using the public IANA example-domain documentation, state why example.com and example.org exist.",
    "Return only the requested JSON object. Do not include personal data.",
  ].join(" ");
}

function conservativeCost(inputTokens, outputTokens, searchQueryCount) {
  return money(
    (inputTokens * 1.5) / 1_000_000 +
      (outputTokens * 7.5) / 1_000_000 +
      (searchQueryCount * 14) / 1000,
    "conservative qualification cost",
  );
}

export function buildGeminiQualificationRequest(route) {
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt() }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: OUTPUT_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  });
  return Object.freeze({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(route.requestedModelId)}:generateContent`,
    body,
    requestDigest: sha256(body),
  });
}

export function buildOpenRouterQualificationRequest(route) {
  const provider = Object.freeze({
    zdr: true,
    data_collection: "deny",
    only: ["google-vertex"],
    order: ["google-vertex"],
    require_parameters: true,
    allow_fallbacks: false,
  });
  const body = JSON.stringify({
    model: route.requestedModelId,
    provider,
    messages: [
      { role: "user", content: prompt() },
      {
        role: "user",
        content:
          "Sanitized public evidence: IANA reserves example.com and example.org for documentation and illustrative examples. Source: https://www.iana.org/help/example-domains",
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "matchbase_slice3_qualification",
        strict: true,
        schema: OUTPUT_SCHEMA,
      },
    },
    max_tokens: MAX_OUTPUT_TOKENS,
  });
  return Object.freeze({
    url: "https://openrouter.ai/api/v1/chat/completions",
    body,
    requestDigest: sha256(body),
    provider,
  });
}

export async function inspectOpenRouterEndpointCatalog(fetchImpl = fetch) {
  const response = await fetchImpl(
    "https://openrouter.ai/api/v1/models/google/gemini-3.6-flash/endpoints",
    { method: "GET", redirect: "error" },
  );
  const catalog = await readBoundedJson(response);
  if (!response.ok)
    throw new Error("OpenRouter endpoint catalog is unavailable.");
  const endpoints = catalog?.data?.endpoints;
  if (!Array.isArray(endpoints))
    throw new Error("OpenRouter endpoint catalog is malformed.");
  const eligible = endpoints.filter((endpoint) => {
    const promptPrice = Number(endpoint?.pricing?.prompt);
    const completionPrice = Number(endpoint?.pricing?.completion);
    const webSearchPrice = Number(endpoint?.pricing?.web_search);
    return (
      typeof endpoint?.tag === "string" &&
      endpoint.tag.startsWith("google-vertex/") &&
      Array.isArray(endpoint.supported_parameters) &&
      ["max_tokens", "response_format", "structured_outputs"].every(
        (parameter) => endpoint.supported_parameters.includes(parameter),
      ) &&
      Number.isFinite(promptPrice) &&
      promptPrice > 0 &&
      promptPrice <= 0.0000015 &&
      Number.isFinite(completionPrice) &&
      completionPrice > 0 &&
      completionPrice <= 0.0000075 &&
      Number.isFinite(webSearchPrice) &&
      webSearchPrice > 0 &&
      webSearchPrice <= 0.014
    );
  });
  if (eligible.length === 0)
    throw new Error("No eligible Google Vertex endpoint is advertised.");
  const zdrResponse = await fetchImpl(
    "https://openrouter.ai/api/v1/endpoints/zdr",
    { method: "GET", redirect: "error" },
  );
  const zdrCatalog = await readBoundedJson(zdrResponse);
  if (!zdrResponse.ok)
    throw new Error("OpenRouter ZDR endpoint catalog is unavailable.");
  const zdrEndpoints = zdrCatalog?.data;
  if (!Array.isArray(zdrEndpoints))
    throw new Error("OpenRouter ZDR endpoint catalog is malformed.");
  const eligibleTags = new Set(eligible.map((endpoint) => endpoint.tag));
  const verifiedZdr = zdrEndpoints.filter(
    (endpoint) =>
      endpoint?.model_id === "google/gemini-3.6-flash" &&
      typeof endpoint?.tag === "string" &&
      eligibleTags.has(endpoint.tag) &&
      endpoint.tag.startsWith("google-vertex/"),
  );
  if (verifiedZdr.length === 0) {
    throw new Error("No eligible Google Vertex ZDR endpoint is advertised.");
  }
  const sanitized = eligible.map((endpoint) => ({
    tag: endpoint.tag,
    providerName: endpoint.provider_name,
    supportedParameters: [...endpoint.supported_parameters].sort(),
    promptPrice: endpoint.pricing?.prompt,
    completionPrice: endpoint.pricing?.completion,
    webSearchPrice: endpoint.pricing?.web_search,
  }));
  return Object.freeze({
    digest: sha256(
      JSON.stringify({
        endpoints: sanitized,
        verifiedZdrTags: verifiedZdr.map((endpoint) => endpoint.tag).sort(),
      }),
    ),
    eligibleCount: eligible.length,
    verifiedZdrCount: verifiedZdr.length,
  });
}

function baseEvidence(route, requestDigest, startedAt) {
  return {
    routePath: route.path,
    routeId: route.routeId,
    terminalDisposition: "PASS",
    reasonCode: "QUALIFICATION_ROUTE_PASSED",
    requestDigest,
    responseContentDigest: "0".repeat(64),
    providerRequestIdDigest: null,
    generationMetadataDigest: null,
    routerMetadataDigest: null,
    metadataReadCostEvent: null,
    requestedProviderId: route.providerId,
    requestedModelId: route.requestedModelId,
    servedProviderId: route.providerId,
    servedModelId: route.expectedServedModelId,
    identityBasis:
      route.path === "gemini_direct"
        ? "provider_reported_alias_direct_google_endpoint"
        : "provider_reported_alias_generation_metadata",
    inputTokens: 0,
    outputTokens: 0,
    searchQueryCount: 0,
    finishReason: "STOP",
    costState: "conservative_estimate",
    costAmountUsd: 0.000000001,
    currency: "USD",
    pricingVersion: "gemini-3.6-conservative-upper.2026-08-16",
    sourceUrls: ["https://www.iana.org/help/example-domains"],
    endpointCatalogDigest: null,
    officialEvidenceRefs: [...OFFICIAL_EVIDENCE_REFS],
    startedAt,
    completedAt: startedAt,
  };
}

function failureTracker(route, requestDigest) {
  return {
    reasonCode:
      route.path === "gemini_direct"
        ? "DIRECT_ROUTE_NOT_PASSED"
        : "OPENROUTER_ROUTE_NOT_PASSED",
    phase: "PRE_SEND",
    httpStatus: null,
    callOccurred: false,
    servedProviderId: null,
    servedModelId: null,
    inputTokens: null,
    outputTokens: null,
    searchQueryCount: null,
    finishReason: null,
    costState: "unknown",
    costAmountUsd: null,
    requestDigest,
    responseContentDigest: null,
    providerRequestIdDigest: null,
    generationMetadataDigest: null,
    routerMetadataDigest: null,
    metadataReadCostEvent: null,
    endpointCatalogDigest: null,
    recordedAt: new Date().toISOString(),
  };
}

function throwSanitizedFailure(tracker) {
  tracker.reasonCode = `QUALIFICATION_${tracker.phase}_FAILED`;
  tracker.recordedAt = new Date().toISOString();
  throw new SanitizedQualificationCallError(tracker);
}

function safeObservedIdentity(value) {
  return typeof value === "string" && SAFE_ID.test(value) ? value : null;
}

function safeObservedInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function sanitizeOpenRouterRoutingMetadata(value) {
  const metadata = exactKeys(
    value,
    new Set([
      "requested",
      "strategy",
      "attempt",
      "endpoints",
      "attempts",
      "pipeline",
    ]),
    "OpenRouter routing metadata",
  );
  const endpoints = exactKeys(
    metadata.endpoints,
    new Set(["total", "available"]),
    "OpenRouter routing endpoints",
  );
  if (
    !Array.isArray(endpoints.available) ||
    endpoints.total !== endpoints.available.length ||
    endpoints.available.length === 0
  ) {
    throw new Error("OpenRouter routing endpoint set is invalid.");
  }
  const available = endpoints.available.map((entry) =>
    exactKeys(
      entry,
      new Set(["provider", "model", "selected"]),
      "OpenRouter available endpoint",
    ),
  );
  const selected = available.filter((entry) => entry.selected === true);
  const attempts = metadata.attempts ?? [];
  if (
    metadata.requested !== OPENROUTER_REQUESTED_MODEL ||
    metadata.strategy !== "direct" ||
    metadata.attempt !== 1 ||
    selected.length !== 1 ||
    available.some(
      (entry) =>
        entry.provider !== OPENROUTER_SERVED_PROVIDER ||
        entry.model !== OPENROUTER_SERVED_MODEL ||
        typeof entry.selected !== "boolean",
    ) ||
    !Array.isArray(attempts) ||
    attempts.length > 1 ||
    (metadata.pipeline !== undefined &&
      (!Array.isArray(metadata.pipeline) || metadata.pipeline.length !== 0))
  ) {
    throw new Error("OpenRouter routing metadata is invalid.");
  }
  if (attempts.length === 1) {
    const attempt = exactKeys(
      attempts[0],
      new Set(["provider", "model", "status"]),
      "OpenRouter routing attempt",
    );
    if (
      attempt.provider !== OPENROUTER_SERVED_PROVIDER ||
      attempt.model !== OPENROUTER_SERVED_MODEL ||
      attempt.status !== 200
    ) {
      throw new Error("OpenRouter routing attempt is invalid.");
    }
  }
  return {
    requestedModel: metadata.requested,
    strategy: metadata.strategy,
    attempt: metadata.attempt,
    provider: selected[0].provider,
    model: selected[0].model,
    available: available.length,
    attempts: attempts.length,
  };
}

export async function executeGeminiQualificationCall({
  route,
  secret,
  fetchImpl = fetch,
}) {
  const request = buildGeminiQualificationRequest(route);
  const startedAt = new Date().toISOString();
  const failure = failureTracker(route, request.requestDigest);
  try {
    failure.callOccurred = true;
    const envelope = await oneJsonPost({
      url: request.url,
      headers: { "x-goog-api-key": secret },
      body: request.body,
      fetchImpl,
      onPhase: (phase, status) => {
        failure.phase = phase;
        failure.httpStatus = status;
      },
    });
    failure.responseContentDigest = sha256(JSON.stringify(envelope));
    failure.providerRequestIdDigest =
      typeof envelope.responseId === "string"
        ? sha256(envelope.responseId)
        : null;
    failure.servedProviderId = "google";
    failure.servedModelId = safeObservedIdentity(envelope.modelVersion);
    const metadata = envelope.usageMetadata ?? {};
    failure.inputTokens = safeObservedInteger(metadata.promptTokenCount);
    const candidateTokens = safeObservedInteger(metadata.candidatesTokenCount);
    const thoughtTokens = safeObservedInteger(metadata.thoughtsTokenCount ?? 0);
    failure.outputTokens =
      candidateTokens === null || thoughtTokens === null
        ? null
        : candidateTokens + thoughtTokens;
    const candidate = envelope?.candidates?.[0];
    failure.finishReason = safeObservedIdentity(candidate?.finishReason);
    const queries = candidate?.groundingMetadata?.webSearchQueries ?? [];
    failure.searchQueryCount = Array.isArray(queries) ? queries.length : null;
    if (
      failure.inputTokens !== null &&
      failure.outputTokens !== null &&
      failure.searchQueryCount !== null
    ) {
      failure.costState = "conservative_estimate";
      failure.costAmountUsd = conservativeCost(
        failure.inputTokens,
        failure.outputTokens,
        failure.searchQueryCount,
      );
    }
    failure.phase = "IDENTITY";
    if (
      failure.servedProviderId !== "google" ||
      failure.servedModelId !== route.expectedServedModelId
    ) {
      throw new Error("identity");
    }
    failure.phase = "FINISH_REASON";
    if (failure.finishReason !== "STOP") throw new Error("finish");
    failure.phase = "USAGE";
    const inputTokens = finiteInteger(
      failure.inputTokens,
      "Gemini input tokens",
    );
    const outputTokens = finiteInteger(
      failure.outputTokens,
      "Gemini output tokens",
    );
    if (outputTokens > MAX_OUTPUT_TOKENS) throw new Error("output limit");
    failure.phase = "SEARCH_GROUNDING";
    const sourceUrls = (candidate?.groundingMetadata?.groundingChunks ?? [])
      .map((chunk) => chunk?.web?.uri)
      .filter((uri) => typeof uri === "string");
    if (failure.searchQueryCount !== 1 || sourceUrls.length === 0) {
      throw new Error("grounding");
    }
    failure.phase = "RESPONSE_PARSE";
    const content = parseJsonText(candidate?.content?.parts?.[0]?.text);
    const evidence = {
      ...baseEvidence(route, request.requestDigest, startedAt),
      responseContentDigest: sha256(JSON.stringify(content)),
      providerRequestIdDigest: failure.providerRequestIdDigest,
      servedProviderId: "google",
      servedModelId: failure.servedModelId,
      inputTokens,
      outputTokens,
      searchQueryCount: failure.searchQueryCount,
      finishReason: "STOP",
      costAmountUsd: failure.costAmountUsd,
      sourceUrls: safeUrls(sourceUrls),
      completedAt: new Date().toISOString(),
    };
    failure.phase = "EVIDENCE_VALIDATION";
    validateSanitizedQualificationEvidence(evidence);
    return Object.freeze(evidence);
  } catch (error) {
    if (error instanceof SanitizedQualificationCallError) throw error;
    throwSanitizedFailure(failure);
  }
}

export async function executeOpenRouterQualificationCall({
  route,
  secret,
  fetchImpl = fetch,
}) {
  const request = buildOpenRouterQualificationRequest(route);
  const startedAt = new Date().toISOString();
  const failure = failureTracker(route, request.requestDigest);
  try {
    const catalog = await inspectOpenRouterEndpointCatalog(fetchImpl);
    failure.endpointCatalogDigest = catalog.digest;
    failure.callOccurred = true;
    let headerGenerationId = null;
    const envelope = await oneJsonPost({
      url: request.url,
      headers: {
        Authorization: `Bearer ${secret}`,
        "X-OpenRouter-Metadata": "enabled",
      },
      body: request.body,
      fetchImpl,
      onPhase: (phase, status) => {
        failure.phase = phase;
        failure.httpStatus = status;
      },
      onResponse: (response) => {
        headerGenerationId = response.headers.get("x-generation-id");
      },
    });
    failure.responseContentDigest = sha256(JSON.stringify(envelope));
    failure.routerMetadataDigest = sha256(
      JSON.stringify(
        sanitizeOpenRouterRoutingMetadata(envelope.openrouter_metadata),
      ),
    );
    const bodyGenerationId = safeObservedIdentity(envelope.id);
    const safeHeaderGenerationId = safeObservedIdentity(headerGenerationId);
    if (
      (bodyGenerationId === null && safeHeaderGenerationId === null) ||
      (bodyGenerationId !== null &&
        safeHeaderGenerationId !== null &&
        bodyGenerationId !== safeHeaderGenerationId)
    ) {
      throw new Error("generation identity");
    }
    const generationId = bodyGenerationId ?? safeHeaderGenerationId;
    failure.providerRequestIdDigest = sha256(generationId);
    failure.servedModelId = safeObservedIdentity(envelope.model);
    failure.inputTokens = safeObservedInteger(envelope?.usage?.prompt_tokens);
    failure.outputTokens = safeObservedInteger(
      envelope?.usage?.completion_tokens,
    );
    failure.searchQueryCount = 0;
    failure.finishReason = safeObservedIdentity(
      envelope?.choices?.[0]?.finish_reason,
    );
    const reported = Number(envelope?.usage?.cost);
    if (Number.isFinite(reported) && reported > 0) {
      failure.costState = "provider_reported";
      failure.costAmountUsd = money(reported, "OpenRouter reported cost");
    }
    const metadataEnvelope = await oneJsonGet({
      url: `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`,
      headers: { Authorization: `Bearer ${secret}` },
      fetchImpl,
      onPhase: (phase, status) => {
        failure.phase = phase;
        failure.httpStatus = status;
      },
    });
    const metadata = metadataEnvelope?.data;
    const sanitizedMetadata = {
      idDigest: typeof metadata?.id === "string" ? sha256(metadata.id) : null,
      providerName:
        metadata?.provider_name === OPENROUTER_SERVED_PROVIDER
          ? OPENROUTER_SERVED_PROVIDER
          : null,
      model: safeObservedIdentity(metadata?.model),
      finishReason: safeObservedIdentity(metadata?.finish_reason),
      inputTokens: safeObservedInteger(metadata?.tokens_prompt),
      outputTokens: safeObservedInteger(metadata?.tokens_completion),
      totalCostUsd:
        Number.isFinite(Number(metadata?.total_cost)) &&
        Number(metadata.total_cost) > 0
          ? money(metadata.total_cost, "OpenRouter metadata cost")
          : null,
    };
    failure.generationMetadataDigest = sha256(
      JSON.stringify(sanitizedMetadata),
    );
    failure.metadataReadCostEvent = {
      capability: "OPENROUTER_GENERATION_METADATA_READ",
      calls: 1,
      amountUsd: 0,
      currency: "USD",
      costState: "explicit_zero",
    };
    failure.servedProviderId =
      sanitizedMetadata.providerName === OPENROUTER_SERVED_PROVIDER
        ? OPENROUTER_PROVIDER_ALIAS
        : null;
    if (
      sanitizedMetadata.idDigest !== failure.providerRequestIdDigest ||
      failure.servedProviderId !== OPENROUTER_PROVIDER_ALIAS ||
      sanitizedMetadata.model !== OPENROUTER_SERVED_MODEL ||
      sanitizedMetadata.finishReason !== failure.finishReason ||
      sanitizedMetadata.inputTokens !== failure.inputTokens ||
      sanitizedMetadata.outputTokens !== failure.outputTokens ||
      sanitizedMetadata.totalCostUsd !== failure.costAmountUsd
    ) {
      throw new Error("generation metadata mismatch");
    }
    failure.phase = "IDENTITY";
    if (
      failure.servedModelId !== OPENROUTER_SERVED_MODEL ||
      route.providerId !== OPENROUTER_PROVIDER_ALIAS ||
      route.requestedModelId !== OPENROUTER_REQUESTED_MODEL ||
      route.expectedServedModelId !== OPENROUTER_SERVED_MODEL
    ) {
      throw new Error("identity");
    }
    failure.phase = "FINISH_REASON";
    if (failure.finishReason !== "stop") throw new Error("finish");
    failure.phase = "USAGE";
    const inputTokens = finiteInteger(
      failure.inputTokens,
      "OpenRouter input tokens",
    );
    const outputTokens = finiteInteger(
      failure.outputTokens,
      "OpenRouter output tokens",
    );
    if (outputTokens > MAX_OUTPUT_TOKENS) throw new Error("output limit");
    failure.phase = "COST";
    if (failure.costAmountUsd === null) throw new Error("cost");
    failure.phase = "RESPONSE_PARSE";
    const content = parseJsonText(envelope?.choices?.[0]?.message?.content);
    const evidence = {
      ...baseEvidence(route, request.requestDigest, startedAt),
      responseContentDigest: sha256(JSON.stringify(content)),
      providerRequestIdDigest: failure.providerRequestIdDigest,
      generationMetadataDigest: failure.generationMetadataDigest,
      routerMetadataDigest: failure.routerMetadataDigest,
      metadataReadCostEvent: failure.metadataReadCostEvent,
      servedProviderId: OPENROUTER_PROVIDER_ALIAS,
      servedModelId: OPENROUTER_SERVED_MODEL,
      inputTokens,
      outputTokens,
      searchQueryCount: 0,
      finishReason: "stop",
      costState: failure.costState,
      costAmountUsd: failure.costAmountUsd,
      endpointCatalogDigest: catalog.digest,
      completedAt: new Date().toISOString(),
    };
    failure.phase = "EVIDENCE_VALIDATION";
    validateSanitizedQualificationEvidence(evidence);
    return Object.freeze(evidence);
  } catch (error) {
    if (error instanceof SanitizedQualificationCallError) throw error;
    throwSanitizedFailure(failure);
  }
}

export function qualificationWorstCaseCostUsd() {
  const perRoute =
    (4096 * 1.5) / 1_000_000 + (MAX_OUTPUT_TOKENS * 7.5) / 1_000_000;
  return Number((perRoute * 2 + 14 / 1000).toFixed(9));
}

export async function executeAuthorizedQualification(options) {
  if (
    options.preflight?.disposition !== "READY_TO_QUALIFY" ||
    options.preflight?.schemaVersion !==
      "slice3-live-qualification-preflight.v4" ||
    options.budget?.maxCalls !== MAX_CALLS ||
    options.budget?.maxCostUsd !== MAX_COST_USD
  ) {
    throw new Error("Authorized qualification preflight or budget is invalid.");
  }
  const recomputedBinding = await createQualificationAuthorizationBinding({
    ownerDecisionFile: options.ownerDecisionFile,
    policyFile: options.policyFile,
    policy: options.policy,
    stateDirectory: options.stateDirectory,
  });
  const preflightBinding = requireAuthorizedQualificationBinding(
    options.preflight.authorizationBinding,
  );
  if (JSON.stringify(preflightBinding) !== JSON.stringify(recomputedBinding)) {
    throw new Error("Qualification preflight authorization binding drifted.");
  }
  const worstCase = qualificationWorstCaseCostUsd();
  if (worstCase <= 0 || worstCase > options.budget.maxCostUsd) {
    throw new Error("Qualification worst-case cost exceeds authorization.");
  }
  const routes = options.policy?.routes;
  if (
    !Array.isArray(routes) ||
    routes.length !== MAX_CALLS ||
    routes[0]?.path !== "gemini_direct" ||
    routes[1]?.path !== "openrouter"
  ) {
    throw new Error("Authorized qualification route order is invalid.");
  }
  const session = await createDurableQualificationSession({
    stateDirectory: options.stateDirectory,
    routeIds: routes.map((route) => route.routeId),
    authorizationBinding: recomputedBinding,
  });
  const credentials = validateCredentialObject(
    options.credentials ??
      (await readCanonicalCredentials(options.credentialFile)),
  );
  const startingState = await session.read();
  const failures = [];
  for (const route of routes) {
    const existing = startingState.routes.find(
      (entry) => entry.routeId === route.routeId,
    );
    if (existing?.state === "PASSED") continue;
    if (existing?.state !== "AVAILABLE") {
      failures.push(
        route.path === "gemini_direct"
          ? "DIRECT_ROUTE_NOT_RESUMABLE"
          : "OPENROUTER_ROUTE_NOT_RESUMABLE",
      );
      continue;
    }
    const request =
      route.path === "gemini_direct"
        ? buildGeminiQualificationRequest(route)
        : buildOpenRouterQualificationRequest(route);
    let reserved = false;
    try {
      await session.reserve(route.routeId, request.requestDigest);
      reserved = true;
      const evidence =
        route.path === "gemini_direct"
          ? await executeGeminiQualificationCall({
              route,
              secret: credentials.MATCHBASE_GEMINI_API_KEY,
              fetchImpl: options.fetchImpl ?? fetch,
            })
          : await executeOpenRouterQualificationCall({
              route,
              secret: credentials.MATCHBASE_OPENROUTER_API_KEY,
              fetchImpl: options.fetchImpl ?? fetch,
            });
      await session.record(route.routeId, evidence);
    } catch (error) {
      const reasonCode =
        route.path === "gemini_direct"
          ? "DIRECT_ROUTE_NOT_PASSED"
          : "OPENROUTER_ROUTE_NOT_PASSED";
      failures.push(reasonCode);
      if (reserved) {
        try {
          const failure =
            error instanceof SanitizedQualificationCallError
              ? error.failure
              : {
                  ...failureTracker(route, request.requestDigest),
                  reasonCode,
                };
          await session.recordFailure(route.routeId, failure);
        } catch {
          failures.push(`${reasonCode}_FAILURE_LEDGER_UNCLOSED`);
        }
      }
    }
  }
  let finalState = await session.read();
  if (
    failures.length === 0 &&
    !finalState.finalized &&
    finalState.routes.every((route) => route.state === "PASSED")
  ) {
    finalState = await session.finalize();
  }
  const passed =
    failures.length === 0 &&
    finalState.finalized &&
    finalState.routes.every((route) => route.state === "PASSED");
  return Object.freeze({
    schemaVersion: "slice3-live-qualification-execution.v3",
    disposition: passed ? "PASS" : "FAIL",
    authorizationId: AUTHORIZATION_ID,
    callsConsumed: finalState.routes.filter(
      (route) => route.state !== "AVAILABLE",
    ).length,
    routeStates: Object.freeze(
      finalState.routes.map((route) =>
        Object.freeze({ routeId: route.routeId, state: route.state }),
      ),
    ),
    failures: Object.freeze(failures),
    worstCaseCostUsd: worstCase,
    totalCostUsd: finalState.totalCostUsd ?? null,
    stateFileName: basename(session.statePath),
    credentialValuesDisclosed: false,
    rawProviderPayloadPersisted: false,
  });
}

export function validateFinalizedQualificationSession(state, policy) {
  if (
    !state ||
    state.schemaVersion !== "slice3-live-qualification-authorization.v3" ||
    state.authorizationId !== AUTHORIZATION_ID ||
    state.maxCalls !== MAX_CALLS ||
    state.maxCostUsd !== MAX_COST_USD ||
    state.syntheticOnly !== true ||
    state.finalized !== true ||
    state.totalCalls !== MAX_CALLS ||
    !Number.isFinite(state.totalCostUsd) ||
    state.totalCostUsd <= 0 ||
    state.totalCostUsd > MAX_COST_USD ||
    !Array.isArray(state.routes) ||
    state.routes.length !== MAX_CALLS
  ) {
    throw new Error("Finalized qualification session is invalid.");
  }
  if (
    !policy ||
    policy.liveActivation !== "blocked" ||
    !Array.isArray(policy.routes) ||
    policy.routes.length !== MAX_CALLS
  ) {
    throw new Error("Qualification policy is not the frozen blocked policy.");
  }
  let totalCost = 0;
  for (let index = 0; index < MAX_CALLS; index += 1) {
    const sessionRoute = state.routes[index];
    const policyRoute = policy.routes[index];
    if (
      sessionRoute.state !== "PASSED" ||
      sessionRoute.routeId !== policyRoute.routeId ||
      sessionRoute.callNumber !== index + 1 ||
      !sessionRoute.result
    ) {
      throw new Error("Qualification session route binding is invalid.");
    }
    const evidence = validateSanitizedQualificationEvidence(
      sessionRoute.result,
    );
    if (
      evidence.routeId !== policyRoute.routeId ||
      evidence.routePath !== policyRoute.path ||
      evidence.requestedProviderId !== policyRoute.providerId ||
      evidence.requestedModelId !== policyRoute.requestedModelId ||
      evidence.servedProviderId !==
        (policyRoute.path === "openrouter"
          ? OPENROUTER_PROVIDER_ALIAS
          : policyRoute.providerId) ||
      evidence.servedModelId !==
        (policyRoute.path === "openrouter"
          ? OPENROUTER_SERVED_MODEL
          : policyRoute.expectedServedModelId) ||
      evidence.requestDigest !== sessionRoute.requestDigest ||
      evidence.terminalDisposition !== "PASS" ||
      (policyRoute.path === "gemini_direct" &&
        evidence.searchQueryCount !== 1) ||
      (policyRoute.path === "openrouter" &&
        (evidence.searchQueryCount !== 0 ||
          evidence.costState !== "provider_reported" ||
          evidence.endpointCatalogDigest === null))
    ) {
      throw new Error(
        "Qualification evidence does not match its frozen route.",
      );
    }
    totalCost += evidence.costAmountUsd;
  }
  if (Number(totalCost.toFixed(9)) !== state.totalCostUsd) {
    throw new Error("Qualification aggregate cost binding is invalid.");
  }
  return state;
}

export function validateFinalizedQualificationAttestation(attestation, policy) {
  const binding =
    attestation && typeof attestation === "object"
      ? FINALIZED_ATTESTATION_BINDINGS.get(attestation)
      : undefined;
  if (
    !attestation ||
    typeof attestation !== "object" ||
    !FINALIZED_ATTESTATIONS.has(attestation) ||
    !binding ||
    attestation.schemaVersion !== "slice3-live-qualification-attestation.v3" ||
    attestation.authorizationId !== AUTHORIZATION_ID ||
    !DIGEST.test(attestation.ledgerDigest) ||
    !DIGEST.test(attestation.stateDigest) ||
    attestation.ledgerDigest !== binding.ledgerDigest ||
    attestation.stateDigest !== binding.stateDigest ||
    sha256(JSON.stringify(attestation.state)) !== binding.stateDigest ||
    !Object.isFrozen(attestation) ||
    !Object.isFrozen(attestation.state)
  ) {
    throw new Error(
      "Qualification activation requires a ledger-backed attestation.",
    );
  }
  return validateFinalizedQualificationSession(attestation.state, policy);
}

export const SLICE3_LIVE_QUALIFICATION_CONSTANTS = Object.freeze({
  authorizationId: AUTHORIZATION_ID,
  sessionId: `session-${sha256(AUTHORIZATION_ID).slice(0, 24)}`,
  v1AuthorizationId: V1_AUTHORIZATION_ID,
  v2AuthorizationId: V2_AUTHORIZATION_ID,
  v3AuthorizationSignal: V3_AUTHORIZATION_SIGNAL,
  ownerDecisionDigest: EXPECTED_OWNER_DECISION_DIGEST,
  expectedPolicyDigest: EXPECTED_POLICY_DIGEST,
  expectedConsumedV1LedgerDigest: EXPECTED_CONSUMED_V1_LEDGER_DIGEST,
  expectedConsumedV2LedgerDigest: EXPECTED_CONSUMED_V2_LEDGER_DIGEST,
  expectedPreCallStateDigest: EXPECTED_PRECALL_STATE_DIGEST,
  preCallManifest: deepFreeze(exactPreCallManifest()),
  maxCalls: MAX_CALLS,
  maxCostUsd: MAX_COST_USD,
  officialEvidenceRefs: OFFICIAL_EVIDENCE_REFS,
  outputSchema: OUTPUT_SCHEMA,
});
