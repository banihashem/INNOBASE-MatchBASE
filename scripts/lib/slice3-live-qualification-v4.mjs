import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const PM_ROOT = "C:\\INNOBASE\\MatchBASE\\01_Product_Management";
const STATE_ROOT = join(PM_ROOT, ".slice3-live-qualification-state");
const V3_SESSION_ID = "session-19AD2D3117AF9064AF90F879";
const V4_SESSION_ID = "session-3DD21321009BFABD87CB1904";
const V4_AUTHORIZATION_ID =
  "PO-001-SLICE3-LIVE-QUALIFICATION-REPLACEMENT-2026-08-18-V4";
const V4_SIGNAL = "I_AUTHORIZE_TWO_REPLACEMENT_BILLABLE_SYNTHETIC_CALLS_V4";
const OWNER_FILE = join(
  PM_ROOT,
  "OWNER_DECISION_AND_ROLE2_ALLOCATION_PO_001_SLICE_3_LIVE_QUALIFICATION_V4.md",
);
const PREFLIGHT_FILE = join(
  PM_ROOT,
  "ROLE3_SLICE_3_OPENROUTER_CREDENTIAL_PREFLIGHT_V4.json",
);
const POLICY_FILE = resolve("config/slice3/research-route-policy.v1.json");
const OWNER_DIGEST =
  "5FCDF1EEB703F0B5F976AF2DAB5B4786818AFD6708ED8AE6063F4349885CD9EE";
const PREFLIGHT_DIGEST =
  "144E77DE086FF53BFE2FCDD75A4CA750951C4026EA10ECF41FCAE983F9B87C08";
const POLICY_DIGEST =
  "46FCAF0C2D2B66F8BAB8526C48E448A24B2E9F65B065AAA99135CA6AF048DB23";
const V1_LEDGER_DIGEST =
  "D26108B406EBB23615E9A181ADBC40FED85EDFEE504D7BA144A7BC2277930FA8";
const V2_LEDGER_DIGEST =
  "DB247B6E332F02D38E0355B6359F7A3A72A7C02D64A23B6A7B33212D423EF748";
const V3_LEDGER_DIGEST =
  "3030B12726EB31DA43BBEBD19E9D5C0E819AB5857371FBC843CF3F7D759F7BC8";
