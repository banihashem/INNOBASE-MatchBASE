import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const commonPath = fileURLToPath(
  new URL("../../deployment/gcp/Common.ps1", import.meta.url),
);
const deployPath = fileURLToPath(
  new URL("../../deployment/gcp/Deploy-CloudRun.ps1", import.meta.url),
);
const policyPath = fileURLToPath(
  new URL(
    "../../config/slice3/research-route-policy.staging.v3.json",
    import.meta.url,
  ),
);
const policyIdentity = createHash("sha256")
  .update(readFileSync(policyPath))
  .digest("hex")
  .slice(0, 16);
const digest = `sha256:${"a".repeat(64)}`;
const webSecrets = [
  "DATABASE_URL=matchbase-db-runtime-url-ew2:1",
  "MATCHBASE_DIGEST_KEY=matchbase-digest-key-ew2:1",
  "GOOGLE_CLIENT_ID=matchbase-google-client-id-ew2:1",
  "GOOGLE_CLIENT_SECRET=matchbase-google-client-secret-ew2:1",
  "MATCHBASE_ORIGIN_ADMISSION_KEY=matchbase-origin-admission-key-ew2:1",
  "MATCHBASE_GEMINI_API_KEY=matchbase-gemini-api-key-ew2:1",
];
const workerSecrets = [
  "DATABASE_URL=matchbase-db-runtime-url-ew2:1",
  "MATCHBASE_DIGEST_KEY=matchbase-digest-key-ew2:1",
  "MATCHBASE_GEMINI_API_KEY=matchbase-gemini-api-key-ew2:1",
  "MATCHBASE_OPENROUTER_API_KEY=matchbase-openrouter-api-key-ew2:1",
];

function deployPlan(overrides = {}) {
  const selectedWebSecrets = overrides.webSecrets ?? webSecrets;
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const array = (values) => `@(${values.map(quote).join(",")})`;
  const command = [
    `& ${quote(deployPath)}`,
    "-Environment staging",
    "-DeploymentTarget staging-eu",
    "-ArtifactRepository matchbase",
    "-WebServiceName matchbase-staging-web",
    "-WorkerPoolName matchbase-staging-worker",
    "-WebServiceAccountName matchbase-staging-web-sa",
    "-WorkerServiceAccountName matchbase-staging-worker-sa",
    `-WebImageDigest ${quote(`europe-west2-docker.pkg.dev/innobase-matchbase-stg/matchbase/staging-web@${digest}`)}`,
    `-WorkerImageDigest ${quote(`europe-west2-docker.pkg.dev/innobase-matchbase-stg/matchbase/staging-worker-${policyIdentity}@${digest}`)}`,
    `-RoutePolicyPath ${quote(policyPath)}`,
    `-WebSecretVersionRef ${array(selectedWebSecrets)}`,
    `-WorkerSecretVersionRef ${array(workerSecrets)}`,
    "-WebMaxInstances 2",
    "-WorkerInstances 1",
  ].join(" ");
  return spawnSync("pwsh", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
  });
}

test("Common exposes one exact closed EU Staging runtime target", () => {
  const command = `. '${commonPath.replaceAll("'", "''")}'; Get-MatchBaseTarget -Environment staging-eu | ConvertTo-Json -Depth 5 -Compress`;
  const result = spawnSync("pwsh", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const target = JSON.parse(result.stdout.trim());
  assert.equal(target.Environment, "staging");
  assert.equal(target.DeploymentTarget, "staging-eu");
  assert.equal(target.Region, "europe-west2");
  assert.equal(
    target.CloudSqlInstanceConnectionName,
    "innobase-matchbase-stg:europe-west2:matchbase-stg-pg18-ew2",
  );
  assert.equal(target.ArtifactBucket, "innobase-matchbase-stg-eu-artifacts");
  assert.equal(
    target.SecretNameMap.MATCHBASE_OPENROUTER_API_KEY,
    "matchbase-openrouter-api-key-ew2",
  );
});

test("EU Staging deploy plan binds region, database, bucket, identity, and secret map", () => {
  const result = deployPlan();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--region=europe-west2/u);
  assert.match(
    result.stdout,
    /--set-cloudsql-instances=innobase-matchbase-stg:europe-west2:matchbase-stg-pg18-ew2/u,
  );
  assert.match(
    result.stdout,
    /MATCHBASE_ARTIFACT_GCS_BUCKET=innobase-matchbase-stg-eu-artifacts/u,
  );
  assert.match(result.stdout, /MATCHBASE_DEPLOYMENT_TARGET=staging-eu/u);
  assert.match(result.stdout, /matchbase-db-runtime-url-ew2:1/u);
});

test("EU Staging deploy rejects a non-EU secret name before any cloud call", () => {
  const result = deployPlan({
    webSecrets: webSecrets.map((reference) =>
      reference.startsWith("DATABASE_URL=")
        ? "DATABASE_URL=matchbase-db-runtime-url:1"
        : reference,
    ),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /outside the closed target secret-name map/iu);
  assert.doesNotMatch(result.stdout, /^gcloud /mu);
});
