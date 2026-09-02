[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet("Preflight", "RegionalFoundation", "DatabaseRehearsal", "Canary", "Maintenance", "FinalRestore", "Cutover", "Rollback", "PreWriteRollback", "SourceRetirement")][string]$Checkpoint,
  [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$CandidateCommit,
  [Parameter(Mandatory)][ValidatePattern('^me-central1-docker\.pkg\.dev/innobase-matchbase-stg/matchbase/.+@sha256:[a-f0-9]{64}$')][string]$WebSourceImageDigest,
  [Parameter(Mandatory)][ValidatePattern('^me-central1-docker\.pkg\.dev/innobase-matchbase-stg/matchbase/.+@sha256:[a-f0-9]{64}$')][string]$WorkerSourceImageDigest,
  [Parameter(Mandatory)][ValidatePattern('^projects/innobase-matchbase-stg/locations/europe-west2/keyRings/[a-z0-9_-]+/cryptoKeys/[a-z0-9_-]+/cryptoKeyVersions/[1-9][0-9]*$')][string]$KmsKeyVersion,
  [Parameter(Mandatory)][string]$OutputPath,
  [string]$PredecessorLedgerUri = ""
)

. (Join-Path $PSScriptRoot "Common.ps1")
Assert-GcloudAvailable
$migration = Get-MatchBaseStagingRegionMigration
$project = "innobase-matchbase-stg"
$sourceRegion = "me-central1"
$targetRegion = "europe-west2"
$facts = [ordered]@{}

function Invoke-ReadOnlyCapture {
  param([Parameter(Mandatory)][string]$Id, [Parameter(Mandatory)][string[]]$Arguments)
  $forbidden = $Arguments -join " "
  if ($forbidden -match '(?i)\b(create|delete|deploy|update|patch|restore|add-iam-policy-binding|rm|cp|rsync|versions access)\b') { throw "Evidence producer rejected non-read-only command '$Id'." }
  $raw = (Invoke-Gcloud -Arguments $Arguments | Out-String).Trim()
  $sha = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($raw))).ToLowerInvariant()
  return [ordered]@{ id = $Id; argv = @($Arguments); stdout_sha256 = $sha; stdout = $raw }
}

