# MatchBASE

Private, unlicensed implementation workspace for the MatchBASE evidence-gated delivery program.

## Current scope

Slice 1 adds a production-structured, local-only authenticated Demo reference path to the verified Slice 0 governance baseline. It includes fail-closed Google OIDC contracts, an explicitly non-production simulator, PostgreSQL 18 persistence, canonical-English intake, atomic rolling quota, three global execution leases, fixture-only provider execution, hidden evidence storage, strict Demo projection, and responsive product UI. It does not call live identity or AI providers and does not deploy infrastructure or product workloads.

## Development and Verification Workflows

### 1. Developer Fast Feedback (`check:dev`)

Runs formatting check, linting, boundary verification, protected baseline checks, candidate secret scan, and TypeScript typechecking across all workspace packages:

```powershell
pnpm run check:dev
```

### 2. Full Gate Verification (`check:full` / `check`)

Runs the comprehensive test and governance gate, including slow archival, deep secretlint, and git history scans:

```powershell
pnpm run check:full
```

### 3. Unit and Integration Tests

```powershell
# Run workspace package tests
pnpm run test:unit

# Run API and integration test suites
pnpm run test:integration

# Run all automated tests
pnpm test
```

### 4. Build Workspace

```powershell
pnpm run build
```

## Runtime Configuration

MatchBASE uses environment variables for runtime configuration. A template is provided in [`.env.example`](.env.example).

### Configuration Rules:

- **Server-Side Only:** The canonical key for external model routing is `MATCHBASE_OPENROUTER_API_KEY`.
- **Never Client-Exposed:** Never prefix model keys or secrets with `NEXT_PUBLIC_`.
- **No Committed Secrets:** Never commit `.env`, `.env.local`, API keys, or credentials to Git history or files.
- **Local Dev:** Use Windows User environment variables or local shell environment variables.

## Local verification

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
pnpm test:ci
```

The exact one-command local acceptance runner performs the frozen install,
PostgreSQL startup, migration, synthetic seed, and complete gate with the same
explicit local-only environment:

```powershell
pnpm slice1:validate:local
```

Run the dashboard with the generated sanitized snapshot:

```powershell
pnpm snapshot:generate
pnpm --filter @matchbase/dashboard dev
```

The indexer reads only explicitly allowlisted MatchBASE roots and writes sanitized derived data inside this repository. Source artifacts are never changed or copied into Git.

Run the product surface after building it:

```powershell
pnpm --filter @matchbase/web build
pnpm --filter @matchbase/application worker:synthetic
pnpm --filter @matchbase/web start
```

Run the worker and web commands in separate terminals with the same environment.
The web start command executes the packaged standalone server directly at exactly `http://127.0.0.1:3010`; the worker health endpoint binds exactly to `http://127.0.0.1:3011/health`.

The local simulator and synthetic fixture flags are forbidden in production. Startup fails closed if either is enabled with `MATCHBASE_ENVIRONMENT=production`.

## Boundaries

- Repository visibility must remain private. Public release is not authorized.
- No `LICENSE` is included. The code is `UNLICENSED` pending an owner/counsel decision.
- No code, assets, schemas, prompts, fixtures, configuration, or documentation from INNOBASE-MEP may be reused.
- `C:\INNOBASE\MatchBASE\00_Authoritative_Sources`, `C:\INNOBASE\MatchBASE\01_Product_Management`, and `C:\INNOBASE\MatchBASE\02_Product_Research_and_Planning` are read-only external evidence roots and must not be copied into this repository.
- Do not commit credentials, original personal data, original intake text, or provider payloads.

See `SECURITY.md`, `CONTRIBUTING.md`, `governance/README.md`, and `docs/LOCAL_OPERATIONS_RUNBOOK.md` before changing code or recovering a failed local run.
