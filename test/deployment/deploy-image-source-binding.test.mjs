import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deriveGovernedSourceImage,
  validateEuTargetImageIdentity,
} from "../../scripts/lib/deploy-image-source-binding.mjs";
const digest = `sha256:${"a".repeat(64)}`;
const target = `europe-west2-docker.pkg.dev/innobase-matchbase-stg/matchbase/staging-web@${digest}`;
const exact = () => ({
  image_summary: {
    fully_qualified_digest: target,
    digest,
    repository: "matchbase",
    registry: "europe-west2-docker.pkg.dev",
  },
});
test("exact EU identity derives the same-name same-digest governed source", () => {
  assert.equal(
    validateEuTargetImageIdentity(exact(), target).source_image,
    `me-central1-docker.pkg.dev/innobase-matchbase-stg/matchbase/staging-web@${digest}`,
  );
  assert.equal(
    deriveGovernedSourceImage(target).endsWith(`staging-web@${digest}`),
    true,
  );
});
test("absent or forged EU target identities fail closed", () => {
  for (const value of [
    null,
    {},
    {
      image_summary: {
        ...exact().image_summary,
        digest: `sha256:${"b".repeat(64)}`,
      },
    },
    { image_summary: { ...exact().image_summary, repository: "other" } },
  ])
    assert.throws(
      () => validateEuTargetImageIdentity(value, target),
      /rejected/u,
    );
});
test("deploy validates target identity and source provenance before mutation", async () => {
  const script = await readFile(
    new URL("../../deployment/gcp/Deploy-CloudRun.ps1", import.meta.url),
    "utf8",
  );
  const targetGate = script.indexOf("$imageBindingParser --file");
  const sourceGate = script.indexOf("$provenanceParser --file");
  assert.ok(targetGate > -1 && sourceGate > targetGate);
  for (const mutation of [
    "add-iam-policy-binding",
    "Invoke-Gcloud -Arguments $workerCommand",
    "Invoke-Gcloud -Arguments $webCommand",
  ])
    assert.ok(sourceGate < script.indexOf(mutation));
  assert.match(script, /describe", \$sourceImage[\s\S]*--show-provenance/u);
});
