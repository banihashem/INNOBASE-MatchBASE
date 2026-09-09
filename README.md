# MatchBASE

Evidence-based B2B supplier research for Consultant users. Multilingual intake becomes an approved English request and research plan. Separately priced research rounds return ranked supplier dossiers, source evidence, available dated prices and English PDF reports. Live research uses OpenRouter; fixture tests remain explicitly synthetic.

## Current source and runtime

Product version is the root `package.json` version. Workspace packages are private internal units, not separately released products. Git tags identify checked source releases; running image digests and local acceptance records are separate. A successful build or five-model execution does not imply complete commercial qualification or production readiness.

Canonical local authority: `C:/INNOBASE/MatchBASE/PROJECT_START_HERE.md`. Canonical implementation root: `C:/INNOBASE/MatchBASE/03_Implementation/INNOBASE-MatchBASE`. This GitHub repository contains implementation/build/test material; private governance, source research and customer data remain outside it.

Local startup uses Docker Compose project `matchbase-local`. Read [local Docker launcher](https://github.com/banihashem/INNOBASE-MatchBASE/blob/main/deployment/local/README.md). On the canonical host use `C:/INNOBASE/MatchBASE/03_Implementation/INNOBASE-MatchBASE/deployment/local/Manage-LocalDocker.ps1 -Action Status`. Build qualifies host unit tests before Docker; Up refuses active research. Preserve saved data and volumes. Host-process startup is historical compatibility guidance.

## Engineering map

| Area                                          | Responsibility                                                        |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `apps/web`                                    | Consultant entry, profile/dashboard, approvals, progress and results  |
| `packages/application`                        | Research orchestration, provider routing, durable worker and recovery |
| `packages/contracts`, `packages/ai-evidence`  | Validated requirements, supplier evidence and output contracts        |
| `packages/data`                               | PostgreSQL persistence, additive migrations and usage records         |
| `packages/auth`, `packages/security`          | Identity, ownership, authorization and boundary controls              |
| `packages/reporting`                          | Evidence-based English reports and PDF generation                     |
| `apps/dashboard`, `packages/artifact-indexer` | Historical delivery evidence and read-only artifact projection        |

## Development

Use Node 24.14.0 and the exact package manager in `package.json`. Install with `pnpm install --frozen-lockfile`. `pnpm run check:dev` gives fast feedback; `pnpm run test:ci` executes the full release gate with an explicitly configured disposable database. Never point tests or seed tools at saved research data. No live model credentials belong in CI.

Read [delivery lifecycle](https://github.com/banihashem/INNOBASE-MatchBASE/blob/main/docs/DELIVERY_LIFECYCLE.md), [command catalog](https://github.com/banihashem/INNOBASE-MatchBASE/blob/main/docs/DEVELOPER_COMMANDS.md), [documentation map](https://github.com/banihashem/INNOBASE-MatchBASE/blob/main/docs/DOCUMENTATION_MAP.md), [contributing](https://github.com/banihashem/INNOBASE-MatchBASE/blob/main/CONTRIBUTING.md) and [security policy](https://github.com/banihashem/INNOBASE-MatchBASE/blob/main/SECURITY.md).

The configuration schema is `.env.example`; provide values through process/runtime secrets rather than creating credential files. Server key: `MATCHBASE_OPENROUTER_API_KEY`. Configured BYOK must be verified in provider metadata; additional-family credit use requires its own approved quote. Never prefix secret or model configuration with `NEXT_PUBLIC_`.

Source is publicly visible but remains UNLICENSED; visibility is not a software distribution license. Production deployment and paid research require their own explicit authorization.
