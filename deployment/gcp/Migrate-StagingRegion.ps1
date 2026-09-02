[CmdletBinding()]
param(
  [ValidateSet(
    "PlanAll",
    "Preflight",
    "RegionalFoundation",
    "DatabaseRehearsal",
    "Canary",
    "Maintenance",
    "FinalRestore",
    "Cutover",
    "Rollback",
    "PreWriteRollback",
    "SourceRetirement"
  )]
  [string]$Checkpoint = "PlanAll",
  [switch]$Apply,
  [string]$ConfirmProjectId = "",
  [string]$ResidualRiskAcknowledgement = "",
  [string]$EvidencePath = "",
  [string]$EvidenceSignaturePath = "",
  [ValidatePattern('^projects/innobase-matchbase-stg/locations/europe-west2/keyRings/[a-z0-9_-]+/cryptoKeys/[a-z0-9_-]+/cryptoKeyVersions/[1-9][0-9]*$')][string]$EvidenceKmsKeyVersion = "",
  [string]$GcranePath = "",
  [string]$PreviousEuWebRevision = "",
  [string]$PreviousEuWorkerImageDigest = "",
  [string]$RollbackBackupId = "",
  [string]$SourceRetirementAcknowledgement = "",
  [string]$RetirementBackupId = "",
  [ValidateRange(1, 30)][int]$SourceHoldDays = 7,
  [string]$ExpectedRoutePolicySha256 = "b752d2d42a63aaad11f3b89f67bad64861ce767f633bee8190549df23a6f4155",
  [string]$WebSourceImageDigest = "me-central1-docker.pkg.dev/innobase-matchbase-stg/matchbase/staging-web@sha256:088f3a29fadc0bc9caedfd7f93fd19767a3d6d434fc3a0d333d09b20029ae071",
  [string]$WorkerSourceImageDigest = "me-central1-docker.pkg.dev/innobase-matchbase-stg/matchbase/staging-worker-b752d2d42a63aaad@sha256:9f0422c70e09bf24f654d8c4e7af4241ef8dd5305af862b62e04e8d134da4816",
  [string]$MaintenanceBaseImageDigest = "node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8",
  [ValidatePattern('^db-custom-[1-9][0-9]*-[1-9][0-9]*$')][string]$TargetCloudSqlTier = "db-custom-2-7680"
)

. (Join-Path $PSScriptRoot "Common.ps1")

$migration = Get-MatchBaseStagingRegionMigration
$ProjectId = [string]$migration.ProjectId
$SourceRegion = [string]$migration.SourceRegion
$TargetRegion = [string]$migration.TargetRegion
$ResidualMarker = "I_ACKNOWLEDGE_GLOBAL_REQUIRED_EDGE_PROVIDER_LIMITATIONS"
$RetirementMarker = "I_AUTHORIZE_VERIFIED_SOURCE_RETIREMENT_AND_CRYPTOGRAPHIC_ERASURE"
$ExpectedMigrationHead = "0013_domain_pack_v2_and_legacy_annotation"
$LedgerSchemaVersion = "matchbase-staging-region-migration-ledger.v1"
$EvidenceSchemaVersion = "matchbase-staging-region-checkpoint-evidence.v1"
$PinnedGcraneVersion = "0.22.0"
$PinnedGcraneExecutableSha256 = "094281bd4c98e1dbf805350f3f59a152244324fb86a4b4b908c741d012a9615d"
$SourceLedgerUri = "gs://$($migration.SourceArtifactBucket)/migration-governance/staging-region-migration-ledger.v1.json"
$TargetLedgerUri = "gs://$($migration.TargetArtifactBucket)/migration-governance/staging-region-migration-ledger.v1.json"
$MaintenanceBaseSha256 = $MaintenanceBaseImageDigest.Split("@", 2)[1]
$TargetMaintenanceImageDigest = "$TargetRegion-docker.pkg.dev/$ProjectId/$($migration.TargetArtifactRepository)/maintenance-node-base@$MaintenanceBaseSha256"
$ForwardCheckpointOrder = @("Preflight", "RegionalFoundation", "DatabaseRehearsal", "Canary", "Maintenance", "FinalRestore", "Cutover", "SourceRetirement")
$SourceSecretNames = @(
  "matchbase-db-admin-password",
  "matchbase-db-migrator-url",
  "matchbase-db-runtime-url",
  "matchbase-digest-key",
  "matchbase-gemini-api-key",
  "matchbase-google-client-id",
  "matchbase-google-client-secret",
  "matchbase-openrouter-api-key",
  "matchbase-origin-admission-key"
)
$SourceWebImageName = $WebSourceImageDigest.Split("@", 2)[0].Split("/")[-1]
$SourceWorkerImageName = $WorkerSourceImageDigest.Split("@", 2)[0].Split("/")[-1]
$WebSha256 = $WebSourceImageDigest.Split("@", 2)[1]
$WorkerSha256 = $WorkerSourceImageDigest.Split("@", 2)[1]
$WebMigrationTag = "migration-ew2-$($WebSha256.Split(':', 2)[1].Substring(0, 16))"
$WorkerMigrationTag = "migration-ew2-$($WorkerSha256.Split(':', 2)[1].Substring(0, 16))"
$MaintenanceMigrationTag = "migration-ew2-$($MaintenanceBaseSha256.Split(':', 2)[1].Substring(0, 16))"
$TargetRepositoryRoot = "$TargetRegion-docker.pkg.dev/$ProjectId/$($migration.TargetArtifactRepository)"
$TargetWebImageDigest = "$TargetRepositoryRoot/$SourceWebImageName@$WebSha256"
$TargetWorkerImageDigest = "$TargetRepositoryRoot/$SourceWorkerImageName@$WorkerSha256"
$SecretNames = @(
  "matchbase-db-admin-password-ew2",
  "matchbase-db-migrator-url-ew2",
  "matchbase-db-runtime-url-ew2",
  "matchbase-digest-key-ew2",
  "matchbase-gemini-api-key-ew2",
  "matchbase-google-client-id-ew2",
  "matchbase-google-client-secret-ew2",
  "matchbase-openrouter-api-key-ew2",
  "matchbase-origin-admission-key-ew2"
)

function Test-Checkpoint {
  param([Parameter(Mandatory)][string]$Name)
  return $Checkpoint -ceq "PlanAll" -or $Checkpoint -ceq $Name
}

function Write-CheckpointHeader {
  param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Purpose)
  Write-Output ""
  Write-Output "CHECKPOINT $Name"
  Write-Output $Purpose
}

function Write-ExternalPlan {
  param([Parameter(Mandatory)][string]$Executable, [Parameter(Mandatory)][string[]]$Arguments)
  $rendered = ($Arguments | ForEach-Object { Format-CommandArgument $_ }) -join " "
  Write-Output "$Executable $rendered"
}

function Assert-SafeMigrationArguments {
  param([Parameter(Mandatory)][string[]]$Arguments)
  $rendered = $Arguments -join " "
  if ($rendered -match '(?i)--password(?:=|\s)|--data-file(?:=|\s)|secrets\s+versions\s+(?:access|add)') {
    throw "Migration scaffold refuses commands that can read, print, or transmit secret values."
  }
  if ($rendered -match '(?i)(?:^|\s)(?:delete|remove|destroy)(?:\s|$)') {
    throw "Migration scaffold never deletes source or target resources."
  }
}

function Invoke-MigrationGcloud {
  param([Parameter(Mandatory)][string[]]$Arguments)
  Assert-SafeMigrationArguments -Arguments $Arguments
  return Invoke-Gcloud -Arguments $Arguments
}

function Write-MigrationGcloudPlan {
  param([Parameter(Mandatory)][string[]]$Arguments)
  Assert-SafeMigrationArguments -Arguments $Arguments
  Write-GcloudPlan -Arguments $Arguments
}

function Invoke-OrPlanGcloud {
  param([Parameter(Mandatory)][string[]]$Arguments)
  if ($Apply) { return Invoke-MigrationGcloud -Arguments $Arguments }
  Write-MigrationGcloudPlan -Arguments $Arguments
  return $null
}

function Get-Sha256Text {
  param([Parameter(Mandatory)][string]$Text)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  $hash = [System.Security.Cryptography.SHA256]::HashData($bytes)
  return [Convert]::ToHexString($hash).ToLowerInvariant()
}

function Resolve-PinnedGcrane {
  $candidate = $GcranePath
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    $command = Get-Command gcrane -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $command) { throw "RegionalFoundation Apply requires pinned gcrane $PinnedGcraneVersion. Supply -GcranePath to the verified executable." }
    $candidate = $command.Source
  }
  $resolved = (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).Path
  if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "GcranePath must identify one executable file." }
  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolved).Hash.ToLowerInvariant()
  if ($actualHash -cne $PinnedGcraneExecutableSha256) { throw "gcrane executable SHA-256 does not match the governed Windows x86_64 v$PinnedGcraneVersion binary." }
  $version = (& $resolved version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $version -cne $PinnedGcraneVersion) { throw "gcrane version must be exactly $PinnedGcraneVersion." }
  return $resolved
}

