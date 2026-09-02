import assert from "node:assert/strict";
import { validateStagingEuProvenance } from "../../scripts/lib/staging-eu-provenance.mjs";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptUrl = new URL(
  "../../deployment/gcp/Migrate-StagingRegion.ps1",
  import.meta.url,
);
const scriptPath = fileURLToPath(scriptUrl);
const evidenceProducerPath = fileURLToPath(
  new URL(
    "../../deployment/gcp/New-StagingRegionEvidence.ps1",
    import.meta.url,
  ),
);
const euAcceptanceValidatorPath = fileURLToPath(
  new URL("../../scripts/validate-staging-eu-acceptance.mjs", import.meta.url),
);
const read = async (path) =>
  await readFile(new URL(path, import.meta.url), "utf8");

const runPowerShell = (...arguments_) =>
  spawnSync("pwsh", ["-NoProfile", "-File", scriptPath, ...arguments_], {
    encoding: "utf8",
  });

test("the closed migration map preserves the active source and names the EU target", async () => {
  const common = await read("../../deployment/gcp/Common.ps1");
  const evidenceProducer = await read(
    "../../deployment/gcp/New-StagingRegionEvidence.ps1",
  );
  assert.match(
    common,
    /StagingRegionMigration\s*=\s*\[pscustomobject\]@\{[\s\S]*ProjectId\s*=\s*"innobase-matchbase-stg"[\s\S]*SourceRegion\s*=\s*"me-central1"[\s\S]*TargetRegion\s*=\s*"europe-west2"/u,
  );
  for (const resource of [
    "innobase-matchbase-stg-eu-artifacts",
    "matchbase-stg-pg18-ew2",
    "matchbase-staging-neg-ew2",
    "matchbase-staging-backend-ew2",
    "matchbase-staging-maintenance-ew2",
    "matchbase-staging-maintenance-neg-ew2",
    "matchbase-staging-maintenance-backend-ew2",
    "matchbase-staging-runtime-ew2",
  ]) {
    assert.match(common, new RegExp(resource, "u"));
  }
  assert.match(
    common,
    /staging\s*=\s*\[pscustomobject\]@\{[\s\S]*Region\s*=\s*\$script:RequiredRegion/u,
  );
  assert.match(evidenceProducer, /\(\[string\]\$migration\.UrlMap\)/u);
  assert.doesNotMatch(evidenceProducer, /matchbase-staging-url-map/u);
  assert.match(evidenceProducer, /--peer-image \$PeerImage/u);
});

test("the migration defaults to a complete plan and makes no cloud call", () => {
  const result = runPowerShell();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Mode: PLAN ONLY/u);
  assert.match(result.stdout, /Route: me-central1 -> europe-west2/u);
  for (const checkpoint of [
    "Preflight",
    "RegionalFoundation",
    "DatabaseRehearsal",
    "Canary",
    "Preflight",
    "FinalRestore",
    "Cutover",
    "Rollback",
    "PreWriteRollback",
    "SourceRetirement",
  ]) {
    assert.match(result.stdout, new RegExp(`CHECKPOINT ${checkpoint}`, "u"));
  }
  assert.match(result.stdout, /PLAN COMPLETE — no cloud state was changed/u);
  assert.match(
    result.stdout,
    /never deleted outside the separately gated SourceRetirement/u,
  );
});

test("migration ledger tracks are closed, isolated, and canonical by default", async () => {
  const source = await read("../../deployment/gcp/Migrate-StagingRegion.ps1");
  const producer = await read(
    "../../deployment/gcp/New-StagingRegionEvidence.ps1",
  );
  const canonical = runPowerShell("-Checkpoint", "Preflight");
  const isolated = runPowerShell(
    "-Checkpoint",
    "Preflight",
    "-LedgerTrackId",
    "candidate-2b859650",
  );
  const invalid = runPowerShell(
    "-Checkpoint",
    "Preflight",
    "-LedgerTrackId",
    "../candidate",
  );
  const canonicalFoundation = runPowerShell(
    "-Checkpoint",
    "RegionalFoundation",
  );
  const isolatedFoundation = runPowerShell(
    "-Checkpoint",
    "RegionalFoundation",
    "-LedgerTrackId",
    "candidate-2b859650",
  );

  assert.equal(canonical.status, 0, canonical.stderr);
  assert.match(canonical.stdout, /Ledger track: canonical/u);
  assert.equal(isolated.status, 0, isolated.stderr);
  assert.match(isolated.stdout, /Ledger track: candidate-2b859650/u);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Cannot validate argument.*LedgerTrackId/su);
  assert.doesNotMatch(
    canonicalFoundation.stdout,
    /--exclude=\^migration-governance\//u,
  );
  assert.match(
    isolatedFoundation.stdout,
    /--exclude=\^migration-governance\//u,
  );
  assert.match(
    source,
    /migration-governance\/tracks\/\$LedgerTrackId\/staging-region-migration-ledger\.v1\.json/u,
  );
  assert.match(
    source,
    /migration-governance\/tracks\/\$LedgerTrackId\/evidence/u,
  );
  assert.match(
    source,
    /\[string\]\$evidence\.ledger_track_id -cne \$LedgerTrackId/u,
  );
  assert.match(
    source,
    /\[string\]\$document\.ledger_track_id -cne \$LedgerTrackId/u,
  );
  assert.match(
    source,
    /-not \$name\.StartsWith\("migration-governance\/tracks\/\$LedgerTrackId\/"/u,
  );
  assert.match(
    producer,
    /migration-governance\/tracks\/\$LedgerTrackId\/staging-region-migration-ledger\.v1\.json/u,
  );
  assert.match(
    producer,
    /\$Checkpoint -ceq "RegionalFoundation"[\s\S]*\$sourceLedgerUri[\s\S]*\$targetLedgerUri/u,
  );
  assert.match(
    producer,
    /Predecessor ledger URI is outside the selected track\./u,
  );
  assert.match(producer, /ledger_track_id = \$LedgerTrackId/u);
});

test("apply is fail-closed on project, residual, checkpoint, and machine evidence", () => {
  const wrongProject = runPowerShell(
    "-Checkpoint",
    "Preflight",
    "-Apply",
    "-ConfirmProjectId",
    "wrong-project",
  );
  assert.notEqual(wrongProject.status, 0);
  assert.match(
    wrongProject.stderr,
    /ConfirmProjectId 'innobase-matchbase-stg'/u,
  );

  const missingResidual = runPowerShell(
    "-Checkpoint",
    "Preflight",
    "-Apply",
    "-ConfirmProjectId",
    "innobase-matchbase-stg",
  );
  assert.notEqual(missingResidual.status, 0);
  assert.match(
    missingResidual.stderr,
    /I_ACKNOWLEDGE_GLOBAL_REQUIRED_EDGE_PROVIDER_LIMITATIONS/u,
  );

  const planAllApply = runPowerShell(
    "-Apply",
    "-ConfirmProjectId",
    "innobase-matchbase-stg",
    "-ResidualRiskAcknowledgement",
    "I_ACKNOWLEDGE_GLOBAL_REQUIRED_EDGE_PROVIDER_LIMITATIONS",
  );
  assert.notEqual(planAllApply.status, 0);
  assert.match(planAllApply.stderr, /PlanAll is plan-only/u);

  const maintenanceWithoutEvidence = runPowerShell(
    "-Checkpoint",
    "Preflight",
    "-Apply",
    "-ConfirmProjectId",
    "innobase-matchbase-stg",
    "-ResidualRiskAcknowledgement",
    "I_ACKNOWLEDGE_GLOBAL_REQUIRED_EDGE_PROVIDER_LIMITATIONS",
  );
  assert.notEqual(maintenanceWithoutEvidence.status, 0);
  assert.match(
    maintenanceWithoutEvidence.stderr,
    /EvidencePath to a machine-generated checkpoint evidence JSON/u,
  );
});

test("database checkpoints always plan a fresh backup and restore", () => {
  for (const checkpoint of ["DatabaseRehearsal", "FinalRestore"]) {
    const result = runPowerShell("-Checkpoint", checkpoint);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /gcloud sql backups create[\s\S]*--location=eu[\s\S]*--description=matchbase-/u,
    );
    assert.doesNotMatch(result.stdout, /--format=value\(id\)/u);
    assert.match(
      result.stdout,
      /gcloud sql backups restore <FRESH_BACKUP_ID>[\s\S]*--restore-instance=matchbase-stg-pg18-ew2/u,
    );
    assert.match(
      result.stdout,
      /gcloud sql backups list[\s\S]*--filter=description=/u,
    );
    assert.match(
      result.stdout,
      /gcloud sql instances patch matchbase-stg-pg18-ew2[\s\S]*--backup-location=europe-west2[\s\S]*--enable-point-in-time-recovery/u,
    );
  }
});

