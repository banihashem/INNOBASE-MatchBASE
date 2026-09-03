import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "../packages/data/node_modules/pg/lib/index.js";
import { validateResearchRoutePolicy } from "../packages/ai-evidence/dist/src/index.js";
import { canonicalResearchRoutePolicySha256 } from "../packages/application/dist/live-research-pipeline-identity.js";

const args = new Set(process.argv.slice(2));
const execute = args.size === 1 && args.has("--execute");
const verifyOnly = args.size === 1 && args.has("--verify");
if (!execute && !verifyOnly)
  throw new Error("Route registration requires exactly --execute or --verify.");
if (
  execute &&
  process.env.MATCHBASE_STAGING_ROUTE_REGISTRATION !==
    "I_AUTHORIZE_IMMUTABLE_STAGING_ROUTE_REGISTRATION"
)
  throw new Error("Staging route-registration acknowledgement is absent.");
const target = process.env.MATCHBASE_ROUTE_REGISTRATION_TARGET;
if (!new Set(["source", "eu"]).has(target))
  throw new Error("Route-registration target must be source or eu.");
const connectionString = process.env.MATCHBASE_ROUTE_REGISTRATION_DATABASE_URL;
if (!connectionString?.startsWith("postgres"))
  throw new Error("Route-registration database handle is absent.");
const url = new URL(connectionString);
if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname))
  throw new Error("Route registration requires a loopback Cloud SQL proxy.");

const root = resolve(import.meta.dirname, "..");
const [
  policyBytes,
  authorizationBytes,
  manifestBytes,
  manifestSignature,
  evidenceBytes,
  evidenceSignature,
  publicKeyBytes,
] = await Promise.all([
  readFile(
    resolve(root, "config/slice3/research-route-policy.staging.v4.json"),
  ),
  readFile(
    resolve(
      root,
      "governance/staging-route-qualification-authorization.v1.json",
    ),
  ),
  readFile(
    resolve(
      root,
      "evidence/slice3/staging-openrouter-azure-openai-qualification-manifest.v2.json",
    ),
  ),
  readFile(
    resolve(
      root,
      "evidence/slice3/staging-openrouter-azure-openai-qualification-manifest.v2.sig",
    ),
  ),
  readFile(
    resolve(
      root,
      "evidence/slice3/staging-openrouter-azure-openai-qualification.v2.json",
    ),
  ),
  readFile(
    resolve(
      root,
      "evidence/slice3/staging-openrouter-azure-openai-qualification.v2.sig",
    ),
  ),
  readFile(
    resolve(
      root,
      "evidence/slice3/staging-openrouter-azure-openai-qualification.v2.pub.pem",
    ),
  ),
]);
const policy = validateResearchRoutePolicy(JSON.parse(policyBytes));
const authorization = JSON.parse(authorizationBytes);
const manifest = JSON.parse(manifestBytes);
const evidence = JSON.parse(evidenceBytes);
const contentSha256 = canonicalResearchRoutePolicySha256(policy);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const publicKey = createPublicKey(publicKeyBytes);
if (
  policy.environment !== "staging" ||
  policy.policyVersion !== "slice3-routes.2026-09-02.staging-qualified-v4" ||
  authorization.authorizationId !== "MB-STG-ROUTE-QUAL-20260902-01" ||
  authorization.authorizedMaxCalls !== 50 ||
  authorization.authorizedMaxCostUsd !== 100 ||
  publicKey.asymmetricKeyType !== "rsa" ||
  publicKey.asymmetricKeyDetails?.modulusLength !== 3072 ||
  !verify("sha256", evidenceBytes, publicKey, evidenceSignature) ||
  !verify("sha256", manifestBytes, publicKey, manifestSignature) ||
  manifest.signatureAlgorithm !== "RSA_SIGN_PKCS1_3072_SHA256" ||
  manifest.signingKeyVersion !==
    "projects/innobase-matchbase-stg/locations/europe-west2/keyRings/matchbase-staging-evidence/cryptoKeys/checkpoint-signer/cryptoKeyVersions/1" ||
  manifest.artifacts?.evidence?.sha256 !== sha256(evidenceBytes) ||
  manifest.artifacts?.evidenceSignature?.sha256 !== sha256(evidenceSignature) ||
  manifest.artifacts?.publicKey?.sha256 !== sha256(publicKeyBytes) ||
  manifest.authorizationId !== authorization.authorizationId ||
  manifest.policyVersion !== policy.policyVersion ||
  manifest.policyFileSha256 !== sha256(policyBytes) ||
  evidence.authorization?.authorizationFileSha256 !==
    sha256(authorizationBytes) ||
  evidence.policyBinding?.policyVersion !== policy.policyVersion ||
  evidence.policyBinding?.policyFileSha256 !== sha256(policyBytes) ||
  evidence.policyBinding?.policyCanonicalSha256 !== contentSha256 ||
  evidence.policyBinding?.outputSchemaCanonicalSha256 !==
    manifest.outputSchemaCanonicalSha256 ||
  evidence.terminalDisposition !== "PASS" ||
  manifest.terminalDisposition !== "PASS"
)
  throw new Error("Governed Staging policy registration inputs are invalid.");

