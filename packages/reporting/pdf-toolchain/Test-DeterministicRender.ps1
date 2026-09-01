param(
  [string]$Image = "matchbase-pdf-runtime-adapter:blankfix",
  [string]$EvidenceRoot = "C:\INNOBASE\MatchBASE\tmp\pdfs\determinism"
)
$ErrorActionPreference = "Stop"
$resolvedRoot = [IO.Path]::GetFullPath($EvidenceRoot)
$allowedRoot = [IO.Path]::GetFullPath("C:\INNOBASE\MatchBASE\tmp\pdfs\determinism")
if (-not $resolvedRoot.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Evidence path is outside the deterministic-render evidence root."
}
$runRoot = Join-Path $resolvedRoot ([DateTimeOffset]::UtcNow.ToString("yyyyMMddTHHmmssfffZ"))
$first = Join-Path $runRoot "render-1"
$second = Join-Path $runRoot "render-2"
New-Item -ItemType Directory -Force -Path $first, $second | Out-Null
$source = Join-Path $PSScriptRoot "smoke.html"
Copy-Item -LiteralPath $source -Destination (Join-Path $first "model.html")
Copy-Item -LiteralPath $source -Destination (Join-Path $second "model.html")

foreach ($directory in @($first, $second)) {
  & docker run --rm --user 10001:10001 -e XDG_CACHE_HOME=/tmp -v "${directory}:/work" $Image `
    /opt/matchbase/pdf-venv/bin/weasyprint `
    --pdf-tags --pdf-variant pdf/ua-1 --allowed-protocols file,data `
    --no-http-redirects --fail-on-http-errors `
    --base-url file:///opt/matchbase/report-assets/ `
    --stylesheet /opt/matchbase/report-assets/report.css `
    --stylesheet /opt/matchbase/report-assets/a4.css `
    /work/model.html /work/model.pdf
  if ($LASTEXITCODE -ne 0) { throw "Isolated PDF render failed." }
}

$firstPdf = Join-Path $first "model.pdf"
$secondPdf = Join-Path $second "model.pdf"
$firstHash = (Get-FileHash -LiteralPath $firstPdf -Algorithm SHA256).Hash.ToLowerInvariant()
$secondHash = (Get-FileHash -LiteralPath $secondPdf -Algorithm SHA256).Hash.ToLowerInvariant()
$firstBytes = [IO.File]::ReadAllBytes($firstPdf)
$secondBytes = [IO.File]::ReadAllBytes($secondPdf)
$byteEqual = [Convert]::ToBase64String($firstBytes) -ceq [Convert]::ToBase64String($secondBytes)
if ($firstHash -cne $secondHash -or -not $byteEqual) {
  throw "Same-model isolated renders are not byte-for-byte deterministic."
}
[pscustomobject]@{
  schema_version = "matchbase-pdf-determinism-evidence.v1"
  image = $Image
  sha256 = $firstHash
  byte_size = $firstBytes.Length
  byte_equal = $true
  render_count = 2
  evidence_root = $runRoot
} | ConvertTo-Json -Depth 3