const DIGEST = /^[A-F0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const V3_MANIFEST = Object.freeze([
  Object.freeze({
    name: "00-authorization.json",
    digest: "9C5A3489035F371685F852A13B0CB578745BBBB3EB673E079C9CFB44B2F7D890",
  }),
  Object.freeze({
    name: "01-reserved.json",
    digest: "AA62614A9936D071ECDE5284C4618A7111CF2EE4B8434FF8A308B7C3D8A5E6B9",
  }),
  Object.freeze({
    name: "01-result.json",
    digest: "BAF6AA089BD8BDDB6B2CE7CC32FF804A5E8A1C759E453A9994D80728BC7BC2BC",
  }),
  Object.freeze({
    name: "02-reserved.json",
    digest: "101AF85031C002AAB59BB73221771C80F559DFF2A0A89C638744C6FFA3A09161",
  }),
  Object.freeze({
    name: "02-result.json",
    digest: "09E4CF8E7176A8E5FADA216637D4983748D78FE2C761B1F5DD5B38AB9B67F265",
  }),
]);
const SOURCE_BINDINGS = new WeakSet();
const READY_CAPABILITIES = new WeakMap();
const SESSION_CAPABILITIES = new WeakMap();
const CREDENTIAL_FILE = resolve("APIKeys.md");
const CANONICAL_INITIALIZER = Symbol("canonical-v4-initializer");
const GEMINI_V4_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["fixtureId", "answer", "sourceSummary"],
  properties: {
    fixtureId: {
      type: "string",
      enum: ["S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN"],
    },
    answer: { type: "string", minLength: 1, maxLength: 500 },
    sourceSummary: { type: "string", minLength: 1, maxLength: 500 },
  },
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} is not closed.`);
  }
  return value;
}

async function requireRegularContainedFile(path, root) {
  const rootReal = await realpath(root);
  const item = await lstat(path);
  if (!item.isFile() || item.isSymbolicLink()) {
    throw new Error("Qualification source is not a regular file.");
  }
  const fileReal = await realpath(path);
  const rel = relative(rootReal, fileReal);
  if (!rel || rel.startsWith("..") || resolve(rootReal, rel) !== fileReal) {
    throw new Error("Qualification source escaped its root.");
  }
  return readFile(fileReal);
}

export async function verifyImmutableV3Ledger(stateRoot = STATE_ROOT) {
  const sessionDirectory = join(stateRoot, V3_SESSION_ID);
  const names = (await readdir(sessionDirectory)).sort();
  const expectedNames = V3_MANIFEST.map(({ name }) => name);
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error("Immutable V3 ledger file set drifted.");
  }
  const actual = [];
  for (const expected of V3_MANIFEST) {
    const bytes = await requireRegularContainedFile(
      join(sessionDirectory, expected.name),
      sessionDirectory,
    );
    const digest = sha256(bytes);
    if (digest !== expected.digest) {
      throw new Error(`Immutable V3 ledger byte drift: ${expected.name}.`);
    }
    actual.push({ name: expected.name, digest });
  }
  const ledgerDigest = sha256(JSON.stringify(actual));
  if (ledgerDigest !== V3_LEDGER_DIGEST) {
    throw new Error("Immutable V3 ledger manifest digest drifted.");
  }
  return Object.freeze({
    sessionId: V3_SESSION_ID,
    ledgerDigest,
    files: Object.freeze(actual.map((entry) => Object.freeze(entry))),
  });
}

function validateObservedCredentialPreflight(value) {
  exactKeys(
    value,
    new Set([
      "schemaVersion",
      "observationSource",
      "endpoint",
      "method",
      "sanitizedEnvelope",
      "sanitizedEnvelopeDigest",
      "disposition",
      "providerModelPosts",
      "billableCalls",
      "additionalAuthorizationGets",
      "requestIdDigest",
      "errorCode",
      "errorType",
      "costState",
      "costAmountUsd",
      "credentialValuePersisted",
      "credentialValueDisclosed",
      "rawResponsePersisted",
      "recordedAt",
    ]),
    "Credential preflight record",
  );
  exactKeys(
    value.sanitizedEnvelope,
    new Set([
      "endpointCapability",
      "httpStatus",
      "callOccurred",
      "responseBodyPersisted",
      "rawHeadersPersisted",
    ]),
    "Credential preflight envelope",
  );
  if (
    value.schemaVersion !== "slice3-openrouter-credential-preflight.v1" ||
    value.observationSource !== "OWNER_MEASURED_CURRENT_FACT" ||
    value.endpoint !== "https://openrouter.ai/api/v1/key" ||
    value.method !== "GET" ||
    value.disposition !== "BLOCKED_CREDENTIAL" ||
    value.sanitizedEnvelope.endpointCapability !==
      "OPENROUTER_KEY_STATUS_READ" ||
    value.sanitizedEnvelope.httpStatus !== 401 ||
    value.sanitizedEnvelope.callOccurred !== true ||
    value.sanitizedEnvelope.responseBodyPersisted !== false ||
    value.sanitizedEnvelope.rawHeadersPersisted !== false ||
    sha256(JSON.stringify(value.sanitizedEnvelope)) !==
      value.sanitizedEnvelopeDigest ||
    value.providerModelPosts !== 0 ||
    value.billableCalls !== 0 ||
    value.additionalAuthorizationGets !== 0 ||
    value.requestIdDigest !== null ||
    value.errorCode !== null ||
    value.errorType !== null ||
    value.costState !== "unknown" ||
    value.costAmountUsd !== null ||
    value.credentialValuePersisted !== false ||
    value.credentialValueDisclosed !== false ||
    value.rawResponsePersisted !== false ||
    !Number.isFinite(Date.parse(value.recordedAt))
  ) {
    throw new Error("Credential preflight record is invalid.");
  }
  return Object.freeze(value);
}

function parseAuthorizationMarker(bytes) {
  const text = bytes.toString("utf8");
  const match = text.match(/<!--SLICE3_V4_AUTHORIZATION:(\{[^\r\n]+\})-->/u);
  if (!match) throw new Error("V4 authorization marker is absent.");
  const marker = JSON.parse(match[1]);
  exactKeys(
    marker,
    new Set([
      "schemaVersion",
      "allocationId",
      "authorizationId",
      "authorizationSignal",
      "sessionId",
      "maxCalls",
      "maxCostUsd",
      "retries",
      "fallbacks",
      "syntheticOnly",
      "restartPolicy",
      "policyDigest",
      "consumedV1LedgerDigest",
      "consumedV2LedgerDigest",
      "consumedV3LedgerDigest",
      "credentialPreflightDigest",
      "currentDisposition",
      "providerModelPosts",
      "v4SessionState",
      "activation",
    ]),
    "V4 authorization marker",
  );
  if (
    marker.schemaVersion !== "slice3-live-qualification-allocation.v4" ||
    marker.authorizationId !== V4_AUTHORIZATION_ID ||
    marker.authorizationSignal !== V4_SIGNAL ||
    marker.sessionId !== V4_SESSION_ID ||
    marker.maxCalls !== 2 ||
    marker.maxCostUsd !== 100 ||
    marker.retries !== 0 ||
    marker.fallbacks !== 0 ||
    marker.syntheticOnly !== true ||
    marker.restartPolicy !== "NON_RESUMABLE_NEW_ALLOCATION_REQUIRED" ||
    marker.policyDigest !== POLICY_DIGEST ||
    marker.consumedV1LedgerDigest !== V1_LEDGER_DIGEST ||
    marker.consumedV2LedgerDigest !== V2_LEDGER_DIGEST ||
    marker.consumedV3LedgerDigest !== V3_LEDGER_DIGEST ||
    marker.credentialPreflightDigest !== PREFLIGHT_DIGEST ||
    marker.currentDisposition !== "BLOCKED_CREDENTIAL" ||
    marker.providerModelPosts !== 0 ||
    marker.v4SessionState !== "ABSENT" ||
    marker.activation !== false
  ) {
    throw new Error("V4 authorization marker drifted.");
  }
  return marker;
}

async function pathAbsent(path) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

export async function verifyV4PrecallAbsenceAt(stateRoot = STATE_ROOT) {
  const sessionDirectory = join(stateRoot, V4_SESSION_ID);
  const paths = [
    sessionDirectory,
    `${sessionDirectory}.authorization.lock`,
    `${sessionDirectory}.run.lock`,
  ];
  if (!(await Promise.all(paths.map(pathAbsent))).every(Boolean)) {
    throw new Error("V4 pre-call session or lock state is not absent.");
  }
  return Object.freeze({
    sessionId: V4_SESSION_ID,
    sessionAbsent: true,
    authorizationLockAbsent: true,
    runLockAbsent: true,
  });
}

export async function createV4SourceBinding() {
  const [ownerBytes, preflightBytes, policyBytes, v3] = await Promise.all([
    requireRegularContainedFile(OWNER_FILE, PM_ROOT),
    requireRegularContainedFile(PREFLIGHT_FILE, PM_ROOT),
    requireRegularContainedFile(POLICY_FILE, dirname(POLICY_FILE)),
    verifyImmutableV3Ledger(),
  ]);
  if (
    sha256(ownerBytes) !== OWNER_DIGEST ||
    sha256(preflightBytes) !== PREFLIGHT_DIGEST ||
    sha256(policyBytes) !== POLICY_DIGEST
  ) {
    throw new Error("V4 source binding drifted.");
  }
  const marker = parseAuthorizationMarker(ownerBytes);
  const preflight = validateObservedCredentialPreflight(
    JSON.parse(preflightBytes.toString("utf8")),
  );
  await verifyV4PrecallAbsenceAt();
  const binding = Object.freeze({
    schemaVersion: "slice3-live-qualification-source-binding.v4",
    authorizationId: V4_AUTHORIZATION_ID,
    sessionId: V4_SESSION_ID,
    ownerDigest: OWNER_DIGEST,
    policyDigest: POLICY_DIGEST,
    credentialPreflightDigest: PREFLIGHT_DIGEST,
    consumedV3LedgerDigest: v3.ledgerDigest,
    currentDisposition: preflight.disposition,
    activation: marker.activation,
  });
  SOURCE_BINDINGS.add(binding);
  return binding;
}

export function assessCurrentV4Disposition(binding) {
  if (!SOURCE_BINDINGS.has(binding)) {
    throw new Error("V4 source binding capability is invalid.");
  }
  return Object.freeze({
    schemaVersion: "slice3-live-qualification-precall.v4",
    disposition: "BLOCKED_CREDENTIAL",
    authorizationId: V4_AUTHORIZATION_ID,
    sessionId: V4_SESSION_ID,
    credentialPreflightHttpStatus: 401,
    credentialRead: false,
    additionalAuthorizationGets: 0,
    providerModelPosts: 0,
    billableCalls: 0,
    sessionCreated: false,
    activation: false,
  });
}

export class GeminiV4OutputError extends Error {
  constructor(phase, telemetry) {
    super(`Gemini V4 output failed at ${phase}.`);
    this.name = "GeminiV4OutputError";
    this.phase = phase;
    this.telemetry = Object.freeze({ ...telemetry, failurePhase: phase });
  }
}

function outputFailure(phase, telemetry) {
  throw new GeminiV4OutputError(phase, telemetry);
}

export function parseGeminiV4Candidate(candidate) {
  const parts = candidate?.content?.parts;
  const telemetry = {
    partCount: Array.isArray(parts) ? parts.length : 0,
    thoughtPartCount: 0,
    signatureOnlyPartCount: 0,
    finalTextPartCount: 0,
    textLength: null,
    textDigest: null,
    rawTextPersisted: false,
  };
  if (!Array.isArray(parts) || parts.length === 0 || parts.length > 32) {
    outputFailure("TEXT_ABSENT", telemetry);
  }
  const finalTexts = [];
  for (const part of parts) {
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      outputFailure("OUTPUT_KEYS", telemetry);
    }
    const keys = Object.keys(part);
    if (
      keys.some(
        (key) => !new Set(["text", "thought", "thoughtSignature"]).has(key),
      ) ||
      ("thought" in part && typeof part.thought !== "boolean") ||
      ("thoughtSignature" in part &&
        typeof part.thoughtSignature !== "string") ||
      ("text" in part && typeof part.text !== "string")
    ) {
      outputFailure("OUTPUT_KEYS", telemetry);
    }
    if (part.thought === true) {
      telemetry.thoughtPartCount += 1;
      continue;
    }
    if (!("text" in part) && "thoughtSignature" in part) {
      telemetry.signatureOnlyPartCount += 1;
      continue;
    }
    if (!("text" in part)) outputFailure("OUTPUT_KEYS", telemetry);
    if (typeof part.text === "string") finalTexts.push(part.text);
  }
  telemetry.finalTextPartCount = finalTexts.length;
  if (finalTexts.length === 0) outputFailure("TEXT_ABSENT", telemetry);
  if (finalTexts.length !== 1) {
    outputFailure("TEXT_PART_CARDINALITY", telemetry);
  }
  const text = finalTexts[0];
  telemetry.textLength = text.length;
  telemetry.textDigest = sha256(text);
  if (text.length === 0 || text.length > 32_768) {
    outputFailure("TEXT_LIMIT", telemetry);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    outputFailure("JSON_SYNTAX", telemetry);
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    JSON.stringify(Object.keys(parsed).sort()) !==
      JSON.stringify(["answer", "fixtureId", "sourceSummary"])
  ) {
    outputFailure("OUTPUT_KEYS", telemetry);
  }
  if (parsed.fixtureId !== "S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN") {
    outputFailure("FIXTURE", telemetry);
  }
  for (const [field, phase] of [
    ["answer", "ANSWER"],
    ["sourceSummary", "SOURCE_SUMMARY"],
  ]) {
    const value = parsed[field];
    if (
      typeof value !== "string" ||
      value !== value.trim() ||
      value.length < 1 ||
      value.length > 500
    ) {
      outputFailure(phase, telemetry);
    }
  }
  return Object.freeze({
    content: Object.freeze({ ...parsed }),
    telemetry: Object.freeze(telemetry),
  });
}

export function buildGeminiV4QualificationRequest(route) {
  if (
    route?.path !== "gemini_direct" ||
    route?.providerId !== "google" ||
    route?.requestedModelId !== "gemini-3.6-flash" ||
    route?.expectedServedModelId !== "gemini-3.6-flash"
  ) {
    throw new Error("Gemini V4 route identity is invalid.");
  }
  const prompt = [
    "This is a benign synthetic qualification request containing no user data.",
    "Using only public IANA example-domain documentation, explain why example.com and example.org exist.",
    "Return exactly one JSON object with exactly these keys: fixtureId, answer, sourceSummary.",
    'Set fixtureId exactly to "S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN".',
    "Set answer and sourceSummary to trimmed nonempty strings of at most 500 characters.",
    "Return no Markdown fence, prefix, suffix, commentary, personal data, or additional key.",
  ].join(" ");
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: GEMINI_V4_OUTPUT_SCHEMA,
      maxOutputTokens: 2048,
    },
  });
  return Object.freeze({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(route.requestedModelId)}:generateContent`,
    body,
    requestDigest: sha256(body),
  });
}

