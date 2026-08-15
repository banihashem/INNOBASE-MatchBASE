import type {
  ResearchCapability,
  ResearchRouteDefinitionV1,
  ResearchRoutePolicyV1,
  ResearchRouteSnapshotV1,
} from "@matchbase/contracts";

const ENVIRONMENTS = new Set(["local", "test", "staging", "production"]);
const PATHS = new Set(["gemini_direct", "openrouter"]);
const CAPABILITIES = new Set<ResearchCapability>([
  "query_planning",
  "web_search_grounding",
  "retrieval",
  "structured_extraction",
  "advisory_synthesis",
]);
const POLICY_FIELDS = new Set([
  "schemaVersion",
  "policyVersion",
  "capabilityPolicyVersion",
  "environment",
  "evaluatedAt",
  "liveActivation",
  "routes",
]);
const ROUTE_FIELDS = new Set([
  "routeId",
  "adapterId",
  "adapterVersion",
  "path",
  "providerId",
  "requestedModelId",
  "expectedServedModelId",
  "enabled",
  "liveQualified",
  "fallbackPosition",
  "capabilities",
  "parameterPolicy",
  "dataHandling",
  "costPolicy",
]);
const PARAMETER_FIELDS = new Set([
  "policyVersion",
  "searchMode",
  "structuredOutput",
  "requireParameters",
  "allowFallbacks",
  "maxOutputTokens",
  "temperature",
  "timeoutMs",
  "maxAttempts",
  "backoffMs",
]);
const DATA_FIELDS = new Set([
  "evidenceVersion",
  "evidenceRefs",
  "evidenceAccessedAt",
  "evidenceExpiresAt",
  "paidPath",
  "retentionTrainingPosture",
]);
const COST_FIELDS = new Set([
  "pricingState",
  "pricingVersion",
  "currency",
  "accountingMode",
]);
const SNAPSHOT_FIELDS = new Set([
  "schemaVersion",
  "snapshotId",
  "runId",
  "policyVersion",
  "routeId",
  "adapterId",
  "adapterVersion",
  "path",
  "providerId",
  "requestedModelId",
  "expectedServedProviderId",
  "expectedServedModelId",
  "servedProviderId",
  "servedModelId",
  "terminalDisposition",
  "capabilityPolicyVersion",
  "parameterPolicy",
  "dataHandlingEvidenceVersion",
  "fallbackPosition",
  "capturedAt",
]);
const SECRET_FIELD =
  /(?:api.?key|authorization|credential|password|secret|access.?token)/iu;
const SECRET_VALUE =
  /(?:bearer\s+[a-z0-9._-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|token|secret|apikey)[-_][a-z0-9_-]{8,}\b|\bAKIA[A-Z0-9]{16}\b|\bAIza[A-Za-z0-9_-]{20,}\b)/iu;
const IMPLICIT_ID =
  /(?:^|[/:._-])(?:auto|default|latest|any)(?:$|[/:._-])|[*?]/iu;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a closed object.`);
  }
  return value as Record<string, unknown>;
}

function assertClosed(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((field) => !fields.has(field));
  if (unknown.length > 0) {
    throw new Error(
      `${label} contains unsupported fields: ${unknown.join(", ")}.`,
    );
  }
}

function canonical(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error(`${label} must be explicit canonical text.`);
  }
  return value;
}

function isoInstant(value: unknown, label: string): string {
  const candidate = canonical(value, label);
  if (
    Number.isNaN(Date.parse(candidate)) ||
    new Date(candidate).toISOString() !== candidate
  ) {
    throw new Error(`${label} must be a canonical ISO instant.`);
  }
  return candidate;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function containsSecret(value: unknown): boolean {
  if (typeof value === "string") return SECRET_VALUE.test(value);
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSecret);
  return Object.entries(value).some(
    ([field, nested]) => SECRET_FIELD.test(field) || containsSecret(nested),
  );
}

function explicitIdentity(value: unknown, label: string): string {
  const identity = canonical(value, label);
  if (IMPLICIT_ID.test(identity)) {
    throw new Error(`${label} cannot be auto, wildcard, implicit, or mutable.`);
  }
  return identity;
}

function validateEvidenceReference(reference: unknown, label: string): void {
  const raw = canonical(reference, label);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} must be an absolute HTTPS reference.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${label} must be a credential-free HTTPS reference.`);
  }
}

