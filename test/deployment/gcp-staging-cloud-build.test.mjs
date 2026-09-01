import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("governed Staging Cloud Build binds exact Git material, images and provenance", async () => {
  const [config, publisher] = await Promise.all([
    readFile(new URL("../../cloudbuild.staging.yaml", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../../deployment/gcp/Publish-StagingImages.ps1",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(
    config,
    /--target\n\s+- web-runtime[\s\S]*--target\n\s+- worker-runtime/u,
  );
  assert.equal((config.match(/--pull/gu) ?? []).length, 2);
  const dockerSteps = config
    .split(/^  - name: gcr\.io\/cloud-builders\/docker\s*$/gmu)
    .slice(1);
  assert.equal(dockerSteps.length, 2);
  assert.match(dockerSteps[0], /DOCKER_BUILDKIT=1[\s\S]*web-runtime/u);
  assert.match(dockerSteps[1], /DOCKER_BUILDKIT=1[\s\S]*worker-runtime/u);
  for (const step of dockerSteps)
    assert.equal((step.match(/DOCKER_BUILDKIT=1/gu) ?? []).length, 1);
  assert.equal(
    (
      config.match(
        /ROUTE_POLICY_PATH=config\/slice3\/research-route-policy\.staging\.v3\.json/gu,
      ) ?? []
    ).length,
    2,
  );
  assert.equal(
    (config.match(/ROUTE_POLICY_SHA256=\$\{_ROUTE_POLICY_SHA256\}/gu) ?? [])
      .length,
    2,
  );
  assert.match(config, /^images:\n(?:\s+- .+\n){2}/mu);
  assert.match(
    config,
    /^options:\n  logging: CLOUD_LOGGING_ONLY\n  requestedVerifyOption: VERIFIED$/mu,
  );
  assert.equal(
    (config.match(/requestedVerifyOption: VERIFIED/gu) ?? []).length,
    1,
  );
  assert.doesNotMatch(config, /docker\s+push|\n\s+- push\s*$/imu);
  assert.match(publisher, /status --porcelain=v1 --untracked-files=all/u);
  assert.match(publisher, /ls-remote origin refs\/heads\/main/u);
  assert.match(
    publisher,
    /builds", "submit", \$sourceRepository, "--revision=\$CandidateCommit"/u,
  );
  assert.doesNotMatch(publisher, /--git-source-revision/u);
  assert.match(
    publisher,
    /connections", "describe"[\s\S]*repositories", "describe"/u,
  );
  assert.match(publisher, /cloudbuild\.googleapis\.com/u);
  assert.match(publisher, /artifactregistry\.googleapis\.com/u);
  assert.match(publisher, /containeranalysis\.googleapis\.com/u);
  assert.match(publisher, /repositories", "describe"[\s\S]*--format=json/u);
  assert.equal(
    (publisher.match(/Invoke-GcloudStdout[^\n]+--format=json/gu) ?? []).length,
    6,
  );
  assert.doesNotMatch(
    publisher,
    /Invoke-Gcloud -Arguments[^\n]+--format=json/u,
  );
  assert.match(publisher, /immutableTags/u);
  assert.match(publisher, /Invoke-BoundedProvenanceProbe/u);
  assert.match(
    publisher,
    /@\(\$buildIds \| Sort-Object -Unique\)\.Count -ne 1/u,
  );
  assert.match(publisher, /builds", "describe", \$buildIds\[0\]/u);
  assert.ok(
    publisher.indexOf('builds", "describe", $buildIds[0]') <
      publisher.indexOf("$published | Write-Output"),
    "build record must validate before published digests are emitted",
  );
  assert.match(publisher, /DOCKER/u);
  assert.match(
    publisher,
    /containeranalysis\.occurrences\.get[\s\S]*containeranalysis\.occurrences\.list/u,
  );
  assert.match(
    publisher,
    /Assert-ExactArtifactRepositoryRoles[\s\S]*roles\/artifactregistry\.writer/u,
  );
  assert.match(publisher, /staging-eu-provenance/u);
  assert.match(publisher, /--show-provenance/u);
  assert.match(publisher, /roles\/iam\.serviceAccountTokenCreator/u);
  assert.match(publisher, /gcp-sa-cloudbuild\.iam\.gserviceaccount\.com/u);
  assert.match(publisher, /roles\/iam\.serviceAccountUser/u);
  assert.match(publisher, /extra or missing binding/u);
  assert.match(
    publisher,
    /b752d2d42a63aaad11f3b89f67bad64861ce767f633bee8190549df23a6f4155/u,
  );
});
