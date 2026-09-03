[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$CandidateCommit,
  [string]$BuildServiceAccount = "matchbase-staging-build@innobase-matchbase-stg.iam.gserviceaccount.com",
  [switch]$Apply,
  [string]$ConfirmProjectId = ""
)

. (Join-Path $PSScriptRoot "Common.ps1")
. (Join-Path $PSScriptRoot "Invoke-GcloudStdout.ps1")
. (Join-Path $PSScriptRoot "Invoke-BoundedProvenanceProbe.ps1")
$project = "innobase-matchbase-stg"
$region = "me-central1"
$repository = "matchbase"
$source = "https://github.com/banihashem/INNOBASE-MatchBASE.git"
$sourceConnection = "projects/innobase-matchbase-stg/locations/me-central1/connections/matchbase-github"
$sourceRepository = "$sourceConnection/repositories/matchbase"
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..") -ErrorAction Stop).Path
$policyRelative = "config/slice3/research-route-policy.staging.v4.json"
$policyPath = Join-Path $repoRoot $policyRelative
$configPath = Join-Path $repoRoot "cloudbuild.staging.yaml"
$parser = Join-Path $repoRoot "scripts/lib/staging-eu-provenance.mjs"
$buildRecordParser = Join-Path $repoRoot "scripts/lib/staging-build-record.mjs"
$preflightParser = Join-Path $repoRoot "scripts/lib/staging-build-preflight.mjs"
$policySha = (Get-FileHash -LiteralPath $policyPath -Algorithm SHA256).Hash.ToLowerInvariant()
$policyId = $policySha.Substring(0, 16)
if ($policySha -cne "0c95528d528d7237c90d7bde792d5700e41878cf7f6f0a12b52d5ff4edb4ee02") { throw "Tracked qualified Staging route-policy SHA-256 changed; update the governed build contract and tests first." }
if ((& git -C $repoRoot rev-parse HEAD).Trim() -cne $CandidateCommit) { throw "Candidate commit must equal HEAD." }
if (-not [string]::IsNullOrWhiteSpace((& git -C $repoRoot status --porcelain=v1 --untracked-files=all | Out-String))) { throw "Image publication requires a clean tracked and untracked worktree." }
$remote = (& git -C $repoRoot remote get-url origin).Trim()
if ($remote -cne $source) { throw "origin must be the closed public GitHub repository." }
$remoteMain = ((& git -C $repoRoot ls-remote origin refs/heads/main | Out-String).Trim() -split '\s+')[0]
if ($LASTEXITCODE -ne 0 -or $remoteMain -cne $CandidateCommit) { throw "origin/main must resolve to the exact candidate commit." }
& git -C $repoRoot cat-file -e "$CandidateCommit`:cloudbuild.staging.yaml"
if ($LASTEXITCODE -ne 0) { throw "The governed Cloud Build config is absent from the candidate commit." }