const policyId = "c1370004-0000-4000-8000-000000000004";
const routeIds = Object.freeze({
  gemini_direct: "c1370004-0000-4000-8000-000000000101",
  openrouter: "c1370004-0000-4000-8000-000000000102",
});
const officialEvidence = [
  ...new Set(policy.routes.flatMap((route) => route.dataHandling.evidenceRefs)),
  {
    kind: "kms_signed_qualification_manifest",
    path: "evidence/slice3/staging-openrouter-azure-openai-qualification-manifest.v2.json",
    sha256: sha256(manifestBytes),
    signing_key_version: manifest.signingKeyVersion,
  },
];
const budget = {
  max_calls: authorization.authorizedMaxCalls,
  max_cost_usd: authorization.authorizedMaxCostUsd,
};
const expectedRoutes = policy.routes.map((route) => ({
  providerRouteId: routeIds[route.path],
  routeId: route.routeId,
  provider: route.path === "gemini_direct" ? "gemini_direct" : "openrouter",
  modelId: route.requestedModelId,
  dataHandlingPosture:
    route.path === "gemini_direct" ? "paid_no_training" : "zdr_verified",
  timeoutMs: route.parameterPolicy.timeoutMs,
  maxAttempts: route.parameterPolicy.maxAttempts,
  retryPolicy: {
    backoff_ms: route.parameterPolicy.backoffMs,
    allow_fallbacks: route.parameterPolicy.allowFallbacks,
    require_parameters: route.parameterPolicy.requireParameters,
  },
  capabilities: ["CAP-SEARCH", "CAP-STRUCTURED-GENERATION"],
}));