test("backup discovery never reuses PowerShell's automatic Matches variable", async () => {
  const source = await read("../../deployment/gcp/Migrate-StagingRegion.ps1");
  assert.doesNotMatch(source, /\$matches\s*=/iu);
  assert.match(source, /\$backupRecords\s*=/u);
});

test("foundation plans regional metadata and immutable digest copies without secret values", async () => {
  const source = await read("../../deployment/gcp/Migrate-StagingRegion.ps1");
  const result = runPowerShell("-Checkpoint", "RegionalFoundation");
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /gcloud logging buckets create matchbase-staging-runtime-ew2[\s\S]*--location=europe-west2/u,
  );
  assert.match(
    result.stdout,
    /gcloud logging sinks create matchbase-staging-runtime-ew2/u,
  );
  assert.doesNotMatch(result.stdout, /--unique-writer-identity/u);
  assert.doesNotMatch(source, /roles\/logging\.bucketWriter/u);
  assert.match(result.stdout, /has no writer identity/u);
  assert.match(
    result.stdout,
    /gcloud artifacts repositories create matchbase[\s\S]*--location=europe-west2[\s\S]*--immutable-tags/u,
  );
  assert.equal(
    (result.stdout.match(/gcloud secrets create /gu) ?? []).length,
    9,
  );
  assert.equal(
    (result.stdout.match(/--replication-policy=user-managed/gu) ?? []).length,
    9,
  );
  assert.equal(
    (result.stdout.match(/--locations=europe-west2/gu) ?? []).length,
    9,
  );
  assert.match(result.stdout, /gcrane cp [^\r\n]+@sha256:[a-f0-9]{64}/u);
  assert.equal((result.stdout.match(/gcrane cp /gu) ?? []).length, 3);
  assert.equal(
    (result.stdout.match(/:migration-ew2-[a-f0-9]{16}/gu) ?? []).length,
    3,
  );
  assert.match(
    result.stdout,
    /storage rsync gs:\/\/innobase-matchbase-stg-artifacts[\s\S]*gs:\/\/innobase-matchbase-stg-eu-artifacts/u,
  );
  assert.doesNotMatch(
    result.stdout,
    /APIKeys\.md|--data-file|secrets versions/u,
  );
  assert.doesNotMatch(source, /APIKeys\.md/u);
  assert.match(source, /function Invoke-RetirementGcloud/u);
  assert.match(
    source,
    /Checkpoint -cne "SourceRetirement"[\s\S]*SourceRetirementAcknowledgement -cne \$RetirementMarker/u,
  );
});