function Get-ClosedProvenanceBinding {
  param([Parameter(Mandatory)][string]$Raw, [Parameter(Mandatory)][string]$Image, [Parameter(Mandatory)][string]$PeerImage, [Parameter(Mandatory)][string]$Commit)
  $parser = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\scripts\lib\staging-eu-provenance.mjs") -ErrorAction Stop).Path
  $work = Join-Path ([IO.Path]::GetTempPath()) "matchbase-apply-provenance-$([guid]::NewGuid().ToString('N')).json"
  try {
    Set-Content -LiteralPath $work -Value $Raw -Encoding utf8NoBOM
    $normalized = (& node $parser --file $work --image $Image --peer-image $PeerImage --commit $Commit 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Closed Artifact Registry provenance validation failed." }
    return $normalized | ConvertFrom-Json
  } finally { Remove-Item -LiteralPath $work -Force -ErrorAction SilentlyContinue }
}

function Get-GovernedEvidence {
  if (-not $Apply) { return $null }
  if ([string]::IsNullOrWhiteSpace($EvidencePath)) { throw "-Apply requires -EvidencePath to a machine-generated checkpoint evidence JSON file." }
  $resolved = (Resolve-Path -LiteralPath $EvidencePath -ErrorAction Stop).Path
  if ([string]::IsNullOrWhiteSpace($EvidenceSignaturePath) -or [string]::IsNullOrWhiteSpace($EvidenceKmsKeyVersion)) { throw "Apply requires the detached KMS signature and exact same-project EU KMS key version." }
  $signatureResolved = (Resolve-Path -LiteralPath $EvidenceSignaturePath -ErrorAction Stop).Path
  $raw = Get-Content -LiteralPath $resolved -Raw
  # Preserve signed ISO-8601 values exactly. PowerShell otherwise materializes
  # timestamps as local DateTime values and changes the bytes used by the
  # durable ledger hash chain when the document is read in another time zone.
  $evidence = $raw | ConvertFrom-Json -DateKind String
  if ($evidence.schema_version -cne $EvidenceSchemaVersion -or
      $evidence.checkpoint -cne $Checkpoint -or
      $evidence.project_id -cne $ProjectId -or
      $evidence.source_region -cne $SourceRegion -or
      $evidence.target_region -cne $TargetRegion -or
      $evidence.outcome -cne "PASS") {
    throw "Checkpoint evidence identity or outcome is invalid."
  }
  if ($evidence.producer_schema_version -cne "matchbase-staging-region-evidence-producer.v1" -or $evidence.signing_key_version -cne $EvidenceKmsKeyVersion) { throw "Evidence producer or signing-key provenance is invalid." }
  $keyParts = $EvidenceKmsKeyVersion -split "/"
  $publicKeyPath = Join-Path ([System.IO.Path]::GetTempPath()) "matchbase-evidence-public-$([guid]::NewGuid().ToString('N')).pem"
  try {
    $null = Invoke-MigrationGcloud -Arguments @("kms", "keys", "versions", "get-public-key", $keyParts[9], "--project=$ProjectId", "--location=$($keyParts[3])", "--keyring=$($keyParts[5])", "--key=$($keyParts[7])", "--output-file=$publicKeyPath")
    $rsa = [Security.Cryptography.RSA]::Create()
    $rsa.ImportFromPem((Get-Content -LiteralPath $publicKeyPath -Raw))
    $validSignature = $rsa.VerifyData([IO.File]::ReadAllBytes($resolved), [IO.File]::ReadAllBytes($signatureResolved), [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $rsa.Dispose()
    if (-not $validSignature) { throw "Evidence KMS signature verification failed." }
  } finally { Remove-Item -LiteralPath $publicKeyPath -Force -ErrorAction SilentlyContinue }
  $activeAccount = (Invoke-MigrationGcloud -Arguments @("config", "get-value", "account") | Out-String).Trim()
  $activeProject = (Invoke-MigrationGcloud -Arguments @("config", "get-value", "project") | Out-String).Trim()
  if ($evidence.principal.active_account -cne $activeAccount -or $evidence.principal.active_project -cne $ProjectId -or $activeProject -cne $ProjectId) { throw "Evidence principal no longer matches the active gcloud identity." }
  if ($evidence.candidate.web_source_image_digest -cne $WebSourceImageDigest -or $evidence.candidate.worker_source_image_digest -cne $WorkerSourceImageDigest) { throw "Evidence candidate image digests do not match Apply arguments." }
  $repoRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..") -ErrorAction Stop).Path
  $controlPlaneCommit = (& git -C $repoRoot rev-parse HEAD 2>&1 | Out-String).Trim();$candidateCommit=[string]$evidence.candidate.commit
  $worktreeState = (& git -C $repoRoot status --porcelain=v1 --untracked-files=all 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0 -or -not [string]::IsNullOrWhiteSpace($worktreeState)) { throw "Apply requires a clean tracked and untracked worktree." }
  if($evidence.control_plane.commit-cne$controlPlaneCommit-or-not$evidence.control_plane.candidate_is_ancestor){throw "Evidence control-plane commit does not match the checked-out repository HEAD."}
  & git -C $repoRoot merge-base --is-ancestor $candidateCommit $controlPlaneCommit 2>$null;if($LASTEXITCODE-ne0){throw "The evidence image candidate is not an ancestor of the checked-out control plane."}
  $allowedControlPlanePaths=@("deployment/gcp/Common.ps1","deployment/gcp/Configure-StagingCanaryEdge.ps1","deployment/gcp/Prepare-StagingCanaryRoute.ps1","deployment/gcp/Migrate-StagingRegion.ps1","deployment/gcp/New-StagingRegionEvidence.ps1","deployment/gcp/run-closed-database-query.mjs","deployment/gcp/README.md","test/deployment/gcp-eu-staging-target.test.mjs","test/deployment/gcp-staging-region-migration.test.mjs");$actualDelta=@(& git -C $repoRoot diff --name-only "$candidateCommit..$controlPlaneCommit" 2>&1|Where-Object{-not[string]::IsNullOrWhiteSpace($_)}|Sort-Object);$signedDelta=@($evidence.control_plane.delta_paths|Sort-Object);if($LASTEXITCODE-ne0-or@($actualDelta|Where-Object{$_-cnotin$allowedControlPlanePaths}).Count-or($actualDelta-join",")-cne($signedDelta-join",")){throw "Signed control-plane delta is outside the closed path set or does not match HEAD."}
  foreach ($result in @($evidence.raw_results)) {
    if ([string]$result.stdout_sha256 -cne (Get-Sha256Text -Text ([string]$result.stdout))) { throw "Evidence raw-result hash is invalid for '$($result.id)'." }
  }
  $webProvenance = @($evidence.raw_results | Where-Object id -eq "candidate-web-build-provenance")
  $workerProvenance = @($evidence.raw_results | Where-Object id -eq "candidate-worker-build-provenance")
  if ($webProvenance.Count -ne 1 -or $workerProvenance.Count -ne 1 -or
      $evidence.candidate.web_build_provenance_sha256 -cne $webProvenance[0].stdout_sha256 -or
      $evidence.candidate.worker_build_provenance_sha256 -cne $workerProvenance[0].stdout_sha256) { throw "Signed Artifact Registry provenance captures are missing or substituted." }
  $signedWebBinding = Get-ClosedProvenanceBinding -Raw ([string]$webProvenance[0].stdout) -Image $WebSourceImageDigest -PeerImage $WorkerSourceImageDigest -Commit $candidateCommit
  $signedWorkerBinding = Get-ClosedProvenanceBinding -Raw ([string]$workerProvenance[0].stdout) -Image $WorkerSourceImageDigest -PeerImage $WebSourceImageDigest -Commit $candidateCommit
  if (($signedWebBinding | ConvertTo-Json -Compress) -cne ($evidence.candidate.web_provenance_binding | ConvertTo-Json -Compress) -or ($signedWorkerBinding | ConvertTo-Json -Compress) -cne ($evidence.candidate.worker_provenance_binding | ConvertTo-Json -Compress)) { throw "Signed closed provenance bindings do not match the evidence candidate." }
  foreach ($binding in @(@($WebSourceImageDigest, $WorkerSourceImageDigest, $evidence.candidate.web_build_provenance_sha256, $evidence.candidate.web_provenance_binding), @($WorkerSourceImageDigest, $WebSourceImageDigest, $evidence.candidate.worker_build_provenance_sha256, $evidence.candidate.worker_provenance_binding))) {
    $liveProvenance = (Invoke-MigrationGcloud -Arguments @("artifacts", "docker", "images", "describe", [string]$binding[0], "--project=$ProjectId", "--show-provenance", "--format=json") | Out-String).Trim()
    $liveBinding = Get-ClosedProvenanceBinding -Raw $liveProvenance -Image ([string]$binding[0]) -PeerImage ([string]$binding[1]) -Commit $candidateCommit
    if ((Get-Sha256Text -Text $liveProvenance) -cne [string]$binding[2] -or ($liveBinding | ConvertTo-Json -Compress) -cne ($binding[3] | ConvertTo-Json -Compress)) { throw "Live Artifact Registry provenance changed after evidence capture." }
  }
  $capturedAt = [datetimeoffset]::MinValue
  if (-not [datetimeoffset]::TryParse([string]$evidence.captured_at_utc, [ref]$capturedAt)) { throw "Checkpoint evidence captured_at_utc is invalid." }
  if ($capturedAt -gt [datetimeoffset]::UtcNow.AddMinutes(5)) { throw "Checkpoint evidence timestamp is in the future." }
  if ($capturedAt -lt [datetimeoffset]::UtcNow.AddMinutes(-30)) { throw "Checkpoint evidence is older than the 30-minute execution window." }
  if ($null -eq $evidence.facts) { throw "Checkpoint evidence facts are required." }
  return [pscustomobject]@{
    Path = $resolved
    Raw = $raw
    Sha256 = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant()
    Document = $evidence
  }
}

function Add-ObservedEvidenceFacts {
  param([Parameter(Mandatory)][object]$Evidence, [Parameter(Mandatory)][System.Collections.IDictionary]$Observed)
  $document = $Evidence.Document
  $document | Add-Member -NotePropertyName observed -NotePropertyValue ([pscustomobject]$Observed) -Force
  $work = Join-Path ([System.IO.Path]::GetTempPath()) "matchbase-observed-evidence-$([guid]::NewGuid().ToString('N')).json"
  $json = $document | ConvertTo-Json -Depth 20
  Set-Content -LiteralPath $work -Value $json -Encoding utf8NoBOM
  return [pscustomobject]@{
    Path = $work
    Raw = $json
    Sha256 = (Get-FileHash -LiteralPath $work -Algorithm SHA256).Hash.ToLowerInvariant()
    Document = $document
  }
}

function Assert-ZeroFreezeEvidence {
  param([Parameter(Mandatory)][object]$Evidence)
  $freezeQuery = "SELECT count(*) FILTER (WHERE state IN ('queued','running','failed_retryable')) AS active_or_queued_runs, count(*) FILTER (WHERE state='queued') AS queued_runs FROM research_run; SELECT count(*) AS unreleased_leases FROM execution_lease WHERE released_at IS NULL AND expires_at > now();"
  $facts = $Evidence.Document.facts
  if ([int]$facts.active_runs -ne 0 -or [int]$facts.queued_runs -ne 0 -or [int]$facts.unreleased_leases -ne 0 -or
      [string]$facts.freeze_query_sha256 -cne (Get-Sha256Text -Text $freezeQuery)) {
    throw "Maintenance evidence does not prove a machine-queried zero-run, zero-queue, zero-lease write freeze."
  }
}

function Assert-LiveDatabaseMigrationHead {
  $psql = Get-Command psql -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $psql -or [string]::IsNullOrWhiteSpace($env:MATCHBASE_EVIDENCE_DATABASE_URL)) { throw "Live database verification requires psql and MATCHBASE_EVIDENCE_DATABASE_URL." }
  $query = "SELECT migration_id FROM matchbase_schema_migration ORDER BY applied_at DESC, migration_id DESC LIMIT 1;"
  $head = (& $psql.Source $env:MATCHBASE_EVIDENCE_DATABASE_URL --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 --command=$query 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $head -cne $ExpectedMigrationHead) { throw "Live database migration head verification failed." }
}

function Assert-NoEuWritesSinceCutover {
  param([Parameter(Mandatory)][object]$Ledger)
  $cutover = @($Ledger.Document.entries | Where-Object checkpoint -eq "Cutover")
  if ($cutover.Count -ne 1 -or [string]$cutover[0].occurred_at_utc -cnotmatch '^20[0-9]{2}-') { throw "Pre-write rollback requires one valid Cutover ledger timestamp." }
  $psql = Get-Command psql -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $psql -or [string]::IsNullOrWhiteSpace($env:MATCHBASE_EVIDENCE_DATABASE_URL)) { throw "EU write verification requires psql and MATCHBASE_EVIDENCE_DATABASE_URL." }
  $timestamp = [datetimeoffset]::Parse([string]$cutover[0].occurred_at_utc).ToUniversalTime().ToString("o")
  $query = "SELECT count(*) FROM research_run WHERE created_at >= '$timestamp'::timestamptz;"
  $count = (& $psql.Source $env:MATCHBASE_EVIDENCE_DATABASE_URL --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 --command=$query 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $count -cne "0") { throw "Pre-write rollback is prohibited because EU writes exist or cannot be disproved." }
}

function Assert-CutoverEvidence {
  param([Parameter(Mandatory)][object]$Evidence)
  $facts = $Evidence.Document.facts
  foreach ($field in @("oauth", "complete_research", "pdf", "profile_admin", "origin_denial", "responsive_browser", "latency", "cost", "eu_log_routing")) {
    if ($facts.acceptance.$field -cne "PASS") { throw "Cutover acceptance '$field' is not PASS." }
  }
  if ([string]$facts.web_image_digest -cne $TargetWebImageDigest -or
      [string]$facts.worker_image_digest -cne $TargetWorkerImageDigest -or
      [string]$facts.route_policy_sha256 -cne $ExpectedRoutePolicySha256 -or
      [string]$facts.cloud_sql_instance -cne [string]$migration.TargetCloudSqlInstance -or
      [string]$facts.migration_head -cne $ExpectedMigrationHead) {
    throw "Cutover evidence does not bind the exact EU images, route policy, database, and migration head."
  }
}

function Assert-ArtifactInventoryReconciled {
  param([Parameter(Mandatory)][object]$Evidence)
  $sourceCapture = @($Evidence.Document.raw_results | Where-Object id -eq "source-object-inventory")
  $targetCapture = @($Evidence.Document.raw_results | Where-Object id -eq "target-object-inventory")
  if ($sourceCapture.Count -ne 1 -or $targetCapture.Count -ne 1) { throw "SourceRetirement requires one full source and target object inventory." }
  $sourceObjects = @(Convert-StorageLsInventory -Raw ([string]$sourceCapture[0].stdout))
  $targetObjects = @(Convert-StorageLsInventory -Raw ([string]$targetCapture[0].stdout))
  $targetByName = @{}
  $targetVersions = @{}
  foreach ($item in $targetObjects) {
    $name = ([string]$item.name).Replace("gs://$($migration.TargetArtifactBucket)/", "")
    $targetByName[$name] = $item
    $identity = "$name|$($item.size)|$($item.crc32c)"
    $targetVersions[$identity] = 1 + [int]($targetVersions[$identity] ?? 0)
  }
  foreach ($item in $sourceObjects) {
    $name = ([string]$item.name).Replace("gs://$($migration.SourceArtifactBucket)/", "")
    $identity = "$name|$($item.size)|$($item.crc32c)"
    if (-not $targetVersions.ContainsKey($identity) -or [int]$targetVersions[$identity] -lt 1) { throw "Artifact generation inventory mismatch for '$name'." }
    $targetVersions[$identity] = [int]$targetVersions[$identity] - 1
  }
  foreach ($uri in @($Evidence.Document.facts.persisted_artifact_uris)) {
    if ([string]$uri -cnotmatch "^gs://$([regex]::Escape($migration.SourceArtifactBucket))/(?<name>.+)$") { throw "Persisted artifact URI is outside the source bucket." }
    if (-not $targetByName.ContainsKey($Matches.name)) { throw "Persisted artifact '$($Matches.name)' is absent from the EU bucket." }
  }
}

function Get-LedgerLoadUri {
  if ($Checkpoint -in @("Preflight", "RegionalFoundation")) { return $SourceLedgerUri }
  return $TargetLedgerUri
}

function Get-LedgerStoreUri {
  if ($Checkpoint -ceq "Preflight") { return $SourceLedgerUri }
  return $TargetLedgerUri
}

function Get-EmptyLedger {
  return [ordered]@{
    schema_version = $LedgerSchemaVersion
    project_id = $ProjectId
    source_region = $SourceRegion
    target_region = $TargetRegion
    entries = @()
  }
}

function Get-MigrationLedger {
  $uri = Get-LedgerLoadUri
  $work = Join-Path ([System.IO.Path]::GetTempPath()) "matchbase-region-ledger-$([guid]::NewGuid().ToString('N')).json"
  if (-not (Test-GcloudResource -Arguments @("storage", "objects", "describe", $uri))) {
    if ($Checkpoint -cne "Preflight") { throw "Durable predecessor ledger '$uri' is missing." }
    return [pscustomobject]@{ Document = (Get-EmptyLedger); Generation = "0"; WorkPath = $work; LoadUri = $uri }
  }
  $generation = Invoke-MigrationGcloud -Arguments @("storage", "objects", "describe", $uri, "--format=value(generation)")
  if ($generation -cnotmatch '^[1-9][0-9]*$') { throw "Durable ledger generation is invalid." }
  $null = Invoke-MigrationGcloud -Arguments @("storage", "cp", $uri, $work, "--quiet")
  $ledgerRaw = Get-Content -LiteralPath $work -Raw
  # Hash-chain material includes the exact persisted timestamp. Keep JSON date
  # tokens as strings so validation is independent of the operator time zone.
  $document = $ledgerRaw | ConvertFrom-Json -DateKind String
  if ($document.schema_version -cne $LedgerSchemaVersion -or $document.project_id -cne $ProjectId -or
      $document.source_region -cne $SourceRegion -or $document.target_region -cne $TargetRegion) {
    throw "Durable ledger identity is invalid."
  }
  $previous = "0" * 64
  $sequence = 0
  $candidateCommit = $null
  $candidateWebDigest = $null
  $candidateWorkerDigest = $null
  $candidateWebProvenance = $null
  $candidateWorkerProvenance = $null
  foreach ($entry in @($document.entries)) {
    $sequence++
    if ([int]$entry.sequence -ne $sequence -or [string]$entry.previous_entry_sha256 -cne $previous) { throw "Durable ledger sequence or chain is invalid." }
    if ($sequence -eq 1) {
      $candidateCommit = [string]$entry.candidate_commit
      $candidateWebDigest = [string]$entry.candidate_web_image_digest
      $candidateWorkerDigest = [string]$entry.candidate_worker_image_digest
      $candidateWebProvenance = [string]$entry.candidate_web_build_provenance_sha256
      $candidateWorkerProvenance = [string]$entry.candidate_worker_build_provenance_sha256
      if ($candidateCommit -cnotmatch '^[a-f0-9]{40}$' -or $candidateWebDigest -cnotmatch '@sha256:[a-f0-9]{64}$' -or $candidateWorkerDigest -cnotmatch '@sha256:[a-f0-9]{64}$' -or $candidateWebProvenance -cnotmatch '^[a-f0-9]{64}$' -or $candidateWorkerProvenance -cnotmatch '^[a-f0-9]{64}$') { throw "Durable ledger candidate identity is invalid." }
    } elseif ([string]$entry.candidate_commit -cne $candidateCommit -or [string]$entry.candidate_web_image_digest -cne $candidateWebDigest -or [string]$entry.candidate_worker_image_digest -cne $candidateWorkerDigest -or [string]$entry.candidate_web_build_provenance_sha256 -cne $candidateWebProvenance -or [string]$entry.candidate_worker_build_provenance_sha256 -cne $candidateWorkerProvenance) {
      throw "Durable ledger candidate identity changed across checkpoints."
    }
    $material = "$previous|$sequence|$($entry.checkpoint)|$($entry.evidence_sha256)|$($entry.occurred_at_utc)|$($entry.candidate_commit)|$($entry.candidate_web_image_digest)|$($entry.candidate_worker_image_digest)|$($entry.candidate_web_build_provenance_sha256)|$($entry.candidate_worker_build_provenance_sha256)"
    $expected = Get-Sha256Text -Text $material
    if ([string]$entry.entry_sha256 -cne $expected) { throw "Durable ledger entry hash is invalid." }
    $previous = $expected
  }
  return [pscustomobject]@{ Document = $document; Raw = $ledgerRaw; Generation = $generation; WorkPath = $work; LoadUri = $uri }
}

function Assert-CheckpointPredecessors {
  param([Parameter(Mandatory)][object]$Ledger)
  if ($Checkpoint -in @("Rollback", "PreWriteRollback")) {
    if (@($Ledger.Document.entries | Where-Object checkpoint -eq "Cutover").Count -ne 1) { throw "Rollback requires exactly one completed Cutover ledger entry." }
    if (@($Ledger.Document.entries | Where-Object checkpoint -eq "SourceRetirement").Count -ne 0) { throw "Rollback is prohibited after governed source retirement." }
    return
  }
  $index = [array]::IndexOf($ForwardCheckpointOrder, $Checkpoint)
  if ($index -lt 0) { return }
  $expected = if ($index -eq 0) { @() } else { @($ForwardCheckpointOrder[0..($index - 1)]) }
  $actual = @($Ledger.Document.entries | Where-Object { $_.checkpoint -in $ForwardCheckpointOrder } | ForEach-Object checkpoint)
  if (($actual -join "|") -cne ($expected -join "|")) {
    throw "Checkpoint '$Checkpoint' requires ordered predecessors [$($expected -join ', ')]; found [$($actual -join ', ')]."
  }
}

function Assert-EvidenceLedgerBinding {
  param([Parameter(Mandatory)][object]$Evidence, [Parameter(Mandatory)][object]$Ledger)
  if ($Checkpoint -ceq "Preflight") { return }
  $binding = $Evidence.Document.predecessor_ledger
  if ($null -eq $binding -or [string]$binding.uri -cne [string]$Ledger.LoadUri -or [string]$binding.content_sha256 -cne (Get-Sha256Text -Text ([string]$Ledger.Raw))) {
    throw "Evidence is not bound to the exact predecessor ledger bytes loaded for Apply."
  }
  $entries = @($Ledger.Document.entries)
  if ($entries.Count -gt 0 -and ($Evidence.Document.candidate.commit -cne $entries[0].candidate_commit -or $Evidence.Document.candidate.web_source_image_digest -cne $entries[0].candidate_web_image_digest -or $Evidence.Document.candidate.worker_source_image_digest -cne $entries[0].candidate_worker_image_digest -or $Evidence.Document.candidate.web_build_provenance_sha256 -cne $entries[0].candidate_web_build_provenance_sha256 -or $Evidence.Document.candidate.worker_build_provenance_sha256 -cne $entries[0].candidate_worker_build_provenance_sha256)) { throw "Evidence attempts cross-candidate ledger substitution." }
}

function Assert-DurableEvidenceObjects {
  param([Parameter(Mandatory)][object]$Ledger)
  foreach ($entry in @($Ledger.Document.entries)) {
    $uri = "gs://$($migration.TargetArtifactBucket)/$($entry.evidence_object)"
    $work = Join-Path ([System.IO.Path]::GetTempPath()) "matchbase-evidence-$([guid]::NewGuid().ToString('N')).json"
    $null = Invoke-MigrationGcloud -Arguments @("storage", "cp", $uri, $work, "--quiet")
    $actual = (Get-FileHash -LiteralPath $work -Algorithm SHA256).Hash.ToLowerInvariant()
    Remove-Item -LiteralPath $work -Force
    if ($actual -cne [string]$entry.evidence_sha256) { throw "Durable evidence hash mismatch for checkpoint '$($entry.checkpoint)'." }
  }
}

function Complete-MigrationCheckpoint {
  param([Parameter(Mandatory)][object]$Ledger, [Parameter(Mandatory)][object]$Evidence)
  $storeUri = Get-LedgerStoreUri
  $storeBucket = if ($Checkpoint -ceq "Preflight") { [string]$migration.SourceArtifactBucket } else { [string]$migration.TargetArtifactBucket }
  $entries = @($Ledger.Document.entries)
  $sequence = $entries.Count + 1
  $previous = if ($entries.Count -eq 0) { "0" * 64 } else { [string]$entries[-1].entry_sha256 }
  $evidenceObject = "migration-governance/evidence/{0:D2}-{1}-{2}.json" -f $sequence, $Checkpoint.ToLowerInvariant(), $Evidence.Sha256
  $evidenceUri = "gs://$storeBucket/$evidenceObject"
  $null = Invoke-MigrationGcloud -Arguments @("storage", "cp", $Evidence.Path, $evidenceUri, "--if-generation-match=0", "--quiet")
  $occurredAt = ([datetimeoffset]$Evidence.Document.captured_at_utc).ToUniversalTime().ToString("o")
  $candidateCommit = [string]$Evidence.Document.candidate.commit
  $candidateWebDigest = [string]$Evidence.Document.candidate.web_source_image_digest
  $candidateWorkerDigest = [string]$Evidence.Document.candidate.worker_source_image_digest
  $candidateWebProvenance = [string]$Evidence.Document.candidate.web_build_provenance_sha256
  $candidateWorkerProvenance = [string]$Evidence.Document.candidate.worker_build_provenance_sha256
  $material = "$previous|$sequence|$Checkpoint|$($Evidence.Sha256)|$occurredAt|$candidateCommit|$candidateWebDigest|$candidateWorkerDigest|$candidateWebProvenance|$candidateWorkerProvenance"
  $entryHash = Get-Sha256Text -Text $material
  $entry = [ordered]@{
    sequence = $sequence
    checkpoint = $Checkpoint
    occurred_at_utc = $occurredAt
    evidence_object = $evidenceObject
    evidence_sha256 = $Evidence.Sha256
    candidate_commit = $candidateCommit
    candidate_web_image_digest = $candidateWebDigest
    candidate_worker_image_digest = $candidateWorkerDigest
    candidate_web_build_provenance_sha256 = $candidateWebProvenance
    candidate_worker_build_provenance_sha256 = $candidateWorkerProvenance
    previous_entry_sha256 = $previous
    entry_sha256 = $entryHash
  }
  $Ledger.Document.entries = @($entries + $entry)
  $json = $Ledger.Document | ConvertTo-Json -Depth 20
  Set-Content -LiteralPath $Ledger.WorkPath -Value $json -Encoding utf8NoBOM
  $expectedGeneration = if ($storeUri -ceq $Ledger.LoadUri) {
    [string]$Ledger.Generation
  } elseif (Test-GcloudResource -Arguments @("storage", "objects", "describe", $storeUri)) {
    # RegionalFoundation copies the complete versioned source bucket before it
    # promotes the canonical ledger. Replace only the exact copied predecessor,
    # using its live generation as the optimistic-concurrency precondition.
    $targetGeneration = Invoke-MigrationGcloud -Arguments @("storage", "objects", "describe", $storeUri, "--format=value(generation)")
    if ($targetGeneration -cnotmatch '^[1-9][0-9]*$') { throw "Copied target ledger generation is invalid." }
    $targetWork = Join-Path ([System.IO.Path]::GetTempPath()) "matchbase-target-ledger-$([guid]::NewGuid().ToString('N')).json"
    try {
      $null = Invoke-MigrationGcloud -Arguments @("storage", "cp", $storeUri, $targetWork, "--quiet")
      $targetRaw = Get-Content -LiteralPath $targetWork -Raw
      if ((Get-Sha256Text -Text $targetRaw) -cne (Get-Sha256Text -Text ([string]$Ledger.Raw))) { throw "Copied target ledger does not equal the exact predecessor bytes." }
    } finally { Remove-Item -LiteralPath $targetWork -Force -ErrorAction SilentlyContinue }
    [string]$targetGeneration
  } else {
    "0"
  }
  $null = Invoke-MigrationGcloud -Arguments @("storage", "cp", $Ledger.WorkPath, $storeUri, "--if-generation-match=$expectedGeneration", "--quiet")
  Remove-Item -LiteralPath $Ledger.WorkPath -Force -ErrorAction SilentlyContinue
}

function Assert-SourceWorkerQuiesced {
  $json = Invoke-MigrationGcloud -Arguments @("run", "worker-pools", "describe", [string]$migration.SourceWorkerPool, "--project=$ProjectId", "--region=$SourceRegion", "--format=json") | ConvertFrom-Json
  $container = $json.spec.template.spec.containers[0]
  if ([string]$container.command[0] -cne "/bin/sleep" -or [string]$container.args[0] -cne "2147483647") {
    throw "Source worker is not in the governed quiescent configuration."
  }
}

function Assert-ExactEuRuntimeAndDatabase {
  $web = Invoke-MigrationGcloud -Arguments @("run", "services", "describe", [string]$migration.TargetWebService, "--project=$ProjectId", "--region=$TargetRegion", "--format=json") | ConvertFrom-Json
  $worker = Invoke-MigrationGcloud -Arguments @("run", "worker-pools", "describe", [string]$migration.TargetWorkerPool, "--project=$ProjectId", "--region=$TargetRegion", "--format=json") | ConvertFrom-Json
  $database = Invoke-MigrationGcloud -Arguments @("sql", "instances", "describe", [string]$migration.TargetCloudSqlInstance, "--project=$ProjectId", "--format=json") | ConvertFrom-Json
  if ([string]$web.spec.template.spec.containers[0].image -cne $TargetWebImageDigest -or [string]$worker.spec.template.spec.containers[0].image -cne $TargetWorkerImageDigest) {
    throw "EU runtime image identity does not match the governed digests."
  }
  if (@($worker.spec.template.spec.containers[0].command).Count -ne 0 -or @($worker.spec.template.spec.containers[0].args).Count -ne 0) {
    throw "EU worker is quiesced or has a non-governed command override."
  }
  foreach ($runtime in @($web, $worker)) {
    $environment = @{}; foreach ($item in @($runtime.spec.template.spec.containers[0].env)) { $environment[[string]$item.name] = [string]$item.value }
    if ($environment.MATCHBASE_ROUTE_POLICY_SHA256 -cne $ExpectedRoutePolicySha256 -or
        $environment.MATCHBASE_IMAGE_DIGEST -cne ([string]$runtime.spec.template.spec.containers[0].image).Split("@", 2)[1] -or
        [string]$runtime.spec.template.metadata.annotations.'run.googleapis.com/cloudsql-instances' -cne "$ProjectId`:$TargetRegion`:$($migration.TargetCloudSqlInstance)") {
      throw "EU runtime configuration identity or Cloud SQL binding is invalid."
    }
  }
  if ($database.region -cne $TargetRegion -or $database.state -cne "RUNNABLE" -or $database.databaseVersion -cne "POSTGRES_18") {
    throw "EU Cloud SQL identity or state is invalid."
  }
  Assert-SourceWorkerQuiesced
}

function Invoke-RetirementGcloud {
  param([Parameter(Mandatory)][string[]]$Arguments)
  if ($Checkpoint -cne "SourceRetirement" -or $SourceRetirementAcknowledgement -cne $RetirementMarker) {
    throw "Source retirement command escaped its destructive gate."
  }
  $rendered = $Arguments -join " "
  $allowedTargets = @(
    [string]$migration.SourceWebService, [string]$migration.SourceWorkerPool,
    [string]$migration.SourceCloudSqlInstance, [string]$migration.SourceNetworkEndpointGroup,
    [string]$migration.SourceBackendService, [string]$migration.SourceArtifactBucket,
    [string]$migration.SourceArtifactRepository
  ) + $SourceSecretNames
  if (-not ($allowedTargets | Where-Object { $rendered.Contains($_) })) { throw "Source retirement target is outside the exact allowlist." }
  return Invoke-Gcloud -Arguments $Arguments
}

function Assert-ResourceExists {
  param([Parameter(Mandatory)][string[]]$Arguments, [Parameter(Mandatory)][string]$Description)
  if (-not (Test-GcloudResource -Arguments $Arguments)) {
    throw "$Description is missing or inaccessible."
  }
}

function Convert-StorageLsInventory {
  param([Parameter(Mandatory)][string]$Raw)
  foreach ($item in @($Raw | ConvertFrom-Json -DateKind String)) {
    if ($item.type -cne "cloud_object" -or $null -eq $item.metadata) { throw "Storage inventory contains a non-object entry." }
    $metadata = $item.metadata
    if ([string]$metadata.name -eq "" -or [string]$metadata.generation -cnotmatch '^[1-9][0-9]*$' -or [string]$metadata.size -cnotmatch '^[0-9]+$' -or [string]::IsNullOrWhiteSpace([string]$metadata.crc32c)) {
      throw "Storage inventory object metadata is incomplete or malformed."
    }
    [pscustomobject]@{ name = [string]$metadata.name; generation = [string]$metadata.generation; size = [string]$metadata.size; crc32c = [string]$metadata.crc32c }
  }
}

function Copy-AllSourceArtifactGenerations {
  $inventoryRaw = Invoke-MigrationGcloud -Arguments @("storage", "ls", "gs://$($migration.SourceArtifactBucket)/**", "--all-versions", "--json")
  $inventory = @(Convert-StorageLsInventory -Raw $inventoryRaw | Sort-Object { [int64]$_.generation })
  foreach ($item in $inventory) {
    $name = ([string]$item.name).Replace("gs://$($migration.SourceArtifactBucket)/", "")
    if ([string]::IsNullOrWhiteSpace($name) -or [string]$item.generation -cnotmatch '^[1-9][0-9]*$') { throw "Source artifact inventory contains an invalid object identity." }
    $sourceVersion = "gs://$($migration.SourceArtifactBucket)/$name#$($item.generation)"
    $targetObject = "gs://$($migration.TargetArtifactBucket)/$name"
    $null = Invoke-MigrationGcloud -Arguments @("storage", "cp", $sourceVersion, $targetObject, "--quiet")
  }
}

function New-FreshBackupAndRestore {
  param([Parameter(Mandatory)][string]$Label)
  $backupDescription = "matchbase-$Label-fresh-$([datetimeoffset]::UtcNow.ToString('yyyyMMddTHHmmssZ'))-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
  $backupArguments = @(
    "sql", "backups", "create",
    "--project=$ProjectId",
    "--instance=$($migration.SourceCloudSqlInstance)",
    "--location=eu",
    "--description=$backupDescription",
    "--quiet"
  )
  $restoreTemplate = @(
    "sql", "backups", "restore", "<FRESH_BACKUP_ID>",
    "--project=$ProjectId",
    "--backup-instance=$($migration.SourceCloudSqlInstance)",
    "--restore-instance=$($migration.TargetCloudSqlInstance)",
    "--quiet"
  )
  $discoveryArguments = @(
    "sql", "backups", "list",
    "--project=$ProjectId",
    "--instance=$($migration.SourceCloudSqlInstance)",
    "--filter=description=$backupDescription",
    "--format=json(id,status,location,description)"
  )
  if (-not $Apply) {
    Write-MigrationGcloudPlan -Arguments $backupArguments
    Write-MigrationGcloudPlan -Arguments $discoveryArguments
    Write-MigrationGcloudPlan -Arguments $restoreTemplate
    return
  }
  $null = Invoke-MigrationGcloud -Arguments $backupArguments
  $backupRecords = @((Invoke-MigrationGcloud -Arguments $discoveryArguments | ConvertFrom-Json -DateKind String))
  if ($backupRecords.Count -ne 1 -or [string]$backupRecords[0].id -cnotmatch '^[1-9][0-9]*$' -or
      [string]$backupRecords[0].description -cne $backupDescription -or [string]$backupRecords[0].status -cne "SUCCESSFUL" -or
      [string]$backupRecords[0].location -cne "eu") {
    throw "Fresh Cloud SQL backup discovery did not return one exact successful European backup."
  }
  $backupId = [string]$backupRecords[0].id
  $restoreArguments = @($restoreTemplate | ForEach-Object { if ($_ -ceq "<FRESH_BACKUP_ID>") { $backupId } else { $_ } })
  $null = Invoke-MigrationGcloud -Arguments $restoreArguments
  return $backupId
}

function Set-TargetSqlPostRestorePolicy {
  $arguments = @(
    "sql", "instances", "patch", [string]$migration.TargetCloudSqlInstance,
    "--project=$ProjectId",
    "--availability-type=REGIONAL",
    "--storage-auto-increase",
    "--backup-start-time=02:00",
    "--backup-location=$TargetRegion",
    "--enable-point-in-time-recovery",
    "--retained-backups-count=7",
    "--database-flags=cloudsql.iam_authentication=on",
    "--connector-enforcement=REQUIRED",
    "--ssl-mode=TRUSTED_CLIENT_CERTIFICATE_REQUIRED",
    "--deletion-protection",
    "--quiet"
  )
  Invoke-OrPlanGcloud -Arguments $arguments
}

Assert-ImmutableImageDigest -Image $WebSourceImageDigest -ProjectId $ProjectId -Region $SourceRegion -Repository ([string]$migration.SourceArtifactRepository)
Assert-ImmutableImageDigest -Image $WorkerSourceImageDigest -ProjectId $ProjectId -Region $SourceRegion -Repository ([string]$migration.SourceArtifactRepository)
if ($ExpectedRoutePolicySha256 -cnotmatch '^[a-f0-9]{64}$') { throw "Expected route-policy SHA-256 is invalid." }
if ($MaintenanceBaseImageDigest -cnotmatch '^node:24\.14\.0-bookworm-slim@sha256:[a-f0-9]{64}$') { throw "Maintenance base image must be the governed Node digest." }

$GovernedEvidence = $null
$MigrationLedger = $null
$PinnedGcraneExecutable = $null

if ($Apply) {
  Assert-ApplyConfirmation -Apply $true -ExpectedProjectId $ProjectId -ConfirmProjectId $ConfirmProjectId
  if ($ResidualRiskAcknowledgement -cne $ResidualMarker) {
    throw "-Apply requires -ResidualRiskAcknowledgement '$ResidualMarker'."
  }
  if ($Checkpoint -ceq "PlanAll") {
    throw "-Apply requires one explicit checkpoint; PlanAll is plan-only."
  }
  if ($Checkpoint -ne "Preflight" -and (-not $PSBoundParameters.ContainsKey("WebSourceImageDigest") -or -not $PSBoundParameters.ContainsKey("WorkerSourceImageDigest"))) {
    throw "Apply requires explicit candidate -WebSourceImageDigest and -WorkerSourceImageDigest values; plan defaults are not release authorization."
  }
  if ($Checkpoint -ceq "Rollback" -and $PreviousEuWebRevision -cnotmatch '^matchbase-staging-web-[a-z0-9-]{3,63}$') {
    throw "Rollback requires an exact -PreviousEuWebRevision in europe-west2."
  }
  if ($Checkpoint -ceq "Rollback" -and ($PreviousEuWorkerImageDigest -cnotmatch "^$([regex]::Escape($TargetRepositoryRoot))/[a-z0-9][a-z0-9._-]{0,127}@sha256:[a-f0-9]{64}$" -or $RollbackBackupId -cnotmatch '^[1-9][0-9]*$')) {
    throw "Rollback requires an exact EU worker digest and numeric EU backup ID."
  }
  if ($Checkpoint -ceq "SourceRetirement" -and ($SourceRetirementAcknowledgement -cne $RetirementMarker -or $RetirementBackupId -cnotmatch '^[1-9][0-9]*$')) {
    throw "SourceRetirement requires the exact destructive acknowledgement and numeric verified EU backup ID."
  }
  Assert-GcloudAvailable
  if ($Checkpoint -ceq "RegionalFoundation") { $PinnedGcraneExecutable = Resolve-PinnedGcrane }
  $GovernedEvidence = Get-GovernedEvidence
  $MigrationLedger = Get-MigrationLedger
  Assert-EvidenceLedgerBinding -Evidence $GovernedEvidence -Ledger $MigrationLedger
  Assert-CheckpointPredecessors -Ledger $MigrationLedger
}

Write-Output "MatchBASE Staging regional migration"
Write-Output "Mode: $(if ($Apply) { 'APPLY' } else { 'PLAN ONLY' })"
Write-Output "Project: $ProjectId"
Write-Output "Route: $SourceRegion -> $TargetRegion"
Write-Output "Residual boundary: global _Required logging, global edge termination, and provider geography are not resolved by this scaffold."
Write-Output "Source resources are never deleted outside the separately gated SourceRetirement checkpoint."

if (Test-Checkpoint -Name "Preflight") {
  Write-CheckpointHeader -Name "Preflight" -Purpose "Verify the closed project, source resources, target-region service availability, logging boundary, and pinned images."
  $commands = @(
    @("projects", "describe", $ProjectId, "--format=value(projectId,lifecycleState)"),
    @("projects", "get-ancestors", $ProjectId, "--format=json"),
    @("run", "services", "list", "--project=$ProjectId", "--region=$TargetRegion", "--format=value(name)"),
    @("run", "worker-pools", "list", "--project=$ProjectId", "--region=$TargetRegion", "--format=value(name)"),
    @("sql", "tiers", "list", "--project=$ProjectId", "--filter=tier=$TargetCloudSqlTier AND region=$TargetRegion", "--format=value(tier,region)"),
    @("compute", "regions", "describe", $TargetRegion, "--project=$ProjectId", "--format=value(status)"),
    @("logging", "buckets", "list", "--project=$ProjectId", "--location=global", "--format=value(name,location)"),
    @("secrets", "list", "--project=$ProjectId", "--format=value(name,replication)"),
    @("run", "services", "describe", [string]$migration.SourceWebService, "--project=$ProjectId", "--region=$SourceRegion", "--format=value(status.conditions[0].status)"),
    @("run", "worker-pools", "describe", [string]$migration.SourceWorkerPool, "--project=$ProjectId", "--region=$SourceRegion", "--format=value(status.conditions[0].status)"),
    @("sql", "instances", "describe", [string]$migration.SourceCloudSqlInstance, "--project=$ProjectId", "--format=value(state,region,databaseVersion)"),
    @("storage", "buckets", "describe", "gs://$($migration.SourceArtifactBucket)", "--format=value(location)"),
    @("artifacts", "docker", "images", "describe", $WebSourceImageDigest, "--project=$ProjectId", "--format=value(image_summary.digest)"),
    @("artifacts", "docker", "images", "describe", $WorkerSourceImageDigest, "--project=$ProjectId", "--format=value(image_summary.digest)")
  )
  foreach ($command in $commands) { Invoke-OrPlanGcloud -Arguments $command }
  if ($Apply) { Complete-MigrationCheckpoint -Ledger $MigrationLedger -Evidence $GovernedEvidence }
}

if (Test-Checkpoint -Name "RegionalFoundation") {
  Write-CheckpointHeader -Name "RegionalFoundation" -Purpose "Create EU metadata and regional storage without reading secret versions or deleting source resources."
  $repositoryCreate = @("artifacts", "repositories", "create", [string]$migration.TargetArtifactRepository, "--project=$ProjectId", "--location=$TargetRegion", "--repository-format=docker", "--immutable-tags", "--description=MatchBASE Staging EU immutable runtime images", "--quiet")
  $bucketCreate = @("storage", "buckets", "create", "gs://$($migration.TargetArtifactBucket)", "--project=$ProjectId", "--location=$TargetRegion", "--uniform-bucket-level-access", "--public-access-prevention", "--quiet")
  $bucketUpdate = @("storage", "buckets", "update", "gs://$($migration.TargetArtifactBucket)", "--uniform-bucket-level-access", "--public-access-prevention", "--versioning", "--soft-delete-duration=2592000s", "--quiet")
  $logBucketCreate = @("logging", "buckets", "create", [string]$migration.TargetLogBucket, "--project=$ProjectId", "--location=$TargetRegion", "--retention-days=30", "--quiet")
  $logDestination = "logging.googleapis.com/projects/$ProjectId/locations/$TargetRegion/buckets/$($migration.TargetLogBucket)"
  $logFilter = "(((resource.type=`"cloud_run_revision`" OR resource.type=`"cloud_run_worker_pool`") AND resource.labels.location=`"$TargetRegion`") OR (resource.type=`"cloudsql_database`" AND resource.labels.database_id=`"$ProjectId`:$($migration.TargetCloudSqlInstance)`"))"
  # A sink writing to a log bucket in the same project has no writer identity
  # and requires no destination IAM grant. The removed CLI flag and custom
  # writer identities must not be reintroduced for this closed destination.
  $logSinkCreate = @("logging", "sinks", "create", [string]$migration.TargetLogSink, $logDestination, "--project=$ProjectId", "--log-filter=$logFilter", "--quiet")

  if ($Apply) {
    if (-not (Test-GcloudResource -Arguments @("artifacts", "repositories", "describe", [string]$migration.TargetArtifactRepository, "--project=$ProjectId", "--location=$TargetRegion"))) {
      $null = Invoke-MigrationGcloud -Arguments $repositoryCreate
    }
    if (-not (Test-GcloudResource -Arguments @("storage", "buckets", "describe", "gs://$($migration.TargetArtifactBucket)"))) {
      $null = Invoke-MigrationGcloud -Arguments $bucketCreate
    }
    $null = Invoke-MigrationGcloud -Arguments $bucketUpdate
    foreach ($secret in $SecretNames) {
      if (-not (Test-GcloudResource -Arguments @("secrets", "describe", $secret, "--project=$ProjectId"))) {
        $null = Invoke-MigrationGcloud -Arguments @("secrets", "create", $secret, "--project=$ProjectId", "--replication-policy=user-managed", "--locations=$TargetRegion", "--quiet")
      }
    }
    if (-not (Test-GcloudResource -Arguments @("logging", "buckets", "describe", [string]$migration.TargetLogBucket, "--project=$ProjectId", "--location=$TargetRegion"))) {
      $null = Invoke-MigrationGcloud -Arguments $logBucketCreate
    }
    if (-not (Test-GcloudResource -Arguments @("logging", "sinks", "describe", [string]$migration.TargetLogSink, "--project=$ProjectId"))) {
      $null = Invoke-MigrationGcloud -Arguments $logSinkCreate
    }
    $sink = Invoke-MigrationGcloud -Arguments @("logging", "sinks", "describe", [string]$migration.TargetLogSink, "--project=$ProjectId", "--format=json") | ConvertFrom-Json
    $hasWriterIdentity = $sink.PSObject.Properties.Name -contains "writerIdentity" -and -not [string]::IsNullOrWhiteSpace([string]$sink.writerIdentity)
    if ([string]$sink.name -cne [string]$migration.TargetLogSink -or [string]$sink.destination -cne $logDestination -or [string]$sink.filter -cne $logFilter -or $hasWriterIdentity) {
      throw "EU same-project log sink identity, destination, filter, or no-writer contract drifted."
    }
    if (-not (Test-GcloudResource -Arguments @("artifacts", "docker", "images", "describe", $TargetWebImageDigest, "--project=$ProjectId"))) {
      & $PinnedGcraneExecutable cp $WebSourceImageDigest "$TargetRepositoryRoot/${SourceWebImageName}:$WebMigrationTag"
      if ($LASTEXITCODE -ne 0) { throw "gcrane failed to copy the web digest." }
    }
    if (-not (Test-GcloudResource -Arguments @("artifacts", "docker", "images", "describe", $TargetWorkerImageDigest, "--project=$ProjectId"))) {
      & $PinnedGcraneExecutable cp $WorkerSourceImageDigest "$TargetRepositoryRoot/${SourceWorkerImageName}:$WorkerMigrationTag"
      if ($LASTEXITCODE -ne 0) { throw "gcrane failed to copy the worker digest." }
    }
    if (-not (Test-GcloudResource -Arguments @("artifacts", "docker", "images", "describe", $TargetMaintenanceImageDigest, "--project=$ProjectId"))) {
      & $PinnedGcraneExecutable cp $MaintenanceBaseImageDigest "$TargetRepositoryRoot/maintenance-node-base:$MaintenanceMigrationTag"
      if ($LASTEXITCODE -ne 0) { throw "gcrane failed to copy the maintenance base digest." }
    }
    Assert-ResourceExists -Arguments @("artifacts", "docker", "images", "describe", $TargetWebImageDigest, "--project=$ProjectId") -Description "EU web image digest"
    Assert-ResourceExists -Arguments @("artifacts", "docker", "images", "describe", $TargetWorkerImageDigest, "--project=$ProjectId") -Description "EU worker image digest"
    Assert-ResourceExists -Arguments @("artifacts", "docker", "images", "describe", $TargetMaintenanceImageDigest, "--project=$ProjectId") -Description "EU maintenance base digest"
    Copy-AllSourceArtifactGenerations
    $null = Invoke-MigrationGcloud -Arguments @("storage", "rsync", "gs://$($migration.SourceArtifactBucket)", "gs://$($migration.TargetArtifactBucket)", "--recursive", "--checksums-only", "--quiet")
    Complete-MigrationCheckpoint -Ledger $MigrationLedger -Evidence $GovernedEvidence
  } else {
    Write-MigrationGcloudPlan -Arguments $repositoryCreate
    Write-ExternalPlan -Executable "gcrane" -Arguments @("cp", $WebSourceImageDigest, "$TargetRepositoryRoot/${SourceWebImageName}:$WebMigrationTag")
    Write-ExternalPlan -Executable "gcrane" -Arguments @("cp", $WorkerSourceImageDigest, "$TargetRepositoryRoot/${SourceWorkerImageName}:$WorkerMigrationTag")
    Write-ExternalPlan -Executable "gcrane" -Arguments @("cp", $MaintenanceBaseImageDigest, "$TargetRepositoryRoot/maintenance-node-base:$MaintenanceMigrationTag")
    Write-MigrationGcloudPlan -Arguments $bucketCreate
    Write-MigrationGcloudPlan -Arguments $bucketUpdate
    foreach ($secret in $SecretNames) {
      Write-MigrationGcloudPlan -Arguments @("secrets", "create", $secret, "--project=$ProjectId", "--replication-policy=user-managed", "--locations=$TargetRegion", "--quiet")
    }
    Write-MigrationGcloudPlan -Arguments $logBucketCreate
    Write-MigrationGcloudPlan -Arguments $logSinkCreate
    Write-MigrationGcloudPlan -Arguments @("storage", "ls", "gs://$($migration.SourceArtifactBucket)/**", "--all-versions", "--json")
    Write-Output "For every source object generation in ascending generation order: gcloud storage cp gs://$($migration.SourceArtifactBucket)/<OBJECT>#<GENERATION> gs://$($migration.TargetArtifactBucket)/<OBJECT> --quiet"
    Write-MigrationGcloudPlan -Arguments @("storage", "rsync", "gs://$($migration.SourceArtifactBucket)", "gs://$($migration.TargetArtifactBucket)", "--recursive", "--checksums-only", "--quiet")
    Write-Output "Verify the same-project EU log-bucket sink has no writer identity; no destination IAM grant is required."
  }
}

