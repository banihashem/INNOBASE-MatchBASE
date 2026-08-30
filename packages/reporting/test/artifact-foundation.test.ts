import assert from "node:assert/strict";
import test from "node:test";
import {
  ArtifactFoundationRepository,
  P4_QA_CHECK_KEYS,
  assertStructuredZeroEligibleFixture,
  p4QualificationFixtures,
  type ArtifactByteStore,
  type CreateArtifactVersionInput,
} from "../src/index.js";

class MemoryArtifactStore implements ArtifactByteStore {
  readonly bytes = new Map<string, Uint8Array>();
  failAfterPut = false;

  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.bytes.set(key, Uint8Array.from(bytes));
    if (this.failAfterPut) throw new Error("synthetic byte-store failure");
  }

  async get(key: string): Promise<Uint8Array | null> {
    const value = this.bytes.get(key);
    return value === undefined ? null : Uint8Array.from(value);
  }

  async delete(key: string): Promise<void> {
    this.bytes.delete(key);
  }

  corrupt(key: string): void {
    this.bytes.set(key, new TextEncoder().encode("tampered artifact bytes"));
  }
}

function deterministicIds(): () => string {
  let next = 0;
  return () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
}

function input(
  overrides: Partial<CreateArtifactVersionInput> = {},
): CreateArtifactVersionInput {
  return {
    artifact_id: "artifact-001",
    account_id: "account-001",
    run_id: "run-001",
    result_version: "complete-result-foundation.v2:1",
    result_sha256: "a".repeat(64),
    canonical_request_version_id: "request-version-001",
    projection_version_id: "projection-version-001",
    analyst_decision_set_id: "analyst-decisions-001",
    scoring_config_version_id: "scoring-config-001",
    model_policy_version_id: "model-policy-001",
    template_version: "consultant-template.v1",
    renderer: "isolated-local-reference",
    renderer_version: "1.0.0",
    page_geometry: "a4",
    generated_by_subject_id: "subject-001",
    ...overrides,
  };
}

function repository(store: MemoryArtifactStore): ArtifactFoundationRepository {
  return new ArtifactFoundationRepository(store, {
    clock: () => new Date("2026-08-29T12:00:00.000Z"),
    id_factory: deterministicIds(),
  });
}

function passAllChecks(
  repo: ArtifactFoundationRepository,
  artifactVersionId: string,
): void {
  for (const checkKey of P4_QA_CHECK_KEYS)
    repo.recordQaCheck(artifactVersionId, {
      check_key: checkKey,
      outcome: "pass",
      detail: { fixture: "synthetic" },
    });
}

test("release is fail-closed until all sixteen blocking checks pass", async () => {
  const store = new MemoryArtifactStore();
  const repo = repository(store);
  const version = repo.createVersion(input());
  for (const checkKey of P4_QA_CHECK_KEYS.slice(0, -1))
    repo.recordQaCheck(version.artifact_version_id, {
      check_key: checkKey,
      outcome: "pass",
      detail: {},
    });

  await assert.rejects(
    repo.release(
      version.artifact_version_id,
      new TextEncoder().encode("synthetic PDF bytes"),
      3,
    ),
    /all sixteen blocking QA checks/u,
  );
  assert.equal(store.bytes.size, 0);

  repo.recordQaCheck(version.artifact_version_id, {
    check_key: P4_QA_CHECK_KEYS.at(-1)!,
    outcome: "pass",
    detail: {},
  });
  const released = await repo.release(
    version.artifact_version_id,
    new TextEncoder().encode("synthetic PDF bytes"),
    3,
  );
  assert.equal(released.state, "released");
  assert.equal(released.qa_checks.length, 16);
  assert.match(released.file_sha256 ?? "", /^[0-9a-f]{64}$/u);
  assert.equal(released.byte_size, 19);
  assert.equal(store.bytes.size, 1);
});

test("render and QA failures create no downloadable bytes", async () => {
  const store = new MemoryArtifactStore();
  const repo = repository(store);
  const renderFailure = repo.createVersion(input());
  const failedRender = await repo.failRender(
    renderFailure.artifact_version_id,
    {
      stage: "renderer",
      code: "synthetic-render-failure",
    },
  );
  assert.equal(failedRender.state, "render_failed");
  assert.equal(failedRender.failure_class, "render_failure");

  const qaFailure = repo.createVersion(input());
  const failedQa = repo.recordQaCheck(qaFailure.artifact_version_id, {
    check_key: "overflow_collision",
    outcome: "fail",
    detail: { page: 2 },
  });
  assert.equal(failedQa.state, "qa_failed");
  assert.equal(failedQa.failure_class, "qa_failure");
  const warnFailure = repo.createVersion(input());
  const failedWarn = repo.recordQaCheck(warnFailure.artifact_version_id, {
    check_key: "contrast_ratio",
    outcome: "warn",
    detail: { reason: "blocking warning" },
  });
  assert.equal(failedWarn.state, "qa_failed");
  assert.equal(store.bytes.size, 0);

  for (const artifactVersionId of [
    renderFailure.artifact_version_id,
    qaFailure.artifact_version_id,
    warnFailure.artifact_version_id,
  ])
    await assert.rejects(
      repo.retrieve({
        artifact_version_id: artifactVersionId,
        account_id: "account-001",
        subject_id: "consultant-001",
        subject_tier: "consultant",
      }),
      /not downloadable/u,
    );
});