test("canary creates a real pinned maintenance path and remains unattached", () => {
  const canary = runPowerShell("-Checkpoint", "Canary");
  assert.equal(canary.status, 0, canary.stderr);
  assert.match(canary.stdout, /matchbase-staging-neg-ew2/u);
  assert.match(canary.stdout, /matchbase-staging-backend-ew2/u);
  assert.match(canary.stdout, /matchbase-staging-web-canary-ew2/u);
  assert.match(canary.stdout, /matchbase-staging-canary-neg-ew2/u);
  assert.match(canary.stdout, /matchbase-staging-canary-backend-ew2/u);
  assert.match(
    canary.stdout,
    /--hosts=matchbase-staging-eu-canary\.innobase\.app/u,
  );
  assert.match(
    canary.stdout,
    /run deploy matchbase-staging-maintenance-ew2[\s\S]*maintenance-node-base@sha256:[a-f0-9]{64}[\s\S]*--command=node/u,
  );
  assert.match(canary.stdout, /matchbase-staging-maintenance-neg-ew2/u);
  assert.match(canary.stdout, /matchbase-staging-maintenance-backend-ew2/u);
  assert.doesNotMatch(canary.stdout, /url-maps set-default-service/u);
});

test("maintenance uses machine freeze evidence and quiesces the source worker", async () => {
  const source = await read("../../deployment/gcp/Migrate-StagingRegion.ps1");
  const maintenance = runPowerShell("-Checkpoint", "Maintenance");
  assert.equal(maintenance.status, 0, maintenance.stderr);
  assert.match(
    maintenance.stdout,
    /--default-service=matchbase-staging-maintenance-backend-ew2/u,
  );
  assert.match(
    maintenance.stdout,
    /worker-pools update matchbase-staging-worker[\s\S]*--region=me-central1[\s\S]*--command=\/bin\/sleep[\s\S]*--args=2147483647/u,
  );
  assert.match(source, /freeze_query_sha256/u);
  assert.match(
    source,
    /active_runs.*-ne 0[\s\S]*queued_runs.*-ne 0[\s\S]*unreleased_leases.*-ne 0/u,
  );
  assert.doesNotMatch(source, /I_CONFIRM_ZERO_ACTIVE_RUNS_AND_WRITE_FREEZE/u);
});

test("cutover verifies the chained predecessors and exact EU identity before one switch", async () => {
  const source = await read("../../deployment/gcp/Migrate-StagingRegion.ps1");
  const cutover = runPowerShell("-Checkpoint", "Cutover");
  assert.equal(cutover.status, 0, cutover.stderr);
  assert.equal(
    (cutover.stdout.match(/url-maps set-default-service/gu) ?? []).length,
    1,
  );
  assert.match(
    cutover.stdout,
    /--default-service=matchbase-staging-backend-ew2/u,
  );
  for (const invariant of [
    "Assert-DurableEvidenceObjects",
    "Assert-CutoverEvidence",
    "Assert-ExactEuRuntimeAndDatabase",
    "MATCHBASE_ROUTE_POLICY_SHA256",
    "MATCHBASE_IMAGE_DIGEST",
    "0013_domain_pack_v2_and_legacy_annotation",
  ]) {
    assert.match(source, new RegExp(invariant, "u"));
  }
});

test("durable ledger is ordered, hash-chained, evidence-bound, and generation-conditional", async () => {
  const source = await read("../../deployment/gcp/Migrate-StagingRegion.ps1");
  assert.match(source, /matchbase-staging-region-migration-ledger\.v1/u);
  assert.equal(
    (source.match(/ConvertFrom-Json -DateKind String/gu) ?? []).length >= 2,
    true,
    "signed evidence and ledger timestamps must remain exact JSON strings",
  );
  assert.match(source, /previous_entry_sha256/u);
  assert.match(source, /entry_sha256/u);
  assert.match(source, /evidence_sha256/u);
  assert.match(
    source,
    /Copied target ledger does not equal the exact predecessor bytes/u,
  );
  assert.match(source, /--if-generation-match=\$expectedGeneration/u);
  assert.match(source, /--if-generation-match=\$expectedGeneration/u);
  assert.match(source, /Assert-CheckpointPredecessors/u);
  assert.match(
    source,
    /Checkpoint -cne "Preflight"[\s\S]*Durable predecessor ledger/u,
  );
});

test("post-write rollback coordinates EU web, worker, and database while source stays quiesced", async () => {
  const source = await read("../../deployment/gcp/Migrate-StagingRegion.ps1");
  const rollback = runPowerShell("-Checkpoint", "Rollback");
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.match(rollback.stdout, /--region=europe-west2/u);
  assert.match(rollback.stdout, /<PREVIOUS_EU_WEB_REVISION>=100/u);
  assert.match(rollback.stdout, /<PREVIOUS_EU_WORKER_IMAGE_DIGEST>/u);
  assert.match(rollback.stdout, /sql backups restore <VERIFIED_EU_BACKUP_ID>/u);
  assert.match(
    rollback.stdout,
    /--default-service=matchbase-staging-maintenance-backend-ew2[\s\S]*--command=\/bin\/sleep[\s\S]*sql backups restore[\s\S]*--command= --args=[\s\S]*--default-service=matchbase-staging-backend-ew2/u,
  );
  assert.doesNotMatch(
    rollback.stdout,
    /--default-service=matchbase-staging-backend(?:\s|$)/u,
  );
  assert.match(source, /Assert-SourceWorkerQuiesced/u);
  assert.match(source, /Assert-NoEuWritesSinceCutover/u);
  assert.match(source, /This path is prohibited after any EU write/u);
});