function canonicalCredentialLine(line) {
  const match = line.match(
    /^\s*(?:[-*]\s*)?`?(MATCHBASE_(?:GEMINI|OPENROUTER)_API_KEY)`?\s*[:=]\s*`?([^`\s]+)`?\s*$/u,
  );
  return match ? [match[1], match[2]] : null;
}

async function readCredentialsOnce(path) {
  const text = await readFile(path, "utf8");
  const entries = text
    .split(/\r?\n/u)
    .map(canonicalCredentialLine)
    .filter(Boolean);
  const value = Object.fromEntries(entries);
  if (
    entries.length !== 2 ||
    Object.keys(value).length !== 2 ||
    !value.MATCHBASE_GEMINI_API_KEY ||
    !value.MATCHBASE_OPENROUTER_API_KEY ||
    Object.values(value).some(
      (secret) => secret !== secret.trim() || /[\s\p{Cc}\p{Cf}]/u.test(secret),
    )
  ) {
    throw new Error("Canonical V4 credential file is invalid.");
  }
  return Object.freeze(value);
}

async function boundedResponseBytes(response, timeoutMs = 10_000) {
  const limit = 32_768;
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) {
    throw new Error("Credential response exceeded its declared bound.");
  }
  if (!response.body) throw new Error("Credential response omitted its body.");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  let timeout;
  const timedOut = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("Credential response body timed out."));
      void reader.cancel("credential_body_timeout");
    }, timeoutMs);
    timeout.unref();
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timedOut]);
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel("credential_response_limit");
        throw new Error("Credential response exceeded its streamed bound.");
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function safeOptionalId(value) {
  return typeof value === "string" && SAFE_ID.test(value) ? value : null;
}

function sanitizedNon2xx(status, bytes) {
  let code = null;
  let type = null;
  try {
    const envelope = JSON.parse(
      new TextDecoder("utf8", { fatal: true }).decode(bytes),
    );
    code = safeOptionalId(envelope?.error?.code);
    type = safeOptionalId(envelope?.error?.type);
  } catch {
    // The raw body is intentionally reduced to a digest only.
  }
  const envelope = Object.freeze({
    endpointCapability: "OPENROUTER_KEY_STATUS_READ",
    httpStatus: status,
    callOccurred: true,
    responseBodyDigest: sha256(bytes),
    requestIdDigest: null,
    errorCode: code,
    errorType: type,
    responseBodyPersisted: false,
    rawHeadersPersisted: false,
  });
  return Object.freeze({
    schemaVersion: "slice3-openrouter-credential-probe.v4",
    disposition: "BLOCKED_CREDENTIAL",
    sanitizedEnvelope: envelope,
    sanitizedEnvelopeDigest: sha256(JSON.stringify(envelope)),
    costState: "unknown",
    costAmountUsd: null,
    providerModelPosts: 0,
    credentialValuePersisted: false,
  });
}

export async function reduceCredentialResponseForV4(
  response,
  { timeoutMs = 10_000 } = {},
) {
  const bytes = await boundedResponseBytes(response, timeoutMs);
  if (response.status !== 200) return sanitizedNon2xx(response.status, bytes);
  let data;
  try {
    data = JSON.parse(
      new TextDecoder("utf8", { fatal: true }).decode(bytes),
    )?.data;
  } catch {
    data = null;
  }
  if (!data || typeof data !== "object" || data.is_free_tier !== false) {
    return Object.freeze({
      ...sanitizedNon2xx(200, bytes),
      disposition: "BLOCKED_CREDENTIAL",
    });
  }
  return Object.freeze({
    schemaVersion: "slice3-openrouter-credential-probe.v4",
    disposition: "READY_TO_INITIALIZE",
    sanitizedEnvelopeDigest: sha256(bytes),
    costState: "unknown",
    costAmountUsd: null,
    providerModelPosts: 0,
    credentialValuePersisted: false,
  });
}

async function performAuthorizedCredentialGate(sourceBinding) {
  if (!SOURCE_BINDINGS.has(sourceBinding)) {
    throw new Error("V4 source binding capability is invalid.");
  }
  if (sourceBinding.currentDisposition !== "READY_TO_PROBE") {
    return assessCurrentV4Disposition(sourceBinding);
  }
  const credentials = await readCredentialsOnce(CREDENTIAL_FILE);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("credential_timeout"),
    10_000,
  );
  timer.unref();
  try {
    const response = await fetch("https://openrouter.ai/api/v1/key", {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${credentials.MATCHBASE_OPENROUTER_API_KEY}`,
      },
    });
    const record = await reduceCredentialResponseForV4(response);
    if (record.disposition !== "READY_TO_INITIALIZE") return record;
    const capability = Object.freeze({});
    READY_CAPABILITIES.set(capability, {
      sourceBinding,
      credentials,
      responseDigest: record.sanitizedEnvelopeDigest,
    });
    return initializeV4SessionWithCapability(capability, credentials);
  } catch {
    const sanitizedEnvelope = Object.freeze({
      endpointCapability: "OPENROUTER_KEY_STATUS_READ",
      httpStatus: null,
      callOccurred: true,
      responseBodyDigest: null,
      requestIdDigest: null,
      errorCode: "TRANSPORT_OR_TIMEOUT",
      errorType: null,
      responseBodyPersisted: false,
      rawHeadersPersisted: false,
    });
    return Object.freeze({
      schemaVersion: "slice3-openrouter-credential-probe.v4",
      disposition: "BLOCKED_CREDENTIAL",
      sanitizedEnvelope,
      sanitizedEnvelopeDigest: sha256(JSON.stringify(sanitizedEnvelope)),
      costState: "unknown",
      costAmountUsd: null,
      providerModelPosts: 0,
      credentialValuePersisted: false,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function initializeV4SessionWithCapability(capability, credentials) {
  const authorized = READY_CAPABILITIES.get(capability);
  if (
    !authorized ||
    authorized.credentials !== credentials ||
    !SOURCE_BINDINGS.has(authorized.sourceBinding)
  ) {
    throw new Error("V4 credential-ready capability is invalid.");
  }
  const initialized = await initializeV4SessionFilesystem({
    stateRoot: STATE_ROOT,
    initializerToken: CANONICAL_INITIALIZER,
    authorizationEvent: {
      schemaVersion: "slice3-live-qualification-authorization.v4",
      authorizationId: V4_AUTHORIZATION_ID,
      sessionId: V4_SESSION_ID,
      credentialProbeDigest: authorized.responseDigest,
      maxCalls: 2,
      maxCostUsd: 100,
      activation: false,
    },
  });
  READY_CAPABILITIES.delete(capability);
  const sessionCapability = Object.freeze({});
  SESSION_CAPABILITIES.set(sessionCapability, {
    sessionDirectory: initialized.sessionDirectory,
    createdByThisCall: true,
  });
  return Object.freeze({
    schemaVersion: "slice3-live-qualification-session-created.v4",
    disposition: "SESSION_CREATED",
    credentialValuesDisclosed: false,
    providerModelPosts: 0,
    terminalizeFailure: () => appendV4TerminalFailure(sessionCapability),
  });
}

async function initializeV4SessionFilesystem({
  stateRoot,
  initializerToken,
  authorizationEvent,
  afterLock,
}) {
  const resolvedRoot = resolve(stateRoot);
  if (
    resolvedRoot === STATE_ROOT &&
    initializerToken !== CANONICAL_INITIALIZER
  ) {
    throw new Error(
      "Canonical V4 initialization requires its private capability.",
    );
  }
  const stateItem = await lstat(stateRoot);
  if (!stateItem.isDirectory() || stateItem.isSymbolicLink()) {
    throw new Error("V4 state root identity is invalid.");
  }
  if ((await realpath(stateRoot)) !== resolvedRoot) {
    throw new Error("V4 state root alias is forbidden.");
  }
  const sessionDirectory = join(resolvedRoot, V4_SESSION_ID);
  const lockPath = `${sessionDirectory}.authorization.lock`;
  const runLockPath = `${sessionDirectory}.run.lock`;
  const lock = await open(lockPath, "wx");
  try {
    await afterLock?.({ sessionDirectory, runLockPath });
    if (
      !(await pathAbsent(sessionDirectory)) ||
      !(await pathAbsent(runLockPath))
    ) {
      throw new Error(
        "V4 session or run lock appeared while authorization was held.",
      );
    }
    await mkdir(sessionDirectory);
    await writeFile(
      join(sessionDirectory, "00-authorization.json"),
      `${JSON.stringify(authorizationEvent)}\n`,
      { flag: "wx" },
    );
    return Object.freeze({ sessionDirectory });
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

export async function exerciseV4ExclusiveInitializerForTest({
  stateRoot,
  afterLock,
}) {
  if (resolve(stateRoot) === STATE_ROOT) {
    throw new Error("Test initializer cannot target canonical V4 state.");
  }
  const initialized = await initializeV4SessionFilesystem({
    stateRoot,
    initializerToken: null,
    authorizationEvent: {
      schemaVersion: "slice3-live-qualification-authorization.v4-test-fixture",
      authorizationId: "TEST-ONLY-NON-AUTHORITY",
      sessionId: V4_SESSION_ID,
      activation: false,
    },
    afterLock,
  });
  const sessionCapability = Object.freeze({});
  SESSION_CAPABILITIES.set(sessionCapability, {
    sessionDirectory: initialized.sessionDirectory,
    createdByThisCall: true,
  });
  let nextCall = 1;
  return Object.freeze({
    sessionDirectory: initialized.sessionDirectory,
    appendResult: async (event) => {
      if (nextCall > 2) throw new Error("V4 test result slots are exhausted.");
      const path = join(
        initialized.sessionDirectory,
        `0${nextCall}-result.json`,
      );
      await writeFile(path, `${JSON.stringify(event)}\n`, { flag: "wx" });
      nextCall += 1;
      return sha256(await readFile(path));
    },
    terminalizeFailure: () => appendV4TerminalFailure(sessionCapability),
  });
}

export function deriveV4TerminalFailure(records) {
  if (!Array.isArray(records) || records.length < 1 || records.length > 2) {
    throw new Error("V4 terminal failure accounting is invalid.");
  }
  const resultDigests = [];
  let knownCostUsd = 0;
  let unknownCostCalls = 0;
  let hasFailure = false;
  records.forEach((record, index) => {
    exactKeys(record, new Set(["digest", "event"]), "V4 result record");
    if (!DIGEST.test(record.digest)) {
      throw new Error("V4 result digest is invalid.");
    }
    const event = exactKeys(
      record.event,
      new Set([
        "schemaVersion",
        "authorizationId",
        "sessionId",
        "callNumber",
        "terminalDisposition",
        "costState",
        "costAmountUsd",
        "activation",
      ]),
      "V4 result event",
    );
    if (
      event.schemaVersion !== "slice3-live-qualification-result-event.v4" ||
      event.authorizationId !== V4_AUTHORIZATION_ID ||
      event.sessionId !== V4_SESSION_ID ||
      event.callNumber !== index + 1 ||
      !new Set(["PASS", "FAIL"]).has(event.terminalDisposition) ||
      event.activation !== false
    ) {
      throw new Error("V4 result event identity is invalid.");
    }
    if (event.terminalDisposition === "FAIL") hasFailure = true;
    if (event.costState === "unknown") {
      if (event.costAmountUsd !== null) {
        throw new Error("Unknown V4 cost contains an amount.");
      }
      unknownCostCalls += 1;
    } else if (
      !new Set(["provider_reported", "conservative_estimate"]).has(
        event.costState,
      ) ||
      !Number.isFinite(event.costAmountUsd) ||
      event.costAmountUsd < 0
    ) {
      throw new Error("Known V4 cost is invalid.");
    } else {
      knownCostUsd += event.costAmountUsd;
    }
    resultDigests.push(record.digest);
  });
  if (!hasFailure || knownCostUsd > 100) {
    throw new Error("V4 failure or cost cap is invalid.");
  }
  const callsConsumed = records.length;
  const expiredUnusedSlots = 2 - callsConsumed;
  const event = Object.freeze({
    schemaVersion: "slice3-live-qualification-terminal-failure.v4",
    authorizationId: V4_AUTHORIZATION_ID,
    sessionId: V4_SESSION_ID,
    disposition: "FAIL",
    resultDigests: Object.freeze([...resultDigests]),
    callsConsumed,
    expiredUnusedSlots,
    knownCostUsd,
    unknownCostCalls,
    aggregateCostState:
      unknownCostCalls > 0
        ? "contains_unknown"
        : callsConsumed === 2
          ? "known_total"
          : "known_partial_total",
    activation: false,
    recordedAt: new Date().toISOString(),
  });
  return event;
}

async function appendV4TerminalFailure(sessionCapability) {
  const session = SESSION_CAPABILITIES.get(sessionCapability);
  if (!session || session.createdByThisCall !== true) {
    throw new Error("V4 session capability is invalid.");
  }
  const names = (await readdir(session.sessionDirectory)).sort();
  const resultNames = names.filter((name) =>
    /^0[12]-result\.json$/u.test(name),
  );
  if (
    names.some(
      (name) => name !== "00-authorization.json" && !resultNames.includes(name),
    ) ||
    resultNames.length < 1 ||
    resultNames.length > 2
  ) {
    throw new Error("V4 session result file set is invalid.");
  }
  const records = [];
  for (const name of resultNames) {
    const bytes = await requireRegularContainedFile(
      join(session.sessionDirectory, name),
      session.sessionDirectory,
    );
    records.push({
      digest: sha256(bytes),
      event: JSON.parse(bytes.toString("utf8")),
    });
  }
  const event = deriveV4TerminalFailure(records);
  await writeFile(
    join(session.sessionDirectory, "99-terminal-failure.json"),
    `${JSON.stringify(event)}\n`,
    { flag: "wx" },
  );
  SESSION_CAPABILITIES.delete(sessionCapability);
  return event;
}

export async function executeCurrentV4PreCall(binding) {
  if (!SOURCE_BINDINGS.has(binding)) {
    throw new Error("V4 source binding capability is invalid.");
  }
  return performAuthorizedCredentialGate(binding);
}

export const slice3V4QualificationConstants = Object.freeze({
  authorizationId: V4_AUTHORIZATION_ID,
  authorizationSignal: V4_SIGNAL,
  sessionId: V4_SESSION_ID,
  ownerDigest: OWNER_DIGEST,
  credentialPreflightDigest: PREFLIGHT_DIGEST,
  policyDigest: POLICY_DIGEST,
  v3LedgerDigest: V3_LEDGER_DIGEST,
  v3Manifest: V3_MANIFEST,
});
