import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const BUILD_TYPE =
  "https://cloud.google.com/build/gcb-buildtypes/google-worker/v1";
const BUILDER = "https://cloudbuild.googleapis.com/GoogleHostedWorker";
const BUILDER_KEY =
  "projects/verified-builder/locations/global/keyRings/attestor/cryptoKeys/google-hosted-worker/cryptoKeyVersions/1";
const fail = (message) => {
  throw new Error(`Closed Artifact Registry provenance rejected: ${message}`);
};
const obj = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} is not an object`);
  return value;
};
export function validateStagingEuProvenance(value, expected) {
  const image = obj(value?.image_summary, "image_summary");
  if (
    image.fully_qualified_digest !== expected.image ||
    image.digest !== expected.digest ||
    image.repository !== "matchbase" ||
    image.registry !== "me-central1-docker.pkg.dev"
  )
    fail("image subject identity mismatch");
  const items = value?.provenance_summary?.provenance;
  if (!Array.isArray(items)) fail("provenance occurrence collection is absent");
  const v1 = items.filter((item) => item?.build?.inTotoSlsaProvenanceV1);
  if (v1.length !== 1)
    fail("exactly one SLSA v1 provenance occurrence is required");
  const item = v1[0];
  if (item.kind !== "BUILD" || item.resourceUri !== `https://${expected.image}`)
    fail("occurrence resource identity mismatch");
  const statement = obj(
    item.build.inTotoSlsaProvenanceV1,
    "inTotoSlsaProvenanceV1",
  );
  if (
    statement._type !== "https://in-toto.io/Statement/v1" ||
    statement.predicateType !== "https://slsa.dev/provenance/v1"
  )
    fail("statement type is unsupported");
  const governed = [expected.image, expected.peerImage]
    .map((entry) => ({
      name: `https://${entry.split("@", 1)[0]}:${expected.commit}`,
      sha256: entry.split("@sha256:", 2)[1],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const subjects = Array.isArray(statement.subject)
    ? statement.subject
        .map((entry) => ({ name: entry?.name, sha256: entry?.digest?.sha256 }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    : [];
  if (JSON.stringify(subjects) !== JSON.stringify(governed))
    fail("attested governed subjects, tags, or digests mismatch");
  const definition = obj(
    statement.predicate?.buildDefinition,
    "buildDefinition",
  );
  const details = obj(statement.predicate?.runDetails, "runDetails");
  if (definition.buildType !== BUILD_TYPE) fail("buildType mismatch");
  if (details.builder?.id !== BUILDER) fail("builder mismatch");
  const invocation = details.metadata?.invocationId;
  const invocationPrefix =
    "https://cloudbuild.googleapis.com/v1/projects/innobase-matchbase-stg/locations/me-central1/builds/";
  if (
    typeof invocation !== "string" ||
    !invocation.startsWith(invocationPrefix)
  )
    fail("build invocationId identity is invalid");
  const buildId = invocation.slice(invocationPrefix.length);
  const canonicalUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (
    !canonicalUuid.test(buildId) ||
    invocation !== `${invocationPrefix}${buildId}`
  )
    fail("build invocationId UUID is not canonical");
  const signatures = item.envelope?.signatures;
  if (
    !Array.isArray(signatures) ||
    signatures.length !== 1 ||
    signatures[0]?.keyid !== BUILDER_KEY ||
    typeof signatures[0]?.sig !== "string" ||
    !signatures[0].sig
  )
    fail("exact verified-builder signature identity is required");
  return Object.freeze({
    schema_version: "matchbase-cloud-build-slsa-v1.2",
    image: expected.image,
    subject_sha256: expected.digest.slice(7),
    build_id: buildId,
    invocation_id: invocation,
    builder_id: BUILDER,
    build_type: BUILD_TYPE,
    signature_keyid: signatures[0].keyid,
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const get = (name) => {
    const i = process.argv.indexOf(name);
    if (i < 0 || !process.argv[i + 1]) fail(`${name} is required`);
    return process.argv[i + 1];
  };
  const image = get("--image");
  process.stdout.write(
    JSON.stringify(
      validateStagingEuProvenance(
        JSON.parse(await readFile(get("--file"), "utf8")),
        {
          image,
          peerImage: get("--peer-image"),
          digest: image.split("@", 2)[1],
          commit: get("--commit"),
        },
      ),
    ),
  );
}
