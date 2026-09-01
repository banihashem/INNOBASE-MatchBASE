import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_APIS,
  REQUIRED_PUBLISHER_PERMISSIONS,
  validateStagingBuildPreflight,
} from "../../scripts/lib/staging-build-preflight.mjs";

const valid = () => ({
  repository: {
    name: "projects/innobase-matchbase-stg/locations/me-central1/repositories/matchbase",
    format: "DOCKER",
    dockerConfig: { immutableTags: true },
  },
  enabled_apis: [...REQUIRED_APIS],
  publisher_permissions: [...REQUIRED_PUBLISHER_PERMISSIONS],
  build_agent_project_roles: ["roles/cloudbuild.serviceAgent"],
});

test("accepts only the immutable closed Docker repository and complete provenance preflight", () => {
  assert.equal(
    validateStagingBuildPreflight(valid()).repository.endsWith("/matchbase"),
    true,
  );
  for (const mutate of [
    (v) => {
      v.repository.dockerConfig.immutableTags = false;
    },
    (v) => {
      v.repository.format = "MAVEN";
    },
    (v) => {
      v.repository.name = v.repository.name.replace(
        "me-central1",
        "europe-west2",
      );
    },
    (v) => {
      v.repository.name = v.repository.name.replace("/matchbase", "/other");
    },
    (v) => {
      v.enabled_apis = v.enabled_apis.filter(
        (item) => item !== "containeranalysis.googleapis.com",
      );
    },
    (v) => {
      v.publisher_permissions = v.publisher_permissions.filter(
        (item) => item !== "containeranalysis.occurrences.list",
      );
    },
    (v) => {
      v.build_agent_project_roles = [];
    },
  ]) {
    const candidate = structuredClone(valid());
    mutate(candidate);
    assert.throws(
      () => validateStagingBuildPreflight(candidate),
      /preflight rejected/u,
    );
  }
});
