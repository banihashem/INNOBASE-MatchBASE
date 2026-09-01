function Invoke-GcloudStdout {
  param(
    [Parameter(Mandatory)][string[]]$Arguments,
    [string]$Executable = "gcloud",
    [ValidateRange(256, 16384)][int]$MaximumDiagnosticCharacters = 4096
  )
  $stdoutPath = Join-Path ([IO.Path]::GetTempPath()) "matchbase-gcloud-stdout-$([guid]::NewGuid().ToString('N')).txt"
  $stderrPath = Join-Path ([IO.Path]::GetTempPath()) "matchbase-gcloud-stderr-$([guid]::NewGuid().ToString('N')).txt"
  try {
    & $Executable @Arguments 1> $stdoutPath 2> $stderrPath
    $exitCode = $LASTEXITCODE
    $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { "" }
    if ($exitCode -ne 0) {
      $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }
      $diagnostic = $stderr.Trim()
      if ($diagnostic.Length -gt $MaximumDiagnosticCharacters) { $diagnostic = $diagnostic.Substring(0, $MaximumDiagnosticCharacters) + "…" }
      throw "gcloud failed ($exitCode): $($Arguments -join ' ')`n$diagnostic"
    }
    return $stdout.Trim()
  } finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
}
