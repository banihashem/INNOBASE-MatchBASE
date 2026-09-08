# MB-UX-OPS-002 L01. All secret values are supplied in memory to Compose secrets.
[CmdletBinding()]
param(
    [ValidateSet('Build', 'Up', 'Stop', 'Status', 'Backup')][string]$Action = 'Status',
    [ValidateRange(1024,65535)][int]$WebPort = 3000,
    [string[]]$Services = @('postgres', 'web', 'worker', 'dashboard')
)
$ErrorActionPreference = 'Stop'
$appRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
function Assert-NativeSuccess([string]$Operation) {
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed. No further operation was performed." }
}
function Get-LocalDatabaseContainer {
    $container = & docker ps -q --filter 'label=com.docker.compose.project=matchbase-local' --filter 'label=com.docker.compose.service=postgres'
    Assert-NativeSuccess 'Local database lookup'
    return $container
}
function Assert-LocalQueueIdle {
    $container = Get-LocalDatabaseContainer
    if (-not $container) { return }
    $schema = & docker exec --user postgres $container psql -U matchbase_test -d matchbase_slice1 -Atc "SELECT to_regclass('consultant_workflow_job') IS NOT NULL"
    Assert-NativeSuccess 'Queue schema lookup'
    if ($schema.Trim() -eq 'f') { return }
    $active = & docker exec --user postgres $container psql -U matchbase_test -d matchbase_slice1 -Atc "SELECT (SELECT count(*) FROM consultant_workflow_job WHERE status IN ('queued','running')) + (SELECT count(*) FROM consultant_workflow_session WHERE current_state='prep_step1_interpreting')"
    Assert-NativeSuccess 'Active research check'
    if ([int]$active.Trim() -ne 0) { throw 'Research is active. Stop it in Section 3 before restarting or stopping containers.' }
}
Push-Location $appRoot
try {
    if (@($Services | Where-Object { $_ -notin @('postgres','web','worker','dashboard') }).Count -gt 0) { throw 'Unknown local service.' }
    # Maintenance must remain available even when an inference credential is absent.
    if ($Action -eq 'Status') {
        & docker ps -a --filter 'label=com.docker.compose.project=matchbase-local' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
        Assert-NativeSuccess 'Local container status'
        return
    }
    if ($Action -eq 'Stop') {
        Assert-LocalQueueIdle
        foreach ($service in @('worker','web','dashboard','postgres') | Where-Object { $_ -in $Services }) {
            $container = & docker ps -q --filter 'label=com.docker.compose.project=matchbase-local' --filter "label=com.docker.compose.service=$service"
            Assert-NativeSuccess 'Local component lookup'
            if ($container) { & docker stop --time 120 $container; Assert-NativeSuccess 'Local component stop' }
        }
        return
    }
    if ($Action -eq 'Backup') {
        $container = Get-LocalDatabaseContainer
        if (-not $container) { throw 'Database must be running to create a backup.' }
        $backupRoot = Join-Path $env:LOCALAPPDATA 'MatchBASE/backups'
        New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
        $name = 'matchbase-local-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.dump'
        $destination = Join-Path $backupRoot $name
        & docker exec --user postgres $container pg_dump -U matchbase_test -d matchbase_slice1 -Fc -f /tmp/matchbase-backup.dump
        Assert-NativeSuccess 'Database backup'
        & docker cp "${container}:/tmp/matchbase-backup.dump" $destination
        Assert-NativeSuccess 'Backup export'
        $hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
        [System.IO.File]::WriteAllText("$destination.sha256", "$hash  $name`n")
        Write-Output "Backup saved: $destination"
        return
    }
    if ($Action -eq 'Build') {
        # Each build qualifies all database-dependent tests against disposable data.
        $unitContainer = 'matchbase-unit-' + [guid]::NewGuid().ToString('N')
        $previousDatabase = $env:DATABASE_URL
        $previousConsultantDatabase = $env:MATCHBASE_CONSULTANT_TEST_DATABASE_URL
        try {
            & docker run -d --name $unitContainer --label matchbase.role=unit-test --publish '127.0.0.1::5432' --tmpfs /var/lib/postgresql --env POSTGRES_HOST_AUTH_METHOD=trust postgres:18.1-bookworm@sha256:cc9f4143a8d2fa8cf3749d0cb4d26ecf2d53a77a2ac807e9ebd67ae22426221a | Out-Null
            Assert-NativeSuccess 'Disposable unit database creation'
            $ready = $false
            for ($attempt=0; $attempt -lt 60; $attempt++) {
                & docker exec $unitContainer pg_isready -U postgres 2>$null | Out-Null
                if ($LASTEXITCODE -eq 0) { $ready=$true; break }
                Start-Sleep -Milliseconds 500
            }
            if (-not $ready) { throw 'Disposable unit database did not become ready.' }
            $binding = & docker port $unitContainer 5432/tcp
            Assert-NativeSuccess 'Disposable database port lookup'
            if ($binding -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'Unit database is not bound to loopback.' }
            $env:DATABASE_URL = "postgresql://postgres@127.0.0.1:$($Matches[1])/postgres"
            $env:MATCHBASE_CONSULTANT_TEST_DATABASE_URL = $env:DATABASE_URL
            # Source is not sent to the application image builder before this succeeds.
            & pnpm run test:unit
            Assert-NativeSuccess 'Complete unit suite including real PostgreSQL tests'
        } finally {
            $env:DATABASE_URL = $previousDatabase
            $env:MATCHBASE_CONSULTANT_TEST_DATABASE_URL = $previousConsultantDatabase
            & docker rm -f $unitContainer | Out-Null
        }
        & docker build --file Dockerfile.local --target local-runtime --tag matchbase-local:current .
        Assert-NativeSuccess 'Docker image build and Linux unit gate'
        return
    }
    $runtime = @{}
    foreach ($name in @('MATCHBASE_DATABASE_URL', 'MATCHBASE_DIGEST_KEY', 'MATCHBASE_OPENROUTER_API_KEY', 'MATCHBASE_PROVIDER_GOOGLE', 'MATCHBASE_PROVIDER_OPENAI')) {
        $value = [Environment]::GetEnvironmentVariable($name, 'User')
        if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, 'Process') }
        if ($value) { $runtime[$name] = $value }
    }
    if (-not $runtime.MATCHBASE_DATABASE_URL -or -not $runtime.MATCHBASE_DIGEST_KEY -or -not $runtime.MATCHBASE_OPENROUTER_API_KEY) {
        throw 'Provision the database URL, digest key and OpenRouter key in the Windows User environment.'
    }
    $dbUri = [uri]$runtime.MATCHBASE_DATABASE_URL
    $parts = $dbUri.UserInfo.Split(':',2)
    if ($parts.Count -ne 2 -or $dbUri.AbsolutePath -ne '/matchbase_slice1') { throw 'Unexpected source database identity.' }
    $env:MATCHBASE_LOCAL_DATABASE_PASSWORD = [uri]::UnescapeDataString($parts[1])
    $runtime.MATCHBASE_DATABASE_URL = "postgresql://$($dbUri.UserInfo)@postgres:5432/matchbase_slice1"
    $runtime.DATABASE_URL = $runtime.MATCHBASE_DATABASE_URL
    $runtime.MATCHBASE_ENVIRONMENT = 'test'
    $runtime.MATCHBASE_OIDC_SIMULATOR = 'true'
    $runtime.MATCHBASE_SYNTHETIC_FIXTURE = 'true'
    $runtime.MATCHBASE_ORIGIN = "http://localhost:$WebPort"
    $env:MATCHBASE_LOCAL_RUNTIME_CONFIG = $runtime | ConvertTo-Json -Compress
    $env:MATCHBASE_LOCAL_WEB_PORT = [string]$WebPort
    Assert-LocalQueueIdle
    & docker compose -f compose.local.yaml up -d --no-build --wait --wait-timeout 180 @Services
    Assert-NativeSuccess 'Local Compose startup'
} finally {
    Remove-Item Env:MATCHBASE_LOCAL_RUNTIME_CONFIG -ErrorAction SilentlyContinue
    Remove-Item Env:MATCHBASE_LOCAL_DATABASE_PASSWORD -ErrorAction SilentlyContinue
    Pop-Location
}
