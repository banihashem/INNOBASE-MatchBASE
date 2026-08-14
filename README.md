# MatchBASE

Private, unlicensed implementation workspace for the MatchBASE evidence-gated delivery program.

## Current scope

Slice 0 contains the secure repository baseline, machine-readable autonomous-organization registers, a local read-only product-management observability dashboard, and deterministic validation. It does not deploy infrastructure or product workloads.

## Local verification

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm test:ci
```

Run the dashboard with the generated sanitized snapshot:

```powershell
pnpm snapshot:generate
pnpm --filter @matchbase/dashboard dev
```

The indexer reads only explicitly allowlisted MatchBASE roots and writes sanitized derived data inside this repository. Source artifacts are never changed or copied into Git.

## Boundaries

- Repository visibility must remain private. Public release is not authorized.
- No `LICENSE` is included. The code is `UNLICENSED` pending an owner/counsel decision.
- No code, assets, schemas, prompts, fixtures, configuration, or documentation from INNOBASE-MEP may be reused.
- `C:\INNOBASE\MatchBASE\00_Authoritative_Sources`, `C:\INNOBASE\MatchBASE\01_Product_Management`, and `C:\INNOBASE\MatchBASE\02_Product_Research_and_Planning` are read-only external evidence roots and must not be copied into this repository.
- Do not commit credentials, original personal data, original intake text, or provider payloads.

See `SECURITY.md`, `CONTRIBUTING.md`, `governance/README.md`, and `docs/LOCAL_OPERATIONS_RUNBOOK.md` before changing code or recovering a failed local run.
