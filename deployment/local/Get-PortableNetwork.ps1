# MB-UX-OPS-002 L07. Read-only adapter discovery. No secrets or network changes.
param([Parameter(Mandatory)][guid]$InterfaceGuid)
$ErrorActionPreference = 'Stop'
$adapter = @(Get-NetAdapter -Physical | Where-Object { [guid]$_.InterfaceGuid -eq $InterfaceGuid -and $_.Status -eq 'Up' })
$addresses = @()
if ($adapter.Count -eq 1) {
    $addresses = @(Get-NetIPAddress -InterfaceIndex $adapter[0].ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.AddressState -eq 'Preferred' -and -not $_.SkipAsSource } |
        ForEach-Object { $_.IPAddress })
}
@{ addresses = @($addresses) } | ConvertTo-Json -Compress
