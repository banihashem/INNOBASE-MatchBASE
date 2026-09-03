import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { format } from "prettier";
import {
  normalizeLegacyProviderDimensionScores,
  qualifiedResearchOutputInstruction,
  serializeSanitizedEvidence,
  validateEvidenceGraph,
  validateQualifiedResearchRequest,
  validateResearchRoutePolicy,
} from "../packages/ai-evidence/dist/src/index.js";
import {
  LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA,
  LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA_SHA256,
  canonicalResearchRoutePolicySha256,
} from "../packages/application/dist/live-research-pipeline-identity.js";
import { bindServerOwnedLiveEvidenceGraph } from "../packages/application/dist/live-source-binding.js";

const args = new Set(process.argv.slice(2));
if (!args.has("--execute") || args.size !== 1) {
  throw new Error("Qualification requires exactly --execute.");
}
if (
  process.env.MATCHBASE_STAGING_ROUTE_QUALIFICATION !==
  "I_ACKNOWLEDGE_BILLABLE_SYNTHETIC_ONLY"
) {
  throw new Error("Qualification acknowledgement is absent.");
}

const root = resolve(import.meta.dirname, "..");
const policyPath = resolve(
  root,
  "config/slice3/research-route-policy.staging.v4.json",
);
const authorizationPath = resolve(
  root,
  "governance/staging-route-qualification-authorization.v1.json",
);
const outputPath = resolve(
  root,
  "evidence/slice3/staging-openrouter-azure-openai-qualification.v2.json",
);
const keyPath = resolve(root, "APIKeys.md");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonicalJson = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
};
const exactKeys = (value, keys, label) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== [...keys].sort().join(",")
  )
    throw new Error(`${label} is not closed.`);
};

const authorizationBytes = await readFile(authorizationPath);
const runnerBytes = await readFile(new URL(import.meta.url));
const authorization = JSON.parse(authorizationBytes);
if (
  authorization.authorizationId !== "MB-STG-ROUTE-QUAL-20260902-01" ||
  authorization.environment !== "staging" ||
  authorization.scope !== "synthetic_route_qualification_only" ||
  authorization.authorizedMaxCalls !== 50 ||
  authorization.authorizedMaxCostUsd !== 100 ||
  authorization.realUserDataAuthorized !== false
)
  throw new Error("Governed Staging qualification authorization is invalid.");

const policyBytes = await readFile(policyPath);
const policy = validateResearchRoutePolicy(JSON.parse(policyBytes));
const route = policy.routes.find(
  (candidate) => candidate.path === "openrouter",
);
if (
  policy.policyVersion !== "slice3-routes.2026-09-02.staging-qualified-v4" ||
  policy.environment !== "staging" ||
  !route ||
  route.routeId !== "RT-OPENROUTER-AZURE-OPENAI-GPT-5.4-MINI-S3-V1" ||
  route.providerId !== "azure" ||
  route.requestedModelId !== "openai/gpt-5.4-mini" ||
  route.expectedServedModelId !== "openai/gpt-5.4-mini" ||
  route.parameterPolicy.timeoutMs !== 60_000 ||
  route.parameterPolicy.maxAttempts !== 1 ||
  route.parameterPolicy.requireParameters !== true ||
  route.parameterPolicy.allowFallbacks !== false
)
  throw new Error("Staging v4 OpenRouter route is not the qualified target.");