test("live database gates retain psql and fall back to the closed Node scalar query", async () => {
  const source = await read("../../deployment/gcp/Migrate-StagingRegion.ps1");
  const helper = await read(
    "../../deployment/gcp/run-closed-database-query.mjs",
  );
  assert.match(source, /function Invoke-ClosedDatabaseScalarQuery/u);
  assert.match(
    source,
    /Get-Command psql -CommandType Application -ErrorAction SilentlyContinue/u,
  );
  assert.match(
    source,
    /Get-Command node -CommandType Application -ErrorAction SilentlyContinue/u,
  );
  assert.match(source, /run-closed-database-query\.mjs/u);
  assert.match(source, /\$Query \| & \$node\.Source \$helper 2>&1/u);
  assert.doesNotMatch(
    source,
    /& \$node\.Source \$helper\s+\$env:MATCHBASE_EVIDENCE_DATABASE_URL/u,
  );
  assert.equal(
    (source.match(/Invoke-ClosedDatabaseScalarQuery -Query \$query/gu) ?? [])
      .length,
    2,
  );
  assert.match(helper, /BEGIN READ ONLY/u);
  assert.match(helper, /result\.rows\.length !== 1/u);
  assert.match(helper, /result\.rows\[0\]\.length !== 1/u);
  assert.match(helper, /Only one closed read-only SELECT is accepted/u);
});

test("source retirement is separately gated and plans only exact source targets after EU recovery", async () => {
  const source = await read("../../deployment/gcp/Migrate-StagingRegion.ps1");
  const retirement = runPowerShell("-Checkpoint", "SourceRetirement");
  assert.equal(retirement.status, 0, retirement.stderr);
  for (const target of [
    "matchbase-staging-backend",
    "matchbase-staging-neg",
    "matchbase-staging-web",
    "matchbase-staging-worker",
    "matchbase-stg-pg18",
    "innobase-matchbase-stg-artifacts",
    "--location=me-central1",
  ]) {
    assert.match(retirement.stdout, new RegExp(target, "u"));
  }
  assert.match(retirement.stdout, /--no-deletion-protection/u);
  assert.equal(
    (retirement.stdout.match(/gcloud secrets delete /gu) ?? []).length,
    9,
  );
  assert.doesNotMatch(retirement.stdout, /matchbase-stg-pg18-ew2.*delete/u);
  assert.doesNotMatch(
    retirement.stdout,
    /innobase-matchbase-stg-eu-artifacts.*delete/u,
  );
  assert.match(
    source,
    /I_AUTHORIZE_VERIFIED_SOURCE_RETIREMENT_AND_CRYPTOGRAPHIC_ERASURE/u,
  );
  assert.match(source, /source_retirement_not_before_utc/u);
  assert.match(source, /recent EU application log/iu);
  assert.match(source, /Assert-ArtifactInventoryReconciled/u);
  assert.match(source, /replication\.userManaged\.replicas/u);
  assert.match(source, /TargetLogSink/u);
});

test("regional image copies require the exact pinned gcrane binary", async () => {
  const source = await read("../../deployment/gcp/Migrate-StagingRegion.ps1");
  assert.match(source, /PinnedGcraneVersion = "0\.22\.0"/u);
  assert.match(
    source,
    /PinnedGcraneExecutableSha256 = "094281bd4c98e1dbf805350f3f59a152244324fb86a4b4b908c741d012a9615d"/u,
  );
  assert.match(source, /Resolve-PinnedGcrane/u);
  assert.match(source, /Get-FileHash -Algorithm SHA256/u);
  assert.match(source, /& \$PinnedGcraneExecutable cp/u);
  assert.doesNotMatch(source, /& gcrane cp/u);
});

test("runtime identity compares MATCHBASE_IMAGE_DIGEST to digest-only image identity", async () => {
  const source = await read("../../deployment/gcp/Migrate-StagingRegion.ps1");
  assert.match(
    source,
    /MATCHBASE_IMAGE_DIGEST -cne \(\[string\]\$runtime\.spec\.template\.spec\.containers\[0\]\.image\)\.Split\("@", 2\)\[1\]/u,
  );
  assert.doesNotMatch(
    source,
    /MATCHBASE_IMAGE_DIGEST -cne \[string\]\$runtime\.spec\.template\.spec\.containers\[0\]\.image -or/u,
  );
});

test("EU deployment target and complete artifact copy are closed and explicit", async () => {
  const deploy = await read("../../deployment/gcp/Deploy-CloudRun.ps1");
  const config = await read("../../apps/web/src/config.ts");
  const migration = await read(
    "../../deployment/gcp/Migrate-StagingRegion.ps1",
  );
  assert.match(deploy, /\[switch\]\$StagingEuropeWest2/u);
  assert.match(deploy, /TargetArtifactBucket/u);
  assert.match(deploy, /TargetCloudSqlInstance/u);
  assert.match(config, /innobase-matchbase-stg-eu-artifacts/u);
  assert.match(
    migration,
    /"storage", "rsync", "gs:\/\/\$\(\$migration\.SourceArtifactBucket\)", "gs:\/\/\$\(\$migration\.TargetArtifactBucket\)"/u,
  );
});

test("checkpoint evidence is produced read-only and bound to same-project KMS provenance", async () => {
  const producer = await read(
    "../../deployment/gcp/New-StagingRegionEvidence.ps1",
  );
  const migration = await read(
    "../../deployment/gcp/Migrate-StagingRegion.ps1",
  );
  assert.match(producer, /matchbase-staging-region-evidence-producer\.v1/u);
  assert.match(producer, /asymmetric-sign/u);
  assert.match(producer, /stdout_sha256/u);
  assert.match(producer, /active_account/u);
  assert.match(producer, /CandidateCommit/u);
  assert.match(producer, /PredecessorLedgerUri/u);
  assert.match(producer, /predecessor-ledger-content/u);
  assert.match(producer, /run-closed-database-query\.mjs/u);
  assert.doesNotMatch(producer, /Get-Command psql/u);
  assert.match(migration, /get-public-key/u);
  assert.match(migration, /VerifyData/u);
  assert.match(migration, /EvidenceSignaturePath/u);
  assert.match(migration, /candidate\.web_source_image_digest/u);
});

