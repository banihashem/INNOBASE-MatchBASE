[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet("staging", "production")][string]$Environment,
  [Parameter(Mandatory)][string]$WebServiceName,
  [Parameter(Mandatory)][string]$AddressName,
  [Parameter(Mandatory)][string]$NegName,
  [Parameter(Mandatory)][string]$BackendServiceName,
  [Parameter(Mandatory)][string]$UrlMapName,
  [Parameter(Mandatory)][string]$CertificateName,
  [Parameter(Mandatory)][string]$HttpsProxyName,
  [Parameter(Mandatory)][string]$ForwardingRuleName,
  [Parameter(Mandatory)][string]$SecurityPolicyName,
  [Parameter(Mandatory)][ValidateCount(1, 64)][string[]]$CloudflareSourceIpv4Range,
  [switch]$Apply,
  [string]$ConfirmProjectId = ""
)

. (Join-Path $PSScriptRoot "Common.ps1")
$target = Get-MatchBaseTarget -Environment $Environment
$ProjectId = $target.ProjectId
$Region = $target.Region
$Hostname = $target.Hostname
Assert-ApplyConfirmation -Apply $Apply.IsPresent -ExpectedProjectId $ProjectId -ConfirmProjectId $ConfirmProjectId
foreach ($name in @($WebServiceName, $AddressName, $NegName, $BackendServiceName, $UrlMapName, $CertificateName, $HttpsProxyName, $ForwardingRuleName, $SecurityPolicyName)) {
  if ($name -cnotmatch '^[a-z][a-z0-9-]{1,61}[a-z0-9]$') { throw "Resource name '$name' is invalid." }
}
$cloudflareRanges = @($CloudflareSourceIpv4Range | Sort-Object -Unique)
if ($cloudflareRanges.Count -ne $CloudflareSourceIpv4Range.Count) { throw "Cloudflare source ranges must be unique." }
foreach ($range in $cloudflareRanges) {
  if ($range -cnotmatch '^(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})(?:\.(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})){3}\/(?:[89]|[12][0-9]|3[0-2])$') {
    throw "Cloudflare source range '$range' must be an explicit IPv4 CIDR with prefix /8 through /32."
  }
}

$createCommands = [System.Collections.Generic.List[object]]::new()
$createCommands.Add(@("compute", "security-policies", "create", $SecurityPolicyName, "--project=$ProjectId", "--type=CLOUD_ARMOR", "--description=MatchBASE closed Cloudflare origin admission", "--quiet"))
$priority = 1000
foreach ($range in $cloudflareRanges) {
  $expression = "inIpRange(origin.ip, '$range') && request.headers['host'].lower() == '$Hostname'"
  $createCommands.Add(@("compute", "security-policies", "rules", "create", "$priority", "--project=$ProjectId", "--security-policy=$SecurityPolicyName", "--action=allow", "--expression=$expression", "--description=Approved Cloudflare source and exact MatchBASE host", "--quiet"))
  $priority++
}
$createCommands.Add(@("compute", "security-policies", "rules", "update", "2147483647", "--project=$ProjectId", "--security-policy=$SecurityPolicyName", "--action=deny-403", "--quiet"))
$createCommands.AddRange(@(
  @("compute", "addresses", "create", $AddressName, "--project=$ProjectId", "--global", "--ip-version=IPV4", "--network-tier=PREMIUM", "--quiet"),
  @("compute", "network-endpoint-groups", "create", $NegName, "--project=$ProjectId", "--region=$Region", "--network-endpoint-type=serverless", "--cloud-run-service=$WebServiceName", "--quiet"),
  @("compute", "backend-services", "create", $BackendServiceName, "--project=$ProjectId", "--global", "--load-balancing-scheme=EXTERNAL_MANAGED", "--protocol=HTTP", "--timeout=30s", "--quiet"),
  @("compute", "backend-services", "add-backend", $BackendServiceName, "--project=$ProjectId", "--global", "--network-endpoint-group=$NegName", "--network-endpoint-group-region=$Region", "--quiet"),
  @("compute", "backend-services", "update", $BackendServiceName, "--project=$ProjectId", "--global", "--security-policy=$SecurityPolicyName", "--quiet"),
  @("compute", "url-maps", "create", $UrlMapName, "--project=$ProjectId", "--default-service=$BackendServiceName", "--global", "--quiet"),
  @("compute", "ssl-certificates", "create", $CertificateName, "--project=$ProjectId", "--domains=$Hostname", "--global", "--quiet"),
  @("compute", "target-https-proxies", "create", $HttpsProxyName, "--project=$ProjectId", "--url-map=$UrlMapName", "--ssl-certificates=$CertificateName", "--global", "--quiet"),
  @("compute", "forwarding-rules", "create", $ForwardingRuleName, "--project=$ProjectId", "--global", "--load-balancing-scheme=EXTERNAL_MANAGED", "--network-tier=PREMIUM", "--address=$AddressName", "--target-https-proxy=$HttpsProxyName", "--ports=443", "--quiet")
))

if (-not $Apply) {
  $createCommands | ForEach-Object { Write-GcloudPlan -Arguments $_ }
  return
}

