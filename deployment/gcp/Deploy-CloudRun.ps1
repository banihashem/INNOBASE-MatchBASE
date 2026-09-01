[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet("staging", "production")][string]$Environment,
  [Parameter(Mandatory)][string]$ArtifactRepository,
  [Parameter(Mandatory)][string]$WebServiceName,
  [Parameter(Mandatory)][string]$WorkerPoolName,
  [Parameter(Mandatory)][string]$WebServiceAccountName,
  [Parameter(Mandatory)][string]$WorkerServiceAccountName,
  [Parameter(Mandatory)][string]$WebImageDigest,
  [Parameter(Mandatory)][string]$WorkerImageDigest,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$CandidateCommit,
  [Parameter(Mandatory)][string]$RoutePolicyPath,
  [Parameter(Mandatory)][string[]]$WebSecretVersionRef,
  [Parameter(Mandatory)][string[]]$WorkerSecretVersionRef,
  [Parameter(Mandatory)][ValidateRange(1, 100)][int]$WebMaxInstances,
  [Parameter(Mandatory)][ValidateRange(1, 100)][int]$WorkerInstances,
  [ValidateSet("staging", "staging-eu", "staging-eu-canary", "production")][string]$DeploymentTarget = "",
  [switch]$StagingEuropeWest2,
  [switch]$Apply,
  [string]$ConfirmProjectId = ""
)

. (Join-Path $PSScriptRoot "Common.ps1")
. (Join-Path $PSScriptRoot "Invoke-GcloudStdout.ps1")
$selectedTarget = if ($DeploymentTarget) { $DeploymentTarget } else { $Environment }
if ($StagingEuropeWest2) {
  if ($Environment -cne "staging") { throw "-StagingEuropeWest2 is closed to Staging." }
  if ($DeploymentTarget -and $DeploymentTarget -cne "staging-eu") { throw "-StagingEuropeWest2 conflicts with -DeploymentTarget." }
  $selectedTarget = "staging-eu"
}
$target = Get-MatchBaseTarget -Environment $selectedTarget
if ($target.Environment -cne $Environment) { throw "Deployment target does not belong to the selected environment." }
if ($selectedTarget -cin @("staging-eu", "staging-eu-canary")) {
  if ($Environment -cne "staging") { throw "EU Staging deployment target is closed to Staging." }
  $regional = Get-MatchBaseStagingRegionMigration
  if (
    $target.ArtifactBucket -cne $regional.TargetArtifactBucket -or
    $target.Region -cne $regional.TargetRegion -or
    $target.CloudSqlInstanceConnectionName -cne "$($regional.ProjectId):$($regional.TargetRegion):$($regional.TargetCloudSqlInstance)"
  ) { throw "EU Staging deployment target drifted from the governed migration map." }
  if ($selectedTarget -ceq "staging-eu-canary" -and $WebServiceName -cne $regional.CanaryWebService) { throw "EU Canary deployment must use the closed canary Cloud Run service identity." }
  if ($selectedTarget -ceq "staging-eu" -and $WebServiceName -ceq $regional.CanaryWebService) { throw "Main EU Staging deployment cannot use the isolated canary service identity." }
}
$ProjectId = $target.ProjectId
$Region = $target.Region
$Hostname = $target.Hostname
$ArtifactBucket = $target.ArtifactBucket
$CloudSqlInstanceConnectionName = [string]$target.CloudSqlInstanceConnectionName
if ([string]::IsNullOrWhiteSpace($CloudSqlInstanceConnectionName)) { throw "Cloud SQL instance connection is not approved for '$Environment'." }
if ($CloudSqlInstanceConnectionName -cnotmatch "^$([regex]::Escape($ProjectId)):$([regex]::Escape($Region)):[a-z][a-z0-9-]{0,97}[a-z0-9]$") { throw "Cloud SQL instance connection is outside the closed target map." }
$WebGeminiSecretName = [string]$target.WebGeminiSecretName
if ([string]::IsNullOrWhiteSpace($WebGeminiSecretName)) { throw "Web Gemini credential is not approved for '$Environment'." }
Assert-ApplyConfirmation -Apply $Apply.IsPresent -ExpectedProjectId $ProjectId -ConfirmProjectId $ConfirmProjectId
$resolvedRoutePolicyPath = (Resolve-Path -LiteralPath $RoutePolicyPath -ErrorAction Stop).Path
$allowedPolicyRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\config\slice3") -ErrorAction Stop).Path
if ([System.IO.Path]::GetDirectoryName($resolvedRoutePolicyPath) -cne $allowedPolicyRoot) { throw "Route policy must be a direct config/slice3 JSON file." }
$routePolicySha256 = (Get-FileHash -LiteralPath $resolvedRoutePolicyPath -Algorithm SHA256).Hash.ToLowerInvariant()
$routePolicy = Get-Content -LiteralPath $resolvedRoutePolicyPath -Raw | ConvertFrom-Json
& node (Join-Path $PSScriptRoot "Assert-ProductionWorkerPolicy.mjs") $Environment $resolvedRoutePolicyPath $routePolicySha256
if ($LASTEXITCODE -ne 0) { throw "Governed route policy verification failed." }
$pricingVersions = @($routePolicy.routes | ForEach-Object { $_.costPolicy.pricingVersion } | Sort-Object -Unique)
if ($pricingVersions.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$pricingVersions[0])) { throw "Worker routes must share one governed pricing version." }
$pricingVersion = [string]$pricingVersions[0]
$routeIdentity = $routePolicySha256.Substring(0, 16)
Assert-ImmutableImageDigest -Image $WebImageDigest -ProjectId $ProjectId -Region $Region -Repository $ArtifactRepository -ExpectedImageName "$Environment-web"
Assert-ImmutableImageDigest -Image $WorkerImageDigest -ProjectId $ProjectId -Region $Region -Repository $ArtifactRepository -ExpectedImageName "$Environment-worker-$routeIdentity"