const client = new pg.Client({
  connectionString,
  application_name: `matchbase-staging-v4-registration-${target}`,
});
try {
  await client.connect();
  await client.query(
    verifyOnly
      ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
      : "BEGIN ISOLATION LEVEL SERIALIZABLE",
  );
  await client.query("SET LOCAL lock_timeout='10s'");
  await client.query("SET LOCAL statement_timeout='30s'");
  const migrations = await client.query(
    "SELECT migration_id FROM matchbase_schema_migration ORDER BY applied_at,migration_id",
  );
  if (
    migrations.rows.at(-1)?.migration_id !==
    "0013_domain_pack_v2_and_legacy_annotation"
  )
    throw new Error("Staging database migration head is not qualified.");

  const existingPolicy = await client.query(
    `SELECT research_route_policy_id,schema_version,environment,activation_state,
            official_evidence,qualification_budget,encode(content_sha256,'hex') content_sha256
       FROM research_route_policy WHERE policy_version=$1 ${verifyOnly ? "" : "FOR SHARE"}`,
    [policy.policyVersion],
  );
  if (existingPolicy.rowCount === 0) {
    if (verifyOnly)
      throw new Error("Staging v4 route policy is absent during verification.");
    await client.query(
      `INSERT INTO research_route_policy
         (research_route_policy_id,schema_version,policy_version,environment,
          activation_state,official_evidence,qualification_budget,content_sha256)
       VALUES($1,'research-route-policy.v1',$2,'staging','qualified',$3::jsonb,$4::jsonb,decode($5,'hex'))`,
      [
        policyId,
        policy.policyVersion,
        JSON.stringify(officialEvidence),
        JSON.stringify(budget),
        contentSha256,
      ],
    );
  } else {
    const row = existingPolicy.rows[0];
    if (
      row.research_route_policy_id !== policyId ||
      row.schema_version !== "research-route-policy.v1" ||
      row.environment !== "staging" ||
      row.activation_state !== "qualified" ||
      row.content_sha256 !== contentSha256 ||
      JSON.stringify(row.official_evidence) !==
        JSON.stringify(officialEvidence) ||
      JSON.stringify(row.qualification_budget) !== JSON.stringify(budget)
    )
      throw new Error(
        "Existing Staging v4 route policy differs from governed bytes.",
      );
  }

  for (const route of expectedRoutes) {
    const existing = await client.query(
      `SELECT provider_route_id,provider,model_id,environment,route_kind,
              data_handling_posture,timeout_ms,max_attempts,retry_policy,enabled
         FROM provider_route WHERE route_id=$1 AND config_version=$2 ${verifyOnly ? "" : "FOR SHARE"}`,
      [route.routeId, policy.policyVersion],
    );
    if (existing.rowCount === 0) {
      if (verifyOnly)
        throw new Error(
          "Staging v4 provider route is absent during verification.",
        );
      await client.query(
        `INSERT INTO provider_route
           (provider_route_id,route_id,capability,provider,model_id,environment,
            route_kind,data_handling_posture,timeout_ms,max_attempts,retry_policy,
            config_version,enabled)
         VALUES($1,$2,'CAP-STRUCTURED-GENERATION',$3,$4,'staging','real_data',$5,$6,$7,$8::jsonb,$9,true)`,
        [
          route.providerRouteId,
          route.routeId,
          route.provider,
          route.modelId,
          route.dataHandlingPosture,
          route.timeoutMs,
          route.maxAttempts,
          JSON.stringify(route.retryPolicy),
          policy.policyVersion,
        ],
      );
    } else {
      const row = existing.rows[0];
      if (
        row.provider_route_id !== route.providerRouteId ||
        row.provider !== route.provider ||
        row.model_id !== route.modelId ||
        row.environment !== "staging" ||
        row.route_kind !== "real_data" ||
        row.data_handling_posture !== route.dataHandlingPosture ||
        row.timeout_ms !== route.timeoutMs ||
        row.max_attempts !== route.maxAttempts ||
        JSON.stringify(row.retry_policy) !==
          JSON.stringify(route.retryPolicy) ||
        row.enabled !== true
      )
        throw new Error(
          "Existing Staging v4 provider route differs from governed bytes.",
        );
    }
    for (const capability of route.capabilities) {
      const capabilityResult = await client.query(
        "SELECT count(*)::int count FROM provider_route_capability WHERE provider_route_id=$1 AND capability=$2",
        [route.providerRouteId, capability],
      );
      if (capabilityResult.rows[0].count === 0) {
        if (verifyOnly)
          throw new Error(
            "Staging v4 provider capability is absent during verification.",
          );
        await client.query(
          `INSERT INTO provider_route_capability(provider_route_id,capability)
           VALUES($1,$2)`,
          [route.providerRouteId, capability],
        );
      } else if (capabilityResult.rows[0].count !== 1) {
        throw new Error("Staging v4 provider capability is not unique.");
      }
    }
  }

  const verification = await client.query(
    `SELECT
       (SELECT count(*)::int FROM research_route_policy
         WHERE research_route_policy_id=$1 AND policy_version=$2
           AND environment='staging' AND activation_state='qualified'
           AND content_sha256=decode($3,'hex')) policy_count,
       (SELECT count(*)::int FROM provider_route
         WHERE config_version=$2 AND enabled AND environment='staging') route_count,
       (SELECT count(*)::int FROM provider_route_capability c
         JOIN provider_route r USING(provider_route_id)
         WHERE r.config_version=$2) capability_count`,
    [policyId, policy.policyVersion, contentSha256],
  );
  const counts = verification.rows[0];
  if (
    counts.policy_count !== 1 ||
    counts.route_count !== 2 ||
    counts.capability_count !== 4
  )
    throw new Error("Staging v4 route registration did not close exactly.");
  await client.query("COMMIT");
  process.stdout.write(
    JSON.stringify({
      target,
      mode: verifyOnly ? "verify" : "execute",
      policyVersion: policy.policyVersion,
      contentSha256,
      policyCount: counts.policy_count,
      routeCount: counts.route_count,
      capabilityCount: counts.capability_count,
      disposition: "PASS",
    }),
  );
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {}
  throw error;
} finally {
  await client.end();
}