test("a byte-store failure is cleaned up and terminally fails the version", async () => {
  const store = new MemoryArtifactStore();
  const repo = repository(store);
  const version = repo.createVersion(input());
  passAllChecks(repo, version.artifact_version_id);
  store.failAfterPut = true;
  await assert.rejects(
    repo.release(
      version.artifact_version_id,
      new TextEncoder().encode("partially written bytes"),
      1,
    ),
    /synthetic byte-store failure/u,
  );
  assert.equal(store.bytes.size, 0);
  assert.equal(
    repo.getVersion(version.artifact_version_id).state,
    "render_failed",
  );
});

test("reissue creates a new immutable version and preserves the prior bytes", async () => {
  const store = new MemoryArtifactStore();
  const repo = repository(store);
  const first = repo.createVersion(input());
  passAllChecks(repo, first.artifact_version_id);
  const firstBytes = new TextEncoder().encode("first released artifact");
  const firstReleased = await repo.release(
    first.artifact_version_id,
    firstBytes,
    2,
  );

  const second = repo.createVersion(
    input({
      result_version: "complete-result-foundation.v2:2",
      result_sha256: "b".repeat(64),
    }),
  );
  assert.equal(second.version, 2);
  assert.notEqual(second.artifact_version_id, first.artifact_version_id);
  assert.deepEqual(repo.getVersion(first.artifact_version_id), firstReleased);
  assert.deepEqual(
    await repo.retrieve({
      artifact_version_id: first.artifact_version_id,
      account_id: "account-001",
      subject_id: "consultant-001",
      subject_tier: "consultant",
    }),
    firstBytes,
  );
});

test("retrieval verifies bytes and writes allow, deny, and integrity-error audit events", async () => {
  const store = new MemoryArtifactStore();
  const repo = repository(store);
  const version = repo.createVersion(input());
  passAllChecks(repo, version.artifact_version_id);
  const bytes = new TextEncoder().encode("verified artifact bytes");
  await repo.release(version.artifact_version_id, bytes, 1);

  assert.deepEqual(
    await repo.retrieve({
      artifact_version_id: version.artifact_version_id,
      account_id: "account-001",
      subject_id: "consultant-001",
      subject_tier: "consultant",
    }),
    bytes,
  );
  await assert.rejects(
    repo.retrieve({
      artifact_version_id: version.artifact_version_id,
      account_id: "account-001",
      subject_id: "admin-001",
      subject_tier: "admin",
    }),
    /requires justification/u,
  );
  store.corrupt(version.artifact_version_id);
  await assert.rejects(
    repo.retrieve({
      artifact_version_id: version.artifact_version_id,
      account_id: "account-001",
      subject_id: "consultant-001",
      subject_tier: "consultant",
    }),
    /integrity verification failed/u,
  );

  assert.deepEqual(
    repo.auditEvents().map(({ outcome, fields_released }) => ({
      outcome,
      fields_released,
    })),
    [
      { outcome: "allow", fields_released: ["artifact_bytes"] },
      { outcome: "deny", fields_released: [] },
      { outcome: "error", fields_released: [] },
    ],
  );
});

test("missing bytes, tenant mismatch, and unknown identities fail closed", async () => {
  const store = new MemoryArtifactStore();
  const repo = repository(store);
  const version = repo.createVersion(input());
  passAllChecks(repo, version.artifact_version_id);
  await repo.release(
    version.artifact_version_id,
    new TextEncoder().encode("released then removed"),
    1,
  );
  await store.delete(version.artifact_version_id);

  await assert.rejects(
    repo.retrieve({
      artifact_version_id: version.artifact_version_id,
      account_id: "account-001",
      subject_id: "consultant-001",
      subject_tier: "consultant",
    }),
    /integrity verification failed/u,
  );
  await assert.rejects(
    repo.retrieve({
      artifact_version_id: version.artifact_version_id,
      account_id: "account-002",
      subject_id: "consultant-002",
      subject_tier: "consultant",
    }),
    /not downloadable/u,
  );
  await assert.rejects(
    repo.retrieve({
      artifact_version_id: "unknown-version",
      account_id: "account-001",
      subject_id: "consultant-001",
      subject_tier: "consultant",
    }),
    /not downloadable/u,
  );
  assert.deepEqual(
    repo.auditEvents().map(({ outcome }) => outcome),
    ["error", "deny", "deny"],
  );
});

test("zero-eligible fixture documents the search, every exclusion, and safe relaxation options", () => {
  const fixture = p4QualificationFixtures().find(
    ({ zero_eligible }) => zero_eligible,
  );
  assert.ok(fixture);
  assertStructuredZeroEligibleFixture(fixture);
  assert.ok(fixture.negative_result.candidates_considered.length >= 1);
  assert.ok(
    fixture.negative_result.candidates_considered.every(
      ({ exclusion_reason }) => exclusion_reason.trim().length > 0,
    ),
  );
  assert.ok(
    fixture.negative_result.relaxation_options.every(
      ({ preserves_hard_gates }) => preserves_hard_gates,
    ),
  );
});