if ($WebServiceName -cnotmatch '^[a-z][a-z0-9-]{1,61}[a-z0-9]$') { throw "Cloud Run service name is invalid." }
if ($WorkerPoolName -cnotmatch '^[a-z][a-z0-9-]{1,46}[a-z0-9]$') { throw "Cloud Run worker pool name is invalid or exceeds 49 characters." }
foreach ($name in @($WebServiceAccountName, $WorkerServiceAccountName)) {
  if ($name -cnotmatch '^[a-z][a-z0-9-]{4,28}[a-z0-9]$') { throw "Service account name '$name' is invalid." }
}
$webSecretParts = @($WebSecretVersionRef | ForEach-Object { Get-SecretReferenceParts -Reference $_ -ProjectId $ProjectId })
$workerSecretParts = @($WorkerSecretVersionRef | ForEach-Object { Get-SecretReferenceParts -Reference $_ -ProjectId $ProjectId })
foreach ($parts in @($webSecretParts, $workerSecretParts)) {
  $duplicate = $parts | Group-Object EnvironmentName | Where-Object Count -gt 1
  if ($duplicate) { throw "Each secret environment name must appear exactly once per runtime." }
}
if ($webSecretParts | Where-Object EnvironmentName -CEQ "MATCHBASE_OPENROUTER_API_KEY") {
  throw "Web MATCHBASE_OPENROUTER_API_KEY is prohibited; OpenRouter credentials are worker-only."
}
$webRequiredSecrets = @("DATABASE_URL", "MATCHBASE_DIGEST_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "MATCHBASE_ORIGIN_ADMISSION_KEY", "MATCHBASE_GEMINI_API_KEY")
$workerRequiredSecrets = @("DATABASE_URL", "MATCHBASE_DIGEST_KEY", "MATCHBASE_GEMINI_API_KEY", "MATCHBASE_OPENROUTER_API_KEY")
foreach ($required in $webRequiredSecrets) {
  if (-not ($WebSecretVersionRef | Where-Object { $_ -cmatch "^$required=" })) { throw "Web secret '$required' is required." }
}
foreach ($required in $workerRequiredSecrets) {
  if (-not ($WorkerSecretVersionRef | Where-Object { $_ -cmatch "^$required=" })) { throw "Worker secret '$required' is required." }
}
$secretNameMap = $target.SecretNameMap
if ($null -ne $secretNameMap) {
  foreach ($parts in @($webSecretParts + $workerSecretParts)) {
    if (-not $secretNameMap.ContainsKey($parts.EnvironmentName) -or $parts.SecretName -cne $secretNameMap[$parts.EnvironmentName]) {
      throw "EU Staging secret '$($parts.EnvironmentName)' is outside the closed target secret-name map."
    }
  }
}
$webGeminiSecretParts = @($webSecretParts | Where-Object EnvironmentName -CEQ "MATCHBASE_GEMINI_API_KEY")
if ($webGeminiSecretParts.Count -ne 1 -or $webGeminiSecretParts[0].SecretName -cne $WebGeminiSecretName) {
  throw "Web MATCHBASE_GEMINI_API_KEY must bind the approved '$WebGeminiSecretName' secret."
}

$webEmail = "$WebServiceAccountName@$ProjectId.iam.gserviceaccount.com"
$workerEmail = "$WorkerServiceAccountName@$ProjectId.iam.gserviceaccount.com"
$origin = "https://$Hostname"
$webEnv = @(
  "MATCHBASE_ENVIRONMENT=production",
  "MATCHBASE_DEPLOYMENT_ENVIRONMENT=$Environment",
  "MATCHBASE_DEPLOYMENT_TARGET=$selectedTarget",
  "MATCHBASE_ORIGIN=$origin",
  "MATCHBASE_DEPLOYMENT_ID=$($WebImageDigest.Split('@')[1])",
  "MATCHBASE_IMAGE_DIGEST=$($WebImageDigest.Split('@')[1])",
  "MATCHBASE_ROUTE_POLICY_SHA256=$routePolicySha256",
  "MATCHBASE_ROUTE_POLICY_VERSION=$($routePolicy.policyVersion)",
  "MATCHBASE_ARTIFACT_GCS_BUCKET=$ArtifactBucket",
  "MATCHBASE_ARTIFACT_MAXIMUM_BYTES=8388608",
  "GOOGLE_REDIRECT_URI=$origin/auth/google/callback",
  "MATCHBASE_OIDC_SIMULATOR=false",
  "MATCHBASE_SYNTHETIC_FIXTURE=false",
  "MATCHBASE_LIVE_RESEARCH_ENABLED=true",
  "MATCHBASE_LIVE_RESEARCH_CREDENTIALS_VERIFIED=true"
) -join ","
$workerEnv = @(
  "MATCHBASE_ENVIRONMENT=production",
  "MATCHBASE_DEPLOYMENT_ENVIRONMENT=$Environment",
  "MATCHBASE_DEPLOYMENT_TARGET=$selectedTarget",
  "MATCHBASE_DEPLOYMENT_ID=$($WorkerImageDigest.Split('@')[1])",
  "MATCHBASE_IMAGE_DIGEST=$($WorkerImageDigest.Split('@')[1])",
  "MATCHBASE_ROUTE_POLICY_SHA256=$routePolicySha256",
  "MATCHBASE_ROUTE_POLICY_VERSION=$($routePolicy.policyVersion)",
  "MATCHBASE_ARTIFACT_GCS_BUCKET=$ArtifactBucket",
  "MATCHBASE_OIDC_SIMULATOR=false",
  "MATCHBASE_SYNTHETIC_FIXTURE=false",
  "MATCHBASE_LIVE_RESEARCH_RUNTIME=environment",
  "MATCHBASE_LIVE_RESEARCH_ENABLED=true",
  "MATCHBASE_LIVE_PRICING_VERSION=$pricingVersion",
  "MATCHBASE_GEMINI_CONSERVATIVE_SEARCH_USD=1",
  "MATCHBASE_GEMINI_CONSERVATIVE_REQUEST_USD=1",
  "MATCHBASE_OPENROUTER_CONSERVATIVE_REQUEST_USD=1",
  "MATCHBASE_WORKER_HEALTH_PORT=3011"
  "MATCHBASE_WORKER_DB_CONNECTION_TIMEOUT_MS=10000"
  "MATCHBASE_WORKER_DB_PROBE_TIMEOUT_MS=5000"
) -join ","
$webSecrets = $WebSecretVersionRef -join ","
$workerSecrets = $WorkerSecretVersionRef -join ","

$webCommand = @(
  "run", "deploy", $WebServiceName,
  "--project=$ProjectId", "--region=$Region", "--platform=managed",
  "--image=$WebImageDigest", "--service-account=$webEmail",
  "--clear-command", "--clear-args",
  "--port=8080", "--ingress=internal-and-cloud-load-balancing",
  "--no-invoker-iam-check", "--min-instances=1", "--max-instances=$WebMaxInstances",
  "--concurrency=8", "--cpu=1", "--memory=1Gi", "--timeout=60s",
  "--set-cloudsql-instances=$CloudSqlInstanceConnectionName",
  "--set-env-vars=$webEnv", "--set-secrets=$webSecrets",
  "--no-session-affinity", "--execution-environment=gen2", "--quiet"
)
$workerCommand = @(
  "run", "worker-pools", "deploy", $WorkerPoolName,
  "--project=$ProjectId", "--region=$Region",
  "--image=$WorkerImageDigest", "--service-account=$workerEmail",
  "--instances=$WorkerInstances", "--cpu=1", "--memory=1Gi",
  "--set-cloudsql-instances=$CloudSqlInstanceConnectionName",
  "--set-env-vars=$workerEnv", "--set-secrets=$workerSecrets", "--quiet"
)

if (-not $Apply) {
  Write-GcloudPlan -Arguments $webCommand
  Write-GcloudPlan -Arguments $workerCommand
  return
}

Assert-GcloudAvailable
if ((& git -C (Join-Path $PSScriptRoot "..\..") rev-parse HEAD).Trim() -cne $CandidateCommit) { throw "Candidate commit must equal clean HEAD before deployment." }
if (-not [string]::IsNullOrWhiteSpace((& git -C (Join-Path $PSScriptRoot "..\..") status --porcelain=v1 --untracked-files=all | Out-String))) { throw "Deployment requires a clean tracked and untracked worktree." }
$originUrl = (& git -C (Join-Path $PSScriptRoot "..\..") remote get-url origin).Trim()
if ($originUrl -cne "https://github.com/banihashem/INNOBASE-MatchBASE.git") { throw "Deployment origin identity is invalid." }
$originMain = ((& git -C (Join-Path $PSScriptRoot "..\..") ls-remote origin refs/heads/main | Out-String).Trim() -split '\s+')[0]
if ($LASTEXITCODE -ne 0 -or $originMain -cne $CandidateCommit) { throw "origin/main must resolve to the exact candidate commit." }
$provenanceParser = Join-Path $PSScriptRoot "..\..\scripts\lib\staging-eu-provenance.mjs"
. (Join-Path $PSScriptRoot "Invoke-BoundedProvenanceProbe.ps1")
$buildRecordParser = Join-Path $PSScriptRoot "..\..\scripts\lib\staging-build-record.mjs"
$imageBindingParser = Join-Path $PSScriptRoot "..\..\scripts\lib\deploy-image-source-binding.mjs"
$provenanceBuildIds = @()
$sourceImages = @()
$expectedSourceImages = @($WebImageDigest, $WorkerImageDigest) | ForEach-Object {
  if ($_.StartsWith("europe-west2-docker.pkg.dev/", [StringComparison]::Ordinal)) {
    "me-central1-docker.pkg.dev/innobase-matchbase-stg/matchbase/$($_.Split('/')[-1])"
  } else { $_ }
}
$imageIndex = 0
foreach ($image in @($WebImageDigest, $WorkerImageDigest)) {
  $capture = Join-Path ([IO.Path]::GetTempPath()) "matchbase-deploy-provenance-$([guid]::NewGuid().ToString('N')).json"
  $targetCapture = Join-Path ([IO.Path]::GetTempPath()) "matchbase-deploy-target-$([guid]::NewGuid().ToString('N')).json"
  try {
    $sourceImage = $image
    if ($image.StartsWith("europe-west2-docker.pkg.dev/", [StringComparison]::Ordinal)) {
      Invoke-GcloudStdout -Arguments @("artifacts", "docker", "images", "describe", $image, "--project=$ProjectId", "--format=json") | Set-Content -LiteralPath $targetCapture -Encoding utf8NoBOM
      $binding = (& node $imageBindingParser --file $targetCapture --image $image 2>&1 | Out-String).Trim()
      if ($LASTEXITCODE -ne 0) { throw "EU deployment image is absent or its target identity is forged." }
      $sourceImage = [string](($binding | ConvertFrom-Json).source_image)
    }
    $validated = Invoke-BoundedProvenanceProbe -Attempt {
      param([int]$Probe)
      Invoke-GcloudStdout -Arguments @("artifacts", "docker", "images", "describe", $sourceImage, "--project=$ProjectId", "--show-provenance", "--format=json") | Set-Content -LiteralPath $capture -Encoding utf8NoBOM
      $validationOutput = (& node $provenanceParser --file $capture --image $sourceImage --peer-image $expectedSourceImages[1 - $imageIndex] --commit $CandidateCommit 2>$null | Out-String).Trim()
      if ($LASTEXITCODE -eq 0) { return ($validationOutput | ConvertFrom-Json) }
      return $null
    }
    $provenanceBuildIds += [string]$validated.build_id
    $sourceImages += $sourceImage
  } finally { Remove-Item -LiteralPath $capture, $targetCapture -Force -ErrorAction SilentlyContinue }
  $imageIndex++
}
if (@($provenanceBuildIds | Sort-Object -Unique).Count -ne 1) { throw "Deployment images do not bind to one exact Cloud Build invocation." }
$policyId = $routePolicySha256.Substring(0, 16)
$webSourceTag = "$($sourceImages[0].Split('@')[0]):$CandidateCommit"
$workerSourceTag = "$($sourceImages[1].Split('@')[0]):$CandidateCommit"
$buildRecordCapture = Join-Path ([IO.Path]::GetTempPath()) "matchbase-deploy-build-record-$([guid]::NewGuid().ToString('N')).json"
try {
  Invoke-GcloudStdout -Arguments @("builds", "describe", $provenanceBuildIds[0], "--project=$ProjectId", "--region=me-central1", "--format=json") | Set-Content -LiteralPath $buildRecordCapture -Encoding utf8NoBOM
  & node $buildRecordParser --file $buildRecordCapture --build-id $provenanceBuildIds[0] --commit $CandidateCommit --policy-sha $routePolicySha256 --policy-id $policyId --web-tag $webSourceTag --worker-tag $workerSourceTag --web-digest $sourceImages[0].Split('@')[1] --worker-digest $sourceImages[1].Split('@')[1] | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Deployment Cloud Build record is not governed by the exact source revision and build contract." }
} finally { Remove-Item -LiteralPath $buildRecordCapture -Force -ErrorAction SilentlyContinue }
Invoke-Gcloud -Arguments @("run", "worker-pools", "deploy", "--help") | Out-Null
Invoke-Gcloud -Arguments @("iam", "service-accounts", "describe", $webEmail, "--project=$ProjectId", "--format=value(email)") | Out-Null
Invoke-Gcloud -Arguments @("iam", "service-accounts", "describe", $workerEmail, "--project=$ProjectId", "--format=value(email)") | Out-Null
Invoke-Gcloud -Arguments @("storage", "buckets", "describe", "gs://$ArtifactBucket", "--project=$ProjectId", "--format=value(name)") | Out-Null
foreach ($image in @($WebImageDigest, $WorkerImageDigest)) {
  $resolvedDigest = Invoke-Gcloud -Arguments @("artifacts", "docker", "images", "describe", $image, "--project=$ProjectId", "--format=value(image_summary.digest)")
  if ($resolvedDigest -cne $image.Split("@", 2)[1]) { throw "Artifact Registry did not resolve the requested image digest." }
}
foreach ($email in @($webEmail, $workerEmail)) {
  Assert-NoUserManagedServiceAccountKeys -Email $email -ProjectId $ProjectId
  Assert-ExactProjectRoles -Email $email -ProjectId $ProjectId -ExpectedRoles @("roles/cloudsql.client", "roles/logging.logWriter", "roles/monitoring.metricWriter")
  Assert-NoAncestorRoles -Email $email -ProjectId $ProjectId
  Assert-ExactArtifactRepositoryRoles -Email $email -ProjectId $ProjectId -Region $Region -Repository $ArtifactRepository
}
Assert-ExactBucketRoles -Email $webEmail -Bucket $ArtifactBucket -ExpectedRoles @("roles/storage.objectViewer")
Assert-ExactBucketRoles -Email $workerEmail -Bucket $ArtifactBucket -ExpectedRoles @("roles/storage.objectCreator")
foreach ($parts in @($webSecretParts + $workerSecretParts)) {
  $state = Invoke-Gcloud -Arguments @("secrets", "versions", "describe", $parts.Version, "--secret=$($parts.SecretName)", "--project=$ProjectId", "--format=value(state)")
  if ($state -cne "ENABLED") { throw "Secret '$($parts.SecretName)' version '$($parts.Version)' is not ENABLED." }
}
foreach ($parts in $webSecretParts) {
  Invoke-Gcloud -Arguments @("secrets", "add-iam-policy-binding", $parts.SecretName, "--project=$ProjectId", "--member=serviceAccount:$webEmail", "--role=roles/secretmanager.secretAccessor", "--quiet") | Out-Null
}
foreach ($parts in $workerSecretParts) {
  Invoke-Gcloud -Arguments @("secrets", "add-iam-policy-binding", $parts.SecretName, "--project=$ProjectId", "--member=serviceAccount:$workerEmail", "--role=roles/secretmanager.secretAccessor", "--quiet") | Out-Null
}
Assert-ExactSecretAccessorBindings -Email $webEmail -ProjectId $ProjectId -ExpectedSecrets @($webSecretParts | ForEach-Object SecretName)
Assert-ExactSecretAccessorBindings -Email $workerEmail -ProjectId $ProjectId -ExpectedSecrets @($workerSecretParts | ForEach-Object SecretName)
Invoke-Gcloud -Arguments $workerCommand | Out-Null
Invoke-Gcloud -Arguments $webCommand | Out-Null
$webState = Invoke-Gcloud -Arguments @("run", "services", "describe", $WebServiceName, "--project=$ProjectId", "--region=$Region", "--format=json")
$workerState = Invoke-Gcloud -Arguments @("run", "worker-pools", "describe", $WorkerPoolName, "--project=$ProjectId", "--region=$Region", "--format=json")
function Assert-DeployedIdentity {
  param(
    [Parameter(Mandatory)][string]$State,
    [Parameter(Mandatory)][string]$Image,
    [Parameter(Mandatory)][string]$ServiceAccount,
    [Parameter(Mandatory)][string]$Digest,
    [Parameter(Mandatory)][string]$RuntimeName
  )
  foreach ($required in @(
    $Image,
    $ServiceAccount,
    $CloudSqlInstanceConnectionName,
    '"name":"MATCHBASE_ENVIRONMENT","value":"production"',
    '"name":"MATCHBASE_DEPLOYMENT_ENVIRONMENT","value":"' + $Environment + '"',
    '"name":"MATCHBASE_DEPLOYMENT_TARGET","value":"' + $selectedTarget + '"',
    '"name":"MATCHBASE_DEPLOYMENT_ID","value":"' + $Digest + '"',
    '"name":"MATCHBASE_IMAGE_DIGEST","value":"' + $Digest + '"',
    '"name":"MATCHBASE_ROUTE_POLICY_SHA256","value":"' + $routePolicySha256 + '"',
    '"name":"MATCHBASE_ROUTE_POLICY_VERSION","value":"' + $routePolicy.policyVersion + '"'
  )) {
    if ($State -cnotmatch [regex]::Escape($required)) { throw "$RuntimeName deployed identity does not match the closed release inputs." }
  }
}
$webStateNormalized = (($webState | ConvertFrom-Json) | ConvertTo-Json -Depth 100 -Compress)
$workerStateNormalized = (($workerState | ConvertFrom-Json) | ConvertTo-Json -Depth 100 -Compress)
Assert-DeployedIdentity -State $webStateNormalized -Image $WebImageDigest -ServiceAccount $webEmail -Digest $WebImageDigest.Split('@')[1] -RuntimeName "Web"
Assert-DeployedIdentity -State $workerStateNormalized -Image $WorkerImageDigest -ServiceAccount $workerEmail -Digest $WorkerImageDigest.Split('@')[1] -RuntimeName "Worker"
if ($webStateNormalized -cmatch '"command":' -or $webStateNormalized -cmatch '"args":') {
  throw "Web deployed identity bypasses the governed image entrypoint or command."
}
if ($webStateNormalized -cnotmatch [regex]::Escape('"name":"MATCHBASE_LIVE_RESEARCH_CREDENTIALS_VERIFIED","value":"true"')) {
  throw "Web deployed identity is missing the verified worker-credential marker."
}
if ($webStateNormalized -cmatch [regex]::Escape('"name":"MATCHBASE_OPENROUTER_API_KEY"')) {
  throw "Web deployed identity contains a prohibited OpenRouter credential."
}
if ($workerStateNormalized -cmatch [regex]::Escape('"name":"MATCHBASE_LIVE_RESEARCH_CREDENTIALS_VERIFIED"')) {
  throw "Worker deployed identity contains the web-only credential-verification marker."
}
$webState
$workerState