if (Test-Checkpoint -Name "DatabaseRehearsal") {
  Write-CheckpointHeader -Name "DatabaseRehearsal" -Purpose "Create the EU Cloud SQL target, restore a fresh source backup, then reapply target-region policy."
  $createSql = @(
    "sql", "instances", "create", [string]$migration.TargetCloudSqlInstance,
    "--project=$ProjectId",
    "--region=$TargetRegion",
    "--database-version=POSTGRES_18",
    "--edition=ENTERPRISE",
    "--tier=$TargetCloudSqlTier",
    "--availability-type=REGIONAL",
    "--storage-type=SSD",
    "--storage-size=10",
    "--storage-auto-increase",
    "--database-flags=cloudsql.iam_authentication=on",
    "--connector-enforcement=REQUIRED",
    "--ssl-mode=TRUSTED_CLIENT_CERTIFICATE_REQUIRED",
    "--deletion-protection",
    "--quiet"
  )
  if ($Apply) {
    if (-not (Test-GcloudResource -Arguments @("sql", "instances", "describe", [string]$migration.TargetCloudSqlInstance, "--project=$ProjectId"))) {
      $null = Invoke-MigrationGcloud -Arguments $createSql
    }
  } else {
    Write-MigrationGcloudPlan -Arguments $createSql
  }
  if ($Apply) { $freshBackupId = New-FreshBackupAndRestore -Label "rehearsal" } else { New-FreshBackupAndRestore -Label "rehearsal" }
  Set-TargetSqlPostRestorePolicy
  Invoke-OrPlanGcloud -Arguments @("sql", "instances", "describe", [string]$migration.TargetCloudSqlInstance, "--project=$ProjectId", "--format=value(state,region,databaseVersion,settings.availabilityType,settings.backupConfiguration.pointInTimeRecoveryEnabled)")
  if ($Apply) {
    Assert-LiveDatabaseMigrationHead
    $observedEvidence = Add-ObservedEvidenceFacts -Evidence $GovernedEvidence -Observed ([ordered]@{ fresh_backup_id = [string]$freshBackupId; target_sql_instance = [string]$migration.TargetCloudSqlInstance })
    Complete-MigrationCheckpoint -Ledger $MigrationLedger -Evidence $observedEvidence
  }
  Write-Output "Gate: contract, migration status, row-count, role, integrity, drift, resume, backup and rollback tests must pass before Canary."
}

