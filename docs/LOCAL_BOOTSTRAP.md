# Local bootstrap

## Prerequisites

- Windows 11 with PowerShell; Slice 0 source-root policy is intentionally Windows-specific
- Git 2.55 or newer
- Node.js 24.14 or newer
- pnpm 11.19.0
- Google Chrome Stable available to Playwright as the `chrome` channel
- TCP port `4317` free during the real-browser test
- The governed workspace mounted at `C:\INNOBASE\MatchBASE`

## Deterministic setup

```powershell
git clone 'https://github.com/banihashem/INNOBASE-MatchBASE.git'
Set-Location 'INNOBASE-MatchBASE'
corepack enable
pnpm install --frozen-lockfile
pnpm test:ci
```

Create no local credential file for Slice 0. The dashboard is local and read-only. The artifact indexer accepts only these evidence roots:

- `C:\INNOBASE\MatchBASE\00_Authoritative_Sources`
- `C:\INNOBASE\MatchBASE\01_Product_Management`
- `C:\INNOBASE\MatchBASE\02_Product_Research_and_Planning`
- `C:\INNOBASE\MatchBASE\03_Implementation\INNOBASE-MatchBASE\governance`

Generated snapshots are sanitized derivatives and are ignored by Git. Never copy the evidence roots into the repository.

Chrome, the fixed workspace root, or port `4317` being unavailable is a blocking prerequisite failure. Do not skip the browser test or rewrite source roots to obtain a pass. Follow `LOCAL_OPERATIONS_RUNBOOK.md` for bounded diagnosis and recovery.

## Failure policy

Any formatting, schema, type, unit, accessibility, secret, protected-file, dependency, build, or provenance failure blocks the slice. Unknown external state stays unknown.
