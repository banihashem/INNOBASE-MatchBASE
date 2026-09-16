param([ValidateSet('Acquire', 'Start', 'Status', 'Stop')][string]$Action = 'Status')
$ErrorActionPreference = 'Stop'
$mbModelRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$mbModelCompose = Join-Path $mbModelRoot 'compose.local-model.yaml'
$mbModelLock = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'artifact-lock.json') -Raw | ConvertFrom-Json
$mbModelVolume = 'matchbase-local-model-artifacts-v1'

function Invoke-CheckedDocker {
    param([string[]]$Arguments)
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Local-model Docker operation failed ($LASTEXITCODE)." }
}

function Test-PinnedArtifact {
    $mbVerifyScript = 'set -eu; echo "' + $mbModelLock.model_manifest_sha256 + '  /models/manifests/registry.ollama.ai/library/qwen3.5/4b" | sha256sum -c -'
    foreach ($mbBlobHash in $mbModelLock.artifact_blobs_sha256) {
        if ($mbBlobHash -notmatch '^[a-f0-9]{64}$') { throw 'Malformed locked artifact digest.' }
        $mbVerifyScript += '; echo "' + $mbBlobHash + '  /models/blobs/sha256-' + $mbBlobHash + '" | sha256sum -c -'
    }
    Invoke-CheckedDocker -Arguments @('run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--mount', "type=volume,source=$mbModelVolume,target=/models,readonly", '--entrypoint', '/bin/bash', $mbModelLock.image, '-c', $mbVerifyScript)
}

switch ($Action) {
    'Acquire' {
        # Acquisition has public registry egress, no GPU, no inference input and no host port.
        # Inference is a separate read-only service on an internal network.
        $mbActiveInference = & docker ps --filter 'label=com.docker.compose.project=matchbase-local-model' --format '{{.ID}}'
        if ($LASTEXITCODE -ne 0) { throw 'Cannot establish isolated inference state.' }
        if ($mbActiveInference) { throw 'Stop the isolated inference service before changing artifact storage.' }
        Invoke-CheckedDocker -Arguments @('pull', '--platform', $mbModelLock.platform, $mbModelLock.image)
        Invoke-CheckedDocker -Arguments @('volume', 'create', '--label', 'matchbase.role=local-model-artifacts', $mbModelVolume)
        $mbAcquireScript = 'set -eu; ollama serve >/tmp/ollama-acquire.log 2>&1 & pid=$!; trap "kill $pid 2>/dev/null || true" EXIT; ready=0; for i in $(seq 1 30); do if ollama list >/dev/null 2>&1; then ready=1; break; fi; sleep 1; done; test "$ready" = 1; if ! timeout 900s ollama pull qwen3.5:4b >/tmp/ollama-pull.log 2>&1; then tail -c 2000 /tmp/ollama-pull.log; exit 1; fi; chmod -R a+rX /models'
        Invoke-CheckedDocker -Arguments @('run', '--rm', '--name', 'matchbase-local-model-acquire', '--label', 'matchbase.role=local-model-acquisition', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--cpus', '2', '--memory', '2g', '--pids-limit', '128', '--tmpfs', '/tmp:rw,nosuid,size=268435456,mode=1777', '--mount', "type=volume,source=$mbModelVolume,target=/models", '-e', 'HOME=/tmp', '-e', 'OLLAMA_MODELS=/models', '-e', 'OLLAMA_NO_CLOUD=1', '--entrypoint', '/bin/bash', $mbModelLock.image, '-c', $mbAcquireScript)
        # Verify the exact artifact before permitting runtime use; a moving registry tag fails closed.
        Test-PinnedArtifact
    }
    'Start' {
        Test-PinnedArtifact
        Invoke-CheckedDocker -Arguments @('compose', '-f', $mbModelCompose, '--profile', 'qualification', 'up', '-d', '--wait')
    }
    'Status' {
        Invoke-CheckedDocker -Arguments @('compose', '-f', $mbModelCompose, '--profile', 'qualification', 'ps')
    }
    'Stop' {
        # Preserve the separately acquired model artifact volume.
        Invoke-CheckedDocker -Arguments @('compose', '-f', $mbModelCompose, '--profile', 'qualification', 'down')
    }
}