if (Test-Checkpoint -Name "Canary") {
  Write-CheckpointHeader -Name "Canary" -Purpose "Verify governed EU runtime deployments, create unattached EU application and real maintenance paths, and retain the current public route."
  Write-Output "Prerequisite: apply Configure-StagingCanaryEdge.ps1 and Prepare-StagingCanaryRoute.ps1, then produce signed Canary evidence proving the isolated EU route, two closed Armor rules at priorities 2000-2001, dual-host ACTIVE certificate, HTTPS proxy attachment, proxied DNS with public A/AAAA, Full strict, and redacted origin-admission transform identity."
  $canaryNegCreate = @("compute", "network-endpoint-groups", "create", [string]$migration.CanaryNetworkEndpointGroup, "--project=$ProjectId", "--region=$TargetRegion", "--network-endpoint-type=serverless", "--cloud-run-service=$($migration.CanaryWebService)", "--quiet")
  $canaryBackendCreate = @("compute", "backend-services", "create", [string]$migration.CanaryBackendService, "--project=$ProjectId", "--global", "--load-balancing-scheme=EXTERNAL_MANAGED", "--protocol=HTTP", "--timeout=30s", "--quiet")
  $canaryBackendAdd = @("compute", "backend-services", "add-backend", [string]$migration.CanaryBackendService, "--project=$ProjectId", "--global", "--network-endpoint-group=$($migration.CanaryNetworkEndpointGroup)", "--network-endpoint-group-region=$TargetRegion", "--quiet")
  $canaryBackendPolicy = @("compute", "backend-services", "update", [string]$migration.CanaryBackendService, "--project=$ProjectId", "--global", "--security-policy=$($migration.SecurityPolicy)", "--quiet")
  $canaryMatcher = "matchbase-staging-eu-canary"
  $canaryPathMatcher = @("compute", "url-maps", "add-path-matcher", [string]$migration.UrlMap, "--project=$ProjectId", "--global", "--path-matcher-name=$canaryMatcher", "--default-service=$($migration.CanaryBackendService)", "--new-hosts=$($migration.CanaryHostname)", "--quiet")
  $canaryHostRule = @("compute", "url-maps", "add-host-rule", [string]$migration.UrlMap, "--project=$ProjectId", "--global", "--hosts=$($migration.CanaryHostname)", "--path-matcher-name=$canaryMatcher", "--quiet")
  $negCreate = @("compute", "network-endpoint-groups", "create", [string]$migration.TargetNetworkEndpointGroup, "--project=$ProjectId", "--region=$TargetRegion", "--network-endpoint-type=serverless", "--cloud-run-service=$($migration.TargetWebService)", "--quiet")
  $backendCreate = @("compute", "backend-services", "create", [string]$migration.TargetBackendService, "--project=$ProjectId", "--global", "--load-balancing-scheme=EXTERNAL_MANAGED", "--protocol=HTTP", "--timeout=30s", "--quiet")
  $backendAdd = @("compute", "backend-services", "add-backend", [string]$migration.TargetBackendService, "--project=$ProjectId", "--global", "--network-endpoint-group=$($migration.TargetNetworkEndpointGroup)", "--network-endpoint-group-region=$TargetRegion", "--quiet")
  $backendPolicy = @("compute", "backend-services", "update", [string]$migration.TargetBackendService, "--project=$ProjectId", "--global", "--security-policy=$($migration.SecurityPolicy)", "--quiet")
  $maintenanceCode = 'require("node:http").createServer((request,response)=>{response.writeHead(503,{"content-type":"text/plain; charset=utf-8","retry-after":"120","cache-control":"no-store"});response.end("MatchBASE staging maintenance\n")}).listen(process.env.PORT||8080)'
  $maintenanceDeploy = @("run", "deploy", [string]$migration.MaintenanceService, "--project=$ProjectId", "--region=$TargetRegion", "--image=$TargetMaintenanceImageDigest", "--command=node", "--args=^~^-e~$maintenanceCode", "--ingress=internal-and-cloud-load-balancing", "--no-invoker-iam-check", "--min=1", "--max=1", "--concurrency=8", "--timeout=30s", "--quiet")
  $maintenanceNegCreate = @("compute", "network-endpoint-groups", "create", [string]$migration.MaintenanceNetworkEndpointGroup, "--project=$ProjectId", "--region=$TargetRegion", "--network-endpoint-type=serverless", "--cloud-run-service=$($migration.MaintenanceService)", "--quiet")
  $maintenanceBackendCreate = @("compute", "backend-services", "create", [string]$migration.MaintenanceBackendService, "--project=$ProjectId", "--global", "--load-balancing-scheme=EXTERNAL_MANAGED", "--protocol=HTTP", "--timeout=30s", "--quiet")
  $maintenanceBackendAdd = @("compute", "backend-services", "add-backend", [string]$migration.MaintenanceBackendService, "--project=$ProjectId", "--global", "--network-endpoint-group=$($migration.MaintenanceNetworkEndpointGroup)", "--network-endpoint-group-region=$TargetRegion", "--quiet")
  $maintenanceBackendPolicy = @("compute", "backend-services", "update", [string]$migration.MaintenanceBackendService, "--project=$ProjectId", "--global", "--security-policy=$($migration.SecurityPolicy)", "--quiet")
  if ($Apply) {
    Assert-ResourceExists -Arguments @("run", "services", "describe", [string]$migration.CanaryWebService, "--project=$ProjectId", "--region=$TargetRegion") -Description "isolated EU canary web service"
    Assert-ResourceExists -Arguments @("run", "worker-pools", "describe", [string]$migration.TargetWorkerPool, "--project=$ProjectId", "--region=$TargetRegion") -Description "EU canary worker pool"
    Assert-ResourceExists -Arguments @("sql", "instances", "describe", [string]$migration.TargetCloudSqlInstance, "--project=$ProjectId") -Description "EU Cloud SQL target"
    $urlMapBefore = Invoke-MigrationGcloud -Arguments @("compute", "url-maps", "describe", [string]$migration.UrlMap, "--project=$ProjectId", "--global", "--format=json") | ConvertFrom-Json
    $mainDefaultBefore = [string]$urlMapBefore.defaultService
    $mainRouteBefore = [ordered]@{ defaultService = $mainDefaultBefore; hostRules = @($urlMapBefore.hostRules | Where-Object { $_.pathMatcher -cne $canaryMatcher }); pathMatchers = @($urlMapBefore.pathMatchers | Where-Object { $_.name -cne $canaryMatcher }) } | ConvertTo-Json -Depth 20 -Compress
    if (-not (Test-GcloudResource -Arguments @("compute", "network-endpoint-groups", "describe", [string]$migration.CanaryNetworkEndpointGroup, "--project=$ProjectId", "--region=$TargetRegion"))) { $null = Invoke-MigrationGcloud -Arguments $canaryNegCreate }
    if (-not (Test-GcloudResource -Arguments @("compute", "backend-services", "describe", [string]$migration.CanaryBackendService, "--project=$ProjectId", "--global"))) {
      $null = Invoke-MigrationGcloud -Arguments $canaryBackendCreate
      $null = Invoke-MigrationGcloud -Arguments $canaryBackendAdd
    }
    $null = Invoke-MigrationGcloud -Arguments $canaryBackendPolicy
    $canaryMatcherMissing=-not(@($urlMapBefore.pathMatchers | Where-Object name -ceq $canaryMatcher).Count);$canaryHostMissing=-not(@($urlMapBefore.hostRules | Where-Object { $_.hosts -ccontains $migration.CanaryHostname -and $_.pathMatcher -ceq $canaryMatcher }).Count);if($canaryMatcherMissing){$null=Invoke-MigrationGcloud -Arguments $canaryPathMatcher}elseif($canaryHostMissing){$null=Invoke-MigrationGcloud -Arguments $canaryHostRule}
    $urlMapAfter = Invoke-MigrationGcloud -Arguments @("compute", "url-maps", "describe", [string]$migration.UrlMap, "--project=$ProjectId", "--global", "--format=json") | ConvertFrom-Json
    $mainRouteAfter = [ordered]@{ defaultService = [string]$urlMapAfter.defaultService; hostRules = @($urlMapAfter.hostRules | Where-Object { $_.pathMatcher -cne $canaryMatcher }); pathMatchers = @($urlMapAfter.pathMatchers | Where-Object { $_.name -cne $canaryMatcher }) } | ConvertTo-Json -Depth 20 -Compress
    if ($mainRouteAfter -cne $mainRouteBefore -or @($urlMapAfter.hostRules | Where-Object { $_.hosts -ccontains $migration.CanaryHostname -and $_.pathMatcher -ceq $canaryMatcher }).Count -ne 1 -or @($urlMapAfter.pathMatchers | Where-Object { $_.name -ceq $canaryMatcher -and $_.defaultService.EndsWith("/backendServices/$($migration.CanaryBackendService)", [StringComparison]::Ordinal) }).Count -ne 1) { throw "Canary host routing is not isolated from the main Staging default route." }
    if (-not (Test-GcloudResource -Arguments @("compute", "network-endpoint-groups", "describe", [string]$migration.TargetNetworkEndpointGroup, "--project=$ProjectId", "--region=$TargetRegion"))) {
      $null = Invoke-MigrationGcloud -Arguments $negCreate
    }
    if (-not (Test-GcloudResource -Arguments @("compute", "backend-services", "describe", [string]$migration.TargetBackendService, "--project=$ProjectId", "--global"))) {
      $null = Invoke-MigrationGcloud -Arguments $backendCreate
      $null = Invoke-MigrationGcloud -Arguments $backendAdd
    }
    $null = Invoke-MigrationGcloud -Arguments $backendPolicy
    $null = Invoke-MigrationGcloud -Arguments $maintenanceDeploy
    if (-not (Test-GcloudResource -Arguments @("compute", "network-endpoint-groups", "describe", [string]$migration.MaintenanceNetworkEndpointGroup, "--project=$ProjectId", "--region=$TargetRegion"))) {
      $null = Invoke-MigrationGcloud -Arguments $maintenanceNegCreate
    }
    if (-not (Test-GcloudResource -Arguments @("compute", "backend-services", "describe", [string]$migration.MaintenanceBackendService, "--project=$ProjectId", "--global"))) {
      $null = Invoke-MigrationGcloud -Arguments $maintenanceBackendCreate
      $null = Invoke-MigrationGcloud -Arguments $maintenanceBackendAdd
    }
    $null = Invoke-MigrationGcloud -Arguments $maintenanceBackendPolicy
    $maintenanceJson = Invoke-MigrationGcloud -Arguments @("run", "services", "describe", [string]$migration.MaintenanceService, "--project=$ProjectId", "--region=$TargetRegion", "--format=json") | ConvertFrom-Json
    if ([string]$maintenanceJson.spec.template.spec.containers[0].image -cne $TargetMaintenanceImageDigest -or $maintenanceJson.status.conditions[0].status -ne "True") {
      throw "Real maintenance service is not Ready on the governed EU digest."
    }
    Assert-CutoverEvidence -Evidence $GovernedEvidence
    $observedEvidence = Add-ObservedEvidenceFacts -Evidence $GovernedEvidence -Observed ([ordered]@{ maintenance_service = [string]$migration.MaintenanceService; maintenance_image_digest = $TargetMaintenanceImageDigest; maintenance_backend = [string]$migration.MaintenanceBackendService })
    Complete-MigrationCheckpoint -Ledger $MigrationLedger -Evidence $observedEvidence
  } else {
    Write-MigrationGcloudPlan -Arguments @("run", "services", "describe", [string]$migration.CanaryWebService, "--project=$ProjectId", "--region=$TargetRegion", "--format=value(status.conditions[0].status)")
    Write-MigrationGcloudPlan -Arguments @("run", "worker-pools", "describe", [string]$migration.TargetWorkerPool, "--project=$ProjectId", "--region=$TargetRegion", "--format=value(status.conditions[0].status)")
    Write-MigrationGcloudPlan -Arguments $negCreate
    Write-MigrationGcloudPlan -Arguments $backendCreate
    Write-MigrationGcloudPlan -Arguments $backendAdd
    Write-MigrationGcloudPlan -Arguments $backendPolicy
    Write-MigrationGcloudPlan -Arguments $canaryNegCreate
    Write-MigrationGcloudPlan -Arguments $canaryBackendCreate
    Write-MigrationGcloudPlan -Arguments $canaryBackendAdd
    Write-MigrationGcloudPlan -Arguments $canaryBackendPolicy
    Write-MigrationGcloudPlan -Arguments $canaryPathMatcher
    Write-MigrationGcloudPlan -Arguments $canaryHostRule
    Write-MigrationGcloudPlan -Arguments $maintenanceDeploy
    Write-MigrationGcloudPlan -Arguments $maintenanceNegCreate
    Write-MigrationGcloudPlan -Arguments $maintenanceBackendCreate
    Write-MigrationGcloudPlan -Arguments $maintenanceBackendAdd
    Write-MigrationGcloudPlan -Arguments $maintenanceBackendPolicy
  }
  Write-Output "Gate: a separately protected canary host must pass OAuth, health, intake, live research, PDF, profile/admin, origin-denial, responsive-browser, latency, cost and EU log-routing acceptance."
  Write-Output "Canary adds only its closed host rule and path matcher; the main Staging default route must remain byte-for-byte identical."
}

