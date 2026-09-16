param(
    [ValidateSet('qwen', 'gemma', 'none')][string]$Model = 'none',
    [ValidateSet('development', 'calibration')][string]$Split = 'development'
)
$ErrorActionPreference = 'Stop'
$mbQualificationLock = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'artifact-lock.json') -Raw | ConvertFrom-Json
$mbQualificationOutput = Join-Path $env:LOCALAPPDATA 'MatchBASE\local-model-qualification'
New-Item -ItemType Directory -Path $mbQualificationOutput -Force | Out-Null
$mbResultName = "${Model}-${Split}-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmss'))-$([Guid]::NewGuid().ToString('N')).json"
$mbResultPath = Join-Path $mbQualificationOutput $mbResultName

if ($Model -eq 'qwen') {
    # The client shares only the isolated model network namespace. No host model port exists.
    $mbContainer = (& docker inspect matchbase-local-model-ollama-1 | ConvertFrom-Json)[0]
    if ($LASTEXITCODE -ne 0 -or $mbContainer.Config.Labels.'com.docker.compose.project' -ne 'matchbase-local-model' -or -not $mbContainer.State.Running) { throw 'Qualified isolated model service is not running.' }
    if ($mbContainer.Config.Image -ne $mbQualificationLock.image) { throw 'Isolated runtime image does not match the artifact lock.' }
    $mbNetwork = (& docker network inspect matchbase-local-model_inference | ConvertFrom-Json)[0]
    if ($LASTEXITCODE -ne 0 -or -not $mbNetwork.Internal -or $mbContainer.HostConfig.NetworkMode -ne 'matchbase-local-model_inference') { throw 'Inference network is not isolated.' }
    if (-not $mbContainer.HostConfig.ReadonlyRootfs -or $mbContainer.HostConfig.Privileged -or $mbContainer.Config.User -ne '1000:1000' -or $mbContainer.HostConfig.PortBindings.PSObject.Properties.Count -gt 0) { throw 'Inference runtime boundary changed.' }
    if ($mbContainer.Mounts.Count -ne 1 -or $mbContainer.Mounts[0].Name -ne 'matchbase-local-model-artifacts-v1' -or $mbContainer.Mounts[0].RW) { throw 'Unexpected writable or product mount on inference runtime.' }
    & docker run --rm --network container:matchbase-local-model-ollama-1 --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges --memory 256m --cpus 1 --pids-limit 64 --mount "type=bind,source=$PSScriptRoot,target=/runner/deployment/local-model,readonly" --mount "type=bind,source=$mbQualificationOutput,target=/results" $mbQualificationLock.qualification_runner_image node /runner/deployment/local-model/qualification.mjs "--model=$Model" "--split=$Split" "--output=/results/$mbResultName"
} else {
    & node (Join-Path $PSScriptRoot 'qualification.mjs') "--model=$Model" "--split=$Split" "--output=$mbResultPath"
}
if ($LASTEXITCODE -ne 0) { throw "Local qualification failed ($LASTEXITCODE); no product activation occurred." }
Write-Output "Qualification result: $mbResultPath"