Assert-GcloudAvailable
if (-not (Test-GcloudResource @("compute", "security-policies", "describe", $SecurityPolicyName, "--project=$ProjectId"))) {
  Invoke-Gcloud -Arguments $createCommands[0] | Out-Null
}
$priority = 1000
foreach ($range in $cloudflareRanges) {
  $expression = "inIpRange(origin.ip, '$range') && request.headers['host'].lower() == '$Hostname'"
  if (Test-GcloudResource @("compute", "security-policies", "rules", "describe", "$priority", "--project=$ProjectId", "--security-policy=$SecurityPolicyName")) {
    $rule = Invoke-Gcloud -Arguments @("compute", "security-policies", "rules", "describe", "$priority", "--project=$ProjectId", "--security-policy=$SecurityPolicyName", "--format=json") | ConvertFrom-Json
    if ($rule.action -cne "allow" -or $rule.match.expr.expression -cne $expression) { throw "Cloud Armor origin-admission rule $priority has drifted." }
  } else {
    Invoke-Gcloud -Arguments @("compute", "security-policies", "rules", "create", "$priority", "--project=$ProjectId", "--security-policy=$SecurityPolicyName", "--action=allow", "--expression=$expression", "--description=Approved Cloudflare source and exact MatchBASE host", "--quiet") | Out-Null
  }
  $priority++
}
Invoke-Gcloud -Arguments @("compute", "security-policies", "rules", "update", "2147483647", "--project=$ProjectId", "--security-policy=$SecurityPolicyName", "--action=deny-403", "--quiet") | Out-Null
$policy = Invoke-Gcloud -Arguments @("compute", "security-policies", "describe", $SecurityPolicyName, "--project=$ProjectId", "--format=json") | ConvertFrom-Json
$expectedPriorities = @((1000..(999 + $cloudflareRanges.Count)) + 2147483647)
$actualPriorities = @($policy.rules | ForEach-Object { [int64]$_.priority } | Sort-Object)
if (($actualPriorities -join ",") -cne (($expectedPriorities | Sort-Object) -join ",")) { throw "Cloud Armor origin-admission policy contains unexpected rules." }

$resources = @(
  @{ Check=@("compute", "addresses", "describe", $AddressName, "--project=$ProjectId", "--global"); Create=$createCommands[$cloudflareRanges.Count + 2] },
  @{ Check=@("compute", "network-endpoint-groups", "describe", $NegName, "--project=$ProjectId", "--region=$Region"); Create=$createCommands[$cloudflareRanges.Count + 3] },
  @{ Check=@("compute", "backend-services", "describe", $BackendServiceName, "--project=$ProjectId", "--global"); Create=$createCommands[$cloudflareRanges.Count + 4] },
  @{ Check=@("compute", "url-maps", "describe", $UrlMapName, "--project=$ProjectId", "--global"); Create=$createCommands[$cloudflareRanges.Count + 7] },
  @{ Check=@("compute", "ssl-certificates", "describe", $CertificateName, "--project=$ProjectId", "--global"); Create=$createCommands[$cloudflareRanges.Count + 8] },
  @{ Check=@("compute", "target-https-proxies", "describe", $HttpsProxyName, "--project=$ProjectId", "--global"); Create=$createCommands[$cloudflareRanges.Count + 9] },
  @{ Check=@("compute", "forwarding-rules", "describe", $ForwardingRuleName, "--project=$ProjectId", "--global"); Create=$createCommands[$cloudflareRanges.Count + 10] }
)
foreach ($resource in $resources) {
  if (-not (Test-GcloudResource $resource.Check)) { Invoke-Gcloud -Arguments $resource.Create | Out-Null }
}
$backendJson = Invoke-Gcloud -Arguments @("compute", "backend-services", "describe", $BackendServiceName, "--project=$ProjectId", "--global", "--format=json")
if ($backendJson -notmatch [regex]::Escape("/networkEndpointGroups/$NegName")) { Invoke-Gcloud -Arguments $createCommands[$cloudflareRanges.Count + 5] | Out-Null }
Invoke-Gcloud -Arguments $createCommands[$cloudflareRanges.Count + 6] | Out-Null

$backendJson = Invoke-Gcloud -Arguments @("compute", "backend-services", "describe", $BackendServiceName, "--project=$ProjectId", "--global", "--format=json")
if ($backendJson -notmatch [regex]::Escape("/securityPolicies/$SecurityPolicyName")) { throw "Cloud Armor origin-admission policy is not bound to the ALB backend." }

$address = Invoke-Gcloud -Arguments @("compute", "addresses", "describe", $AddressName, "--project=$ProjectId", "--global", "--format=value(address)")
$certificate = Invoke-Gcloud -Arguments @("compute", "ssl-certificates", "describe", $CertificateName, "--project=$ProjectId", "--global", "--format=json")
[pscustomobject]@{
  hostname = $Hostname
  address = $address
  requiredDnsRecord = "A $Hostname $address"
  certificate = $certificate | ConvertFrom-Json
} | ConvertTo-Json -Depth 20