if (Test-Checkpoint -Name "Maintenance") {
  Write-CheckpointHeader -Name "Maintenance" -Purpose "Route public traffic to the prebuilt maintenance backend only after zero-active-run and empty-queue evidence."
  if ($Apply) { Assert-ZeroFreezeEvidence -Evidence $GovernedEvidence }
  Invoke-OrPlanGcloud -Arguments @("compute", "backend-services", "describe", [string]$migration.MaintenanceBackendService, "--project=$ProjectId", "--global", "--format=value(name)")
  Invoke-OrPlanGcloud -Arguments @("compute", "url-maps", "set-default-service", [string]$migration.UrlMap, "--project=$ProjectId", "--global", "--default-service=$($migration.MaintenanceBackendService)", "--quiet")
  Invoke-OrPlanGcloud -Arguments @("run", "worker-pools", "update", [string]$migration.SourceWorkerPool, "--project=$ProjectId", "--region=$SourceRegion", "--image=$WorkerSourceImageDigest", "--command=/bin/sleep", "--args=2147483647", "--instances=1", "--quiet")
  if ($Apply) {
    $defaultService = Invoke-MigrationGcloud -Arguments @("compute", "url-maps", "describe", [string]$migration.UrlMap, "--project=$ProjectId", "--global", "--format=value(defaultService)")
    if (-not $defaultService.EndsWith("/backendServices/$($migration.MaintenanceBackendService)", [StringComparison]::Ordinal)) { throw "Maintenance backend is not the active URL-map default." }
    Assert-SourceWorkerQuiesced
    $observedEvidence = Add-ObservedEvidenceFacts -Evidence $GovernedEvidence -Observed ([ordered]@{ url_map_default_backend = [string]$migration.MaintenanceBackendService; source_worker_command = "/bin/sleep"; source_worker_arg = "2147483647" })
    Complete-MigrationCheckpoint -Ledger $MigrationLedger -Evidence $observedEvidence
  }
  Write-Output "The source worker is replaced by a governed quiescent revision after the maintenance route blocks new request admission."
  Write-Output "Gate: record the write-freeze timestamp, zero active executions, empty queue, settled leases, source row counts and source LSN."
}