test("source retirement requires full versioned artifact reconciliation and persisted URI closure", async () => {
  const producer = await read(
    "../../deployment/gcp/New-StagingRegionEvidence.ps1",
  );
  const migration = await read(
    "../../deployment/gcp/Migrate-StagingRegion.ps1",
  );
  assert.match(producer, /--all-versions/u);
  assert.match(producer, /"storage", "ls"/u);
  assert.match(producer, /"--json"/u);
  assert.match(migration, /Convert-StorageLsInventory/u);
  assert.match(migration, /\.metadata\.crc32c|metadata\.crc32c/u);
  assert.match(producer, /persisted_artifact_uris/u);
  assert.match(producer, /json_agg\(storage_uri ORDER BY storage_uri\)/u);
  assert.match(producer, /<QUERY_ON_STDIN>/u);
  assert.match(migration, /Assert-ArtifactInventoryReconciled/u);
  assert.match(
    migration,
    /\$identity = "\$name\|\$\(\$item\.size\)\|\$\(\$item\.crc32c\)"/u,
  );
  assert.match(migration, /Copy-AllSourceArtifactGenerations/u);
  assert.match(migration, /Persisted artifact.*is absent from the EU bucket/u);
});

const provenanceFixture = () => ({
  image_summary: {
    fully_qualified_digest:
      "me-central1-docker.pkg.dev/innobase-matchbase-stg/matchbase/web@sha256:" +
      "a".repeat(64),
    digest: "sha256:" + "a".repeat(64),
    repository: "matchbase",
    registry: "me-central1-docker.pkg.dev",
  },
  provenance_summary: {
    provenance: [
      {
        intotoStatement: {
          _type: "https://in-toto.io/Statement/v1",
          predicateType: "https://slsa.dev/provenance/v1",
          subject: [
            {
              name: "me-central1-docker.pkg.dev/innobase-matchbase-stg/matchbase/web",
              digest: { sha256: "a".repeat(64) },
            },
          ],
          predicate: {
            buildDefinition: {
              buildType:
                "https://cloudbuild.googleapis.com/GoogleHostedWorker@v1",
              externalParameters: {
                source: {
                  repository:
                    "https://github.com/banihashem/INNOBASE-MatchBASE.git",
                },
              },
              resolvedDependencies: [
                {
                  uri: "https://github.com/banihashem/INNOBASE-MatchBASE.git",
                  digest: { gitCommit: "b".repeat(40) },
                },
              ],
            },
            runDetails: {
              builder: {
                id: "https://cloudbuild.googleapis.com/GoogleHostedWorker",
              },
            },
          },
        },
      },
    ],
  },
});

const expectedProvenance = {
  image:
    "me-central1-docker.pkg.dev/innobase-matchbase-stg/matchbase/web@sha256:" +
    "a".repeat(64),
  digest: "sha256:" + "a".repeat(64),
  commit: "b".repeat(40),
  repository: "https://github.com/banihashem/INNOBASE-MatchBASE.git",
};

test("legacy assumed provenance fixture is rejected", () => {
  assert.throws(
    () => validateStagingEuProvenance(provenanceFixture(), expectedProvenance),
    /exactly one SLSA v1/u,
  );
});

test("legacy source-in-provenance fixture is rejected", () => {
  assert.throws(
    () => validateStagingEuProvenance(provenanceFixture(), expectedProvenance),
    /exactly one SLSA v1/u,
  );
});

test("legacy unrelated-field fixture is rejected", () => {
  const forged = provenanceFixture();
  forged.provenance_summary.provenance[0].intotoStatement.subject[0].digest.sha256 =
    "c".repeat(64);
  forged.provenance_summary.provenance[0].intotoStatement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit =
    "d".repeat(40);
  forged.unrelated = JSON.stringify(expectedProvenance);
  assert.throws(
    () => validateStagingEuProvenance(forged, expectedProvenance),
    /exactly one SLSA v1/u,
  );
});

test("legacy repository-in-provenance fixture is rejected", () => {
  for (const mutate of [
    (v) =>
      (v.provenance_summary.provenance[0].intotoStatement.predicate.runDetails.builder.id =
        "forged-builder"),
    (v) =>
      (v.provenance_summary.provenance[0].intotoStatement.predicate.buildDefinition.buildType =
        "forged-build-type"),
    (v) =>
      (v.provenance_summary.provenance[0].intotoStatement.predicate.buildDefinition.externalParameters.source.repository =
        "https://example.invalid/repository.git"),
  ]) {
    const forged = provenanceFixture();
    mutate(forged);
    assert.throws(() =>
      validateStagingEuProvenance(forged, expectedProvenance),
    );
  }
});

test("HA database candidate uses explicit regional custom tier capability", async () => {
  const source = await read("../../deployment/gcp/Migrate-StagingRegion.ps1");
  assert.match(source, /TargetCloudSqlTier = "db-custom-2-7680"/u);
  assert.match(
    source,
    /--filter=tier=\$TargetCloudSqlTier AND region=\$TargetRegion/u,
  );
  assert.doesNotMatch(source, /--tier=db-f1-micro/u);
});