function Invoke-DatabaseFactCapture {
  param([Parameter(Mandatory)][string]$Id, [Parameter(Mandatory)][string]$Query)
  $psql = Get-Command psql -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $psql) { throw "$Checkpoint evidence requires psql for closed database facts." }
  if ([string]::IsNullOrWhiteSpace($env:MATCHBASE_EVIDENCE_DATABASE_URL)) { throw "$Checkpoint evidence requires MATCHBASE_EVIDENCE_DATABASE_URL; its value is never recorded." }
  $raw = (& $psql.Source $env:MATCHBASE_EVIDENCE_DATABASE_URL --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 --command=$Query 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Closed database fact query '$Id' failed." }
  $sha = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($raw))).ToLowerInvariant()
  return [ordered]@{ id = $Id; argv = @("psql", "<REDACTED_DATABASE_URL>", "--no-psqlrc", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", "--command=$Query"); stdout_sha256 = $sha; stdout = $raw }
}

function Get-ClosedBuildProvenanceBinding {
  param([Parameter(Mandatory)][object]$Capture, [Parameter(Mandatory)][string]$Image, [Parameter(Mandatory)][string]$PeerImage)
  $parser = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\scripts\lib\staging-eu-provenance.mjs") -ErrorAction Stop).Path
  $work = Join-Path ([IO.Path]::GetTempPath()) "matchbase-provenance-$([guid]::NewGuid().ToString('N')).json"
  try {
    Set-Content -LiteralPath $work -Value ([string]$Capture.stdout) -Encoding utf8NoBOM
    $normalized = (& node $parser --file $work --image $Image --peer-image $PeerImage --commit $CandidateCommit 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Closed Artifact Registry build-provenance parser rejected candidate image." }
    return $normalized | ConvertFrom-Json
  } finally { Remove-Item -LiteralPath $work -Force -ErrorAction SilentlyContinue }
}

$account = (Invoke-Gcloud -Arguments @("config", "get-value", "account") | Out-String).Trim()
$activeProject = (Invoke-Gcloud -Arguments @("config", "get-value", "project") | Out-String).Trim()
if ($activeProject -cne $project) { throw "Active gcloud project must be exactly $project." }
if ($account -cnotmatch '^[^\s@]+@[^\s@]+$') { throw "Active gcloud account is missing or malformed." }
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..") -ErrorAction Stop).Path
$headCommit = (& git -C $repoRoot rev-parse HEAD 2>&1 | Out-String).Trim()
$worktreeState = (& git -C $repoRoot status --porcelain=v1 --untracked-files=all 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $headCommit -cne $CandidateCommit -or -not [string]::IsNullOrWhiteSpace($worktreeState)) { throw "Evidence production requires exact candidate HEAD and a clean tracked/untracked worktree." }
$captures = @(
  (Invoke-ReadOnlyCapture -Id "project" -Arguments @("projects", "describe", $project, "--format=json(projectId,lifecycleState,parent)")),
  (Invoke-ReadOnlyCapture -Id "source-web" -Arguments @("run", "services", "describe", "matchbase-staging-web", "--project=$project", "--region=$sourceRegion", "--format=json")),
  (Invoke-ReadOnlyCapture -Id "source-worker" -Arguments @("run", "worker-pools", "describe", "matchbase-staging-worker", "--project=$project", "--region=$sourceRegion", "--format=json")),
  (Invoke-ReadOnlyCapture -Id "source-sql" -Arguments @("sql", "instances", "describe", "matchbase-stg-pg18", "--project=$project", "--format=json")),
  (Invoke-ReadOnlyCapture -Id "target-services" -Arguments @("run", "services", "list", "--project=$project", "--region=$targetRegion", "--format=json")),
  (Invoke-ReadOnlyCapture -Id "target-workers" -Arguments @("run", "worker-pools", "list", "--project=$project", "--region=$targetRegion", "--format=json")),
  (Invoke-ReadOnlyCapture -Id "target-sql-list" -Arguments @("sql", "instances", "list", "--project=$project", "--filter=region:$targetRegion", "--format=json")),
  (Invoke-ReadOnlyCapture -Id "url-map" -Arguments @("compute", "url-maps", "describe", ([string]$migration.UrlMap), "--project=$project", "--global", "--format=json"))
)
$webProvenance = Invoke-ReadOnlyCapture -Id "candidate-web-build-provenance" -Arguments @("artifacts", "docker", "images", "describe", $WebSourceImageDigest, "--project=$project", "--show-provenance", "--format=json")
$workerProvenance = Invoke-ReadOnlyCapture -Id "candidate-worker-build-provenance" -Arguments @("artifacts", "docker", "images", "describe", $WorkerSourceImageDigest, "--project=$project", "--show-provenance", "--format=json")
$webProvenanceBinding = Get-ClosedBuildProvenanceBinding -Capture $webProvenance -Image $WebSourceImageDigest -PeerImage $WorkerSourceImageDigest
$workerProvenanceBinding = Get-ClosedBuildProvenanceBinding -Capture $workerProvenance -Image $WorkerSourceImageDigest -PeerImage $WebSourceImageDigest
$captures += $webProvenance
$captures += $workerProvenance

if ($Checkpoint -notin @("Preflight", "RegionalFoundation", "DatabaseRehearsal")) {
  $evidenceWebService = if ($Checkpoint -in @("Canary", "Cutover")) { [string]$migration.CanaryWebService } else { [string]$migration.TargetWebService }
  $captures += Invoke-ReadOnlyCapture -Id "target-web" -Arguments @("run", "services", "describe", $evidenceWebService, "--project=$project", "--region=$targetRegion", "--format=json")
  $captures += Invoke-ReadOnlyCapture -Id "target-worker" -Arguments @("run", "worker-pools", "describe", "matchbase-staging-worker", "--project=$project", "--region=$targetRegion", "--format=json")
  $captures += Invoke-ReadOnlyCapture -Id "target-sql" -Arguments @("sql", "instances", "describe", "matchbase-stg-pg18-ew2", "--project=$project", "--format=json")
}

if ($Checkpoint -in @("Canary", "Maintenance", "FinalRestore", "Cutover", "Rollback", "PreWriteRollback", "SourceRetirement")) {
  $databaseQuery = "SELECT json_build_object('migration_head',(SELECT migration_id FROM matchbase_schema_migration ORDER BY applied_at DESC, migration_id DESC LIMIT 1),'active_runs',(SELECT count(*) FROM research_run WHERE state IN ('queued','running','failed_retryable')),'queued_runs',(SELECT count(*) FROM research_run WHERE state='queued'),'unreleased_leases',(SELECT count(*) FROM execution_lease WHERE released_at IS NULL AND expires_at > now()));"
  $databaseCapture = Invoke-DatabaseFactCapture -Id "closed-database-state" -Query $databaseQuery
  $captures += $databaseCapture
  $databaseFacts = $databaseCapture.stdout | ConvertFrom-Json
  $facts.migration_head = [string]$databaseFacts.migration_head
  $facts.active_runs = [int]$databaseFacts.active_runs
  $facts.queued_runs = [int]$databaseFacts.queued_runs
  $facts.unreleased_leases = [int]$databaseFacts.unreleased_leases
  $facts.freeze_query_sha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes("SELECT count(*) FILTER (WHERE state IN ('queued','running','failed_retryable')) AS active_or_queued_runs, count(*) FILTER (WHERE state='queued') AS queued_runs FROM research_run; SELECT count(*) AS unreleased_leases FROM execution_lease WHERE released_at IS NULL AND expires_at > now();"))).ToLowerInvariant()
}

