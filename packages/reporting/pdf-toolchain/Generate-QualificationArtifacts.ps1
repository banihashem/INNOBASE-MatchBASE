param(
  [string]$Image = "matchbase-pdf-runtime-adapter:blankfix",
  [string]$OutputDirectory = "C:\INNOBASE\MatchBASE\tmp\pdfs\qualification\current"
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$fixturePath = Join-Path $repo "packages\reporting\test\fixtures\pdf-qualification.v1.json"
$resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory)
$allowedRoot = [IO.Path]::GetFullPath("C:\INNOBASE\MatchBASE\tmp\pdfs\qualification")
if (-not $resolvedOutput.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Output path is outside the qualification evidence root." }
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
$fixtures = (Get-Content $fixturePath -Raw | ConvertFrom-Json).fixtures
foreach ($fixture in $fixtures) {
  $repeat = if ($fixture.id -eq "malicious-long-content") { 120 } else { 1 }
  $paragraphs = for ($index = 0; $index -lt $repeat; $index += 1) { "<p>$([Net.WebUtility]::HtmlEncode($fixture.paragraph))</p>" }
  $safeTitle = [Net.WebUtility]::HtmlEncode($fixture.title)
  $html = "<!doctype html><html lang=`"en`"><head><meta charset=`"utf-8`"><title>$safeTitle</title></head><body><div class=`"running-header`" aria-hidden=`"true`">MATCHBASE&nbsp; / &nbsp;CONSULTANT REPORT</div><div class=`"running-footer`" aria-hidden=`"true`">$safeTitle</div><main><h1>$safeTitle</h1><section><h2>$([Net.WebUtility]::HtmlEncode($fixture.heading))</h2>$($paragraphs -join '')</section></main></body></html>"
  [IO.File]::WriteAllText((Join-Path $resolvedOutput "$($fixture.id).html"), $html, [Text.UTF8Encoding]::new($false))
  foreach ($geometry in @("a4", "letter")) {
    & docker run --rm --user 10001:10001 -e XDG_CACHE_HOME=/tmp -v "${resolvedOutput}:/work" $Image /opt/matchbase/pdf-venv/bin/weasyprint --pdf-tags --pdf-variant pdf/ua-1 --allowed-protocols file,data --no-http-redirects --fail-on-http-errors --base-url file:///opt/matchbase/report-assets/ --stylesheet /opt/matchbase/report-assets/report.css --stylesheet "/opt/matchbase/report-assets/$geometry.css" "/work/$($fixture.id).html" "/work/$($fixture.id)-$geometry.pdf"
    if ($LASTEXITCODE -ne 0) { throw "Render failed for $($fixture.id) $geometry." }
    & pdftoppm -png -r 80 (Join-Path $resolvedOutput "$($fixture.id)-$geometry.pdf") (Join-Path $resolvedOutput "$($fixture.id)-$geometry-page") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "PNG render failed for $($fixture.id) $geometry." }
  }
}
