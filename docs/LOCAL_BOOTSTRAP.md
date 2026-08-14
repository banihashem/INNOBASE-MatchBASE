# Local bootstrap for Slice 0 and Slice 1

## Prerequisites

- Windows 11 with PowerShell; Slice 0 source-root policy is intentionally Windows-specific
- Git 2.55 or newer
- Node.js 24.14 or newer
- pnpm 11.19.0
- Google Chrome Stable available to Playwright as the `chrome` channel
- Docker with Compose support and the exact PostgreSQL 18 image digest declared in `compose.yaml`
- TCP ports `3010`, `3011`, `4317`, and `55432` free during full verification
- The governed workspace mounted at `C:\INNOBASE\MatchBASE`

## Deterministic setup

```powershell
git clone 'https://github.com/banihashem/INNOBASE-MatchBASE.git'
Set-Location 'INNOBASE-MatchBASE'
corepack enable
pnpm install --frozen-lockfile
$env:MATCHBASE_TEST_DATABASE_PASSWORD='local-synthetic-db-only'
$env:DATABASE_URL = ('postgresql://{0}:{1}@127.0.0.1:55432/matchbase_slice1' -f 'matchbase_test', 'local-synthetic-db-only')
$env:MATCHBASE_DATABASE_URL=$env:DATABASE_URL
$env:MATCHBASE_ENVIRONMENT='test'
$env:MATCHBASE_OIDC_SIMULATOR='true'
$env:MATCHBASE_SYNTHETIC_FIXTURE='true'
$env:MATCHBASE_ORIGIN='http://127.0.0.1:3010'
$env:MATCHBASE_DIGEST_KEY='local-synthetic-digest-key-32-bytes-minimum'
docker compose up -d postgres
pnpm --filter @matchbase/data build
pnpm --filter @matchbase/data migrate
pnpm --filter @matchbase/data seed:local
pnpm test:ci
```

The exact one-command equivalent is:

```powershell
pnpm slice1:validate:local
```

It sets only the documented synthetic local environment and performs the
frozen install, PostgreSQL startup, migration, seed, and full gate in order.

The packaged product server requires `127.0.0.1:3010`; the synthetic worker readiness server requires `127.0.0.1:3011`. Both ports are fixed and startup must fail when either is unavailable.

Create no local credential file. The displayed values are synthetic local test material, not reusable credentials. The product path uses only the explicit non-production OIDC simulator and fixture provider. The dashboard is local and read-only. The artifact indexer accepts only these evidence roots:

- `C:\INNOBASE\MatchBASE\00_Authoritative_Sources`
- `C:\INNOBASE\MatchBASE\01_Product_Management`
- `C:\INNOBASE\MatchBASE\02_Product_Research_and_Planning`
- `C:\INNOBASE\MatchBASE\03_Implementation\INNOBASE-MatchBASE\governance`

Generated snapshots are sanitized derivatives and are ignored by Git. Never copy the evidence roots into the repository.

Chrome, Docker, PostgreSQL 18, the fixed workspace root, or a required port being unavailable is a blocking prerequisite failure. Do not skip the browser/database tests or rewrite source roots to obtain a pass. Follow `LOCAL_OPERATIONS_RUNBOOK.md` for bounded diagnosis and recovery.

## Failure policy

Any formatting, schema, type, unit, accessibility, secret, protected-file, dependency, build, or provenance failure blocks the slice. Unknown external state stays unknown.
