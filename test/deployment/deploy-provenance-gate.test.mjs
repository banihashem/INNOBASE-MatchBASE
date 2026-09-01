import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateStagingEuProvenance } from "../../scripts/lib/staging-eu-provenance.mjs";

test("Cloud Run deployment gates every mutation on exact commit and two live provenance statements", async () => {
  const script = await readFile(
    new URL("../../deployment/gcp/Deploy-CloudRun.ps1", import.meta.url),
    "utf8",
  );
  assert.match(
    script,
    /ValidatePattern\('\^\[a-f0-9\]\{40\}\$'\).*\$CandidateCommit/u,
  );
  assert.match(script, /status --porcelain=v1 --untracked-files=all/u);
  assert.match(script, /ls-remote origin refs\/heads\/main/u);
  assert.equal((script.match(/--show-provenance/gu) ?? []).length, 1);
  assert.match(
    script,
    /foreach \(\$image in @\(\$WebImageDigest, \$WorkerImageDigest\)\)/u,
  );
  const provenanceGate = script.indexOf("--show-provenance");
  for (const mutation of [
    "add-iam-policy-binding",
    "Invoke-Gcloud -Arguments $workerCommand",
    "Invoke-Gcloud -Arguments $webCommand",
  ])
    assert.ok(
      provenanceGate > -1 && provenanceGate < script.indexOf(mutation),
      `${mutation} precedes provenance gate`,
    );
});

test("image-summary-only Artifact Registry response is rejected before deployment", () => {
  const image = `me-central1-docker.pkg.dev/innobase-matchbase-stg/matchbase/staging-web@sha256:${"a".repeat(64)}`;
  assert.throws(
    () =>
      validateStagingEuProvenance(
        {
          image_summary: {
            fully_qualified_digest: image,
            digest: `sha256:${"a".repeat(64)}`,
            repository: "matchbase",
            registry: "me-central1-docker.pkg.dev",
          },
          provenance_summary: {},
        },
        {
          image,
          digest: `sha256:${"a".repeat(64)}`,
          commit: "b".repeat(40),
          repository: "https://github.com/banihashem/INNOBASE-MatchBASE.git",
        },
      ),
    /exactly one provenance occurrence is required/u,
  );
});