Assert-GcloudAvailable
if ((Invoke-Gcloud -Arguments @("config", "get-value", "project")) -cne $project) { throw "Active gcloud project must be exactly $project." }
$requiredApis = @("artifactregistry.googleapis.com", "cloudbuild.googleapis.com", "containeranalysis.googleapis.com")
foreach ($service in $requiredApis) {
  $enabled = Invoke-Gcloud -Arguments @("services", "list", "--project=$project", "--enabled", "--filter=config.name:$service", "--format=value(config.name)")
  if ($enabled -cne $service) { throw "Required API '$service' is not enabled." }
}
$repositoryDocument = Invoke-GcloudStdout -Arguments @("artifacts", "repositories", "describe", $repository, "--project=$project", "--location=$region", "--format=json") | ConvertFrom-Json
if ($repositoryDocument.name -cne "projects/$project/locations/$region/repositories/$repository" -or $repositoryDocument.format -cne "DOCKER" -or $repositoryDocument.dockerConfig.immutableTags -ne $true) { throw "Artifact Registry repository identity, location, format, or immutable-tag policy is invalid." }
$connectionDocument = Invoke-GcloudStdout -Arguments @("builds", "connections", "describe", "matchbase-github", "--project=$project", "--region=$region", "--format=json") | ConvertFrom-Json
$linkedRepositoryDocument = Invoke-GcloudStdout -Arguments @("builds", "repositories", "describe", "matchbase", "--connection=matchbase-github", "--project=$project", "--region=$region", "--format=json") | ConvertFrom-Json
$connectionReconciling = ($connectionDocument.PSObject.Properties.Name -contains "reconciling") -and ([bool]$connectionDocument.reconciling)
$linkedRepositoryReconciling = ($linkedRepositoryDocument.PSObject.Properties.Name -contains "reconciling") -and ([bool]$linkedRepositoryDocument.reconciling)
if ($connectionDocument.name -cne $sourceConnection -or $connectionDocument.installationState.stage -cne "COMPLETE" -or $connectionReconciling -or [string]::IsNullOrWhiteSpace([string]$connectionDocument.etag) -or [string]$connectionDocument.githubConfig.appInstallationId -cne "142544573") { throw "Cloud Build GitHub connection identity, installation, reconciliation, or etag is invalid." }
if ($linkedRepositoryDocument.name -cne $sourceRepository -or $linkedRepositoryDocument.remoteUri -cne $source -or $linkedRepositoryReconciling -or [string]::IsNullOrWhiteSpace([string]$linkedRepositoryDocument.etag)) { throw "Cloud Build linked repository identity, remote URI, reconciliation, or etag is invalid." }
Invoke-Gcloud -Arguments @("iam", "service-accounts", "describe", $BuildServiceAccount, "--project=$project", "--format=value(email)") | Out-Null
Assert-NoUserManagedServiceAccountKeys -Email $BuildServiceAccount -ProjectId $project
Assert-ExactProjectRoles -Email $BuildServiceAccount -ProjectId $project -ExpectedRoles @("roles/logging.logWriter")
Assert-NoAncestorRoles -Email $BuildServiceAccount -ProjectId $project
Assert-ExactArtifactRepositoryRoles -Email $BuildServiceAccount -ProjectId $project -Region $region -Repository $repository -ExpectedRoles @("roles/artifactregistry.writer")
$projectNumber = Invoke-Gcloud -Arguments @("projects", "describe", $project, "--format=value(projectNumber)")
$buildAgent = "service-$projectNumber@gcp-sa-cloudbuild.iam.gserviceaccount.com"
Assert-ExactProjectRoles -Email $buildAgent -ProjectId $project -ExpectedRoles @("roles/cloudbuild.serviceAgent")
$serviceAccountPolicy = Invoke-GcloudStdout -Arguments @("iam", "service-accounts", "get-iam-policy", $BuildServiceAccount, "--project=$project", "--format=json") | ConvertFrom-Json
$tokenCreators = @($serviceAccountPolicy.bindings | Where-Object role -CEQ "roles/iam.serviceAccountTokenCreator" | ForEach-Object members)
if ($tokenCreators.Count -ne 1 -or $tokenCreators[0] -cne "serviceAccount:$buildAgent") { throw "Only the Cloud Build service agent may mint the governed build identity token." }
$activeAccount = Invoke-Gcloud -Arguments @("config", "get-value", "account")
$publisherMember = if ($activeAccount -match '\.gserviceaccount\.com$') { "serviceAccount:$activeAccount" } else { "user:$activeAccount" }
$actAsMembers = @($serviceAccountPolicy.bindings | Where-Object role -CEQ "roles/iam.serviceAccountUser" | ForEach-Object members)
if ($actAsMembers.Count -ne 1 -or $actAsMembers[0] -cne $publisherMember) { throw "Only the active governed publisher may act as the build service account." }
$allServiceAccountBindings = @($serviceAccountPolicy.bindings | ForEach-Object { $role = $_.role; @($_.members) | ForEach-Object { "$role|$_" } } | Sort-Object)
$expectedServiceAccountBindings = @("roles/iam.serviceAccountTokenCreator|serviceAccount:$buildAgent", "roles/iam.serviceAccountUser|$publisherMember") | Sort-Object
if (($allServiceAccountBindings -join "`n") -cne ($expectedServiceAccountBindings -join "`n")) { throw "Build service-account resource policy contains an extra or missing binding." }
$requiredPublisherPermissions = @("artifactregistry.dockerimages.get", "artifactregistry.dockerimages.list", "artifactregistry.repositories.get", "cloudbuild.builds.create", "cloudbuild.builds.get", "containeranalysis.occurrences.get", "containeranalysis.occurrences.list")
$accessToken = Invoke-Gcloud -Arguments @("auth", "print-access-token")
try {
  $permissionResponse = Invoke-RestMethod -Method Post -Uri "https://cloudresourcemanager.googleapis.com/v1/projects/$project`:testIamPermissions" -Headers @{ Authorization = "Bearer $accessToken" } -ContentType "application/json" -Body (@{ permissions = $requiredPublisherPermissions } | ConvertTo-Json -Compress)
} finally { $accessToken = $null }
$publisherPermissions = @($permissionResponse.permissions | Sort-Object -Unique)
if (($publisherPermissions -join "`n") -cne (($requiredPublisherPermissions | Sort-Object) -join "`n")) { throw "Active publisher lacks a required build or stored-provenance permission." }
$preflightFacts = [ordered]@{ repository = $repositoryDocument; source_connection = $connectionDocument; source_repository = $linkedRepositoryDocument; enabled_apis = $requiredApis; publisher_permissions = $publisherPermissions; build_agent_project_roles = @("roles/cloudbuild.serviceAgent") }
$preflightFile = Join-Path ([IO.Path]::GetTempPath()) "matchbase-build-preflight-$([guid]::NewGuid().ToString('N')).json"
try {
  $preflightFacts | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $preflightFile -Encoding utf8NoBOM
  & node $preflightParser --file $preflightFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Closed build-publication preflight rejected live cloud state." }
} finally { Remove-Item -LiteralPath $preflightFile -Force -ErrorAction SilentlyContinue }

