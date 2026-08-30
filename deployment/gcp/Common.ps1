Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:RequiredRegion = "me-central1"
$script:Targets = @{
  staging = [pscustomobject]@{
    Environment = "staging"
    ProjectId = "innobase-matchbase-stg"
    Hostname = "matchbase-staging.innobase.app"
    ArtifactBucket = "innobase-matchbase-stg-artifacts"
    Region = $script:RequiredRegion
  }
  production = [pscustomobject]@{
    Environment = "production"
    ProjectId = "innobase-matchbase"
    Hostname = "matchbase.innobase.app"
    ArtifactBucket = "innobase-matchbase-artifacts"
    Region = $script:RequiredRegion
  }
}

function Get-MatchBaseTarget {
  param([Parameter(Mandatory)][ValidateSet("staging", "production")][string]$Environment)
  if ($Environment -cnotin @("staging", "production") -or -not $script:Targets.ContainsKey($Environment)) {
    throw "Environment is outside the closed MatchBASE target map."
  }
  return $script:Targets[$Environment]
}

function Assert-ApplyConfirmation {
  param(
    [Parameter(Mandatory)][bool]$Apply,
    [Parameter(Mandatory)][string]$ExpectedProjectId,
    [AllowEmptyString()][string]$ConfirmProjectId = ""
  )
  if ($Apply -and $ConfirmProjectId -cne $ExpectedProjectId) {
    throw "-Apply requires -ConfirmProjectId '$ExpectedProjectId'."
  }
}

function Assert-GcloudAvailable {
  if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    throw "gcloud is required and was not found on PATH."
  }
}

function Format-CommandArgument {
  param([Parameter(Mandatory)][string]$Value)
  if ($Value -match '[\s"'']') {
    return '"' + $Value.Replace('"', '\"') + '"'
  }
  return $Value
}

function Write-GcloudPlan {
  param([Parameter(Mandatory)][string[]]$Arguments)
  $rendered = ($Arguments | ForEach-Object { Format-CommandArgument $_ }) -join " "
  Write-Output "gcloud $rendered"
}

function Invoke-Gcloud {
  param(
    [Parameter(Mandatory)][string[]]$Arguments,
    [switch]$AllowNotFound
  )
  $output = & gcloud @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    if ($AllowNotFound) { return $null }
    throw "gcloud failed ($exitCode): $($Arguments -join ' ')`n$($output -join [Environment]::NewLine)"
  }
  return ($output -join [Environment]::NewLine).Trim()
}

function Test-GcloudResource {
  param([Parameter(Mandatory)][string[]]$Arguments)
  $null = & gcloud @Arguments 2>$null
  return $LASTEXITCODE -eq 0
}

function Assert-ImmutableImageDigest {
  param(
    [Parameter(Mandatory)][string]$Image,
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$Region,
    [Parameter(Mandatory)][string]$Repository,
    [string]$ExpectedImageName = ""
  )
  $escapedProject = [regex]::Escape($ProjectId)
  $escapedRegion = [regex]::Escape($Region)
  $escapedRepository = [regex]::Escape($Repository)
  $pattern = "^${escapedRegion}-docker\.pkg\.dev/${escapedProject}/${escapedRepository}/[a-z0-9][a-z0-9._-]{0,127}@sha256:[a-f0-9]{64}$"
  if ($Image -cnotmatch $pattern) {
    throw "Image must be an immutable sha256 digest in the approved Artifact Registry repository."
  }
  if ($ExpectedImageName -and $Image.Split("@", 2)[0].Split("/")[-1] -cne $ExpectedImageName) {
    throw "Image name must bind the digest to '$ExpectedImageName'."
  }
}

function Get-GcloudRoleSet {
  param([Parameter(Mandatory)][string[]]$Arguments)
  $text = Invoke-Gcloud -Arguments $Arguments
  if (-not $text) { return @() }
  return @($text -split "`r?`n" | Where-Object { $_ } | Sort-Object -Unique)
}

function Assert-ExactRoleSet {
  param(
    [Parameter(Mandatory)][string[]]$Actual,
    [Parameter(Mandatory)][string[]]$Expected,
    [Parameter(Mandatory)][string]$Scope
  )
  $actualSorted = @($Actual | Sort-Object -Unique)
  $expectedSorted = @($Expected | Sort-Object -Unique)
  if (($actualSorted -join "`n") -cne ($expectedSorted -join "`n")) {
    throw "IAM drift for $Scope. Expected [$($expectedSorted -join ', ')], found [$($actualSorted -join ', ')]."
  }
}

function Assert-NoUserManagedServiceAccountKeys {
  param([Parameter(Mandatory)][string]$Email, [Parameter(Mandatory)][string]$ProjectId)
  $keys = Invoke-Gcloud -Arguments @("iam", "service-accounts", "keys", "list", "--iam-account=$Email", "--project=$ProjectId", "--managed-by=user", "--format=value(name)")
  if ($keys) { throw "Service account '$Email' has prohibited user-managed keys." }
}