const keyFile = await readFile(keyPath, "utf8");
const keyMatch =
  /(?:^|\r?\n)\s*`?MATCHBASE_OPENROUTER_API_KEY`?\s*(?:=|:)\s*`?([^`\s]+)`?\s*(?:\r?\n|$)/u.exec(
    keyFile,
  );
if (!keyMatch?.[1] || keyMatch[1].length < 20)
  throw new Error("OpenRouter credential handle is unavailable.");
const apiKey = keyMatch[1];

const capturedAt = new Date().toISOString();
const runId = randomUUID();
const sessionId = randomUUID();
const fixture = [
  {
    sourceId: "11111111-1111-4111-8111-111111111111",
    canonicalUrl: "https://supplier-alpha.example/product/pistachio",
    publisherDomain: "supplier-alpha.example",
    retrievedAt: capturedAt,
    excerpt:
      "Synthetic Supplier Alpha lists Ahmad Aghaei pistachios as an offered agricultural product.",
  },
  {
    sourceId: "22222222-2222-4222-8222-222222222222",
    canonicalUrl: "https://supplier-alpha.example/logistics/dubai-africa",
    publisherDomain: "supplier-alpha.example",
    retrievedAt: capturedAt,
    excerpt:
      "Synthetic Supplier Alpha states that export shipments can route through Dubai for African distribution.",
  },
  {
    sourceId: "33333333-3333-4333-8333-333333333333",
    canonicalUrl: "https://supplier-alpha.example/inventory/current",
    publisherDomain: "supplier-alpha.example",
    retrievedAt: capturedAt,
    excerpt:
      "Synthetic inventory record states that one container of Ahmad Aghaei pistachios is currently available.",
  },
].map((item) => ({
  ...item,
  contentSha256: sha256(item.excerpt),
}));
const canonicalEnglishRequest =
  "Procurement request for three containers of high-quality Iranian Ahmad Aghaei pistachios. The shipment must be routed via Dubai for distribution in the African market. The supplier should have at least one container currently available in stock.";
const qualifiedRequest = validateQualifiedResearchRequest({
  canonicalLanguage: "en",
  canonicalEnglishRequest,
  sanitizedEvidence: fixture,
  outputSchema: LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA,
});
const prompt = qualifiedResearchOutputInstruction({
  runId,
  capturedAt,
  canonicalEnglishRequest,
});
const serializedEvidence = serializeSanitizedEvidence(fixture);
const providerPolicy = {
  zdr: true,
  data_collection: "deny",
  only: ["azure"],
  order: ["azure"],
  require_parameters: true,
  allow_fallbacks: false,
};
const requestBody = {
  model: route.requestedModelId,
  provider: providerPolicy,
  messages: [
    { role: "user", content: prompt },
    { role: "user", content: serializedEvidence },
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "matchbase_evidence_graph_v1",
      strict: false,
      schema: qualifiedRequest.outputSchema,
    },
  },
  max_completion_tokens: route.parameterPolicy.maxOutputTokens,
};

const catalogStartedAt = new Date().toISOString();
const catalogResponse = await fetch(
  "https://openrouter.ai/api/v1/endpoints/zdr",
  {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  },
);
const catalogBytes = Buffer.from(await catalogResponse.arrayBuffer());
if (!catalogResponse.ok || catalogBytes.length > 8 * 1024 * 1024)
  throw new Error("ZDR catalog observation failed.");
const catalog = JSON.parse(catalogBytes.toString("utf8"));
const catalogObservedAt = new Date().toISOString();
const endpoint = catalog.data?.find(
  (candidate) =>
    candidate.model_id === route.requestedModelId &&
    candidate.provider_name === "Azure" &&
    candidate.tag === "azure",
);
if (
  !endpoint ||
  endpoint.status !== 0 ||
  !endpoint.supported_parameters?.includes("response_format") ||
  !endpoint.supported_parameters?.includes("structured_outputs") ||
  !endpoint.supported_parameters?.includes("max_completion_tokens")
)
  throw new Error("Azure OpenAI ZDR endpoint capability is not qualified.");

const providerStartedEpoch = Date.now();
const providerStartedAt = new Date(providerStartedEpoch).toISOString();
const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  redirect: "error",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    "X-OpenRouter-Metadata": "enabled",
  },
  body: JSON.stringify(requestBody),
  signal: AbortSignal.timeout(route.parameterPolicy.timeoutMs),
});
const responseBytes = Buffer.from(await response.arrayBuffer());
const providerCompletedEpoch = Date.now();
const providerCompletedAt = new Date(providerCompletedEpoch).toISOString();
const elapsedMs = providerCompletedEpoch - providerStartedEpoch;
if (!response.ok || responseBytes.length > 2 * 1024 * 1024)
  throw new Error(
    `Qualification generation failed with HTTP ${response.status}.`,
  );
const envelope = JSON.parse(responseBytes.toString("utf8"));
const metadata = envelope.openrouter_metadata;
exactKeys(
  providerPolicy,
  [
    "zdr",
    "data_collection",
    "only",
    "order",
    "require_parameters",
    "allow_fallbacks",
  ],
  "Provider policy",
);
if (
  envelope.model !== route.requestedModelId ||
  metadata?.requested !== route.requestedModelId ||
  metadata?.strategy !== "direct" ||
  metadata?.attempt !== 1 ||
  metadata?.is_byok !== false ||
  !Array.isArray(metadata?.endpoints?.available)
)
  throw new Error("OpenRouter routing metadata is invalid.");
const selected = metadata.endpoints.available.filter(
  (candidate) => candidate.selected === true,
);
if (
  selected.length !== 1 ||
  selected[0].provider !== "Azure" ||
  !["openai/gpt-5.4-mini", "openai/gpt-5.4-mini-20260317"].includes(
    selected[0].model,
  ) ||
  (Array.isArray(metadata.attempts) &&
    (metadata.attempts.length !== 1 ||
      metadata.attempts[0]?.provider !== "Azure" ||
      metadata.attempts[0]?.status !== 200))
)
  throw new Error("OpenRouter selected identity is outside the closed route.");
const choice = envelope.choices?.[0];
const content = choice?.message?.content;
const usage = envelope.usage;
const generationId = envelope.id ?? response.headers.get("x-generation-id");
if (
  typeof generationId !== "string" ||
  !generationId ||
  typeof content !== "string" ||
  choice.finish_reason !== "stop" ||
  !Number.isSafeInteger(usage?.prompt_tokens) ||
  !Number.isSafeInteger(usage?.completion_tokens) ||
  !Number.isFinite(Number(usage?.cost)) ||
  Number(usage.cost) <= 0 ||
  Number(usage.cost) > authorization.authorizedMaxCostUsd
)
  throw new Error("OpenRouter accounting or generation metadata is invalid.");
const providerGraph = normalizeLegacyProviderDimensionScores(
  JSON.parse(content),
);
const graph = bindServerOwnedLiveEvidenceGraph(
  providerGraph,
  fixture.map((item) => ({
    evidenceId: item.sourceId,
    canonicalUrl: item.canonicalUrl,
    publisherDomain: item.publisherDomain,
    retrievedAt: item.retrievedAt,
    contentSha256: item.contentSha256,
    boundedExcerpt: item.excerpt,
  })),
  { runId, capturedAt },
);
validateEvidenceGraph(graph);

const safeMetadata = {
  requested: metadata.requested,
  strategy: metadata.strategy,
  attempt: metadata.attempt,
  is_byok: metadata.is_byok,
  endpoints: metadata.endpoints,
  attempts: metadata.attempts ?? [],
};
const costUsd = Number(usage.cost);
const evidence = {
  schemaVersion: "matchbase.staging-openrouter-route-qualification/v2",
  environment: "staging",
  authorization: {
    authorizationId: authorization.authorizationId,
    authorizationFileSha256: sha256(authorizationBytes),
    sessionId,
    syntheticOnly: true,
    realUserDataTransmitted: false,
    authorizedMaxCalls: authorization.authorizedMaxCalls,
    authorizedMaxCostUsd: authorization.authorizedMaxCostUsd,
  },
  policyBinding: {
    policyVersion: policy.policyVersion,
    policyFileSha256: sha256(policyBytes),
    policyCanonicalSha256: canonicalResearchRoutePolicySha256(policy),
    routeId: route.routeId,
    requestedProviderId: route.providerId,
    requestedModelId: route.requestedModelId,
    outputSchemaCanonicalSha256: LIVE_RESEARCH_APPROVED_OUTPUT_SCHEMA_SHA256,
    responseSchemaStrict: false,
  },
  requestBinding: {
    runnerFileSha256: sha256(runnerBytes),
    requestBodySha256: sha256(canonicalJson(requestBody)),
    promptSha256: sha256(prompt),
    sanitizedEvidenceSha256: sha256(canonicalJson(fixture)),
    canonicalRequestSha256: sha256(canonicalEnglishRequest),
  },
  liveCatalogObservation: {
    endpoint: "https://openrouter.ai/api/v1/endpoints/zdr",
    requestedAt: catalogStartedAt,
    observedAt: catalogObservedAt,
    httpStatus: catalogResponse.status,
    responseSha256: sha256(catalogBytes),
    modelId: endpoint.model_id,
    providerName: endpoint.provider_name,
    providerTag: endpoint.tag,
    status: endpoint.status,
    requiredCapabilities: [
      "response_format",
      "structured_outputs",
      "max_completion_tokens",
    ],
  },
  providerCall: {
    startedAt: providerStartedAt,
    completedAt: providerCompletedAt,
    httpStatus: response.status,
    elapsedMs,
    strategy: metadata.strategy,
    attempt: metadata.attempt,
    isByok: metadata.is_byok,
    servedProviderName: selected[0].provider,
    servedProviderId: "azure",
    requestedModelId: envelope.model,
    servedRouterModelId: selected[0].model,
    finishReason: choice.finish_reason,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    costUsd,
    generationIdSha256: sha256(generationId),
    responseContentSha256: sha256(content),
    routerMetadataSha256: sha256(canonicalJson(safeMetadata)),
    evidenceGraphSha256: sha256(canonicalJson(graph)),
    evidenceGraphValidation: "passed",
  },
  accounting: {
    pricingVersion: route.costPolicy.pricingVersion,
    accountingMode: route.costPolicy.accountingMode,
    sessionConsumedCalls: 1,
    sessionCostUsd: costUsd,
    supersededSessionCalls: 4,
    supersededSessionKnownCostUsd: 0.01900875,
    authorizationAggregateObservedCalls: 5,
    authorizationAggregateKnownCostUsd: 0.01900875 + costUsd,
    authorizationRemainingCalls: authorization.authorizedMaxCalls - 5,
    authorizationRemainingKnownCostUsd:
      authorization.authorizedMaxCostUsd - 0.01900875 - costUsd,
    callsWithinAuthorization: 1 <= authorization.authorizedMaxCalls,
    costWithinAuthorization: costUsd <= authorization.authorizedMaxCostUsd,
  },
  privacy: {
    requestLevelZdr: providerPolicy.zdr,
    dataCollection: providerPolicy.data_collection,
    requireParameters: providerPolicy.require_parameters,
    allowFallbacks: providerPolicy.allow_fallbacks,
    providerOnly: providerPolicy.only,
    providerOrder: providerPolicy.order,
    rawProviderPayloadPersisted: false,
    credentialsPersistedOrDisclosed: false,
  },
  pricingBundle: {
    version: route.costPolicy.pricingVersion,
    directGemini: {
      inheritedUnchangedFromPolicyVersion:
        "slice3-routes.2026-09-01.staging-qualified-v3",
      inheritedPolicyFileSha256:
        "b752d2d42a63aaad11f3b89f67bad64861ce767f633bee8190549df23a6f4155",
      accountingMode: "conservative_estimate",
      officialPricingRef: "https://ai.google.dev/gemini-api/docs/pricing",
      requestCostCeilingUsd: 1,
      searchCostCeilingUsd: 1,
    },
    openRouterAzure: {
      accountingMode: route.costPolicy.accountingMode,
      providerReportedCostUsd: costUsd,
      usageAccountingRef:
        "https://openrouter.ai/docs/cookbook/administration/usage-accounting",
    },
  },
  terminalDisposition: "PASS",
  recordedAt: new Date().toISOString(),
};
await writeFile(
  outputPath,
  await format(JSON.stringify(evidence), { parser: "json" }),
  {
    encoding: "utf8",
    mode: 0o600,
  },
);
process.stdout.write(
  JSON.stringify({
    disposition: evidence.terminalDisposition,
    evidencePath: outputPath,
    policyFileSha256: evidence.policyBinding.policyFileSha256,
    costUsd,
  }),
);
