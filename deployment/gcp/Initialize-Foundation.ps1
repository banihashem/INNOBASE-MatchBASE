[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet("staging", "production")][string]$Environment,
  [Parameter(Mandatory)][string]$ArtifactRepository,
  [Parameter(Mandatory)][string]$WebServiceAccountName,
  [Parameter(Mandatory)][string]$WorkerServiceAccountName,
  [Parameter(Mandatory)][ValidateRange(604800, 7776000)][int]$SoftDeleteSeconds,
  [switch]$Apply,
  [string]$ConfirmProjectId = ""
)

. (Join-Path $PSScriptRoot "Common.ps1")
$target = Get-MatchBaseTarget -Environment $Environment
$ProjectId = $target.ProjectId
$Region = $target.Region
$ArtifactBucket = $target.ArtifactBucket
Assert-ApplyConfirmation -Apply $Apply.IsPresent -ExpectedProjectId $ProjectId -ConfirmProjectId $ConfirmProjectId

if ($ArtifactRepository -cnotmatch '^[a-z][a-z0-9-]{2,62}$') { throw "ArtifactRepository is invalid." }
if ($ArtifactBucket -cnotmatch '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$') { throw "ArtifactBucket is invalid." }
foreach ($name in @($WebServiceAccountName, $WorkerServiceAccountName)) {
  if ($name -cnotmatch '^[a-z][a-z0-9-]{4,28}[a-z0-9]$') { throw "Service account name '$name' is invalid." }
}
if ($WebServiceAccountName -ceq $WorkerServiceAccountName) { throw "Web and worker service accounts must be distinct." }

$apis = @(
  "artifactregistry.googleapis.com",
  "compute.googleapis.com",
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
  "run.googleapis.com",
  "secretmanager.googleapis.com",
  "storage.googleapis.com"
)
$webEmail = "$WebServiceAccountName@$ProjectId.iam.gserviceaccount.com"
$workerEmail = "$WorkerServiceAccountName@$ProjectId.iam.gserviceaccount.com"
$commands = [System.Collections.Generic.List[object]]::new()
$commands.Add(@("services", "enable") + $apis + @("--project=$ProjectId", "--quiet"))
$commands.Add(@("artifacts", "repositories", "create", $ArtifactRepository, "--project=$ProjectId", "--location=$Region", "--repository-format=docker", "--immutable-tags", "--description=MatchBASE immutable runtime images", "--quiet"))
$commands.Add(@("iam", "service-accounts", "create", $WebServiceAccountName, "--project=$ProjectId", "--display-name=MatchBASE web runtime", "--quiet"))
$commands.Add(@("iam", "service-accounts", "create", $WorkerServiceAccountName, "--project=$ProjectId", "--display-name=MatchBASE worker runtime", "--quiet"))
$commands.Add(@("storage", "buckets", "create", "gs://$ArtifactBucket", "--project=$ProjectId", "--location=$Region", "--uniform-bucket-level-access", "--public-access-prevention", "--quiet"))
$commands.Add(@("storage", "buckets", "update", "gs://$ArtifactBucket", "--uniform-bucket-level-access", "--public-access-prevention", "--versioning", "--soft-delete-duration=${SoftDeleteSeconds}s", "--quiet"))
$commands.Add(@("storage", "buckets", "add-iam-policy-binding", "gs://$ArtifactBucket", "--member=serviceAccount:$webEmail", "--role=roles/storage.objectViewer", "--quiet"))
$commands.Add(@("storage", "buckets", "add-iam-policy-binding", "gs://$ArtifactBucket", "--member=serviceAccount:$workerEmail", "--role=roles/storage.objectCreator", "--quiet"))
$runtimeProjectRoles = @("roles/cloudsql.client", "roles/logging.logWriter", "roles/monitoring.metricWriter")
foreach ($email in @($webEmail, $workerEmail)) {
  foreach ($role in $runtimeProjectRoles) {
    $commands.Add(@("projects", "add-iam-policy-binding", $ProjectId, "--member=serviceAccount:$email", "--role=$role", "--condition=None", "--quiet"))
  }
}

if (-not $Apply) {
  $commands | ForEach-Object { Write-GcloudPlan -Arguments $_ }
  return
}

Assert-GcloudAvailable
Invoke-Gcloud -Arguments $commands[0] | Out-Null
if (-not (Test-GcloudResource @("artifacts", "repositories", "describe", $ArtifactRepository, "--project=$ProjectId", "--location=$Region"))) {
  Invoke-Gcloud -Arguments $commands[1] | Out-Null
}
if (-not (Test-GcloudResource @("iam", "service-accounts", "describe", $webEmail, "--project=$ProjectId"))) {
  Invoke-Gcloud -Arguments $commands[2] | Out-Null
}
if (-not (Test-GcloudResource @("iam", "service-accounts", "describe", $workerEmail, "--project=$ProjectId"))) {
  Invoke-Gcloud -Arguments $commands[3] | Out-Null
}
if (-not (Test-GcloudResource @("storage", "buckets", "describe", "gs://$ArtifactBucket", "--project=$ProjectId"))) {
  Invoke-Gcloud -Arguments $commands[4] | Out-Null
}
foreach ($index in 5..($commands.Count - 1)) { Invoke-Gcloud -Arguments $commands[$index] | Out-Null }

foreach ($email in @($webEmail, $workerEmail)) {
  Assert-NoUserManagedServiceAccountKeys -Email $email -ProjectId $ProjectId
  Assert-ExactProjectRoles -Email $email -ProjectId $ProjectId -ExpectedRoles $runtimeProjectRoles
  Assert-NoAncestorRoles -Email $email -ProjectId $ProjectId
  Assert-ExactArtifactRepositoryRoles -Email $email -ProjectId $ProjectId -Region $Region -Repository $ArtifactRepository
}
Assert-ExactBucketRoles -Email $webEmail -Bucket $ArtifactBucket -ExpectedRoles @("roles/storage.objectViewer")
Assert-ExactBucketRoles -Email $workerEmail -Bucket $ArtifactBucket -ExpectedRoles @("roles/storage.objectCreator")

Invoke-Gcloud -Arguments @("artifacts", "repositories", "describe", $ArtifactRepository, "--project=$ProjectId", "--location=$Region", "--format=json")
Invoke-Gcloud -Arguments @("storage", "buckets", "describe", "gs://$ArtifactBucket", "--project=$ProjectId", "--format=json")
