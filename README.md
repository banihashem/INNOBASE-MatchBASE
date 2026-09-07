# MatchBASE

Implementation workspace for MatchBASE industrial B2B sourcing and procurement intelligence. The code is unlicensed pending an owner decision.

## Current scope

Consultant V3 is the current product workflow: multilingual intake, an approved English request snapshot, three advisory loops, an editable research prompt with a second approval gate, parallel supplier research, evidence verification, persisted dossiers and full PDF reports. Live execution calls OpenRouter; Demonstration execution uses explicitly labeled fixtures. Live acceptance depends on the configured account's actual provider routing and evidence capability, and cannot be inferred from fixture tests or a successful build.

The current local activity is `MB-UX-LIVE-001 L02` (BYOK and targeted hygiene). Authoritative product status and authorization remain in the separate local governance repository at `C:\INNOBASE\MatchBASE\PROJECT_START_HERE.md`. Production deployment is outside this activity.

`apps/web` is the product UI. `packages/application` owns orchestration and the durable Consultant worker; `packages/contracts`, `packages/data`, and `packages/reporting` own validated output, persistence, and reports. `apps/dashboard` and the Slice 0–3 governance artifacts retain historical delivery and compatibility roles. V2 readers remain necessary for saved historical reports.

## Current local runtime

Provision server configuration in the authorized process or Windows User environment. Build the application packages before starting the durable worker:

```powershell
pnpm --filter '@matchbase/application...' build
# Separate terminal 1:
pnpm --filter @matchbase/web dev
# Separate terminal 2, with the same intended database and model configuration:
pnpm --filter @matchbase/application worker:consultant
```

The Consultant worker has no HTTP health port. Its process heartbeat and PostgreSQL job/event movement are separate checks. `worker:synthetic` and `worker:combined` belong to earlier runtime paths.

The local governance repository also supplies hidden, owned lifecycle scripts under `05_Operations/runtime/`: `START_MATCHBASE_LOCAL_UAT.ps1`, `CHECK_MATCHBASE_LOCAL_UAT.ps1`, and `STOP_MATCHBASE_LOCAL_UAT.ps1`. Their default scope is the web service plus Consultant worker. The complete local runbook is `C:\INNOBASE\MatchBASE\05_Operations\CONSULTANT_LIVE_WORKFLOW.md`.

See [Developer command catalog](docs/DEVELOPER_COMMANDS.md) for current checks, fixture operations, historical compatibility commands, and commands with external effects.

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
- **Verified BYOK:** Configure `MATCHBASE_PROVIDER_OPENAI=openai` and `MATCHBASE_PROVIDER_GOOGLE=google-ai-studio`, with matching prioritized provider keys in the same OpenRouter workspace and shared-capacity fallback disabled. Live calls require provider-reported `is_byok: true`; a gateway key alone is insufficient.
- **Database:** Provision `MATCHBASE_DATABASE_URL` (canonical) or `DATABASE_URL` (fallback). Operational entrypoints must not silently select a database using embedded credentials.
- **Never Client-Exposed:** Never prefix model keys or secrets with `NEXT_PUBLIC_`.
- **No Committed Secrets:** Never commit `.env`, `.env.local`, API keys, or credentials to Git history or files.
- **Local Dev:** Use Windows User environment variables or local shell environment variables.

## Historical Slice 1 fixture qualification

The following retained recipe creates and seeds the older synthetic local reference environment. Use a disposable qualification database. It is not the startup or recovery procedure for a saved Consultant research session.

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

The historical Slice 1 standalone product surface uses:

```powershell
pnpm --filter @matchbase/web build
pnpm --filter @matchbase/application worker:synthetic
pnpm --filter @matchbase/web start
```

Run the worker and web commands in separate terminals with the same environment.
That standalone web configuration uses `http://127.0.0.1:3010`, with the synthetic worker health endpoint at `http://127.0.0.1:3011/health`. These are legacy defaults, not the Consultant worker's health contract.

The local simulator and synthetic fixture flags are forbidden in production. Startup fails closed if either is enabled with `MATCHBASE_ENVIRONMENT=production`.

## Boundaries

- This activity does not authorize changing repository visibility, publishing private governance material, or production deployment.
- No `LICENSE` is included. The code is `UNLICENSED` pending an owner/counsel decision.
- No code, assets, schemas, prompts, fixtures, configuration, or documentation from INNOBASE-MEP may be reused.
- `C:\INNOBASE\MatchBASE\00_Authoritative_Sources`, `C:\INNOBASE\MatchBASE\01_Product_Management`, and `C:\INNOBASE\MatchBASE\02_Product_Research_and_Planning` are read-only external evidence roots and must not be copied into this repository.
- Do not commit credentials, original personal data, original intake text, or provider payloads.

See `SECURITY.md`, `CONTRIBUTING.md`, and `docs/DEVELOPER_COMMANDS.md` before changing code. `governance/README.md` and `docs/LOCAL_OPERATIONS_RUNBOOK.md` describe retained historical paths. Consultant recovery follows the current local governance runbook named above.
