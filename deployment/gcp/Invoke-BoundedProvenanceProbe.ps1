function Invoke-BoundedProvenanceProbe {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][scriptblock]$Attempt,
    [scriptblock]$Delay = { param([int]$Seconds) Start-Sleep -Seconds $Seconds }
  )

  foreach ($probe in 0..15) {
    $result = & $Attempt ($probe + 1)
    if ($null -ne $result) { return $result }
    if ($probe -lt 15) { & $Delay 3 }
  }
  throw "Governed provenance did not become valid within the deterministic 45-second window (16 probes)."
}
