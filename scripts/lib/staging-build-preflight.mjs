import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const REQUIRED_APIS = Object.freeze([
  "artifactregistry.googleapis.com",
  "cloudbuild.googleapis.com",
  "containeranalysis.googleapis.com",
]);
export const REQUIRED_PUBLISHER_PERMISSIONS = Object.freeze([
  "artifactregistry.dockerimages.get",
  "artifactregistry.dockerimages.list",
  "artifactregistry.repositories.get",
  "cloudbuild.builds.create",
  "cloudbuild.builds.get",
  "containeranalysis.occurrences.get",
  "containeranalysis.occurrences.list",
]);

export function validateStagingBuildPreflight(value) {
  const fail = (message) => {
    throw new Error(`Staging build preflight rejected: ${message}`);
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("facts are invalid");
  const repository = value.repository;
  if (
    !repository ||
    typeof repository !== "object" ||
    Array.isArray(repository)
  )
    fail("repository is invalid");
  if (
    repository.name !==
    "projects/innobase-matchbase-stg/locations/me-central1/repositories/matchbase"
  )
    fail("repository identity or location mismatch");
  if (repository.format !== "DOCKER") fail("repository format mismatch");
  if (repository.dockerConfig?.immutableTags !== true)
    fail("repository tags are mutable");
  const connection = value.source_connection;
  if (
    connection?.name !==
      "projects/innobase-matchbase-stg/locations/me-central1/connections/matchbase-github" ||
    connection?.installationState?.stage !== "COMPLETE" ||
    connection?.reconciling === true ||
    !connection?.etag ||
    String(connection?.githubConfig?.appInstallationId) !== "142544573"
  )
    fail("source connection identity or readiness drifted");
  const sourceRepository = value.source_repository;
  if (
    sourceRepository?.name !==
      "projects/innobase-matchbase-stg/locations/me-central1/connections/matchbase-github/repositories/matchbase" ||
    sourceRepository?.remoteUri !==
      "https://github.com/banihashem/INNOBASE-MatchBASE.git" ||
    sourceRepository?.reconciling === true ||
    !sourceRepository?.etag
  )
    fail("linked source repository drifted");
  const services = [...new Set(value.enabled_apis ?? [])].sort();
  for (const service of REQUIRED_APIS)
    if (!services.includes(service))
      fail(`required API ${service} is disabled`);
  const permissions = [...new Set(value.publisher_permissions ?? [])].sort();
  for (const permission of REQUIRED_PUBLISHER_PERMISSIONS)
    if (!permissions.includes(permission))
      fail(`publisher lacks ${permission}`);
  if (
    JSON.stringify(value.build_agent_project_roles) !==
    JSON.stringify(["roles/cloudbuild.serviceAgent"])
  )
    fail("Cloud Build service-agent role set drifted");
  return Object.freeze({
    repository: repository.name,
    source_repository: sourceRepository.name,
    enabled_apis: services,
    publisher_permissions: permissions,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const index = process.argv.indexOf("--file");
  if (index < 0 || !process.argv[index + 1])
    throw new Error("--file is required");
  process.stdout.write(
    JSON.stringify(
      validateStagingBuildPreflight(
        JSON.parse(await readFile(process.argv[index + 1], "utf8")),
      ),
    ),
  );
}