test("evidence producer rejects arbitrary asserted facts and uses closed collectors", async () => {
  const producer = await read(
    "../../deployment/gcp/New-StagingRegionEvidence.ps1",
  );
  assert.doesNotMatch(producer, /FactsPath/u);
  assert.doesNotMatch(producer, /facts\.outcome/u);
  assert.match(producer, /Invoke-DatabaseFactCapture/u);
  assert.match(producer, /validate-staging-eu-acceptance\.mjs/u);
  assert.match(producer, /Closed EU acceptance collector failed/u);
  const forgedFacts = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      evidenceProducerPath,
      "-Checkpoint",
      "Preflight",
      "-CandidateCommit",
      "a".repeat(40),
      "-WebSourceImageDigest",
      `me-central1-docker.pkg.dev/innobase-matchbase-stg/matchbase/staging-web@sha256:${"b".repeat(64)}`,
      "-WorkerSourceImageDigest",
      `me-central1-docker.pkg.dev/innobase-matchbase-stg/matchbase/staging-worker@sha256:${"c".repeat(64)}`,
      "-KmsKeyVersion",
      "projects/innobase-matchbase-stg/locations/europe-west2/keyRings/evidence/cryptoKeys/signer/cryptoKeyVersions/1",
      "-OutputPath",
      "forged.json",
      "-FactsPath",
      "forged-pass.json",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(forgedFacts.status, 0);
  assert.match(forgedFacts.stderr, /parameter name 'FactsPath'/iu);
});

test("ledger hash chain rejects cross-candidate substitution", async () => {
  const source = await read("../../deployment/gcp/Migrate-StagingRegion.ps1");
  assert.match(source, /candidate_commit/u);
  assert.match(source, /candidate_web_image_digest/u);
  assert.match(source, /candidate_worker_image_digest/u);
  assert.match(source, /candidate identity changed across checkpoints/u);
  assert.match(source, /cross-candidate ledger substitution/u);
  assert.match(
    source,
    /\$material = "\$previous\|\$sequence\|\$Checkpoint\|[^\r\n]+\|\$candidateCommit\|\$candidateWebDigest\|\$candidateWorkerDigest\|\$candidateWebProvenance\|\$candidateWorkerProvenance"/u,
  );
});

test("EU acceptance binds closed origins, live service identity, exact result, and PDF bytes", async () => {
  const common = await read("../../deployment/gcp/Common.ps1");
  const producer = await read(
    "../../deployment/gcp/New-StagingRegionEvidence.ps1",
  );
  const validator = await read(
    "../../scripts/validate-staging-eu-acceptance.mjs",
  );
  assert.match(
    common,
    /CanaryHostname = "matchbase-staging-eu-canary\.innobase\.app"/u,
  );
  assert.doesNotMatch(validator, /MATCHBASE_EU_CANARY_ORIGIN/u);
  assert.doesNotMatch(validator, /MATCHBASE_EU_DIRECT_SERVICE_URL/u);
  assert.match(producer, /\$targetWeb\.status\.url/u);
  assert.match(producer, /cloud_run_service_uid/u);
  assert.match(producer, /cloud_run_generation/u);
  assert.match(producer, /GOOGLE_REDIRECT_URI/u);
  assert.match(producer, /staging-eu-canary/u);
  assert.match(producer, /CanaryWebService/u);
  assert.match(validator, /result\.run_id !== runId/u);
  assert.match(validator, /connectOverCDP/u);
  assert.match(validator, /\/auth\/google\/start/u);
  assert.match(validator, /candidateReadyAt/u);
  assert.match(validator, /%PDF-/u);
  assert.match(validator, /artifact_sha256/u);
  assert.match(
    validator,
    /Procurement request for three containers of high-quality Iranian Ahmad Aghaei pistachios\. The shipment must be routed via Dubai for distribution in the African market\. The supplier should have at least one container currently available in stock\./u,
  );
  assert.doesNotMatch(validator, /MX900/u);
  assert.match(validator, /\/admin\/product/u);
  assert.match(validator, /\/api\/v1\/profile\/history/u);
  assert.match(validator, /\/api\/v1\/admin\/research/u);
  assert.match(validator, /name: "Hard constraint 1"/u);
  assert.match(validator, /selectOption\(\{ label: "Required route" \}\)/u);
  assert.match(validator, /constraint\.field_id === "current_stock"/u);
  assert.match(validator, /mandatory_constraint_field_ids: \["routing_via"\]/u);
  assert.match(validator, /preference_field_ids: \["current_stock"\]/u);
  assert.match(validator, /profile_admin: "PASS"/u);
  assert.match(validator, /responsive_browser: "PASS"/u);
  assert.match(validator, /latency: "PASS"/u);
  assert.match(validator, /MAX_INTERACTIVE_P95_MS = 5_000/u);
  assert.match(validator, /result\.document_width > result\.viewport_width/u);
  assert.match(validator, /percentile95/u);
  assert.match(
    validator,
    /privacy_boundary\?\.source_text_released !== false/u,
  );
  assert.match(validator, /me\.admin_sub_roles\.includes\("super_admin"\)/u);
  for (const name of [
    "oauth",
    "complete_research",
    "pdf",
    "profile_admin",
    "origin_denial",
    "responsive_browser",
    "latency",
  ])
    assert.match(producer, new RegExp(`"${name}"`, "u"));
  assert.match(producer, /artifact-grant-run-result-binding/u);
  assert.match(producer, /stored hash, and stored size/u);
  assert.match(
    producer,
    /\$mandatoryConstraintFields\[0\] -cne "routing_via"/u,
  );
  assert.match(producer, /\$preferenceFields\[0\] -cne "current_stock"/u);
  assert.match(
    producer,
    /\$acceptance\.profile\.result_projection -cne "consultant"/u,
  );
  assert.match(
    producer,
    /\$acceptance\.admin_inventory\.requester_user_id -cne \[string\]\$acceptance\.oauth_subject_user_id/u,
  );
});

