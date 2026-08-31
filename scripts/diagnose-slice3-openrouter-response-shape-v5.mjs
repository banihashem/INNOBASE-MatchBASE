import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildOpenRouterQualificationRequest,
  readCanonicalCredentials,
} from "./lib/slice3-live-qualification-runner.mjs";

const SIGNAL = "I_AUTHORIZE_ONE_SYNTHETIC_OPENROUTER_RESPONSE_SHAPE_CALL_V5";
const SESSION_DIRECTORY = resolve(
  "C:/INNOBASE/MatchBASE/01_Product_Management/.slice3-staging-live-qualification-state/v6-DIAG5-67B60CC5D79C7CF4",
);
const MAX_RESPONSE_BYTES = 512 * 1024;

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex").toUpperCase();

async function boundedJson(response) {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_RESPONSE_BYTES) {
    throw new Error("Diagnostic response exceeded its byte ceiling.");
  }
  return { bytes: bytes.length, value: JSON.parse(bytes.toString("utf8")) };
}

function textShape(value) {
  if (typeof value !== "string") {
    return { type: Array.isArray(value) ? "array" : typeof value };
  }
  const trimmed = value.trim();
  let structured;
  try {
    const parsed = JSON.parse(value);
    structured =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? {
            parseable: true,
            keys: Object.keys(parsed).sort(),
            fixtureExact:
              parsed.fixtureId === "S3-QUALIFICATION-PUBLIC-EXAMPLE-DOMAIN",
            answerType: typeof parsed.answer,
            answerLength:
              typeof parsed.answer === "string" ? parsed.answer.length : null,
            answerTrimmed:
              typeof parsed.answer === "string"
                ? parsed.answer === parsed.answer.trim()
                : null,
            sourceSummaryType: typeof parsed.sourceSummary,
            sourceSummaryLength:
              typeof parsed.sourceSummary === "string"
                ? parsed.sourceSummary.length
                : null,
            sourceSummaryTrimmed:
              typeof parsed.sourceSummary === "string"
                ? parsed.sourceSummary === parsed.sourceSummary.trim()
                : null,
          }
        : { parseable: true, object: false };
  } catch {
    structured = { parseable: false };
  }
  return {
    type: "string",
    length: value.length,
    sha256: sha256(value),
    trimmed: value === trimmed,
    startsWithObject: trimmed.startsWith("{"),
    endsWithObject: trimmed.endsWith("}"),
    startsWithMarkdownFence: trimmed.startsWith("```"),
    structured,
  };
}

function openRouterShape(response, envelope, responseBytes) {
  const choice = envelope?.choices?.[0];
  return {
    httpStatus: response.status,
    responseBytes,
    model: envelope?.model ?? null,
    finishReason: choice?.finish_reason ?? null,
    generationIdPresent:
      typeof envelope?.id === "string" && envelope.id.length > 0,
    messageKeys:
      choice?.message && typeof choice.message === "object"
        ? Object.keys(choice.message).sort()
        : [],
    content: textShape(choice?.message?.content),
    usage: {
      promptTokens: Number.isInteger(envelope?.usage?.prompt_tokens),
      completionTokens: Number.isInteger(envelope?.usage?.completion_tokens),
      positiveCost:
        Number.isFinite(Number(envelope?.usage?.cost)) &&
        Number(envelope.usage.cost) > 0,
    },
    routingMetadataKeys:
      envelope?.openrouter_metadata &&
      typeof envelope.openrouter_metadata === "object"
        ? Object.keys(envelope.openrouter_metadata).sort()
        : [],
    routingMetadataShape:
      envelope.openrouter_metadata &&
      typeof envelope.openrouter_metadata === "object"
        ? Object.fromEntries(
            Object.entries(envelope.openrouter_metadata).map(([key, value]) => [
              key,
              value && typeof value === "object"
                ? {
                    type: Array.isArray(value) ? "array" : "object",
                    keys: Array.isArray(value)
                      ? null
                      : Object.keys(value).sort(),
                    itemCount: Array.isArray(value) ? value.length : null,
                  }
                : { type: typeof value },
            ]),
          )
        : null,
    routingSafeValues: envelope.openrouter_metadata
      ? {
          requested: envelope.openrouter_metadata.requested ?? null,
          strategy: envelope.openrouter_metadata.strategy ?? null,
          region: envelope.openrouter_metadata.region ?? null,
          attempt: envelope.openrouter_metadata.attempt ?? null,
          isByok: envelope.openrouter_metadata.is_byok ?? null,
          endpointTotal: envelope.openrouter_metadata.endpoints?.total ?? null,
          endpoints: Array.isArray(
            envelope.openrouter_metadata.endpoints?.available,
          )
            ? envelope.openrouter_metadata.endpoints.available.map((entry) => ({
                provider: entry?.provider ?? null,
                model: entry?.model ?? null,
                selected: entry?.selected ?? null,
                keys:
                  entry && typeof entry === "object"
                    ? Object.keys(entry).sort()
                    : [],
              }))
            : null,
        }
      : null,
  };
}

async function main() {
  if (process.env.MATCHBASE_SLICE3_RESPONSE_SHAPE_DIAGNOSTIC !== SIGNAL) {
    throw new Error("Exact response-shape diagnostic signal is absent.");
  }
  await mkdir(SESSION_DIRECTORY);
  const credentials = await readCanonicalCredentials(resolve("APIKeys.md"));
  const policy = JSON.parse(
    await readFile(
      resolve("config/slice3/research-route-policy.v1.json"),
      "utf8",
    ),
  );
  const routerRequest = buildOpenRouterQualificationRequest(policy.routes[1]);
  const routerResponse = await fetch(routerRequest.url, {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${credentials.MATCHBASE_OPENROUTER_API_KEY}`,
      "X-OpenRouter-Metadata": "enabled",
    },
    body: routerRequest.body,
  });
  const router = await boundedJson(routerResponse);
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: "matchbase.slice3-openrouter-response-shape-diagnostic/v5",
      syntheticOnly: true,
      providerModelPosts: 1,
      retries: 0,
      fallbacks: 0,
      rawPayloadPersisted: false,
      credentialsDisclosed: false,
      openRouter: openRouterShape(routerResponse, router.value, router.bytes),
    })}\n`,
  );
}

await main();