function validateParameterPolicy(value: unknown, label: string): void {
  const policy = object(value, label);
  assertClosed(policy, PARAMETER_FIELDS, label);
  canonical(policy.policyVersion, `${label}.policyVersion`);
  if (
    !new Set(["provider_native_web_search", "external_sanitized_evidence"]).has(
      String(policy.searchMode),
    )
  ) {
    throw new Error(`${label}.searchMode is outside the closed set.`);
  }
  if (policy.structuredOutput !== "json_schema") {
    throw new Error(`${label}.structuredOutput must be json_schema.`);
  }
  if (policy.requireParameters !== true || policy.allowFallbacks !== false) {
    throw new Error(
      `${label} must close parameter support and provider fallback.`,
    );
  }
  if (
    typeof policy.maxOutputTokens !== "number" ||
    !Number.isInteger(policy.maxOutputTokens) ||
    policy.maxOutputTokens < 1 ||
    policy.maxOutputTokens > 65_536
  ) {
    throw new Error(`${label}.maxOutputTokens is outside the closed range.`);
  }
  if (
    typeof policy.temperature !== "number" ||
    !Number.isFinite(policy.temperature) ||
    policy.temperature < 0 ||
    policy.temperature > 2
  ) {
    throw new Error(`${label}.temperature is outside the closed range.`);
  }
  if (
    typeof policy.timeoutMs !== "number" ||
    !Number.isInteger(policy.timeoutMs) ||
    policy.timeoutMs < 1 ||
    policy.timeoutMs > 120_000
  ) {
    throw new Error(`${label}.timeoutMs is outside the closed range.`);
  }
  if (
    typeof policy.maxAttempts !== "number" ||
    !Number.isInteger(policy.maxAttempts) ||
    policy.maxAttempts < 1 ||
    policy.maxAttempts > 3
  ) {
    throw new Error(`${label}.maxAttempts is outside the closed range.`);
  }
  if (
    typeof policy.backoffMs !== "number" ||
    !Number.isInteger(policy.backoffMs) ||
    policy.backoffMs < 0 ||
    policy.backoffMs > 10_000
  ) {
    throw new Error(`${label}.backoffMs is outside the closed range.`);
  }
}

