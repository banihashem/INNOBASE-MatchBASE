import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const read = async (path) =>
  await readFile(new URL(path, import.meta.url), "utf8");

test("Dockerfile is digest-pinned, frozen, standalone, and non-root", async () => {
  const dockerfile = await read("../../Dockerfile");
  const readme = await read("../../deployment/gcp/README.md");
  assert.match(dockerfile, /node:24\.14\.0-bookworm-slim@sha256:[a-f0-9]{64}/u);
  assert.match(dockerfile, /pnpm install --frozen-lockfile/u);
  assert.match(dockerfile, /\.next\/standalone\/apps\/web/u);
  assert.match(dockerfile, /USER 10001:10001/u);
  assert.match(dockerfile, /CMD \["node", "server\.js"\]/u);
  assert.match(dockerfile, /AS worker-runtime/u);
  assert.match(dockerfile, /Assert-ProductionWorkerPolicy\.mjs/u);
  assert.match(dockerfile, /ARG DEPLOYMENT_ENVIRONMENT/u);
  assert.match(dockerfile, /ARG ROUTE_POLICY_PATH/u);
  assert.match(dockerfile, /ARG ROUTE_POLICY_SHA256/u);
  assert.match(dockerfile, /runtime-entrypoint\.sh/u);
  assert.match(dockerfile, /ENTRYPOINT \["\/app\/runtime-entrypoint\.sh"\]/u);
  assert.match(
    dockerfile,
    /--config\.inject-workspace-packages=true --filter @matchbase\/application --prod deploy \/worker/u,
  );
  assert.match(
    dockerfile,
    /AS web-runtime[\s\S]*COPY --from=worker-packager --chown=10001:10001 \/worker-config\/research-route-policy\.v1\.json \.\/config\/slice3\/research-route-policy\.v1\.json[\s\S]*AS worker-runtime/u,
  );
  assert.match(
    readme,
    /docker build --pull --target web-runtime[\s\S]*--build-arg ROUTE_POLICY_PATH=\$routePolicyPath[\s\S]*--build-arg ROUTE_POLICY_SHA256=\$routePolicySha256[\s\S]*--tag staging-web/u,
  );
  assert.match(dockerfile, /CMD \["node", "dist\/combined-worker\.js"\]/u);
  assert.doesNotMatch(dockerfile, /APIKeys\.md|COPY\s+\.\s+\./u);
});

test("current blocked route policy refuses a production worker image", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL(
          "../../deployment/gcp/Assert-ProductionWorkerPolicy.mjs",
          import.meta.url,
        ),
      ),
      "production",
      fileURLToPath(
        new URL(
          "../../config/slice3/research-route-policy.v1.json",
          import.meta.url,
        ),
      ),
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /production worker image is blocked/u);
});

test("docker context excludes credentials, history, evidence, and generated output", async () => {
  const ignore = await read("../../.dockerignore");
  for (const entry of [
    "APIKeys.md",
    ".git",
    "evidence",
    "output",
    "tmp",
    ".env.*",
  ]) {
    assert.match(ignore, new RegExp(`^${entry.replaceAll(".", "\\.")}$`, "mu"));
  }
});

