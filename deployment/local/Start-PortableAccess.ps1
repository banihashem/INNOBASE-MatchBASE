# MB-UX-OPS-002 L07. The logon task receives no runtime/provider credentials.
param([Parameter(Mandatory)][string]$NodePath, [Parameter(Mandatory)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$instance = $null
$ownsInstance = $false
function Write-PortableStartupStatus([string]$Stage, [Nullable[int]]$ExitCode, [string]$ExceptionType) {
    try {
        @{ stage = $Stage; processId = $PID; exitCode = $ExitCode; exceptionType = $ExceptionType; updatedAt = [DateTime]::UtcNow.ToString('o') } |
            ConvertTo-Json -Compress | Set-Content -LiteralPath "$ConfigPath.startup.json" -Encoding ascii
    } catch { }
}
try {
    Write-PortableStartupStatus 'wrapper-started' $null $null
    if (-not [System.IO.Path]::IsPathRooted($NodePath) -or -not [System.IO.Path]::IsPathRooted($ConfigPath) -or
        -not (Test-Path -LiteralPath $NodePath -PathType Leaf) -or -not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        throw [System.IO.FileNotFoundException]::new('Portable access startup paths are invalid.')
    }
    Set-Location -LiteralPath $PSScriptRoot
    $configBytes = [Text.Encoding]::UTF8.GetBytes([System.IO.Path]::GetFullPath($ConfigPath).ToLowerInvariant())
    $digest = [Security.Cryptography.SHA256]::Create()
    try { $instanceKey = [BitConverter]::ToString($digest.ComputeHash($configBytes)).Replace('-', '') } finally { $digest.Dispose() }
    $instance = [Threading.Mutex]::new($false, ('Local\MatchBASE-PortableAccess-' + $instanceKey))
    try { $ownsInstance = $instance.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsInstance = $true }
    if (-not $ownsInstance) { Write-PortableStartupStatus 'supervisor-already-running' 0 $null; exit 0 }
    Get-ChildItem Env: | Where-Object { $_.Name -notmatch '^(PATH|PATHEXT|SYSTEMROOT|WINDIR|PROGRAMFILES|PROGRAMFILES\(X86\)|TEMP|TMP|LOCALAPPDATA|USERPROFILE)$' } |
        ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
    Write-PortableStartupStatus 'supervisor-starting' $null $null
    & $NodePath (Join-Path $PSScriptRoot 'portable-access.mjs') $ConfigPath
    $childExit = $LASTEXITCODE
    Write-PortableStartupStatus 'supervisor-exited' $childExit $null
    exit $childExit
} catch {
    Write-PortableStartupStatus 'wrapper-failed' 1 $_.Exception.GetType().FullName
    exit 1
} finally {
    if ($ownsInstance) { $instance.ReleaseMutex() }
    if ($null -ne $instance) { $instance.Dispose() }
}