function validateRoute(
  value: unknown,
  policy: Pick<ResearchRoutePolicyV1, "environment" | "evaluatedAt">,
): ResearchRouteDefinitionV1 {
  const route = object(value, "research route");
  assertClosed(route, ROUTE_FIELDS, "research route");
  const routeId = explicitIdentity(route.routeId, "routeId");
  if (!PATHS.has(String(route.path)) || route.adapterId !== route.path) {
    throw new Error(`Route ${routeId} has a mismatched path and adapter.`);
  }
  canonical(route.adapterVersion, `Route ${routeId} adapterVersion`);
  const providerId = explicitIdentity(
    route.providerId,
    `Route ${routeId} providerId`,
  );
  if (route.path === "gemini_direct" && providerId !== "google") {
    throw new Error(`Route ${routeId} direct Gemini provider must be google.`);
  }
  if (route.path === "openrouter" && providerId === "openrouter") {
    throw new Error(`Route ${routeId} must name the explicit served provider.`);
  }
  const requestedModelId = explicitIdentity(
    route.requestedModelId,
    `Route ${routeId} requestedModelId`,
  );
  const expectedServedModelId = explicitIdentity(
    route.expectedServedModelId,
    `Route ${routeId} expectedServedModelId`,
  );
  if (requestedModelId !== expectedServedModelId) {
    throw new Error(
      `Route ${routeId} requested and expected model identities differ.`,
    );
  }
  const enabled = boolean(route.enabled, `Route ${routeId} enabled`);
  const liveQualified = boolean(
    route.liveQualified,
    `Route ${routeId} liveQualified`,
  );
  nonNegativeInteger(
    route.fallbackPosition,
    `Route ${routeId} fallbackPosition`,
  );
  if (
    !Array.isArray(route.capabilities) ||
    route.capabilities.length === 0 ||
    route.capabilities.some((capability) => !CAPABILITIES.has(capability)) ||
    new Set(route.capabilities).size !== route.capabilities.length
  ) {
    throw new Error(`Route ${routeId} has an invalid capability set.`);
  }
  const capabilityValues = route.capabilities as ResearchCapability[];
  validateParameterPolicy(
    route.parameterPolicy,
    `Route ${routeId} parameterPolicy`,
  );
  const parameterPolicy = route.parameterPolicy as Record<string, unknown>;
  if (
    (route.path === "gemini_direct" &&
      parameterPolicy.searchMode !== "provider_native_web_search") ||
    (route.path === "openrouter" &&
      parameterPolicy.searchMode !== "external_sanitized_evidence")
  ) {
    throw new Error(`Route ${routeId} searchMode violates its path policy.`);
  }

  const data = object(route.dataHandling, `Route ${routeId} dataHandling`);
  assertClosed(data, DATA_FIELDS, `Route ${routeId} dataHandling`);
  canonical(data.evidenceVersion, `Route ${routeId} evidenceVersion`);
  if (!Array.isArray(data.evidenceRefs)) {
    throw new Error(`Route ${routeId} evidenceRefs must be an array.`);
  }
  data.evidenceRefs.forEach((reference, index) =>
    validateEvidenceReference(
      reference,
      `Route ${routeId} evidenceRefs[${index}]`,
    ),
  );
  const evidenceAccessedAt = isoInstant(
    data.evidenceAccessedAt,
    `Route ${routeId} evidenceAccessedAt`,
  );
  const evidenceExpiresAt = isoInstant(
    data.evidenceExpiresAt,
    `Route ${routeId} evidenceExpiresAt`,
  );
  if (
    evidenceAccessedAt > policy.evaluatedAt ||
    evidenceExpiresAt < policy.evaluatedAt ||
    evidenceAccessedAt > evidenceExpiresAt
  ) {
    throw new Error(`Route ${routeId} data-handling evidence is not current.`);
  }
  if (!new Set(["verified", "unverified"]).has(String(data.paidPath))) {
    throw new Error(`Route ${routeId} paidPath is invalid.`);
  }
  if (
    !new Set(["verified_no_training", "verified_zdr", "unknown"]).has(
      String(data.retentionTrainingPosture),
    )
  ) {
    throw new Error(`Route ${routeId} retention/training posture is invalid.`);
  }

  const cost = object(route.costPolicy, `Route ${routeId} costPolicy`);
  assertClosed(cost, COST_FIELDS, `Route ${routeId} costPolicy`);
  if (!new Set(["known", "unknown"]).has(String(cost.pricingState))) {
    throw new Error(`Route ${routeId} pricingState is invalid.`);
  }
  canonical(cost.pricingVersion, `Route ${routeId} pricingVersion`);
  canonical(cost.currency, `Route ${routeId} currency`);
  if (
    !new Set(["provider_reported", "conservative_estimate", "unavailable"]).has(
      String(cost.accountingMode),
    )
  ) {
    throw new Error(`Route ${routeId} accountingMode is invalid.`);
  }

  if (enabled) {
    const missingCapabilities = [...CAPABILITIES].filter(
      (capability) => !capabilityValues.includes(capability),
    );
    if (
      !liveQualified ||
      data.paidPath !== "verified" ||
      data.retentionTrainingPosture === "unknown" ||
      data.evidenceRefs.length === 0 ||
      cost.pricingState !== "known" ||
      cost.accountingMode === "unavailable" ||
      missingCapabilities.length > 0
    ) {
      throw new Error(
        `Route ${routeId} activation gates are incomplete or cost is unknown.`,
      );
    }
  }
  return value as ResearchRouteDefinitionV1;
}

