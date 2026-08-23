import assert from "node:assert/strict";
import test from "node:test";
import { reduceV5CredentialResponse } from "../../scripts/lib/slice3-live-qualification-v5.mjs";

const ENDPOINT = "https://openrouter.ai/api/v1/key";
const VERIFY_AT = Date.parse("2026-08-23T08:00:00Z");

function keyData(overrides = {}) {
  return {
    byok_usage: 0,
    byok_usage_daily: 0,
    byok_usage_monthly: 0,
    byok_usage_weekly: 0,
    creator_user_id: null,
    expires_at: null,
    include_byok_in_limit: false,
    is_free_tier: false,
    is_management_key: false,
    is_provisioning_key: false,
    label: "sensitive-label",
    limit: null,
    limit_remaining: 1,
    limit_reset: null,
    rate_limit: { requests: -1, interval: "legacy", note: "deprecated" },
    usage: 0,
    usage_daily: 0,
    usage_monthly: 0,
    usage_weekly: 0,
    ...overrides,
  };
}

function responseFromText(
  text,
  { status = 200, contentType = "application/json", url = ENDPOINT } = {},
) {
  const response = new Response(text, {
    status,
    headers: { "content-type": contentType },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function responseFromData(data, options) {
  return responseFromText(JSON.stringify({ data }), options);
}

async function reduce(data, options) {
  return reduceV5CredentialResponse(
    responseFromData(data, options),
    new AbortController(),
    { verificationInstantMs: VERIFY_AT },
  );
}

test("v2 accepts the official full shape and legacy requests -1", async () => {
  const result = await reduce(keyData());
  assert.equal(
    result.schemaVersion,
    "matchbase.slice3-v5-credential-result/v2",
  );
  assert.equal(
    result.disposition,
    "CREDENTIAL_GATE_PASS_AWAITING_SEPARATE_LIVE_QUALIFICATION",
  );
  assert.deepEqual(result.sanitizedEnvelope.decisionDiagnostics, []);
  assert.equal(JSON.stringify(result).includes("sensitive-label"), false);
  assert.equal(result.sanitizedEnvelope.paidCredential, true);
});

test("unknown fields and future limit_reset values are discarded without decision drift", async () => {
  const result = await reduce({
    ...keyData({ limit_reset: "future-period" }),
    future_data_secret: "never-persist",
    rate_limit: {
      requests: -1,
      interval: "legacy",
      note: "never-persist",
      future_nested_secret: "never-persist",
    },
  });
  assert.equal(
    result.disposition,
    "CREDENTIAL_GATE_PASS_AWAITING_SEPARATE_LIVE_QUALIFICATION",
  );
  assert.deepEqual(result.sanitizedEnvelope.decisionDiagnostics, [
    "UNKNOWN_FIELDS_DISCARDED",
  ]);
  const persisted = JSON.stringify(result);
  assert.doesNotMatch(
    persisted,
    /future|never-persist|future_data_secret|future_nested_secret/u,
  );

  const top = await reduceV5CredentialResponse(
    responseFromText(
      JSON.stringify({ data: keyData(), future_top_secret: "never-persist" }),
    ),
    new AbortController(),
    { verificationInstantMs: VERIFY_AT },
  );
  assert.equal(
    top.disposition,
    "CREDENTIAL_GATE_PASS_AWAITING_SEPARATE_LIVE_QUALIFICATION",
  );
  assert.deepEqual(top.sanitizedEnvelope.decisionDiagnostics, [
    "UNKNOWN_FIELDS_DISCARDED",
  ]);
});

test("paid status is independent from management, provisioning, expiry, and quota", async () => {
  const cases = [
    [{ is_free_tier: true }, false, "UNPAID_CREDENTIAL"],
    [{ is_management_key: true }, true, "INELIGIBLE_MANAGEMENT_KEY"],
    [{ is_provisioning_key: true }, true, "INELIGIBLE_PROVISIONING_KEY"],
    [{ expires_at: "2026-08-23T07:59:59Z" }, true, "EXPIRED_KEY"],
    [{ limit_remaining: 0 }, true, "QUOTA_EXHAUSTED"],
    [{ limit_remaining: null }, true, "QUOTA_UNPROVEN"],
  ];
  for (const [override, paidCredential, failureClass] of cases) {
    const result = await reduce(keyData(override));
    assert.equal(result.sanitizedEnvelope.schemaValid, true);
    assert.equal(result.sanitizedEnvelope.paidCredential, paidCredential);
    assert.equal(result.sanitizedEnvelope.failureClass, failureClass);
    assert.equal(result.disposition, "BLOCKED_CREDENTIAL");
  }
  const absentExpiry = keyData();
  delete absentExpiry.expires_at;
  const result = await reduce(absentExpiry);
  assert.equal(result.sanitizedEnvelope.schemaValid, true);
  assert.equal(result.sanitizedEnvelope.failureClass, "EXPIRY_UNPROVEN");
  assert.deepEqual(result.sanitizedEnvelope.decisionDiagnostics, [
    "EXPIRY_UNPROVEN",
  ]);
});

test("required fields and every known field type fail closed", async () => {
  const cases = [
    (() => {
      const value = keyData();
      delete value.is_free_tier;
      return value;
    })(),
    keyData({ is_management_key: "false" }),
    keyData({ creator_user_id: 1 }),
    keyData({ expires_at: "2026-02-30T00:00:00Z" }),
    keyData({ usage: -1 }),
    keyData({ rate_limit: { requests: -2, interval: "legacy", note: "x" } }),
    keyData({ rate_limit: { requests: 1.5, interval: "legacy", note: "x" } }),
    keyData({
      rate_limit: {
        requests: Number.MAX_SAFE_INTEGER + 1,
        interval: "legacy",
        note: "x",
      },
    }),
  ];
  for (const value of cases) {
    const result = await reduce(value);
    assert.equal(result.sanitizedEnvelope.schemaValid, false);
    assert.equal(result.sanitizedEnvelope.paidCredential, null);
    assert.equal(result.sanitizedEnvelope.failureClass, "INVALID_200_SCHEMA");
  }
});

test("duplicate keys, prototype keys, arrays, invalid UTF-8, and hostile depth fail closed", async () => {
  const bodies = [
    '{"data":{"is_free_tier":false,"is_free_tier":true}}',
    '{"data":{"__proto__":{}}}',
    "[]",
    JSON.stringify({ data: [[[[[[[[[{}]]]]]]]]] }),
  ];
  for (const body of bodies) {
    const result = await reduceV5CredentialResponse(responseFromText(body));
    assert.equal(result.sanitizedEnvelope.failureClass, "INVALID_200_SCHEMA");
    assert.equal(result.sanitizedEnvelope.paidCredential, null);
  }
  const invalidUtf8 = new Response(Uint8Array.from([0xc3, 0x28]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(invalidUtf8, "url", { value: ENDPOINT });
  const invalid = await reduceV5CredentialResponse(invalidUtf8);
  assert.equal(invalid.sanitizedEnvelope.failureClass, "INVALID_200_SCHEMA");
});

test("lexically non-finite numbers are rejected globally, including unknown fields", async () => {
  const body = JSON.stringify({ data: keyData() }).replace(
    /\}\s*\}$/u,
    ',"future_nonfinite":1e9999}}',
  );
  const result = await reduceV5CredentialResponse(responseFromText(body));
  assert.equal(result.sanitizedEnvelope.schemaValid, false);
  assert.equal(result.sanitizedEnvelope.paidCredential, null);
  assert.equal(result.sanitizedEnvelope.failureClass, "INVALID_200_SCHEMA");
  assert.doesNotMatch(
    JSON.stringify(result),
    /future_nonfinite|Infinity|1e9999/u,
  );
});

test("non-200 statuses never expose schema or paid decisions from valid-shaped bodies", async () => {
  for (const [status, failureClass] of [
    [401, "HTTP_401"],
    [403, "HTTP_403"],
    [302, "REDIRECT_RESPONSE"],
  ]) {
    const result = await reduce(keyData(), { status });
    assert.equal(result.sanitizedEnvelope.schemaValid, false);
    assert.equal(result.sanitizedEnvelope.paidCredential, null);
    assert.equal(result.sanitizedEnvelope.failureClass, failureClass);
    assert.deepEqual(result.sanitizedEnvelope.decisionDiagnostics, []);
    assert.doesNotMatch(
      JSON.stringify(result),
      /sensitive-label|legacy|deprecated/u,
    );
  }
});

test("diagnostics remain closed, ordered, duplicate-free, and value-free", async () => {
  const value = keyData({
    limit_remaining: null,
    limit_reset: "private-value",
  });
  delete value.expires_at;
  value.private_unknown_name = "private-value";
  const result = await reduce(value);
  assert.deepEqual(result.sanitizedEnvelope.decisionDiagnostics, [
    "EXPIRY_UNPROVEN",
    "QUOTA_UNPROVEN",
    "UNKNOWN_FIELDS_DISCARDED",
  ]);
  assert.equal(new Set(result.sanitizedEnvelope.decisionDiagnostics).size, 3);
  assert.doesNotMatch(
    JSON.stringify(result),
    /private-value|private_unknown_name/u,
  );
});