if (Test-Checkpoint -Name "FinalRestore") {
  Write-CheckpointHeader -Name "FinalRestore" -Purpose "While maintenance is active, restore a new fresh backup and reapply target SQL policy."
  if ($Apply) { $freshBackupId = New-FreshBackupAndRestore -Label "final-cutover" } else { New-FreshBackupAndRestore -Label "final-cutover" }
  Set-TargetSqlPostRestorePolicy
  if ($Apply) {
    Assert-SourceWorkerQuiesced
    Assert-LiveDatabaseMigrationHead
    $observedEvidence = Add-ObservedEvidenceFacts -Evidence $GovernedEvidence -Observed ([ordered]@{ fresh_backup_id = [string]$freshBackupId; target_sql_instance = [string]$migration.TargetCloudSqlInstance })
    Complete-MigrationCheckpoint -Ledger $MigrationLedger -Evidence $observedEvidence
  }
  Write-Output "Gate: final contract, schema, row-count, role, integrity, resume, drift and rollback evidence must pass. Create fresh EU DB URL secret versions outside this metadata-only scaffold."
}

if (Test-Checkpoint -Name "Cutover") {
  Write-CheckpointHeader -Name "Cutover" -Purpose "Admit the EU worker and atomically switch the existing URL map to the EU backend."
  if ($Apply) {
    Assert-DurableEvidenceObjects -Ledger $MigrationLedger
    Assert-CutoverEvidence -Evidence $GovernedEvidence
    Assert-ExactEuRuntimeAndDatabase
    Assert-ResourceExists -Arguments @("compute", "backend-services", "describe", [string]$migration.TargetBackendService, "--project=$ProjectId", "--global") -Description "EU backend"
    Assert-ResourceExists -Arguments @("run", "services", "describe", [string]$migration.TargetWebService, "--project=$ProjectId", "--region=$TargetRegion") -Description "EU web service"
    Assert-ResourceExists -Arguments @("run", "worker-pools", "describe", [string]$migration.TargetWorkerPool, "--project=$ProjectId", "--region=$TargetRegion") -Description "EU worker pool"
  }
  Invoke-OrPlanGcloud -Arguments @("run", "worker-pools", "update", [string]$migration.TargetWorkerPool, "--project=$ProjectId", "--region=$TargetRegion", "--instances=1", "--quiet")
  Invoke-OrPlanGcloud -Arguments @("compute", "url-maps", "set-default-service", [string]$migration.UrlMap, "--project=$ProjectId", "--global", "--default-service=$($migration.TargetBackendService)", "--quiet")
  if ($Apply) {
    $defaultService = Invoke-MigrationGcloud -Arguments @("compute", "url-maps", "describe", [string]$migration.UrlMap, "--project=$ProjectId", "--global", "--format=value(defaultService)")
    if (-not $defaultService.EndsWith("/backendServices/$($migration.TargetBackendService)", [StringComparison]::Ordinal)) { throw "EU backend cutover was not observed on the URL map." }
    $retirementNotBefore = [datetimeoffset]::UtcNow.AddDays($SourceHoldDays).ToString("o")
    $observedEvidence = Add-ObservedEvidenceFacts -Evidence $GovernedEvidence -Observed ([ordered]@{ url_map_default_backend = [string]$migration.TargetBackendService; source_worker_quiesced = $true; source_retirement_not_before_utc = $retirementNotBefore })
    Complete-MigrationCheckpoint -Ledger $MigrationLedger -Evidence $observedEvidence
  }
  Write-Output "Gate: health, TLS, origin denial, OAuth, full result/PDF, profile/admin, audit, quota, cost, latency and EU location evidence must pass before ending maintenance control."
}

