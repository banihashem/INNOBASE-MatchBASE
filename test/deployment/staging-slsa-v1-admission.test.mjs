import assert from "node:assert/strict";
import test from "node:test";
import { validateStagingEuProvenance } from "../../scripts/lib/staging-eu-provenance.mjs";
import { validateStagingBuildRecord } from "../../scripts/lib/staging-build-record.mjs";
const commit = "b".repeat(40),
  digest = `sha256:${"a".repeat(64)}`;
const image = `me-central1-docker.pkg.dev/innobase-matchbase-stg/matchbase/staging-web@${digest}`;
const peerImage = `me-central1-docker.pkg.dev/innobase-matchbase-stg/matchbase/staging-worker-${"c".repeat(16)}@sha256:${"d".repeat(64)}`;
const buildId = "9023f76a-e60c-41c0-b21d-d46f0d6a5817";
const occurrence = () => ({
  kind: "BUILD",
  resourceUri: `https://${image}`,
  envelope: {
    signatures: [
      {
        keyid:
          "projects/verified-builder/locations/global/keyRings/attestor/cryptoKeys/google-hosted-worker/cryptoKeyVersions/1",
        sig: "signed",
      },
    ],
  },
  build: {
    inTotoSlsaProvenanceV1: {
      _type: "https://in-toto.io/Statement/v1",
      predicateType: "https://slsa.dev/provenance/v1",
      subject: [
        {
          name: `https://${image.split("@")[0]}:${commit}`,
          digest: { sha256: "a".repeat(64) },
        },
        {
          name: `https://${peerImage.split("@")[0]}:${commit}`,
          digest: { sha256: "d".repeat(64) },
        },
      ],
      predicate: {
        buildDefinition: {
          buildType:
            "https://cloud.google.com/build/gcb-buildtypes/google-worker/v1",
        },
        runDetails: {
          builder: {
            id: "https://cloudbuild.googleapis.com/GoogleHostedWorker",
          },
          metadata: {
            invocationId: `https://cloudbuild.googleapis.com/v1/projects/innobase-matchbase-stg/locations/me-central1/builds/${buildId}`,
          },
        },
      },
    },
  },
});
const document = () => ({
  image_summary: {
    fully_qualified_digest: image,
    digest,
    repository: "matchbase",
    registry: "me-central1-docker.pkg.dev",
  },
  provenance_summary: {
    provenance: [
      occurrence(),
      { occurrence: { build: { inTotoSlsaProvenance: {} } } },
    ],
  },
});
test("admits exactly one signed SLSA v1 and ignores one legacy occurrence", () =>
  assert.equal(
    validateStagingEuProvenance(document(), {
      image,
      peerImage,
      digest,
      commit,
    }).build_id,
    buildId,
  ));
test("rejects legacy-only and duplicate v1", () => {
  const legacy = document();
  legacy.provenance_summary.provenance.shift();
  assert.throws(
    () =>
      validateStagingEuProvenance(legacy, { image, peerImage, digest, commit }),
    /exactly one SLSA v1/,
  );
  const duplicate = document();
  duplicate.provenance_summary.provenance.push(occurrence());
  assert.throws(
    () =>
      validateStagingEuProvenance(duplicate, {
        image,
        peerImage,
        digest,
        commit,
      }),
    /exactly one SLSA v1/,
  );
});
test("rejects noncanonical or wrongly scoped Cloud Build invocation IDs", () => {
  for (const invocationId of [
    `https://example.invalid/v1/projects/innobase-matchbase-stg/locations/me-central1/builds/${buildId}`,
    `https://cloudbuild.googleapis.com/v1/projects/wrong/locations/me-central1/builds/${buildId}`,
    `https://cloudbuild.googleapis.com/v1/projects/innobase-matchbase-stg/locations/europe-west2/builds/${buildId}`,
    "https://cloudbuild.googleapis.com/v1/projects/innobase-matchbase-stg/locations/me-central1/builds/------------------------------------",
    "https://cloudbuild.googleapis.com/v1/projects/innobase-matchbase-stg/locations/me-central1/builds/9023f76a-e60c-01c0-b21d-d46f0d6a5817",
    "https://cloudbuild.googleapis.com/v1/projects/innobase-matchbase-stg/locations/me-central1/builds/9023f76a-e60c-41c0-721d-d46f0d6a5817",
  ]) {
    const forged = document();
    forged.provenance_summary.provenance[0].build.inTotoSlsaProvenanceV1.predicate.runDetails.metadata.invocationId =
      invocationId;
    assert.throws(
      () =>
        validateStagingEuProvenance(forged, {
          image,
          peerImage,
          digest,
          commit,
        }),
      /invocationId/u,
    );
  }
});
test("build record closes source, revision, verification, identity, substitutions and images", () => {
  const expected = {
    buildId,
    commit,
    policySha: "c".repeat(64),
    policyId: "c".repeat(16),
    webTag: `me-central1-docker.pkg.dev/innobase-matchbase-stg/matchbase/staging-web:${commit}`,
    workerTag: `me-central1-docker.pkg.dev/innobase-matchbase-stg/matchbase/staging-worker-${"c".repeat(16)}:${commit}`,
    webDigest: `sha256:${"a".repeat(64)}`,
    workerDigest: `sha256:${"d".repeat(64)}`,
  };
  const imageRecord = (name, digest) => ({
    name,
    digest,
    artifactRegistryPackage: `projects/innobase-matchbase-stg/locations/me-central1/repositories/matchbase/packages/${name.split(":", 1)[0].split("/").at(-1)}/versions/${digest}`,
  });
  const record = {
    id: buildId,
    name: `projects/435488023557/locations/me-central1/builds/${buildId}`,
    projectId: "innobase-matchbase-stg",
    status: "SUCCESS",
    source: {
      connectedRepository: {
        repository:
          "projects/innobase-matchbase-stg/locations/me-central1/connections/matchbase-github/repositories/matchbase",
        revision: commit,
      },
    },
    options: { requestedVerifyOption: "VERIFIED" },
    serviceAccount:
      "projects/innobase-matchbase-stg/serviceAccounts/matchbase-staging-build@innobase-matchbase-stg.iam.gserviceaccount.com",
    substitutions: {
      _CANDIDATE_COMMIT: commit,
      _ROUTE_POLICY_SHA256: expected.policySha,
      _ROUTE_POLICY_ID: expected.policyId,
    },
    results: {
      images: [
        imageRecord(expected.workerTag, expected.workerDigest),
        imageRecord(expected.webTag, expected.webDigest),
      ],
    },
  };
  assert.equal(validateStagingBuildRecord(record, expected).build_id, buildId);
  for (const mutate of [
    (r) => (r.status = "FAILURE"),
    (r) => (r.name = "forged"),
    (r) => (r.source.connectedRepository.revision = "d".repeat(40)),
    (r) => (r.serviceAccount = "forged"),
    (r) => (r.substitutions._ROUTE_POLICY_ID = "forged"),
    (r) => (r.results.images[0].digest = "sha256:" + "e".repeat(64)),
    (r) => r.results.images.pop(),
  ]) {
    const forged = structuredClone(record);
    mutate(forged);
    assert.throws(() => validateStagingBuildRecord(forged, expected));
  }
});
