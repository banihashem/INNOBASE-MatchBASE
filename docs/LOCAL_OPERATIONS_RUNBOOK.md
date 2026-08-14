# Slice 0 and Slice 1 local operations runbook

## Operating boundary

Slice 1 runs only on the local Windows workspace and hosted CI with synthetic fixtures. It has no deployed service, live OAuth/provider call, cloud runtime, DNS record, infrastructure-as-code apply, external rollback, service-level objective, or cloud-cost claim. Cloud cost and workload telemetry remain `UNKNOWN`; GCP and Cloudflare mutation remain `NONE`.

## Normal verification

Run from `C:\INNOBASE\MatchBASE\03_Implementation\INNOBASE-MatchBASE`:

```powershell
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
pnpm snapshot:generate
pnpm test:ci
pnpm snapshot:verify-sources
pnpm dependency:audit
```

Any nonzero exit blocks commit, push, gate promotion, and deployment. Preserve the failing output without credentials and correct the cause; never skip or weaken a check.

## Dashboard operation

```powershell
pnpm snapshot:generate
pnpm --filter @matchbase/dashboard dev
```

The generated `apps\dashboard\public\current-snapshot.json` is local, ignored by Git, and replaceable. A missing file causes the application to use the tracked UNKNOWN-only bootstrap. A stale or invalid file must be regenerated before operational conclusions are drawn.

## Product reference path

`pnpm test:ci` builds the standalone Next.js application and runs the product and dashboard Playwright projects. Direct local startup requires the same synthetic environment above:

```powershell
pnpm --filter @matchbase/web build
pnpm --filter @matchbase/application worker:synthetic
pnpm --filter @matchbase/web start
```

Run the worker and web commands in separate terminals. The fixture worker owns no HTTP product route; its local health endpoint is `http://127.0.0.1:3011/health`.

The build packages the traced Next.js standalone server plus `public` and `.next/static` assets with the repository Node packaging script. Local and hosted verification run that minimal standalone server directly, bound exactly to `127.0.0.1:3010`.

Readiness is `503` unless the required database, digest key, origin, and environment controls are valid. Live Google OIDC and live provider execution remain deliberately unwired. Never substitute real identity tokens, user data, or provider credentials in Slice 1.

## Bounded recovery

### Chrome unavailable

Verify `C:\Program Files\Google\Chrome\Application\chrome.exe` exists and that `pnpm test:browser` can resolve the Playwright `chrome` channel. If Chrome is absent or organizational policy prevents execution, record the browser test as blocked. Do not substitute a different browser or skip the test without a reviewed protocol change.

### Port 4317 occupied

```powershell
Get-NetTCPConnection -LocalPort 4317 -ErrorAction SilentlyContinue
```

Resolve the owning process read-only. Stop it only when it is confirmed to be this repository's Vite process. Otherwise leave it intact and record the test as blocked; do not kill an unknown process or silently change the governed port.

Apply the same ownership check to ports `3010`, `3011`, and `55432`. Port `3010` belongs to the product server, `3011` to the synthetic worker health server, and `55432` to the exact Compose PostgreSQL service.

### PostgreSQL unavailable or dirty

Inspect only the named service with `docker compose ps postgres` and `docker compose logs postgres`. Preserve unexpected failure evidence. The tests run migration rollback and reapply against a disposable database; never point `DATABASE_URL` at shared, staging, or production data. To reset only the authorized local fixture, first verify the Compose project and exact container/volume names, then use `docker compose down --volumes` from this repository and recreate with `docker compose up -d postgres`.

### Product startup failure

Confirm `MATCHBASE_ENVIRONMENT=test`, both simulator/fixture flags are exactly `true`, the origin is `http://127.0.0.1:3010`, the digest key is synthetic and at least 32 bytes, and PostgreSQL is healthy. Production plus either simulator flag must fail; do not weaken that guard. A missing live OIDC adapter correctly returns `503` and is not repaired with real credentials in this slice.

### Snapshot generation interrupted

The generator validates the fixed output, rejects symlinks, writes a unique sibling temporary file, swaps the prior regular file to a unique backup, and restores the backup if commit fails. If an unexpected `.tmp` or `.backup` sibling remains, stop the local dashboard, preserve and hash the files, validate the current snapshot, and move only the exact residue to a quarantine directory outside the repository. Never use a wildcard or recursive deletion.

### Stale or invalid snapshot

Run `pnpm snapshot:generate` and then `pnpm snapshot:verify-sources`. If either command fails, keep the dashboard in `UNKNOWN` or `ERROR`; do not edit snapshot JSON manually.

### Generated output cleanup

Only these exact ignored local paths are generated by Slice 0:

- `apps\dashboard\dist`
- `apps\dashboard\tsconfig.tsbuildinfo`
- `packages\artifact-indexer\dist`
- `apps\dashboard\public\current-snapshot.json`
- `test-results`
- `playwright-report`
- `apps\web\.next`
- `apps\web\tsconfig.tsbuildinfo`
- `packages\auth\dist`
- `packages\contracts\dist`
- `packages\data\dist`
- `packages\ai-evidence\dist`
- `packages\security\dist`
- `packages\application\dist`
- `.dashboard-dev.stdout.log`
- `.dashboard-dev.stderr.log`

Hosted GitHub CI cannot access `C:\INNOBASE\MatchBASE\01_Product_Management`. Its workflow therefore sets `MATCHBASE_EXTERNAL_EVIDENCE_MODE=ANCHOR_ONLY_CI` and validates exact committed path/hash/method/result anchors without claiming access to the external bytes. Local validation leaves this variable unset and must reproduce the external file SHA-256 before a slice is submitted for independent audit.

Before cleanup, confirm each resolved path remains under the repository root and is ignored by Git. Remove only an exact path with PowerShell `Remove-Item -LiteralPath`; never enumerate in one shell and delete through another, never use an unresolved variable, and never delete the repository root.

## Evidence handling

Local logs and test reports must not contain credentials, provider payloads, original intake text, or protected-source content. Secret, boundary, source-hash, governance, license, dependency, and browser checks are mandatory. The actual snapshot contains paths and hashes and therefore remains local and ignored.
