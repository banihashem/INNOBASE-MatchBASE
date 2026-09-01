import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const fail = (message) => {
  throw new Error(`Closed Artifact Registry provenance rejected: ${message}`);
};
const object = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label} is not an object`);
  return value;
};
const exactKeys = (value, allowed, label) => {
  const keys = Object.keys(object(value, label)).sort();
  const expected = [...allowed].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected))
    fail(`${label} keys are not closed`);
};

export function validateStagingEuProvenance(value, expected) {
  exactKeys(value, ["image_summary", "provenance_summary"], "root");
  const image = object(value.image_summary, "image_summary");
  if (
    image.fully_qualified_digest !== expected.image ||
    image.digest !== expected.digest ||
    image.repository !== "matchbase" ||
    image.registry !== "me-central1-docker.pkg.dev"
  )
    fail("image subject identity mismatch");
  const occurrences = value.provenance_summary?.provenance;
  if (!Array.isArray(occurrences) || occurrences.length !== 1)
    fail("exactly one provenance occurrence is required");
  const statement = object(occurrences[0].intotoStatement, "intotoStatement");
  if (
    statement._type !== "https://in-toto.io/Statement/v1" ||
    statement.predicateType !== "https://slsa.dev/provenance/v1"
  )
    fail("statement type is unsupported");
  if (
    !Array.isArray(statement.subject) ||
    statement.subject.length !== 1 ||
    statement.subject[0].name !== expected.image.split("@", 1)[0] ||
    statement.subject[0].digest?.sha256 !== expected.digest.slice(7)
  )
    fail("attested subject digest mismatch");
  const definition = object(
    statement.predicate?.buildDefinition,
    "buildDefinition",
  );
  const details = object(statement.predicate?.runDetails, "runDetails");
  if (
    definition.buildType !==
    "https://cloudbuild.googleapis.com/GoogleHostedWorker@v1"
  )
    fail("buildType mismatch");
  if (
    details.builder?.id !==
    "https://cloudbuild.googleapis.com/GoogleHostedWorker"
  )
    fail("builder mismatch");
  if (definition.externalParameters?.source?.repository !== expected.repository)
    fail("source repository mismatch");
  const materials = definition.resolvedDependencies;
  if (
    !Array.isArray(materials) ||
    materials.length < 1 ||
    !materials.some(
      (item) =>
        item.uri === expected.repository &&
        item.digest?.gitCommit === expected.commit,
    )
  )
    fail("exact source material revision mismatch");
  return Object.freeze({
    schema_version: "matchbase-staging-eu-build-provenance.v1",
    image: expected.image,
    subject_sha256: expected.digest.slice(7),
    source_repository: expected.repository,
    source_commit: expected.commit,
    builder_id: details.builder.id,
    build_type: definition.buildType,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const get = (name) => {
    const index = process.argv.indexOf(name);
    if (index < 0 || !process.argv[index + 1]) fail(`${name} is required`);
    return process.argv[index + 1];
  };
  const image = get("--image");
  const result = validateStagingEuProvenance(
    JSON.parse(await readFile(get("--file"), "utf8")),
    {
      image,
      digest: image.split("@", 2)[1],
      commit: get("--commit"),
      repository: "https://github.com/banihashem/INNOBASE-MatchBASE.git",
    },
  );
  process.stdout.write(JSON.stringify(result));
}
