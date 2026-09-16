# MB-UX-OPS-002 L02. All secret values are supplied in memory to Compose secrets.
[CmdletBinding()]
param(
    [ValidateSet('Build', 'Up', 'Stop', 'Status', 'Backup', 'InstallPortableAccess', 'RemovePortableAccess', 'AccessStatus')][string]$Action = 'Status',
    [ValidateRange(1024,65535)][int]$WebPort = 3000,
    [string]$LanAddress = '',
    [string]$InterfaceAlias = '',
    [ValidateSet('ScheduledTask', 'StartupShortcut')][string]$AccessStartupMode = 'ScheduledTask',
    [string[]]$Services = @('postgres', 'migrate', 'web', 'worker', 'dashboard')
)
$ErrorActionPreference = 'Stop'
$appRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $PSScriptRoot 'LocalRuntimeEnvironment.ps1')
function Assert-NativeSuccess([string]$Operation) {
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed. No further operation was performed." }
}
function Resolve-PortableNodePath {
    param([Parameter(Mandatory)][object[]]$Commands)
    $selected = @($Commands | Select-Object -First 1)
    if ($selected.Count -ne 1 -or $selected[0].Source -isnot [string] -or
        -not [System.IO.Path]::IsPathRooted($selected[0].Source)) {
        throw 'Portable access requires one absolute Node executable path.'
    }
    $path = [System.IO.Path]::GetFullPath($selected[0].Source)
    if ([System.IO.Path]::GetFileName($path) -ine 'node.exe' -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw 'Portable access Node executable is missing or invalid.'
    }
    return $path
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
    if (@($Services | Where-Object { $_ -notin @('postgres','migrate','web','worker','dashboard') }).Count -gt 0) { throw 'Unknown local service.' }
    # MB-UX-OPS-002 L07: transport maintenance never reads application credentials.
    $accessRoot = Join-Path $env:LOCALAPPDATA 'MatchBASE/access'
    $accessConfig = Join-Path $accessRoot 'portable-access.json'
    $accessTask = 'MatchBASE-PortableAccess-' + [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $accessShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'MatchBASE Portable Access.lnk'
    if ($Action -eq 'AccessStatus') {
        Write-Output "Permanent host URL: http://localhost:$WebPort"
        if (Test-Path -LiteralPath "$accessConfig.status.json") { Get-Content -LiteralPath "$accessConfig.status.json" }
        if (Test-Path -LiteralPath "$accessConfig.startup.json") { Get-Content -LiteralPath "$accessConfig.startup.json" }
        Get-ScheduledTask -TaskName $accessTask -ErrorAction SilentlyContinue | Select-Object TaskName, State
        Write-Output "Current-user startup shortcut installed: $(Test-Path -LiteralPath $accessShortcut)"
        return
    }
    if ($Action -eq 'RemovePortableAccess') {
        $existing = Get-ScheduledTask -TaskName $accessTask -ErrorAction SilentlyContinue
        if ($existing) { Stop-ScheduledTask -TaskName $accessTask; Unregister-ScheduledTask -TaskName $accessTask -Confirm:$false }
        if (Test-Path -LiteralPath $accessShortcut) { Remove-Item -LiteralPath $accessShortcut }
        # Shortcut mode has no task-owned process tree. Stop only the exact wrapper
        # configured by this launcher and its direct, exact Node supervisor child.
        $wrapperPath = Join-Path $PSScriptRoot 'Start-PortableAccess.ps1'
        $wrappers = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -like ('*"' + $wrapperPath + '"*') -and $_.CommandLine -like ('*"' + $accessConfig + '"*') })
        foreach ($wrapperProcess in $wrappers) {
            $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($wrapperProcess.ProcessId)" | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like ('*' + (Join-Path $PSScriptRoot 'portable-access.mjs') + '*') -and $_.CommandLine -like ('*' + $accessConfig + '*') })
            foreach ($child in $children) { Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue }
            Stop-Process -Id $wrapperProcess.ProcessId -ErrorAction SilentlyContinue
        }
        foreach ($path in @($accessConfig, "$accessConfig.status.json", "$accessConfig.status.json.tmp", "$accessConfig.startup.json")) {
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
        }
        Write-Output "LAN access removed. Host access remains http://localhost:$WebPort"
        return
    }
    if ($Action -eq 'InstallPortableAccess') {
        if (-not $InterfaceAlias) { throw 'Select the physical adapter explicitly with -InterfaceAlias (for example Wi-Fi).' }
        $adapter = @(Get-NetAdapter -Physical | Where-Object { $_.Name -eq $InterfaceAlias })
        if ($adapter.Count -ne 1) { throw 'Select exactly one physical network adapter. VPN and virtual adapters are not supported.' }
        $nodePath = Resolve-PortableNodePath -Commands @(Get-Command node.exe -CommandType Application -ErrorAction Stop)
        New-Item -ItemType Directory -Path $accessRoot -Force | Out-Null
        $existing = Get-ScheduledTask -TaskName $accessTask -ErrorAction SilentlyContinue
        if ($existing) { Stop-ScheduledTask -TaskName $accessTask }
        @{ version = 1; interfaceGuid = ([guid]$adapter[0].InterfaceGuid).ToString(); port = $WebPort } | ConvertTo-Json -Compress | Set-Content -LiteralPath $accessConfig -Encoding ascii
        $account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $wrapper = Join-Path $PSScriptRoot 'Start-PortableAccess.ps1'
        $arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File "' + $wrapper + '" -NodePath "' + $nodePath + '" -ConfigPath "' + $accessConfig + '"'
        if ($AccessStartupMode -eq 'StartupShortcut') {
            if ($existing) { Unregister-ScheduledTask -TaskName $accessTask -Confirm:$false }
            $shortcutDirectory = [Environment]::GetFolderPath('Startup')
            New-Item -ItemType Directory -Path $shortcutDirectory -Force | Out-Null
            $shell = New-Object -ComObject WScript.Shell
            $shortcut = $shell.CreateShortcut($accessShortcut)
            $shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
            $shortcut.Arguments = $arguments
            $shortcut.WorkingDirectory = $appRoot
            $shortcut.WindowStyle = 7
            $shortcut.Description = 'MatchBASE current-user portable LAN access. No application credentials.'
            $shortcut.Save()
            $started = Start-Process -FilePath $shortcut.TargetPath -ArgumentList $arguments -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru
            Write-Output "Portable access configured in current-user Startup. Wrapper process: $($started.Id). Permanent host URL: http://localhost:$WebPort"
            Write-Output 'This workstation fallback does not require Task Scheduler. Check AccessStatus and actual HTTP reachability; reboot qualification remains separate.'
            return
        }
        if (Test-Path -LiteralPath $accessShortcut) { Remove-Item -LiteralPath $accessShortcut }
        $taskAction = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $arguments -WorkingDirectory $appRoot
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
        $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
        Register-ScheduledTask -TaskName $accessTask -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description 'MatchBASE local simulator LAN gateway for the explicitly selected physical adapter. No research or provider credentials.' -Force | Out-Null
        Start-ScheduledTask -TaskName $accessTask
        Write-Output "Portable access enabled for $InterfaceAlias. Permanent host URL: http://localhost:$WebPort"
        Write-Output 'LAN access follows this physical adapter only. It requires a trusted LAN and the existing scoped firewall policy. No firewall policy was changed.'
        return
    }
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
        $testEnvironmentNames = Get-LocalTestEnvironmentNames -ExistingNames @(Get-ChildItem Env: | ForEach-Object { $_.Name })
        $previousTestEnvironment = @{}
        foreach ($testEnvironmentName in ($testEnvironmentNames | Select-Object -Unique)) {
            $previousTestEnvironment[$testEnvironmentName] = [Environment]::GetEnvironmentVariable($testEnvironmentName, 'Process')
            [Environment]::SetEnvironmentVariable($testEnvironmentName, $null, 'Process')
        }
        try {
            & docker run -d --name $unitContainer --label matchbase.role=unit-test --publish '127.0.0.1::5432' --tmpfs /var/lib/postgresql --env POSTGRES_HOST_AUTH_METHOD=trust --env POSTGRES_DB=matchbase_test postgres:18.1-bookworm@sha256:cc9f4143a8d2fa8cf3749d0cb4d26ecf2d53a77a2ac807e9ebd67ae22426221a | Out-Null
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
            $env:DATABASE_URL = "postgresql://postgres@127.0.0.1:$($Matches[1])/matchbase_test"
            $env:MATCHBASE_DATABASE_URL = $env:DATABASE_URL
            $env:MATCHBASE_CONSULTANT_TEST_DATABASE_URL = $env:DATABASE_URL
            $env:MATCHBASE_DISPOSABLE_TEST_DATABASE_URL = $env:DATABASE_URL
            $env:MATCHBASE_TEST_DATABASE_GUARD = 'required'
            # Source is not sent to the application image builder before this succeeds.
            & pnpm run test:unit
            Assert-NativeSuccess 'Complete unit suite including real PostgreSQL tests'
        } finally {
            foreach ($testEnvironmentName in $previousTestEnvironment.Keys) {
                [Environment]::SetEnvironmentVariable($testEnvironmentName, $previousTestEnvironment[$testEnvironmentName], 'Process')
            }
            & docker rm -f $unitContainer | Out-Null
        }
        & docker build --file Dockerfile.local --target local-runtime --tag matchbase-local:current .
        Assert-NativeSuccess 'Docker image build and Linux unit gate'
        return
    }
    # Permanent loopback survives DHCP/network changes without container recreation.
    if ($LanAddress) {
        throw 'Fixed LAN bindings are retired. Use Up without LanAddress, then InstallPortableAccess with an explicit physical InterfaceAlias.'
    }
    $runtime = Get-LocalRuntimeEnvironment
    if (-not $runtime.MATCHBASE_DATABASE_URL -or -not $runtime.MATCHBASE_DIGEST_KEY -or -not $runtime.MATCHBASE_OPENROUTER_API_KEY) {
        throw 'Provision the database URL, digest key and OpenRouter key in the Windows User environment.'
    }
    $dbUri = [uri]$runtime.MATCHBASE_DATABASE_URL
    $parts = $dbUri.UserInfo.Split(':',2)
    if ($parts.Count -ne 2 -or $dbUri.AbsolutePath -ne '/matchbase_slice1') { throw 'Unexpected source database identity.' }
    $env:MATCHBASE_LOCAL_DATABASE_PASSWORD = [uri]::UnescapeDataString($parts[1])
    $runtime.MATCHBASE_DATABASE_URL = "postgresql://$($dbUri.UserInfo)@postgres:5432/matchbase_slice1"
    $runtime.DATABASE_URL = $runtime.MATCHBASE_DATABASE_URL
    if ($runtime.MATCHBASE_PUBLIC_READER_DATABASE_URL) {
        $publicReaderUri = [uri]$runtime.MATCHBASE_PUBLIC_READER_DATABASE_URL
        if ($publicReaderUri.AbsolutePath -ne '/matchbase_slice1') { throw 'Unexpected public reader database identity.' }
        $runtime.MATCHBASE_PUBLIC_READER_DATABASE_URL = "postgresql://$($publicReaderUri.UserInfo)@postgres:5432/matchbase_slice1"
    }
    $runtime.MATCHBASE_ENVIRONMENT = 'test'
    $runtime.MATCHBASE_OIDC_SIMULATOR = 'true'
    $runtime.MATCHBASE_SYNTHETIC_FIXTURE = 'true'
    $runtime.MATCHBASE_ORIGIN = "http://localhost:$WebPort"
    $env:MATCHBASE_LOCAL_RUNTIME_CONFIG = $runtime | ConvertTo-Json -Compress
    $env:MATCHBASE_LOCAL_WEB_PORT = [string]$WebPort
    Assert-LocalQueueIdle
    & docker compose -f compose.local.yaml up -d --no-build --wait --wait-timeout 180 @Services
    Assert-NativeSuccess 'Local Compose startup'
    [Environment]::SetEnvironmentVariable('MATCHBASE_LOCAL_LAN_ADDRESS', $null, 'User')
    Write-Output "Application URL: $($runtime.MATCHBASE_ORIGIN)"
} finally {
    Remove-Item Env:MATCHBASE_LOCAL_RUNTIME_CONFIG -ErrorAction SilentlyContinue
    Remove-Item Env:MATCHBASE_LOCAL_DATABASE_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:MATCHBASE_LOCAL_WEB_BIND_ADDRESS -ErrorAction SilentlyContinue
    Remove-Item Env:MATCHBASE_LOCAL_WEB_PORT -ErrorAction SilentlyContinue
    Pop-Location
}
