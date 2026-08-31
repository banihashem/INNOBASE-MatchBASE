import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildGeminiQualificationRequest,
  buildOpenRouterQualificationRequest,
  readCanonicalCredentials,
} from "./lib/slice3-live-qualification-runner.mjs";

const SIGNAL = "I_AUTHORIZE_TWO_SYNTHETIC_RESPONSE_SHAPE_CALLS_V2";
const SESSION_DIRECTORY = resolve(
  "C:/INNOBASE/MatchBASE/01_Product_Management/.slice3-staging-live-qualification-state/v6-DIAG2-11B143B4EA89F0D2",
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

function geminiShape(response, envelope, responseBytes) {
  const candidate = envelope?.candidates?.[0];
  const parts = candidate?.content?.parts;
  return {
    httpStatus: response.status,
    responseBytes,
    modelVersion: envelope?.modelVersion ?? null,
    finishReason: candidate?.finishReason ?? null,
    searchQueryCount: Array.isArray(
      candidate?.groundingMetadata?.webSearchQueries,
    )
      ? candidate.groundingMetadata.webSearchQueries.length
      : null,
    sourceCount: Array.isArray(candidate?.groundingMetadata?.groundingChunks)
      ? candidate.groundingMetadata.groundingChunks.length
      : null,
    parts: Array.isArray(parts)
      ? parts.map((part) => ({
          keys:
            part && typeof part === "object" && !Array.isArray(part)
              ? Object.keys(part).sort()
              : [],
          thought: part?.thought ?? null,
          thoughtSignaturePresent:
            typeof part?.thoughtSignature === "string" &&
            part.thoughtSignature.length > 0,
          text: textShape(part?.text),
        }))
      : null,
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
  const directRequest = buildGeminiQualificationRequest(policy.routes[0]);
  const routerRequest = buildOpenRouterQualificationRequest(policy.routes[1]);
  const directResponse = await fetch(directRequest.url, {
    method: "POST",
    redirect: "error",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": credentials.MATCHBASE_GEMINI_API_KEY,
    },
    body: directRequest.body,
  });
  const direct = await boundedJson(directResponse);
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
      schemaVersion: "matchbase.slice3-response-shape-diagnostic/v2",
      syntheticOnly: true,
      providerModelPosts: 2,
      retries: 0,
      fallbacks: 0,
      rawPayloadPersisted: false,
      credentialsDisclosed: false,
      gemini: geminiShape(directResponse, direct.value, direct.bytes),
      openRouter: openRouterShape(routerResponse, router.value, router.bytes),
    })}\n`,
  );
}

await main();