export function validateResearchRoutePolicy(
  value: unknown,
): ResearchRoutePolicyV1 {
  if (containsSecret(value)) {
    throw new Error("Research route policy contains secret-bearing material.");
  }
  const policy = object(value, "research route policy");
  assertClosed(policy, POLICY_FIELDS, "research route policy");
  if (policy.schemaVersion !== "research-route-policy.v1") {
    throw new Error("Research route policy schemaVersion is invalid.");
  }
  canonical(policy.policyVersion, "policyVersion");
  canonical(policy.capabilityPolicyVersion, "capabilityPolicyVersion");
  if (!ENVIRONMENTS.has(String(policy.environment))) {
    throw new Error("Research route policy environment is invalid.");
  }
  const evaluatedAt = isoInstant(policy.evaluatedAt, "evaluatedAt");
  if (!new Set(["enabled", "blocked"]).has(String(policy.liveActivation))) {
    throw new Error("Research route policy liveActivation is invalid.");
  }
  if (!Array.isArray(policy.routes) || policy.routes.length === 0) {
    throw new Error("Research route policy must contain routes.");
  }
  const typedPolicy = policy as unknown as ResearchRoutePolicyV1;
  const routeIds = new Set<string>();
  const fallbackPositions = new Set<number>();
  const routes = policy.routes.map((route) =>
    validateRoute(route, {
      environment: typedPolicy.environment,
      evaluatedAt,
    }),
  );
  for (const route of routes) {
    const routeKey = route.routeId.toLowerCase();
    if (routeIds.has(routeKey))
      throw new Error(`Duplicate routeId: ${route.routeId}.`);
    routeIds.add(routeKey);
    if (fallbackPositions.has(route.fallbackPosition)) {
      throw new Error(`Duplicate fallbackPosition: ${route.fallbackPosition}.`);
    }
    fallbackPositions.add(route.fallbackPosition);
  }
  const enabled = routes.filter((route) => route.enabled);
  if (policy.liveActivation === "enabled") {
    if (
      enabled.length !== 2 ||
      !enabled.some((route) => route.path === "gemini_direct") ||
      !enabled.some((route) => route.path === "openrouter") ||
      enabled.some((route, index) => route.fallbackPosition !== index)
    ) {
      throw new Error(
        "Live activation requires exactly one direct Gemini and one explicit OpenRouter route in closed fallback order.",
      );
    }
  } else if (enabled.length > 0) {
    throw new Error("Blocked live activation cannot contain enabled routes.");
  }
  return typedPolicy;
}