test("EU acceptance collector resolves the pinned browser runtime before validating inputs", () => {
  const result = spawnSync(process.execPath, [euAcceptanceValidatorPath], {
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--origin is required\./u);
  assert.doesNotMatch(
    result.stderr,
    /ERR_MODULE_NOT_FOUND|Cannot find package ['"]playwright['"]/u,
  );
});

test("EU acceptance requests and completes a fresh run-bound PDF before validating its grant", async () => {
  const producer = await read(
    "../../deployment/gcp/New-StagingRegionEvidence.ps1",
  );
  const validator = await read(
    "../../scripts/validate-staging-eu-acceptance.mjs",
  );

  assert.match(producer, /'run_created_at',r\.queued_at/u);
  assert.doesNotMatch(producer, /'run_created_at',r\.created_at/u);
  assert.match(
    validator,
    /page\.request\.post\([\s\S]+`\/api\/v1\/runs\/\$\{runId\}\/artifacts`/u,
  );
  assert.match(validator, /"X-CSRF-Token": me\.csrf_token/u);
  assert.match(
    validator,
    /"Idempotency-Key": `eu-canary-acceptance-pdf-\$\{runId\}`/u,
  );
  assert.match(validator, /reportRequest\.state !== "queued"/u);
  assert.match(
    validator,
    /`\/api\/v1\/runs\/\$\{runId\}\/artifacts\/\$\{reportRequest\.job_id\}`/u,
  );
  assert.match(validator, /reportStatus\.state === "completed"/u);
  assert.match(validator, /reportStatus\.state === "failed"/u);
  assert.match(
    validator,
    /profileRun\.artifact_download\.artifact_version_id !==\s+reportRequest\.artifact_version_id/u,
  );
  assert.ok(
    validator.indexOf("Fresh Consultant result") <
      validator.indexOf("Fresh Consultant PDF request"),
  );
  assert.ok(
    validator.indexOf("Fresh Consultant PDF generation timed out") <
      validator.indexOf("Owner profile PDF grant"),
  );
});

test("canary OAuth identity is isolated from main Staging deployment and routing", async () => {
  const common = await read("../../deployment/gcp/Common.ps1");
  const deploy = await read("../../deployment/gcp/Deploy-CloudRun.ps1");
  const migration = await read(
    "../../deployment/gcp/Migrate-StagingRegion.ps1",
  );
  assert.match(
    common,
    /CanaryWebService = "matchbase-staging-web-canary-ew2"/u,
  );
  assert.match(
    common,
    /Hostname = "matchbase-staging-eu-canary\.innobase\.app"/u,
  );
  assert.match(deploy, /staging-eu-canary/u);
  assert.match(deploy, /GOOGLE_REDIRECT_URI=\$origin\/auth\/google\/callback/u);
  assert.match(
    deploy,
    /Main EU Staging deployment cannot use the isolated canary service identity/u,
  );
  assert.match(
    migration,
    /main Staging default route must remain byte-for-byte identical/u,
  );
  assert.match(
    migration,
    /Canary host routing is not isolated from the main Staging default route/u,
  );
  assert.doesNotMatch(
    common,
    /"staging-eu"[\s\S]{0,300}Hostname = "matchbase-staging-eu-canary/u,
  );
});

test("canary edge plan closes Armor, TLS, Cloudflare DNS/header and preserves main edge", async () => {
  const edge = await read(
    "../../deployment/gcp/Configure-StagingCanaryEdge.ps1",
  );
  const producer = await read(
    "../../deployment/gcp/New-StagingRegionEvidence.ps1",
  );
  const route = await read(
    "../../deployment/gcp/Prepare-StagingCanaryRoute.ps1",
  );
  const migration = await read(
    "../../deployment/gcp/Migrate-StagingRegion.ps1",
  );
  const result = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      fileURLToPath(
        new URL(
          "../../deployment/gcp/Configure-StagingCanaryEdge.ps1",
          import.meta.url,
        ),
      ),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    (result.stdout.match(/security-policies rules create 20\d\d/gu) ?? [])
      .length,
    2,
  );
  assert.match(edge, /canaryExpressions/u);
  assert.match(edge, /security-policies","rules","delete"/u);
  assert.match(producer, /armor_rule_count=2/u);
  assert.match(route, /matchbase-staging-eu-canary/u);
  assert.match(route, /Canary URL-map ownership collision/u);
  assert.match(route, /main route changed/u);
  assert.match(route, /PSObject\.Properties\['hostRules'\]/u);
  assert.match(route, /PSObject\.Properties\['pathMatchers'\]/u);
  assert.match(route, /--new-hosts=\$\(\$m\.CanaryHostname\)/u);
  assert.match(route, /unexpectedMatcherHosts/u);
  assert.match(migration, /--new-hosts=\$\(\$migration\.CanaryHostname\)/u);
  assert.match(
    result.stdout,
    /--domains=matchbase-staging\.innobase\.app,matchbase-staging-eu-canary\.innobase\.app/u,
  );
  assert.match(result.stdout, /certificate-manager dns-authorizations create/u);
  assert.match(result.stdout, /certificate-manager maps entries create/u);
  assert.match(result.stdout, /--certificate-map=/u);
  assert.match(edge, /--certificate-map=\$\(\$m\.CertificateMap\)/u);
  assert.match(edge, /--clear-ssl-certificates/u);
  assert.doesNotMatch(edge, /certificatemanager\.googleapis\.com\)\/projects/u);
  assert.match(result.stdout, /application A proxied/u);
  assert.match(result.stdout, /public A\/AAAA/u);
  assert.match(result.stdout, /SSL=strict/u);
  assert.match(
    edge,
    /Where-Object\{\$_.ref -cne "matchbase_canary_origin_admission"\}/u,
  );
  assert.match(
    edge,
    /DNS authorization domain\/type\/record\/ownership collision/u,
  );
  assert.match(edge, /Existing Cloudflare authorization CNAME drift/u);
  assert.match(edge, /--domain=\$\(\$tuple\[1\]\)/u);
  assert.doesNotMatch(edge, /--domain=\$tuple\[1\]/u);
  assert.doesNotMatch(edge, /Invoke-RestMethod\s+(?:Get|Post|Put)\s+/u);
  assert.match(edge, /Invoke-RestMethod -Method Get -Uri/u);
  for (const script of [edge, producer]) {
    assert.match(script, /\.kind-ceq"zone"/u);
    assert.match(script, /\.phase-ceq"http_request_late_transform"/u);
    assert.doesNotMatch(script, /rulesets\?phase=/u);
  }
  assert.match(edge, /HTTPS proxy has an unrelated certificate map/u);
  assert.match(
    edge,
    /PSObject\.Properties\['certificateMap'\]/u,
    "an absent optional certificateMap must be treated as empty under StrictMode",
  );
  assert.match(
    edge,
    /PSObject\.Properties\['sslCertificates'\]/u,
    "an absent optional sslCertificates list must be treated as empty under StrictMode",
  );
  assert.match(
    edge,
    /HTTPS proxy has unrelated classic certificate attachments/u,
  );
  assert.match(edge, /Certificate-map entry collision/u);
  assert.match(
    edge,
    /matchbase-governed=true,matchbase-scope=staging-canary-edge/u,
  );
  assert.match(edge, /Explicit Canary AAAA record is prohibited/u);
  assert.match(edge, /certificates\)\.Count-ne1/u);
  assert.doesNotMatch(
    result.stdout,
    /CLOUDFLARE_API_TOKEN|MATCHBASE_CANARY_ORIGIN_ADMISSION_KEY/u,
  );
  assert.match(producer, /certificate_status="ACTIVE"/u);
  assert.match(producer, /DNS authorization CNAME evidence failed/u);
  assert.match(producer, /dns_proxied=\$true/u);
  assert.match(producer, /admission_value_sha256/u);
  assert.match(
    producer,
    /Resolve-DnsName \$migration\.CanaryHostname -Type AAAA/u,
  );
});

test("exact domain-set helper accepts reordered equality and rejects extras", () => {
  const common = fileURLToPath(
    new URL("../../deployment/gcp/Common.ps1", import.meta.url),
  );
  const equal = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `. '${common}'; Assert-ExactDomainSet -Actual @('b.example','a.example') -Expected @('a.example','b.example') -Description test`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(equal.status, 0, equal.stderr);
  const extra = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `. '${common}'; Assert-ExactDomainSet -Actual @('a.example','b.example','evil.example') -Expected @('a.example','b.example') -Description test`,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(extra.status, 0);
  assert.match(extra.stderr, /domain set drifted/u);
});

test("certificate poll handles provisioning, failure, timeout, and gates proxy attachment", async () => {
  const common = fileURLToPath(
    new URL("../../deployment/gcp/Common.ps1", import.meta.url),
  );
  const edge = await read(
    "../../deployment/gcp/Configure-StagingCanaryEdge.ps1",
  );
  const active = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `. '${common}'; $script:i=0; $result=@(Wait-CertificateManagerActive -TimeoutSeconds 5 -IntervalSeconds 1 -Describe { $script:i++; [pscustomobject]@{managed=[pscustomobject]@{state=$(if($script:i -eq 1){'PROVISIONING'}else{'ACTIVE'})}} } -Sleep { param($s) }); if($result.Count -ne 1 -or $result[0].managed.state -cne 'ACTIVE'){throw 'Wait result stream was contaminated.'}`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(active.status, 0, active.stderr);
  const failed = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `. '${common}'; Wait-CertificateManagerActive -TimeoutSeconds 5 -IntervalSeconds 1 -Describe { [pscustomobject]@{managed=[pscustomobject]@{state='FAILED';provisioningIssue=[pscustomobject]@{reason='CAA'}}} } -Sleep { param($s) }`,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /FAILED.*CAA/u);
  const timed = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `. '${common}'; $script:now=[DateTimeOffset]::Parse('2026-01-01T00:00:00Z'); Wait-CertificateManagerActive -TimeoutSeconds 2 -IntervalSeconds 1 -Clock { $script:now } -Sleep { param($s) $script:now=$script:now.AddSeconds($s) } -Describe { [pscustomobject]@{managed=[pscustomobject]@{state='PROVISIONING'}} }`,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(timed.status, 0);
  assert.match(timed.stderr, /timed out before ACTIVE.*proxy was not changed/u);
  assert.ok(
    edge.indexOf("Wait-CertificateManagerActive") <
      edge.lastIndexOf('target-https-proxies","update'),
  );
});

