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
  assert.equal(
    (
      config.match(
        /ROUTE_POLICY_PATH=config\/slice3\/research-route-policy\.staging\.v1\.json/gu,
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
  assert.doesNotMatch(config, /docker\s+push|\n\s+- push\s*$/imu);
  assert.match(publisher, /status --porcelain=v1 --untracked-files=all/u);
  assert.match(publisher, /ls-remote origin refs\/heads\/main/u);
  assert.match(
    publisher,
    /builds", "submit", \$source, "--git-source-revision=\$CandidateCommit"/u,
  );
  assert.match(publisher, /cloudbuild\.googleapis\.com/u);
  assert.match(publisher, /artifactregistry\.googleapis\.com/u);
  assert.match(publisher, /containeranalysis\.googleapis\.com/u);
  assert.match(publisher, /repositories", "describe"[\s\S]*--format=json/u);
  assert.equal(
    (publisher.match(/Invoke-GcloudStdout[^\n]+--format=json/gu) ?? []).length,
    3,
  );
  assert.doesNotMatch(
    publisher,
    /Invoke-Gcloud -Arguments[^\n]+--format=json/u,
  );
  assert.match(publisher, /immutableTags/u);
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
    /28b77b649f0d689b27979a236d102172f973a793a913b61ede740cce8f9ca9f7/u,
  );
});