export function resolveActiveResearchRoute(
  policyValue: unknown,
  routeId: string,
  at: string,
): ResearchRouteDefinitionV1 {
  const policy = validateResearchRoutePolicy(policyValue);
  const currentAt = isoInstant(at, "route activation time");
  if (policy.liveActivation !== "enabled") {
    throw new Error("Research live activation is blocked.");
  }
  const route = policy.routes.find(
    (candidate) => candidate.routeId === routeId,
  );
  if (!route || !route.enabled)
    throw new Error("Research route is not enabled.");
  if (currentAt > route.dataHandling.evidenceExpiresAt) {
    throw new Error("Research route data-handling evidence is stale.");
  }
  return route;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

export function createResearchRouteSnapshot(input: {
  readonly policy: ResearchRoutePolicyV1;
  readonly route: ResearchRouteDefinitionV1;
  readonly snapshotId: string;
  readonly runId: string;
  readonly servedProviderId: string | null;
  readonly servedModelId: string | null;
  readonly terminalDisposition: "ok" | "failed" | "cancelled";
  readonly capturedAt: string;
}): ResearchRouteSnapshotV1 {
  const snapshotId = canonical(input.snapshotId, "snapshotId");
  const runId = canonical(input.runId, "runId");
  const servedProviderId =
    input.servedProviderId === null
      ? null
      : explicitIdentity(input.servedProviderId, "servedProviderId");
  const servedModelId =
    input.servedModelId === null
      ? null
      : explicitIdentity(input.servedModelId, "servedModelId");
  const capturedAt = isoInstant(input.capturedAt, "capturedAt");
  if ((servedProviderId === null) !== (servedModelId === null)) {
    throw new Error(
      "Served provider/model identity must be jointly present or absent.",
    );
  }
  if (input.terminalDisposition === "ok" && servedProviderId === null) {
    throw new Error("Successful route snapshots require served identity.");
  }
  if (input.terminalDisposition !== "ok" && servedProviderId !== null) {
    throw new Error(
      "Unsuccessful route snapshots cannot claim served identity.",
    );
  }
  if (
    servedProviderId !== null &&
    (servedProviderId !== input.route.providerId ||
      servedModelId !== input.route.expectedServedModelId)
  ) {
    throw new Error(
      "Served provider/model identity does not match the frozen route.",
    );
  }
  const snapshot: ResearchRouteSnapshotV1 = {
    schemaVersion: "research-route-snapshot.v1",
    snapshotId,
    runId,
    policyVersion: input.policy.policyVersion,
    routeId: input.route.routeId,
    adapterId: input.route.adapterId,
    adapterVersion: input.route.adapterVersion,
    path: input.route.path,
    providerId: input.route.providerId,
    requestedModelId: input.route.requestedModelId,
    expectedServedProviderId: input.route.providerId,
    expectedServedModelId: input.route.expectedServedModelId,
    servedProviderId,
    servedModelId,
    terminalDisposition: input.terminalDisposition,
    capabilityPolicyVersion: input.policy.capabilityPolicyVersion,
    parameterPolicy: { ...input.route.parameterPolicy },
    dataHandlingEvidenceVersion: input.route.dataHandling.evidenceVersion,
    fallbackPosition: input.route.fallbackPosition,
    capturedAt,
  };
  return deepFreeze(snapshot);
}

export function validateResearchRouteSnapshot(
  value: unknown,
): ResearchRouteSnapshotV1 {
  if (containsSecret(value)) {
    throw new Error(
      "Research route snapshot contains secret-bearing material.",
    );
  }
  const snapshot = object(value, "research route snapshot");
  assertClosed(snapshot, SNAPSHOT_FIELDS, "research route snapshot");
  if (snapshot.schemaVersion !== "research-route-snapshot.v1") {
    throw new Error("Research route snapshot schemaVersion is invalid.");
  }
  for (const field of [
    "snapshotId",
    "runId",
    "policyVersion",
    "routeId",
    "adapterVersion",
    "providerId",
    "capabilityPolicyVersion",
    "dataHandlingEvidenceVersion",
  ]) {
    canonical(snapshot[field], field);
  }
  if (
    !PATHS.has(String(snapshot.path)) ||
    snapshot.adapterId !== snapshot.path
  ) {
    throw new Error("Research route snapshot adapter/path is invalid.");
  }
  explicitIdentity(snapshot.requestedModelId, "requestedModelId");
  const expectedProvider = explicitIdentity(
    snapshot.expectedServedProviderId,
    "expectedServedProviderId",
  );
  const expectedModel = explicitIdentity(
    snapshot.expectedServedModelId,
    "expectedServedModelId",
  );
  if (
    !new Set(["ok", "failed", "cancelled"]).has(
      String(snapshot.terminalDisposition),
    )
  ) {
    throw new Error("Research route snapshot terminalDisposition is invalid.");
  }
  const servedProvider = snapshot.servedProviderId;
  const servedModel = snapshot.servedModelId;
  if ((servedProvider === null) !== (servedModel === null)) {
    throw new Error("Research route snapshot served identity is incomplete.");
  }
  if (snapshot.terminalDisposition === "ok") {
    if (
      explicitIdentity(servedProvider, "servedProviderId") !==
        expectedProvider ||
      explicitIdentity(servedModel, "servedModelId") !== expectedModel
    ) {
      throw new Error(
        "Research route snapshot served identity is outside the frozen route.",
      );
    }
  } else if (servedProvider !== null) {
    throw new Error(
      "Unsuccessful route snapshot cannot claim served identity.",
    );
  }
  nonNegativeInteger(snapshot.fallbackPosition, "fallbackPosition");
  isoInstant(snapshot.capturedAt, "capturedAt");
  validateParameterPolicy(snapshot.parameterPolicy, "parameterPolicy");
  return value as ResearchRouteSnapshotV1;
}
