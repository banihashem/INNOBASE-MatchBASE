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
  [Parameter(Mandatory)][string]$RoutePolicyPath,
  [Parameter(Mandatory)][string[]]$WebSecretVersionRef,
  [Parameter(Mandatory)][string[]]$WorkerSecretVersionRef,
  [Parameter(Mandatory)][ValidateRange(1, 100)][int]$WebMaxInstances,
  [Parameter(Mandatory)][ValidateRange(1, 100)][int]$WorkerInstances,
  [switch]$Apply,
  [string]$ConfirmProjectId = ""
)

. (Join-Path $PSScriptRoot "Common.ps1")
$target = Get-MatchBaseTarget -Environment $Environment
$ProjectId = $target.ProjectId
$Region = $target.Region
$Hostname = $target.Hostname
$ArtifactBucket = $target.ArtifactBucket
Assert-ApplyConfirmation -Apply $Apply.IsPresent -ExpectedProjectId $ProjectId -ConfirmProjectId $ConfirmProjectId
$resolvedRoutePolicyPath = (Resolve-Path -LiteralPath $RoutePolicyPath -ErrorAction Stop).Path
$allowedPolicyRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\config\slice3") -ErrorAction Stop).Path
if ([System.IO.Path]::GetDirectoryName($resolvedRoutePolicyPath) -cne $allowedPolicyRoot) { throw "Route policy must be a direct config/slice3 JSON file." }
$routePolicySha256 = (Get-FileHash -LiteralPath $resolvedRoutePolicyPath -Algorithm SHA256).Hash.ToLowerInvariant()
$routePolicy = Get-Content -LiteralPath $resolvedRoutePolicyPath -Raw | ConvertFrom-Json
& node (Join-Path $PSScriptRoot "Assert-ProductionWorkerPolicy.mjs") $Environment $resolvedRoutePolicyPath $routePolicySha256
if ($LASTEXITCODE -ne 0) { throw "Governed route policy verification failed." }
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
$webRequiredSecrets = @("DATABASE_URL", "MATCHBASE_DIGEST_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "MATCHBASE_ORIGIN_ADMISSION_KEY")
$workerRequiredSecrets = @("DATABASE_URL", "MATCHBASE_DIGEST_KEY", "MATCHBASE_GEMINI_API_KEY", "MATCHBASE_OPENROUTER_API_KEY")
foreach ($required in $webRequiredSecrets) {
  if (-not ($WebSecretVersionRef | Where-Object { $_ -cmatch "^$required=" })) { throw "Web secret '$required' is required." }
}
foreach ($required in $workerRequiredSecrets) {
  if (-not ($WorkerSecretVersionRef | Where-Object { $_ -cmatch "^$required=" })) { throw "Worker secret '$required' is required." }
}

$webEmail = "$WebServiceAccountName@$ProjectId.iam.gserviceaccount.com"
$workerEmail = "$WorkerServiceAccountName@$ProjectId.iam.gserviceaccount.com"
$origin = "https://$Hostname"
$webEnv = @(
  "MATCHBASE_ENVIRONMENT=production",
  "MATCHBASE_DEPLOYMENT_ENVIRONMENT=$Environment",
  "MATCHBASE_ORIGIN=$origin",
  "MATCHBASE_DEPLOYMENT_ID=$($WebImageDigest.Split('@')[1])",
  "MATCHBASE_IMAGE_DIGEST=$($WebImageDigest.Split('@')[1])",
  "MATCHBASE_ROUTE_POLICY_SHA256=$routePolicySha256",
  "MATCHBASE_ROUTE_POLICY_VERSION=$($routePolicy.policyVersion)",
  "MATCHBASE_ARTIFACT_GCS_BUCKET=$ArtifactBucket",
  "MATCHBASE_ARTIFACT_MAXIMUM_BYTES=8388608",
  "GOOGLE_REDIRECT_URI=$origin/auth/google/callback",
  "MATCHBASE_OIDC_SIMULATOR=false",
  "MATCHBASE_SYNTHETIC_FIXTURE=false"
) -join ","
$workerEnv = @(
  "MATCHBASE_ENVIRONMENT=production",
  "MATCHBASE_DEPLOYMENT_ENVIRONMENT=$Environment",
  "MATCHBASE_DEPLOYMENT_ID=$($WorkerImageDigest.Split('@')[1])",
  "MATCHBASE_IMAGE_DIGEST=$($WorkerImageDigest.Split('@')[1])",
  "MATCHBASE_ROUTE_POLICY_SHA256=$routePolicySha256",
  "MATCHBASE_ROUTE_POLICY_VERSION=$($routePolicy.policyVersion)",
  "MATCHBASE_ARTIFACT_GCS_BUCKET=$ArtifactBucket",
  "MATCHBASE_OIDC_SIMULATOR=false",
  "MATCHBASE_SYNTHETIC_FIXTURE=false",
  "MATCHBASE_LIVE_RESEARCH_RUNTIME=environment",
  "MATCHBASE_LIVE_RESEARCH_ENABLED=true",
  "MATCHBASE_WORKER_HEALTH_PORT=3011"
) -join ","
$webSecrets = $WebSecretVersionRef -join ","
$workerSecrets = $WorkerSecretVersionRef -join ","

$webCommand = @(
  "run", "deploy", $WebServiceName,
  "--project=$ProjectId", "--region=$Region", "--platform=managed",
  "--image=$WebImageDigest", "--service-account=$webEmail",
  "--port=8080", "--ingress=internal-and-cloud-load-balancing",
  "--no-invoker-iam-check", "--min=1", "--max=$WebMaxInstances",
  "--concurrency=8", "--cpu=1", "--memory=1Gi", "--timeout=60s",
  "--set-env-vars=$webEnv", "--set-secrets=$webSecrets",
  "--no-session-affinity", "--execution-environment=gen2", "--quiet"
)
$workerCommand = @(
  "run", "worker-pools", "deploy", $WorkerPoolName,
  "--project=$ProjectId", "--region=$Region",
  "--image=$WorkerImageDigest", "--service-account=$workerEmail",
  "--instances=$WorkerInstances", "--cpu=1", "--memory=1Gi",
  "--set-env-vars=$workerEnv", "--set-secrets=$workerSecrets", "--quiet"
)

if (-not $Apply) {
  Write-GcloudPlan -Arguments $webCommand
  Write-GcloudPlan -Arguments $workerCommand
  return
}

Assert-GcloudAvailable
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
    '"name":"MATCHBASE_ENVIRONMENT","value":"production"',
    '"name":"MATCHBASE_DEPLOYMENT_ENVIRONMENT","value":"' + $Environment + '"',
    '"name":"MATCHBASE_DEPLOYMENT_ID","value":"' + $Digest + '"',
    '"name":"MATCHBASE_IMAGE_DIGEST","value":"' + $Digest + '"',
    '"name":"MATCHBASE_ROUTE_POLICY_SHA256","value":"' + $routePolicySha256 + '"',
    '"name":"MATCHBASE_ROUTE_POLICY_VERSION","value":"' + $routePolicy.policyVersion + '"'
  )) {
    if ($State -cnotmatch [regex]::Escape($required)) { throw "$RuntimeName deployed identity does not match the closed release inputs." }
  }
}
Assert-DeployedIdentity -State (($webState | ConvertFrom-Json) | ConvertTo-Json -Depth 100 -Compress) -Image $WebImageDigest -ServiceAccount $webEmail -Digest $WebImageDigest.Split('@')[1] -RuntimeName "Web"
Assert-DeployedIdentity -State (($workerState | ConvertFrom-Json) | ConvertTo-Json -Depth 100 -Compress) -Image $WorkerImageDigest -ServiceAccount $workerEmail -Digest $WorkerImageDigest.Split('@')[1] -RuntimeName "Worker"
$webState
$workerState