if ($Checkpoint -in @("Canary", "Cutover")) {
  $targetWeb = (($captures | Where-Object id -eq "target-web").stdout | ConvertFrom-Json)
  $targetWorker = (($captures | Where-Object id -eq "target-worker").stdout | ConvertFrom-Json)
  $cloudRunOrigin = ([uri][string]$targetWeb.status.url).GetLeftPart([UriPartial]::Authority)
  $expectedWebService = if ($Checkpoint -in @("Canary", "Cutover")) { [string]$migration.CanaryWebService } else { [string]$migration.TargetWebService }
  if ([string]$targetWeb.metadata.name -cne $expectedWebService -or $cloudRunOrigin -cnotmatch '^https://matchbase-staging-web(?:-canary-ew2)?-[a-z0-9-]+\.europe-west2\.run\.app$') { throw "Live EU Cloud Run service URL is outside the closed checkpoint target identity." }
  $publicCanaryOrigin = "https://$($migration.CanaryHostname)"
  if ($publicCanaryOrigin -cne "https://matchbase-staging-eu-canary.innobase.app") { throw "Public EU canary origin is outside the closed staging-eu target." }
  $armorCapture = Invoke-ReadOnlyCapture -Id "canary-cloud-armor" -Arguments @("compute", "security-policies", "describe", [string]$migration.SecurityPolicy, "--project=$project", "--format=json")
  $certificateCapture = Invoke-ReadOnlyCapture -Id "canary-managed-certificate" -Arguments @("certificate-manager", "certificates", "describe", [string]$migration.CanaryCertificateName, "--project=$project", "--location=global", "--format=json")
  $mainAuthCapture = Invoke-ReadOnlyCapture -Id "main-dns-authorization" -Arguments @("certificate-manager", "dns-authorizations", "describe", [string]$migration.MainDnsAuthorization, "--project=$project", "--location=global", "--format=json")
  $canaryAuthCapture = Invoke-ReadOnlyCapture -Id "canary-dns-authorization" -Arguments @("certificate-manager", "dns-authorizations", "describe", [string]$migration.CanaryDnsAuthorization, "--project=$project", "--location=global", "--format=json")
  $mainEntryCapture = Invoke-ReadOnlyCapture -Id "main-certificate-map-entry" -Arguments @("certificate-manager", "maps", "entries", "describe", [string]$migration.MainCertificateMapEntry, "--project=$project", "--location=global", "--map=$($migration.CertificateMap)", "--format=json")
  $canaryEntryCapture = Invoke-ReadOnlyCapture -Id "canary-certificate-map-entry" -Arguments @("certificate-manager", "maps", "entries", "describe", [string]$migration.CanaryCertificateMapEntry, "--project=$project", "--location=global", "--map=$($migration.CertificateMap)", "--format=json")
  $proxyCapture = Invoke-ReadOnlyCapture -Id "canary-https-proxy" -Arguments @("compute", "target-https-proxies", "describe", [string]$migration.HttpsProxyName, "--project=$project", "--global", "--format=json")
  $addressCapture = Invoke-ReadOnlyCapture -Id "canary-global-address" -Arguments @("compute", "addresses", "describe", [string]$migration.AddressName, "--project=$project", "--global", "--format=json")
  $captures += @($armorCapture, $certificateCapture, $mainAuthCapture, $canaryAuthCapture, $mainEntryCapture, $canaryEntryCapture, $proxyCapture, $addressCapture)
  $armor=$armorCapture.stdout|ConvertFrom-Json; $cert=$certificateCapture.stdout|ConvertFrom-Json; $mainAuth=$mainAuthCapture.stdout|ConvertFrom-Json; $canaryAuth=$canaryAuthCapture.stdout|ConvertFrom-Json; $mainEntry=$mainEntryCapture.stdout|ConvertFrom-Json; $canaryEntry=$canaryEntryCapture.stdout|ConvertFrom-Json; $proxy=$proxyCapture.stdout|ConvertFrom-Json; $address=$addressCapture.stdout|ConvertFrom-Json
  $expectedRanges=@("173.245.48.0/20","103.21.244.0/22","103.22.200.0/22","103.31.4.0/22","141.101.64.0/18","108.162.192.0/18","190.93.240.0/20","188.114.96.0/20","197.234.240.0/22","198.41.128.0/17","162.158.0.0/15","104.16.0.0/13","104.24.0.0/14","172.64.0.0/13","131.0.72.0/22")
  for($i=0;$i-lt $expectedRanges.Count;$i++){ $mainPriority=1000+$i; $mainExpression="inIpRange(origin.ip, '$($expectedRanges[$i])') && request.headers['host'].lower() == '$($migration.Hostname)'"; $mainMatched=@($armor.rules|Where-Object{$_.priority -eq $mainPriority -and $_.action -ceq "allow" -and $_.match.expr.expression -ceq $mainExpression}); $priority=2000+$i; $expression="inIpRange(origin.ip, '$($expectedRanges[$i])') && request.headers['host'].lower() == '$($migration.CanaryHostname)'"; $matched=@($armor.rules|Where-Object{$_.priority -eq $priority -and $_.action -ceq "allow" -and $_.match.expr.expression -ceq $expression}); if($mainMatched.Count-ne 1-or $matched.Count-ne 1){throw "Main/Canary Cloud Armor closed priority/range/host proof failed."} }
  $defaultDeny=@($armor.rules|Where-Object{$_.priority -eq 2147483647-and $_.action -ceq "deny(403)"}); if($defaultDeny.Count-ne 1){throw "Cloud Armor default deny or original-host behavior drifted."}
  $certDomains=(@($cert.managed.domains)|Sort-Object)-join ","; $expectedDomains=(@($migration.CanaryHostname,$migration.Hostname)|Sort-Object)-join ","; if($cert.managed.state-cne "ACTIVE"-or $certDomains-cne $expectedDomains-or-not([string]$proxy.certificateMap).EndsWith("/certificateMaps/$($migration.CertificateMap)")-or $mainEntry.hostname-cne $migration.Hostname-or $canaryEntry.hostname-cne $migration.CanaryHostname-or @($mainEntry.certificates).Count-ne 1-or-not([string]$mainEntry.certificates[0]).EndsWith("/certificates/$($migration.CanaryCertificateName)")-or @($canaryEntry.certificates).Count-ne 1-or-not([string]$canaryEntry.certificates[0]).EndsWith("/certificates/$($migration.CanaryCertificateName)")){throw "Canary ACTIVE Certificate Manager SAN/map/proxy binding failed."}
  if([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)-or $env:MATCHBASE_CLOUDFLARE_ZONE_ID-cnotmatch '^[a-f0-9]{32}$'-or [string]::IsNullOrWhiteSpace($env:MATCHBASE_CANARY_ORIGIN_ADMISSION_KEY)){throw "Canary edge evidence requires in-memory Cloudflare read token, zone ID, and admission key."}
  $cfHeaders=@{Authorization="Bearer $($env:CLOUDFLARE_API_TOKEN)"}; $cfApi="https://api.cloudflare.com/client/v4/zones/$($env:MATCHBASE_CLOUDFLARE_ZONE_ID)"
  $dns=(Invoke-RestMethod -Method Get -Uri "$cfApi/dns_records?type=A&name=$($migration.CanaryHostname)" -Headers $cfHeaders).result
  $explicitAAAA=(Invoke-RestMethod -Method Get -Uri "$cfApi/dns_records?type=AAAA&name=$($migration.CanaryHostname)" -Headers $cfHeaders).result
  $ssl=(Invoke-RestMethod -Method Get -Uri "$cfApi/settings/ssl" -Headers $cfHeaders).result
  $rulesets=@((Invoke-RestMethod -Method Get -Uri "$cfApi/rulesets" -Headers $cfHeaders).result|Where-Object{$_.kind-ceq"zone"-and$_.phase-ceq"http_request_late_transform"})
  foreach($auth in @($mainAuth,$canaryAuth)){ $rr=$auth.dnsResourceRecord;$authDns=(Invoke-RestMethod -Method Get -Uri "$cfApi/dns_records?type=CNAME&name=$($rr.name.TrimEnd('.'))" -Headers $cfHeaders).result;if($authDns.Count-ne 1-or $authDns[0].proxied-or $authDns[0].content.TrimEnd('.')-cne $rr.data.TrimEnd('.')){throw "Certificate Manager DNS authorization CNAME evidence failed."} }
  if($explicitAAAA.Count-ne 0-or$dns.Count-ne 1-or-not $dns[0].proxied-or $dns[0].content-cne [string]$address.address-or $ssl.value-cne "strict"-or $rulesets.Count-ne 1){throw "Cloudflare canary proxied A, explicit-AAAA prohibition, or Full strict evidence failed."}
  $ruleset=(Invoke-RestMethod -Method Get -Uri "$cfApi/rulesets/$($rulesets[0].id)" -Headers $cfHeaders).result
  $transform=@($ruleset.rules|Where-Object{$_.ref-ceq "matchbase_canary_origin_admission"-and $_.expression-ceq "(http.host eq `"$($migration.CanaryHostname)`")"-and $_.action-ceq "rewrite"-and $_.enabled})
  if($transform.Count-ne 1-or $transform[0].action_parameters.headers.'MB-Origin-Admission'.operation-cne "set"-or $transform[0].action_parameters.headers.'MB-Origin-Admission'.value-cne $env:MATCHBASE_CANARY_ORIGIN_ADMISSION_KEY){throw "Cloudflare canary origin-admission transform evidence failed."}
  $publicA=@(Resolve-DnsName $migration.CanaryHostname -Type A -DnsOnly -ErrorAction Stop|Where-Object Type -eq A); $publicAAAA=@(Resolve-DnsName $migration.CanaryHostname -Type AAAA -DnsOnly -ErrorAction Stop|Where-Object Type -eq AAAA)
  if($publicA.Count-lt 1-or $publicAAAA.Count-lt 1){throw "Proxied canary public A/AAAA evidence failed."}
  $facts.canary_edge=[ordered]@{armor_priorities="2000-2014";certificate=[string]$migration.CanaryCertificateName;certificate_status="ACTIVE";https_proxy=[string]$migration.HttpsProxyName;dns_proxied=$true;public_a=$true;public_aaaa=$true;cloudflare_ssl="strict";transform_ref="matchbase_canary_origin_admission";admission_value_sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($env:MATCHBASE_CANARY_ORIGIN_ADMISSION_KEY))).ToLowerInvariant()}
  $runtimeEnv = @{}; foreach ($entry in @($targetWeb.spec.template.spec.containers[0].env)) { if ($null -ne $entry.value) { $runtimeEnv[[string]$entry.name] = [string]$entry.value } }
  if ($runtimeEnv.GOOGLE_REDIRECT_URI -cne "$publicCanaryOrigin/auth/google/callback" -or $runtimeEnv.MATCHBASE_ORIGIN -cne $publicCanaryOrigin -or $runtimeEnv.MATCHBASE_DEPLOYMENT_TARGET -cne "staging-eu-canary") { throw "Canary runtime OAuth redirect, origin, or deployment identity drifted from the closed canary hostname." }
  $candidateRevision = [string]$targetWeb.status.latestReadyRevisionName
  $readyCondition = @($targetWeb.status.conditions | Where-Object { $_.type -ceq "Ready" -and $_.status -ceq "True" })
  if ($candidateRevision -cnotmatch '^matchbase-staging-web(?:-canary-ew2)?-[a-z0-9-]+$' -or $readyCondition.Count -ne 1) { throw "The exact ready candidate revision is absent." }
  $candidateReadyAt = [string]$readyCondition[0].lastTransitionTime
  if ([datetimeoffset]::MinValue -eq [datetimeoffset]::Parse($candidateReadyAt)) { throw "Candidate readiness timestamp is invalid." }
  $validator = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\scripts\validate-staging-eu-acceptance.mjs") -ErrorAction Stop).Path
  $validatorHash = (Get-FileHash -LiteralPath $validator -Algorithm SHA256).Hash.ToLowerInvariant()
  $acceptanceRaw = (& node $validator --origin $publicCanaryOrigin --direct-service-url $cloudRunOrigin --candidate-ready-at $candidateReadyAt --candidate-revision $candidateRevision 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Closed EU acceptance collector failed." }
  $acceptance = $acceptanceRaw | ConvertFrom-Json
  if ($acceptance.schema_version -cne "matchbase-eu-staging-acceptance.v2") { throw "EU acceptance collector schema is invalid." }
  foreach ($name in @("oauth", "complete_research", "pdf", "origin_denial")) { if ($acceptance.acceptance.$name -cne "PASS") { throw "EU acceptance '$name' did not pass." } }
  $acceptanceHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($acceptanceRaw))).ToLowerInvariant()
  $acceptanceRunId = [string]$acceptance.run_id
  if ($acceptance.public_canary_origin -cne $publicCanaryOrigin -or $acceptance.direct_cloud_run_origin -cne $cloudRunOrigin -or $acceptance.candidate_revision -cne $candidateRevision -or $acceptance.candidate_ready_at -cne ([datetimeoffset]$candidateReadyAt).ToUniversalTime().ToString("o") -or $acceptanceRunId -cnotmatch '^[0-9a-f-]{36}$' -or $acceptance.oauth_state_sha256 -cnotmatch '^[a-f0-9]{64}$' -or $acceptance.artifact_sha256 -cnotmatch '^[a-f0-9]{64}$' -or [int64]$acceptance.artifact_byte_size -lt 1024) { throw "EU acceptance output is not bound to the closed canary, ready candidate, OAuth transaction, fresh run, and verified PDF bytes." }
  $oauthStateSha256 = [string]$acceptance.oauth_state_sha256
  $oauthBindingQuery = "SELECT json_build_object('state_sha256',encode(state_hash,'hex'),'nonce_hash_bytes',octet_length(nonce_hash),'pkce_hash_bytes',octet_length(pkce_verifier_hash),'redirect_uri',redirect_uri,'environment',environment,'simulator',simulator,'created_at',created_at,'consumed_at',consumed_at) FROM oauth_transaction WHERE state_hash=decode('$oauthStateSha256','hex');"
  $oauthBindingCapture = Invoke-DatabaseFactCapture -Id "oauth-state-nonce-pkce-consumption" -Query $oauthBindingQuery
  $captures += $oauthBindingCapture
  $oauthBinding = $oauthBindingCapture.stdout | ConvertFrom-Json
  if ($oauthBinding.state_sha256 -cne $oauthStateSha256 -or [int]$oauthBinding.nonce_hash_bytes -ne 32 -or [int]$oauthBinding.pkce_hash_bytes -ne 32 -or $oauthBinding.redirect_uri -cne "$publicCanaryOrigin/auth/google/callback" -or $oauthBinding.environment -cne "staging" -or [bool]$oauthBinding.simulator -or [datetimeoffset]$oauthBinding.created_at -le [datetimeoffset]$candidateReadyAt -or [datetimeoffset]$oauthBinding.consumed_at -le [datetimeoffset]$oauthBinding.created_at) { throw "Google OAuth state, nonce, PKCE, callback, environment, and one-time consumption proof failed." }
  $artifactGrantId = [string]$acceptance.artifact_grant_id
  if ($artifactGrantId -cnotmatch '^[0-9a-f-]{36}$') { throw "Acceptance artifact grant identity is invalid." }
  $artifactBindingQuery = "SELECT json_build_object('grant_id',g.grant_id,'run_id',a.run_id,'file_sha256',encode(v.file_sha256,'hex'),'byte_size',v.byte_size,'state',v.state,'result_version',v.result_version,'run_created_at',r.created_at,'artifact_created_at',v.created_at,'subject_user_id',g.subject_user_id) FROM artifact_access_grant g JOIN artifact_version v USING (artifact_version_id,account_id) JOIN artifact a USING (artifact_id,account_id) JOIN research_run r USING (run_id,account_id) WHERE g.grant_id='$artifactGrantId'::uuid AND a.run_id='$acceptanceRunId'::uuid AND g.expires_at > now();"
  $artifactBindingCapture = Invoke-DatabaseFactCapture -Id "artifact-grant-run-result-binding" -Query $artifactBindingQuery
  $captures += $artifactBindingCapture
  $artifactBinding = $artifactBindingCapture.stdout | ConvertFrom-Json
  if ([string]$artifactBinding.grant_id -cne $artifactGrantId -or [string]$artifactBinding.run_id -cne $acceptanceRunId -or $artifactBinding.state -cne "released" -or [string]$artifactBinding.file_sha256 -cne [string]$acceptance.artifact_sha256 -or [int64]$artifactBinding.byte_size -ne [int64]$acceptance.artifact_byte_size -or [string]::IsNullOrWhiteSpace([string]$artifactBinding.result_version) -or [datetimeoffset]$artifactBinding.run_created_at -le [datetimeoffset]$candidateReadyAt -or [datetimeoffset]$artifactBinding.artifact_created_at -le [datetimeoffset]$candidateReadyAt -or [string]$artifactBinding.subject_user_id -cne [string]$acceptance.oauth_subject_user_id) { throw "Downloaded PDF is not bound to the fresh OAuth subject, fresh run, released artifact version, stored hash, and stored size." }
  $captures += [ordered]@{ id = "eu-live-acceptance"; argv = @("node", $validator, "--origin", $publicCanaryOrigin, "--direct-service-url", $cloudRunOrigin, "--candidate-ready-at", $candidateReadyAt, "--candidate-revision", $candidateRevision); executable_sha256 = $validatorHash; stdout_sha256 = $acceptanceHash; stdout = $acceptanceRaw; cloud_run_service_uid = [string]$targetWeb.metadata.uid; cloud_run_generation = [string]$targetWeb.metadata.generation; cloud_run_revision = $candidateRevision; cloud_run_ready_at = $candidateReadyAt; cloud_run_url = $cloudRunOrigin; public_canary_origin = $publicCanaryOrigin }
  $logCapture = Invoke-ReadOnlyCapture -Id "eu-application-log" -Arguments @("logging", "read", "resource.labels.location=$targetRegion", "--project=$project", "--freshness=30m", "--limit=1", "--format=json(timestamp,resource.labels.location,logName)")
  $captures += $logCapture
  if ([string]::IsNullOrWhiteSpace($logCapture.stdout) -or $logCapture.stdout -ceq "[]") { throw "No recent europe-west2 application log was independently observed." }
  $maximumCostUsd = 0.0
  if ($acceptanceRunId -cnotmatch '^[0-9a-f-]{36}$' -or -not [double]::TryParse([string]$env:MATCHBASE_EVIDENCE_MAX_COST_USD, [ref]$maximumCostUsd) -or $maximumCostUsd -le 0) { throw "Closed run ID and positive cost cap are required for EU cost verification." }
  $costQuery = "SELECT json_build_object('amount',COALESCE(sum(amount),0),'events',count(*),'unclosed',count(*) FILTER (WHERE pricing_state IN ('unknown','unpriced') OR amount IS NULL),'non_usd',count(*) FILTER (WHERE currency_code IS DISTINCT FROM 'USD')) FROM cost_event WHERE run_id='$acceptanceRunId'::uuid;"
  $costCapture = Invoke-DatabaseFactCapture -Id "eu-run-cost" -Query $costQuery
  $captures += $costCapture
  $costFacts = $costCapture.stdout | ConvertFrom-Json
  $observedCostUsd = [double]$costFacts.amount
  if ([int]$costFacts.events -lt 1 -or [int]$costFacts.unclosed -ne 0 -or [int]$costFacts.non_usd -ne 0 -or $observedCostUsd -lt 0 -or $observedCostUsd -gt $maximumCostUsd) { throw "Observed EU run cost is absent, unclosed, non-USD, or exceeds the closed cap." }
  $acceptance.acceptance | Add-Member -NotePropertyName eu_log_routing -NotePropertyValue "PASS" -Force
  $acceptance.acceptance | Add-Member -NotePropertyName cost -NotePropertyValue "PASS" -Force
  $facts.acceptance = $acceptance.acceptance
  $facts.web_image_digest = [string]$targetWeb.spec.template.spec.containers[0].image
  $facts.worker_image_digest = [string]$targetWorker.spec.template.spec.containers[0].image
  $facts.route_policy_sha256 = [string](@($targetWeb.spec.template.spec.containers[0].env | Where-Object name -eq "MATCHBASE_ROUTE_POLICY_SHA256")[0].value)
  $facts.cloud_sql_instance = "matchbase-stg-pg18-ew2"
}

if ($Checkpoint -ceq "SourceRetirement") {
  $captures += Invoke-ReadOnlyCapture -Id "source-object-inventory" -Arguments @("storage", "ls", "gs://innobase-matchbase-stg-artifacts/**", "--all-versions", "--json")
  $captures += Invoke-ReadOnlyCapture -Id "target-object-inventory" -Arguments @("storage", "ls", "gs://innobase-matchbase-stg-eu-artifacts/**", "--all-versions", "--json")
  $psql = Get-Command psql -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $psql) { throw "SourceRetirement evidence requires psql for the read-only persisted artifact URI query." }
  if ([string]::IsNullOrWhiteSpace($env:MATCHBASE_EVIDENCE_DATABASE_URL)) { throw "SourceRetirement evidence requires MATCHBASE_EVIDENCE_DATABASE_URL; its value is never recorded." }
  $artifactQuery = "SELECT storage_uri FROM artifact_version WHERE storage_uri IS NOT NULL ORDER BY storage_uri;"
  $uriRaw = (& $psql.Source $env:MATCHBASE_EVIDENCE_DATABASE_URL --no-psqlrc --tuples-only --no-align --set=ON_ERROR_STOP=1 --command=$artifactQuery 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Persisted artifact URI query failed." }
  $uriHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($uriRaw))).ToLowerInvariant()
  $queryHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($artifactQuery))).ToLowerInvariant()
  $captures += [ordered]@{ id = "persisted-artifact-uris"; argv = @("psql", "<REDACTED_DATABASE_URL>", "--no-psqlrc", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", "--command=$artifactQuery"); stdout_sha256 = $uriHash; stdout = $uriRaw }
  $facts.persisted_artifact_uris = @($uriRaw -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  $facts.persisted_artifact_uri_query_sha256 = $queryHash
}

$ledgerBinding = $null
if ($Checkpoint -cne "Preflight" -and [string]::IsNullOrWhiteSpace($PredecessorLedgerUri)) { throw "Every non-Preflight checkpoint requires -PredecessorLedgerUri." }
if (-not [string]::IsNullOrWhiteSpace($PredecessorLedgerUri)) {
  if ($PredecessorLedgerUri -cnotmatch '^gs://innobase-matchbase-stg(?:-eu)?-artifacts/migration-governance/staging-region-migration-ledger\.v1\.json$') { throw "Predecessor ledger URI is outside the closed map." }
  $ledgerCapture = Invoke-ReadOnlyCapture -Id "predecessor-ledger-metadata" -Arguments @("storage", "objects", "describe", $PredecessorLedgerUri, "--format=json(name,generation,size,crc32c,md5Hash,updateTime)")
  $captures += $ledgerCapture
  $ledgerWork = Join-Path ([IO.Path]::GetTempPath()) "matchbase-evidence-ledger-$([guid]::NewGuid().ToString('N')).json"
  try {
    Invoke-Gcloud -Arguments @("storage", "cp", $PredecessorLedgerUri, $ledgerWork, "--quiet") | Out-Null
    $ledgerExactSha256 = (Get-FileHash -LiteralPath $ledgerWork -Algorithm SHA256).Hash.ToLowerInvariant()
    $ledgerContentRaw = Get-Content -LiteralPath $ledgerWork -Raw
  } finally { Remove-Item -LiteralPath $ledgerWork -Force -ErrorAction SilentlyContinue }
  $captures += [ordered]@{ id = "predecessor-ledger-content"; argv = @("gcloud", "storage", "cp", $PredecessorLedgerUri, "<EPHEMERAL_LOCAL_FILE>"); stdout_sha256 = $ledgerExactSha256; stdout = $ledgerContentRaw }
  $ledgerBinding = [ordered]@{ uri = $PredecessorLedgerUri; metadata_sha256 = $ledgerCapture.stdout_sha256; content_sha256 = $ledgerExactSha256 }
}

$gcloudVersion = (Invoke-Gcloud -Arguments @("version", "--format=json") | Out-String).Trim() | ConvertFrom-Json
$document = [ordered]@{
  schema_version = "matchbase-staging-region-checkpoint-evidence.v1"
  producer_schema_version = "matchbase-staging-region-evidence-producer.v1"
  checkpoint = $Checkpoint
  project_id = $project
  source_region = $sourceRegion
  target_region = $targetRegion
  outcome = "PASS"
  captured_at_utc = [DateTimeOffset]::UtcNow.ToString("o")
  principal = [ordered]@{ active_account = $account; active_project = $activeProject }
  tools = [ordered]@{ gcloud = [string]$gcloudVersion."Google Cloud SDK"; powershell = $PSVersionTable.PSVersion.ToString() }
  candidate = [ordered]@{ commit = $CandidateCommit; web_source_image_digest = $WebSourceImageDigest; worker_source_image_digest = $WorkerSourceImageDigest; web_build_provenance_sha256 = $webProvenance.stdout_sha256; worker_build_provenance_sha256 = $workerProvenance.stdout_sha256; web_provenance_binding = $webProvenanceBinding; worker_provenance_binding = $workerProvenanceBinding }
  predecessor_ledger = $ledgerBinding
  facts = $facts
  raw_results = $captures
  signing_key_version = $KmsKeyVersion
}
$json = $document | ConvertTo-Json -Depth 30
Set-Content -LiteralPath $OutputPath -Value $json -Encoding utf8NoBOM
$parts = $KmsKeyVersion -split "/"
$signaturePath = "$OutputPath.sig"
Invoke-Gcloud -Arguments @("kms", "asymmetric-sign", "--project=$project", "--location=$($parts[3])", "--keyring=$($parts[5])", "--key=$($parts[7])", "--version=$($parts[9])", "--digest-algorithm=sha256", "--input-file=$OutputPath", "--signature-file=$signaturePath") | Out-Null
Write-Output "Evidence: $OutputPath"
Write-Output "Signature: $signaturePath"