if (Test-Checkpoint -Name "Rollback") {
  Write-CheckpointHeader -Name "Rollback" -Purpose "Post-write rollback quiesces both sides, restores a verified EU backup, and restores exact EU web and worker identities without split brain."
  $revision = if ($PreviousEuWebRevision) { $PreviousEuWebRevision } else { "<PREVIOUS_EU_WEB_REVISION>" }
  $workerDigest = if ($PreviousEuWorkerImageDigest) { $PreviousEuWorkerImageDigest } else { "<PREVIOUS_EU_WORKER_IMAGE_DIGEST>" }
  $backupId = if ($RollbackBackupId) { $RollbackBackupId } else { "<VERIFIED_EU_BACKUP_ID>" }
  if ($Apply) {
    Assert-ResourceExists -Arguments @("run", "revisions", "describe", $revision, "--project=$ProjectId", "--region=$TargetRegion") -Description "Rollback EU web revision"
    Assert-ResourceExists -Arguments @("artifacts", "docker", "images", "describe", $workerDigest, "--project=$ProjectId") -Description "Rollback EU worker digest"
  }
  Invoke-OrPlanGcloud -Arguments @("compute", "url-maps", "set-default-service", [string]$migration.UrlMap, "--project=$ProjectId", "--global", "--default-service=$($migration.MaintenanceBackendService)", "--quiet")
  Invoke-OrPlanGcloud -Arguments @("run", "worker-pools", "update", [string]$migration.TargetWorkerPool, "--project=$ProjectId", "--region=$TargetRegion", "--image=$TargetWorkerImageDigest", "--command=/bin/sleep", "--args=2147483647", "--instances=1", "--quiet")
  if ($Apply) { Assert-SourceWorkerQuiesced }
  if ($Apply) {
    $rollbackBackup = Invoke-MigrationGcloud -Arguments @("sql", "backups", "describe", $backupId, "--project=$ProjectId", "--instance=$($migration.TargetCloudSqlInstance)", "--format=json") | ConvertFrom-Json
    if ($rollbackBackup.status -cne "SUCCESSFUL") { throw "Rollback backup is not SUCCESSFUL." }
  } else {
    Write-MigrationGcloudPlan -Arguments @("sql", "backups", "describe", $backupId, "--project=$ProjectId", "--instance=$($migration.TargetCloudSqlInstance)", "--format=value(status,location)")
  }
  Invoke-OrPlanGcloud -Arguments @("sql", "backups", "restore", $backupId, "--project=$ProjectId", "--backup-instance=$($migration.TargetCloudSqlInstance)", "--restore-instance=$($migration.TargetCloudSqlInstance)", "--quiet")
  Set-TargetSqlPostRestorePolicy
  Invoke-OrPlanGcloud -Arguments @("run", "services", "update-traffic", [string]$migration.TargetWebService, "--project=$ProjectId", "--region=$TargetRegion", "--to-revisions=${revision}=100", "--quiet")
  Invoke-OrPlanGcloud -Arguments @("run", "worker-pools", "update", [string]$migration.TargetWorkerPool, "--project=$ProjectId", "--region=$TargetRegion", "--image=$workerDigest", "--command=", "--args=", "--instances=1", "--quiet")
  Invoke-OrPlanGcloud -Arguments @("compute", "url-maps", "set-default-service", [string]$migration.UrlMap, "--project=$ProjectId", "--global", "--default-service=$($migration.TargetBackendService)", "--quiet")
  if ($Apply) {
    $backup = Invoke-MigrationGcloud -Arguments @("sql", "backups", "describe", $backupId, "--project=$ProjectId", "--instance=$($migration.TargetCloudSqlInstance)", "--format=json") | ConvertFrom-Json
    $worker = Invoke-MigrationGcloud -Arguments @("run", "worker-pools", "describe", [string]$migration.TargetWorkerPool, "--project=$ProjectId", "--region=$TargetRegion", "--format=json") | ConvertFrom-Json
    if ($backup.status -cne "SUCCESSFUL" -or [string]$worker.spec.template.spec.containers[0].image -cne $workerDigest -or
        @($worker.spec.template.spec.containers[0].command).Count -ne 0) { throw "Coordinated EU rollback verification failed." }
    $observedEvidence = Add-ObservedEvidenceFacts -Evidence $GovernedEvidence -Observed ([ordered]@{ rollback_backup_id = $backupId; active_web_revision = $revision; active_worker_image_digest = $workerDigest; database_instance = [string]$migration.TargetCloudSqlInstance; source_worker_quiesced = $true })
    Complete-MigrationCheckpoint -Ledger $MigrationLedger -Evidence $observedEvidence
  }
}