test("candidate evidence rejects dirty worktrees and unprovenanced image substitution", async () => {
  const producer = await read(
    "../../deployment/gcp/New-StagingRegionEvidence.ps1",
  );
  const migration = await read(
    "../../deployment/gcp/Migrate-StagingRegion.ps1",
  );
  assert.match(producer, /status --porcelain=v1 --untracked-files=all/u);
  assert.match(producer, /merge-base --is-ancestor/u);
  assert.match(producer, /allowedControlPlanePaths/u);
  assert.match(producer, /candidate_is_ancestor = \$true/u);
  assert.match(migration, /Signed control-plane delta is outside/u);
  assert.match(producer, /--show-provenance/u);
  assert.match(producer, /candidate-web-build-provenance/u);
  assert.match(producer, /candidate-worker-build-provenance/u);
  assert.match(
    producer,
    /Closed Artifact Registry build-provenance parser rejected candidate image/u,
  );
  assert.match(
    migration,
    /Apply requires a clean tracked and untracked worktree/u,
  );
  assert.match(
    migration,
    /Signed closed provenance bindings do not match the evidence candidate/u,
  );
  assert.match(migration, /candidate_web_build_provenance_sha256/u);
  assert.match(migration, /candidate_worker_build_provenance_sha256/u);
});