$webTag = "$region-docker.pkg.dev/$project/$repository/staging-web:$CandidateCommit"
$workerTag = "$region-docker.pkg.dev/$project/$repository/staging-worker-$policyId`:$CandidateCommit"
$arguments = @("builds", "submit", $sourceRepository, "--revision=$CandidateCommit", "--config=$configPath", "--project=$project", "--region=$region", "--service-account=projects/$project/serviceAccounts/$BuildServiceAccount", "--substitutions=_CANDIDATE_COMMIT=$CandidateCommit,_ROUTE_POLICY_SHA256=$policySha,_ROUTE_POLICY_ID=$policyId", "--quiet")
if (-not $Apply) { Write-GcloudPlan -Arguments $arguments; return }
Assert-ApplyConfirmation -Apply $true -ExpectedProjectId $project -ConfirmProjectId $ConfirmProjectId
Invoke-Gcloud -Arguments $arguments | Out-Null
$published = @()
$buildIds = @()
$resolvedImages = @($webTag, $workerTag) | ForEach-Object {
  $tag = $_
  $digest = Invoke-Gcloud -Arguments @("artifacts", "docker", "images", "describe", $tag, "--project=$project", "--format=value(image_summary.fully_qualified_digest)")
  if ($digest -cnotmatch "^$([regex]::Escape($tag.Split(':')[0]))@sha256:[a-f0-9]{64}$") { throw "Published image did not resolve to its immutable digest." }
  $digest
}
for ($imageIndex = 0; $imageIndex -lt $resolvedImages.Count; $imageIndex++) {
  $digest = $resolvedImages[$imageIndex]
  $peerDigest = $resolvedImages[1 - $imageIndex]
  $temporary = Join-Path ([IO.Path]::GetTempPath()) "matchbase-build-provenance-$([guid]::NewGuid().ToString('N')).json"
  try {
    $validated = Invoke-BoundedProvenanceProbe -Attempt {
      param([int]$Probe)
      Invoke-GcloudStdout -Arguments @("artifacts", "docker", "images", "describe", $digest, "--project=$project", "--show-provenance", "--format=json") | Set-Content -LiteralPath $temporary -Encoding utf8NoBOM
      $validationOutput = (& node $parser --file $temporary --image $digest --peer-image $peerDigest --commit $CandidateCommit 2>$null | Out-String).Trim()
      if ($LASTEXITCODE -eq 0) { return ($validationOutput | ConvertFrom-Json) }
      return $null
    }
    $buildIds += [string]$validated.build_id
    $published += $digest
  } finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
}
if (@($buildIds | Sort-Object -Unique).Count -ne 1) { throw "Published images do not bind to one exact Cloud Build invocation." }
$buildRecordFile = Join-Path ([IO.Path]::GetTempPath()) "matchbase-build-record-$([guid]::NewGuid().ToString('N')).json"
try {
  Invoke-GcloudStdout -Arguments @("builds", "describe", $buildIds[0], "--project=$project", "--region=$region", "--format=json") | Set-Content -LiteralPath $buildRecordFile -Encoding utf8NoBOM
  & node $buildRecordParser --file $buildRecordFile --build-id $buildIds[0] --commit $CandidateCommit --policy-sha $policySha --policy-id $policyId --web-tag $webTag --worker-tag $workerTag --web-digest $resolvedImages[0].Split('@')[1] --worker-digest $resolvedImages[1].Split('@')[1] | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Closed Cloud Build record validation failed." }
} finally { Remove-Item -LiteralPath $buildRecordFile -Force -ErrorAction SilentlyContinue }
$published | Write-Output