if (Test-Checkpoint -Name "PreWriteRollback") {
  Write-CheckpointHeader -Name "PreWriteRollback" -Purpose "Only before any EU write, quiesce the EU worker, restore the exact source worker, verify the source DB, then return the edge."
  if ($Apply) {
    Assert-NoEuWritesSinceCutover -Ledger $MigrationLedger
  }
  Invoke-OrPlanGcloud -Arguments @("compute", "url-maps", "set-default-service", [string]$migration.UrlMap, "--project=$ProjectId", "--global", "--default-service=$($migration.MaintenanceBackendService)", "--quiet")
  Invoke-OrPlanGcloud -Arguments @("run", "worker-pools", "update", [string]$migration.TargetWorkerPool, "--project=$ProjectId", "--region=$TargetRegion", "--image=$TargetWorkerImageDigest", "--command=/bin/sleep", "--args=2147483647", "--instances=1", "--quiet")
  Invoke-OrPlanGcloud -Arguments @("run", "worker-pools", "update", [string]$migration.SourceWorkerPool, "--project=$ProjectId", "--region=$SourceRegion", "--image=$WorkerSourceImageDigest", "--command=", "--args=", "--instances=1", "--quiet")
  Invoke-OrPlanGcloud -Arguments @("sql", "instances", "describe", [string]$migration.SourceCloudSqlInstance, "--project=$ProjectId", "--format=value(state,region,databaseVersion)")
  Invoke-OrPlanGcloud -Arguments @("compute", "url-maps", "set-default-service", [string]$migration.UrlMap, "--project=$ProjectId", "--global", "--default-service=$($migration.SourceBackendService)", "--quiet")
  if ($Apply) {
    $sourceWorker = Invoke-MigrationGcloud -Arguments @("run", "worker-pools", "describe", [string]$migration.SourceWorkerPool, "--project=$ProjectId", "--region=$SourceRegion", "--format=json") | ConvertFrom-Json
    $sourceDb = Invoke-MigrationGcloud -Arguments @("sql", "instances", "describe", [string]$migration.SourceCloudSqlInstance, "--project=$ProjectId", "--format=json") | ConvertFrom-Json
    if ([string]$sourceWorker.spec.template.spec.containers[0].image -cne $WorkerSourceImageDigest -or @($sourceWorker.spec.template.spec.containers[0].command).Count -ne 0 -or
        $sourceDb.state -cne "RUNNABLE" -or $sourceDb.region -cne $SourceRegion) { throw "Pre-write source restoration verification failed." }
    $observedEvidence = Add-ObservedEvidenceFacts -Evidence $GovernedEvidence -Observed ([ordered]@{ eu_worker_quiesced = $true; source_worker_image_digest = $WorkerSourceImageDigest; source_database_instance = [string]$migration.SourceCloudSqlInstance; url_map_default_backend = [string]$migration.SourceBackendService })
    Complete-MigrationCheckpoint -Ledger $MigrationLedger -Evidence $observedEvidence
  }
  Write-Output "This path is prohibited after any EU write has been accepted."
}

if (Test-Checkpoint -Name "SourceRetirement") {
  Write-CheckpointHeader -Name "SourceRetirement" -Purpose "After the governed hold, verify EU recovery and retire exact me-central1 resources in a closed cryptographic-erasure sequence."
  $backupId = if ($RetirementBackupId) { $RetirementBackupId } else { "<VERIFIED_EU_RETIREMENT_BACKUP_ID>" }
  if (-not $Apply) {
    Write-Output "Gate: verify the chained Cutover hold timestamp, all durable evidence hashes, EU backup restore, exact EU runtime/database identity, EU artifact digests, EU secret replication, EU log routing, and active EU URL-map backend."
  } else {
    Assert-DurableEvidenceObjects -Ledger $MigrationLedger
    Assert-ExactEuRuntimeAndDatabase
    $cutoverEntry = @($MigrationLedger.Document.entries | Where-Object checkpoint -eq "Cutover")
    if ($cutoverEntry.Count -ne 1) { throw "Source retirement requires exactly one Cutover entry." }
    $cutoverEvidencePath = Join-Path ([System.IO.Path]::GetTempPath()) "matchbase-cutover-evidence-$([guid]::NewGuid().ToString('N')).json"
    $null = Invoke-MigrationGcloud -Arguments @("storage", "cp", "gs://$($migration.TargetArtifactBucket)/$($cutoverEntry[0].evidence_object)", $cutoverEvidencePath, "--quiet")
    $cutoverEvidence = (Get-Content -LiteralPath $cutoverEvidencePath -Raw) | ConvertFrom-Json
    Remove-Item -LiteralPath $cutoverEvidencePath -Force
    $notBefore = [datetimeoffset]::MinValue
    if (-not [datetimeoffset]::TryParse([string]$cutoverEvidence.observed.source_retirement_not_before_utc, [ref]$notBefore) -or [datetimeoffset]::UtcNow -lt $notBefore) {
      throw "Governed source-retirement hold has not expired."
    }
    $facts = $GovernedEvidence.Document.facts
    Assert-ArtifactInventoryReconciled -Evidence $GovernedEvidence
    Assert-LiveDatabaseMigrationHead
    $backup = Invoke-MigrationGcloud -Arguments @("sql", "backups", "describe", $backupId, "--project=$ProjectId", "--instance=$($migration.TargetCloudSqlInstance)", "--format=json") | ConvertFrom-Json
    if ($backup.status -cne "SUCCESSFUL" -or [string]$backup.location -notin @($TargetRegion, "eu")) { throw "Verified retirement backup is not successful and European." }
    foreach ($secret in $SecretNames) {
      $replicas = Invoke-MigrationGcloud -Arguments @("secrets", "describe", $secret, "--project=$ProjectId", "--format=value(replication.userManaged.replicas[].location)")
      if (@($replicas) -notcontains $TargetRegion) { throw "EU secret metadata '$secret' is not pinned to $TargetRegion." }
    }
    $sinkDestination = Invoke-MigrationGcloud -Arguments @("logging", "sinks", "describe", [string]$migration.TargetLogSink, "--project=$ProjectId", "--format=value(destination)")
    if ([string]$sinkDestination -cne "logging.googleapis.com/projects/$ProjectId/locations/$TargetRegion/buckets/$($migration.TargetLogBucket)") { throw "EU application log sink destination is invalid." }
    $recentEuLog = Invoke-MigrationGcloud -Arguments @("logging", "read", "resource.labels.location=$TargetRegion", "--project=$ProjectId", "--freshness=30m", "--limit=1", "--format=value(timestamp)")
    if ([string]::IsNullOrWhiteSpace([string]$recentEuLog)) { throw "No recent EU application log proves active regional routing." }
    $defaultService = Invoke-MigrationGcloud -Arguments @("compute", "url-maps", "describe", [string]$migration.UrlMap, "--project=$ProjectId", "--global", "--format=value(defaultService)")
    if (-not $defaultService.EndsWith("/backendServices/$($migration.TargetBackendService)", [StringComparison]::Ordinal)) { throw "EU backend is not active; source retirement is prohibited." }
    Assert-SourceWorkerQuiesced
  }

  $retirementCommands = @(
    @("compute", "backend-services", "delete", [string]$migration.SourceBackendService, "--project=$ProjectId", "--global", "--quiet"),
    @("compute", "network-endpoint-groups", "delete", [string]$migration.SourceNetworkEndpointGroup, "--project=$ProjectId", "--region=$SourceRegion", "--quiet"),
    @("run", "services", "delete", [string]$migration.SourceWebService, "--project=$ProjectId", "--region=$SourceRegion", "--quiet"),
    @("run", "worker-pools", "delete", [string]$migration.SourceWorkerPool, "--project=$ProjectId", "--region=$SourceRegion", "--quiet"),
    @("sql", "instances", "patch", [string]$migration.SourceCloudSqlInstance, "--project=$ProjectId", "--no-deletion-protection", "--quiet"),
    @("sql", "instances", "delete", [string]$migration.SourceCloudSqlInstance, "--project=$ProjectId", "--quiet")
  )
  foreach ($secret in $SourceSecretNames) { $retirementCommands += ,@("secrets", "delete", $secret, "--project=$ProjectId", "--quiet") }
  $retirementCommands += ,@("storage", "rm", "gs://$($migration.SourceArtifactBucket)/**", "--recursive", "--quiet")
  $retirementCommands += ,@("storage", "buckets", "delete", "gs://$($migration.SourceArtifactBucket)", "--quiet")
  $retirementCommands += ,@("artifacts", "repositories", "delete", [string]$migration.SourceArtifactRepository, "--project=$ProjectId", "--location=$SourceRegion", "--quiet")

  if ($Apply) {
    foreach ($command in $retirementCommands) { $null = Invoke-RetirementGcloud -Arguments $command }
    $observedEvidence = Add-ObservedEvidenceFacts -Evidence $GovernedEvidence -Observed ([ordered]@{ verified_eu_backup_id = $backupId; source_retirement_not_before_utc = $notBefore.ToUniversalTime().ToString("o"); retired_region = $SourceRegion; source_cloud_sql_deleted = $true; source_secrets_scheduled_for_deletion = @($SourceSecretNames); source_bucket_deleted = $true; source_artifact_repository_deleted = $true; source_runtime_deleted = $true })
    Complete-MigrationCheckpoint -Ledger $MigrationLedger -Evidence $observedEvidence
  } else {
    foreach ($command in $retirementCommands) { Write-ExternalPlan -Executable "gcloud" -Arguments $command }
  }
  Write-Output "Residency closure remains blocked until the SourceRetirement ledger entry and provider/edge/global-_Required exceptions are reconciled."
}

if (-not $Apply) {
  Write-Output ""
  Write-Output "PLAN COMPLETE — no cloud state was changed."
  Write-Output "Apply exactly one checkpoint with -Apply -ConfirmProjectId $ProjectId and the exact residual acknowledgement marker."
}