test("GCP scripts pin the target and require an explicit apply confirmation", async () => {
  const common = await read("../../deployment/gcp/Common.ps1");
  const foundation = await read(
    "../../deployment/gcp/Initialize-Foundation.ps1",
  );
  const deploy = await read("../../deployment/gcp/Deploy-CloudRun.ps1");
  const alb = await read("../../deployment/gcp/Initialize-ExternalAlb.ps1");
  for (const text of [common, foundation, deploy, alb]) {
    assert.doesNotMatch(text, /APIKeys\.md/u);
  }
  assert.match(common, /innobase-matchbase/u);
  assert.match(common, /innobase-matchbase-stg/u);
  assert.match(common, /matchbase\.innobase\.app/u);
  assert.match(common, /matchbase-staging\.innobase\.app/u);
  assert.match(common, /innobase-matchbase-stg-artifacts/u);
  assert.match(common, /innobase-matchbase-artifacts/u);
  assert.match(
    common,
    /staging\s*=\s*\[pscustomobject\]@\{[\s\S]*?CloudSqlInstanceConnectionName\s*=\s*"innobase-matchbase-stg:me-central1:matchbase-stg-pg18"[\s\S]*?production\s*=\s*\[pscustomobject\]@\{[\s\S]*?CloudSqlInstanceConnectionName\s*=\s*\$null/u,
  );
  assert.match(
    common,
    /staging\s*=\s*\[pscustomobject\]@\{[\s\S]*?WebGeminiSecretName\s*=\s*"matchbase-gemini-api-key"[\s\S]*?production\s*=\s*\[pscustomobject\]@\{[\s\S]*?WebGeminiSecretName\s*=\s*\$null/u,
  );
  assert.match(common, /me-central1/u);
  assert.match(common, /@sha256:\[a-f0-9\]\{64\}/u);
  for (const text of [foundation, deploy, alb]) {
    assert.match(
      text,
      /\[Parameter\(Mandatory\)\]\[ValidateSet\("staging", "production"\)\]\[string\]\$Environment/u,
    );
    assert.match(text, /ConfirmProjectId/u);
    assert.match(text, /if \(-not \$Apply\)/u);
    assert.doesNotMatch(text, /\$Environment\s*=\s*"production"/u);
  }
});

test("foundation and runtime plans preserve least privilege and fail-closed ingress", async () => {
  const foundation = await read(
    "../../deployment/gcp/Initialize-Foundation.ps1",
  );
  const deploy = await read("../../deployment/gcp/Deploy-CloudRun.ps1");
  assert.match(foundation, /--public-access-prevention/u);
  assert.match(foundation, /--uniform-bucket-level-access/u);
  assert.match(foundation, /--versioning/u);
  assert.match(foundation, /--soft-delete-duration=/u);
  assert.match(foundation, /roles\/storage\.objectViewer/u);
  assert.match(foundation, /roles\/storage\.objectCreator/u);
  assert.doesNotMatch(
    foundation,
    /roles\/(owner|editor|storage\.admin|iam\.serviceAccountUser)/u,
  );
  assert.match(deploy, /--ingress=internal-and-cloud-load-balancing/u);
  assert.match(deploy, /Assert-ImmutableImageDigest/u);
  assert.match(deploy, /Get-SecretReferenceParts/u);
  assert.match(deploy, /roles\/secretmanager\.secretAccessor/u);
  assert.match(deploy, /"run", "worker-pools", "deploy"/u);
  assert.equal(
    deploy.match(
      /"--set-cloudsql-instances=\$CloudSqlInstanceConnectionName"/gu,
    )?.length,
    2,
  );
  assert.match(
    deploy,
    /Cloud SQL instance connection is not approved for '\$Environment'/u,
  );
  assert.match(
    deploy,
    /\$CloudSqlInstanceConnectionName,[\s\S]*MATCHBASE_ENVIRONMENT/u,
  );
  assert.match(deploy, /"MATCHBASE_ENVIRONMENT=production"/u);
  assert.match(deploy, /"MATCHBASE_DEPLOYMENT_ENVIRONMENT=\$Environment"/u);
  assert.match(deploy, /"--min-instances=1"/u);
  assert.match(deploy, /"--max-instances=\$WebMaxInstances"/u);
  assert.doesNotMatch(deploy, /"--min=1"|"--max=\$WebMaxInstances"/u);
  assert.match(deploy, /MATCHBASE_IMAGE_DIGEST/u);
  assert.match(deploy, /MATCHBASE_ROUTE_POLICY_SHA256/u);
  assert.match(deploy, /MATCHBASE_ARTIFACT_MAXIMUM_BYTES=8388608/u);
  assert.match(deploy, /--concurrency=8/u);
  assert.match(deploy, /ExpectedImageName "\$Environment-web"/u);
  assert.match(deploy, /\$Environment-worker-\$routeIdentity/u);
  assert.match(deploy, /Assert-ExactSecretAccessorBindings/u);
  assert.match(deploy, /MATCHBASE_ORIGIN_ADMISSION_KEY/u);
  assert.match(
    deploy,
    /\$webRequiredSecrets\s*=\s*@\([\s\S]*"MATCHBASE_GEMINI_API_KEY"/u,
  );
  assert.match(
    deploy,
    /Web MATCHBASE_GEMINI_API_KEY must bind the approved '\$WebGeminiSecretName' secret/u,
  );
  assert.match(
    deploy,
    /Web MATCHBASE_OPENROUTER_API_KEY is prohibited; OpenRouter credentials are worker-only/u,
  );
  assert.match(deploy, /"MATCHBASE_LIVE_RESEARCH_ENABLED=true"/u);
  assert.match(deploy, /"MATCHBASE_LIVE_RESEARCH_CREDENTIALS_VERIFIED=true"/u);
  const workerEnvironmentBlock = deploy.match(
    /\$workerEnv\s*=\s*@\(([\s\S]*?)\)\s*-join\s*","/u,
  )?.[1];
  assert.ok(workerEnvironmentBlock);
  assert.doesNotMatch(
    workerEnvironmentBlock,
    /MATCHBASE_LIVE_RESEARCH_CREDENTIALS_VERIFIED/u,
  );
  assert.ok(
    deploy.indexOf("Assert-ExactSecretAccessorBindings -Email $workerEmail") <
      deploy.indexOf("Invoke-Gcloud -Arguments $webCommand"),
  );
  assert.match(
    deploy,
    /Web deployed identity is missing the verified worker-credential marker/u,
  );
  assert.match(
    deploy,
    /Web deployed identity contains a prohibited OpenRouter credential/u,
  );
  assert.match(deploy, /Assert-NoUserManagedServiceAccountKeys/u);
  assert.match(foundation, /Assert-ExactProjectRoles/u);
  assert.match(foundation, /Assert-NoAncestorRoles/u);
  assert.match(foundation, /Assert-ExactArtifactRepositoryRoles/u);
  assert.doesNotMatch(deploy, /--allow-unauthenticated/u);
});

test("ALB plan uses a global HTTPS-only external managed frontend", async () => {
  const alb = await read("../../deployment/gcp/Initialize-ExternalAlb.ps1");
  assert.match(alb, /--network-endpoint-type=serverless/u);
  assert.match(alb, /--cloud-run-service=/u);
  assert.match(alb, /--load-balancing-scheme=EXTERNAL_MANAGED/u);
  assert.match(alb, /ssl-certificates/u);
  assert.match(alb, /--ports=443/u);
  assert.match(alb, /CloudflareSourceIpv4Range/u);
  assert.match(alb, /inIpRange\(origin\.ip/u);
  assert.match(alb, /request\.headers\['host'\]\.lower\(\)/u);
  assert.match(alb, /--action=deny-403/u);
  assert.match(alb, /--security-policy=\$SecurityPolicyName/u);
  assert.match(alb, /origin-admission policy is not bound/u);
  assert.doesNotMatch(alb, /--ports=80/u);
});

test("runtime entrypoint rejects non-production image and route-policy identity drift", async () => {
  const entrypoint = await read("../../deployment/gcp/runtime-entrypoint.sh");
  assert.match(entrypoint, /MATCHBASE_ENVIRONMENT:-.*production/u);
  assert.match(entrypoint, /MATCHBASE_DEPLOYMENT_ENVIRONMENT/u);
  assert.match(entrypoint, /MATCHBASE_IMAGE_DIGEST/u);
  assert.match(entrypoint, /MATCHBASE_ROUTE_POLICY_SHA256/u);
  assert.match(entrypoint, /web\|worker/u);
  assert.match(entrypoint, /Runtime governed route-policy bytes do not match/u);
  assert.match(entrypoint, /policy\.liveActivation!=="enabled"/u);
  assert.match(entrypoint, /exec "\$@"/u);
});

test("artifact buffering remains inside the reserved one-GiB instance budget", async () => {
  const deploy = await read("../../deployment/gcp/Deploy-CloudRun.ps1");
  const maximumBytes = Number(
    deploy.match(/MATCHBASE_ARTIFACT_MAXIMUM_BYTES=(\d+)/u)?.[1],
  );
  const concurrency = Number(deploy.match(/--concurrency=(\d+)/u)?.[1]);
  const conservativeCopyFactor = 3;
  const reservedRuntimeBytes = 512 * 1024 * 1024;
  assert.ok(maximumBytes > 0);
  assert.ok(concurrency > 0);
  assert.ok(
    maximumBytes * concurrency * conservativeCopyFactor <= reservedRuntimeBytes,
  );
});