function Assert-ExactProjectRoles {
  param(
    [Parameter(Mandatory)][string]$Email,
    [Parameter(Mandatory)][string]$ProjectId,
    [string[]]$ExpectedRoles = @()
  )
  $roles = Get-GcloudRoleSet -Arguments @("projects", "get-iam-policy", $ProjectId, "--flatten=bindings[].members", "--filter=bindings.members:serviceAccount:$Email", "--format=value(bindings.role)")
  Assert-ExactRoleSet -Actual $roles -Expected $ExpectedRoles -Scope "project $ProjectId member $Email"
}

function Assert-NoAncestorRoles {
  param([Parameter(Mandatory)][string]$Email, [Parameter(Mandatory)][string]$ProjectId)
  $ancestors = Invoke-Gcloud -Arguments @("projects", "get-ancestors", $ProjectId, "--format=json") | ConvertFrom-Json
  foreach ($ancestor in @($ancestors | Where-Object { $_.type -in @("folder", "organization") })) {
    $policyArguments = if ($ancestor.type -eq "folder") {
      @("resource-manager", "folders", "get-iam-policy", [string]$ancestor.id)
    } else {
      @("organizations", "get-iam-policy", [string]$ancestor.id)
    }
    $roles = Get-GcloudRoleSet -Arguments @($policyArguments + @("--flatten=bindings[].members", "--filter=bindings.members:serviceAccount:$Email", "--format=value(bindings.role)"))
    Assert-ExactRoleSet -Actual $roles -Expected @() -Scope "$($ancestor.type) $($ancestor.id) member $Email"
  }
}

function Assert-ExactArtifactRepositoryRoles {
  param(
    [Parameter(Mandatory)][string]$Email,
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$Region,
    [Parameter(Mandatory)][string]$Repository,
    [string[]]$ExpectedRoles = @()
  )
  $roles = Get-GcloudRoleSet -Arguments @("artifacts", "repositories", "get-iam-policy", $Repository, "--project=$ProjectId", "--location=$Region", "--flatten=bindings[].members", "--filter=bindings.members:serviceAccount:$Email", "--format=value(bindings.role)")
  Assert-ExactRoleSet -Actual $roles -Expected $ExpectedRoles -Scope "Artifact Registry $Repository member $Email"
}

function Assert-ExactBucketRoles {
  param(
    [Parameter(Mandatory)][string]$Email,
    [Parameter(Mandatory)][string]$Bucket,
    [Parameter(Mandatory)][string[]]$ExpectedRoles
  )
  $roles = Get-GcloudRoleSet -Arguments @("storage", "buckets", "get-iam-policy", "gs://$Bucket", "--flatten=bindings[].members", "--filter=bindings.members:serviceAccount:$Email", "--format=value(bindings.role)")
  Assert-ExactRoleSet -Actual $roles -Expected $ExpectedRoles -Scope "bucket $Bucket member $Email"
}

function Assert-ExactSecretAccessorBindings {
  param(
    [Parameter(Mandatory)][string]$Email,
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string[]]$ExpectedSecrets
  )
  $expected = @($ExpectedSecrets | Sort-Object -Unique)
  $allText = Invoke-Gcloud -Arguments @("secrets", "list", "--project=$ProjectId", "--format=value(name)")
  $allSecrets = if ($allText) { @($allText -split "`r?`n" | Where-Object { $_ }) } else { @() }
  foreach ($secret in $allSecrets) {
    $roles = Get-GcloudRoleSet -Arguments @("secrets", "get-iam-policy", $secret, "--project=$ProjectId", "--flatten=bindings[].members", "--filter=bindings.members:serviceAccount:$Email", "--format=value(bindings.role)")
    $expectedRoles = if ($secret -cin $expected) { @("roles/secretmanager.secretAccessor") } else { @() }
    Assert-ExactRoleSet -Actual $roles -Expected $expectedRoles -Scope "secret $secret member $Email"
  }
  foreach ($secret in $expected) {
    if ($secret -cnotin $allSecrets) { throw "Expected secret '$secret' does not exist in project '$ProjectId'." }
  }
}

function Assert-SecretVersionReference {
  param(
    [Parameter(Mandatory)][string]$Reference,
    [Parameter(Mandatory)][string]$ProjectId
  )
  if ($ProjectId -notin @($script:Targets.staging.ProjectId, $script:Targets.production.ProjectId)) { throw "Secret project is outside the approved target map." }
  if ($Reference -cnotmatch "^[A-Z][A-Z0-9_]{1,63}=[a-zA-Z0-9_-]{1,255}:[1-9][0-9]*$") {
    throw "Secret references must use ENV=SECRET_NAME:NUMERIC_VERSION for the approved target project."
  }
}

function Get-SecretReferenceParts {
  param(
    [Parameter(Mandatory)][string]$Reference,
    [Parameter(Mandatory)][string]$ProjectId
  )
  Assert-SecretVersionReference -Reference $Reference -ProjectId $ProjectId
  $separator = $Reference.IndexOf("=")
  $environmentName = $Reference.Substring(0, $separator)
  $resource = $Reference.Substring($separator + 1)
  $versionSeparator = $resource.LastIndexOf(":")
  [pscustomobject]@{
    EnvironmentName = $environmentName
    SecretName = $resource.Substring(0, $versionSeparator)
    Version = $resource.Substring($versionSeparator + 1)
  }
}
