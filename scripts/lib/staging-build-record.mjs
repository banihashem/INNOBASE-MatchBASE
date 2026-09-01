import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const fail = (m) => {
  throw new Error(`Closed Cloud Build record rejected: ${m}`);
};
const SOURCE =
  "projects/innobase-matchbase-stg/locations/me-central1/connections/matchbase-github/repositories/matchbase";
const SERVICE_ACCOUNT =
  "projects/innobase-matchbase-stg/serviceAccounts/matchbase-staging-build@innobase-matchbase-stg.iam.gserviceaccount.com";
export function validateStagingBuildRecord(value, expected) {
  if (
    value?.status !== "SUCCESS" ||
    value.id !== expected.buildId ||
    value.projectId !== "innobase-matchbase-stg" ||
    value.name !==
      `projects/435488023557/locations/me-central1/builds/${expected.buildId}`
  )
    fail("build status, id, project, name, or location mismatch");
  if (
    value.source?.connectedRepository?.repository !== SOURCE ||
    value.source.connectedRepository.revision !== expected.commit
  )
    fail("connected repository or revision mismatch");
  if (value.options?.requestedVerifyOption !== "VERIFIED")
    fail("verified provenance was not requested");
  if (value.serviceAccount !== SERVICE_ACCOUNT)
    fail("build service account mismatch");
  const substitutions = value.substitutions ?? {};
  if (
    substitutions._CANDIDATE_COMMIT !== expected.commit ||
    substitutions._ROUTE_POLICY_SHA256 !== expected.policySha ||
    substitutions._ROUTE_POLICY_ID !== expected.policyId
  )
    fail("governed substitutions mismatch");
  const expectedImages = [
    { name: expected.webTag, digest: expected.webDigest },
    { name: expected.workerTag, digest: expected.workerDigest },
  ].sort((a, b) => a.name.localeCompare(b.name));
  const actualImages = (value.results?.images ?? [])
    .map((entry) => ({
      name: entry?.name,
      digest: entry?.digest,
      artifactRegistryPackage: entry?.artifactRegistryPackage,
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (actualImages.length !== expectedImages.length)
    fail("governed build image count mismatch");
  for (let index = 0; index < expectedImages.length; index += 1) {
    const wanted = expectedImages[index];
    const actual = actualImages[index];
    const packageName = wanted.name.split(":", 1)[0].split("/").at(-1);
    const expectedPackage = `projects/innobase-matchbase-stg/locations/me-central1/repositories/matchbase/packages/${packageName}/versions/${wanted.digest}`;
    if (
      actual.name !== wanted.name ||
      actual.digest !== wanted.digest ||
      actual.artifactRegistryPackage !== expectedPackage
    )
      fail("governed build image tag, digest, or package identity mismatch");
  }
  return Object.freeze({
    schema_version: "matchbase-cloud-build-record.v1",
    build_id: value.id,
    source_repository: SOURCE,
    source_commit: expected.commit,
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const get = (n) => {
    const i = process.argv.indexOf(n);
    if (i < 0 || !process.argv[i + 1]) fail(`${n} is required`);
    return process.argv[i + 1];
  };
  process.stdout.write(
    JSON.stringify(
      validateStagingBuildRecord(
        JSON.parse(await readFile(get("--file"), "utf8")),
        {
          buildId: get("--build-id"),
          commit: get("--commit"),
          policySha: get("--policy-sha"),
          policyId: get("--policy-id"),
          webTag: get("--web-tag"),
          workerTag: get("--worker-tag"),
          webDigest: get("--web-digest"),
          workerDigest: get("--worker-digest"),
        },
      ),
    ),
  );
}
