# Slice 1 Implementation Plan

Status: `APPROVED_FOR_LOCAL_IMPLEMENTATION`
Created at: `2026-08-14T13:00:40.889Z`
Baseline commit: `cb9ecc2f12c3a4e1cb6bec801c57b88c595c5285`
Baseline tree: `d28fa5f3a9be528ea472901acef909373dc2ed16`

## Controlling inputs

- `C:\INNOBASE\MatchBASE\01_Product_Management\ROLE3_IMPLEMENTATION_PROMPT_PO_001_SLICE_1.md` — SHA-256 `EB8C7984AB5E0FB5A513956CC4862AC336B2F3F0C6EEEC03EB31D71BE2FC7FCC`
- `C:\INNOBASE\MatchBASE\01_Product_Management\SLICE_1_SPECIFICATION_AUTHENTICATED_DEMO_REFERENCE_PATH_V1.md` — SHA-256 `0A652E87AA1FB532E3974815D18B017B9DC319091B4482BA30C53648EDBDCCD9`
- `C:\INNOBASE\MatchBASE\01_Product_Management\ROLE2_INDEPENDENT_AUDIT_PO_001_SLICE_0.md` — SHA-256 `8888D4E13EF9DB8654A45F27B6A1B8CD4B78ED8316F101269ECF08E3303C924A`
- `C:\INNOBASE\MatchBASE\01_Product_Management\PRODUCT_OWNER_DECISION_OVERLAY_PO_001.md` — SHA-256 `BD058D6AED09D88020B0621BA474AA50EDD24FEC7F48E77F30B2423694F31F8E`
- `C:\INNOBASE\MatchBASE\01_Product_Management\AUTONOMOUS_CONTINUOUS_DELIVERY_GOVERNANCE_CURRENT.md` — SHA-256 `347EE0BBDD4D4CA546FA25D42593802E1B951FFEFC2902024B896C9B8D2457E8`
- `C:\INNOBASE\MatchBASE\01_Product_Management\OWNER_DECISION_DISPOSITION_REGISTER_PO_001.json` — SHA-256 `817029411A8D0E67318CF9FCE9E9C925BB3A261D9F8ED581EF43AC886919E112`

No repository or workspace `AGENTS.md` existed at discovery time. Next.js later generated `apps/web/AGENTS.md` and `apps/web/CLAUDE.md`; both were read in full, and the relevant installed Next.js 16.3.0 route-handler, instrumentation, Vitest, and Playwright documentation was followed before final integration.

## Discovery disposition

The repository was clean, private, unlicensed, and synchronized with `origin/main` and remote `refs/heads/main` at the accepted Slice 0 commit before this plan was added. It has no submodules or tracked symlinks. The full Slice 0 gate suite passed before implementation: artifact indexer 8/8, dashboard 14/14, repository/adversarial tests 34/34, Chrome 2/2, snapshot source verification 420/420, and dependency audit clean.

Node 24.14.0, pnpm 11.19.0, Docker 29.4.2, Docker Compose 5.1.3, and Chrome 151 are available. A PostgreSQL client is not installed, so database commands will run through an explicitly named ephemeral PostgreSQL 18 container and through the Node PostgreSQL driver. Live Google OAuth, Gemini, OpenRouter, Cloudflare, and database credentials are unavailable. Their absence is a live-readiness blocker only; no live mutation or live provider call is authorized for this slice.

## Architecture and intended files

The existing pnpm monorepo and Vite governance dashboard remain intact. Slice 1 adds:

- `apps/web`: Next.js App Router application with standalone output, signed-out and simulator sign-in states, three-part multilingual intake, canonical confirmation, run status/cancellation, and server-projected Demo results.
- `packages/contracts`: versioned request, response, event, error, and JSON-schema contracts.
- `packages/data`: PostgreSQL 18 migration, rollback, repositories, account quota admission, three-slot execution leases, immutable audit, and integration helpers.
- `packages/auth`: OIDC authorization-code/PKCE verification, opaque hashed sessions, CSRF, Origin, revocation, and explicit local/test simulator controls.
- `packages/application`: orchestration for canonicalization, immutable version confirmation, idempotent run admission, deterministic execution, cancellation, and disclosure audit.
- `packages/capabilities`: first-party provider contracts, validated Gemini-direct and OpenRouter fake-transport adapters, no-network enforcement, and the deterministic synthetic fixture adapter.
- `packages/evidence`: hidden evidence graph, content hashes, claim linkage, server-side Demo projection, and recursive denial controls.
- `packages/observability`: allowlist telemetry and complete capability-attempt cost attribution.
- `test/slice1` and `test/browser`: contract, PostgreSQL, concurrency, security, privacy-canary, routing, evidence, cost, browser, responsive, keyboard, and accessibility tests.
- `.github/workflows/ci.yml`, governance registers, runbooks, ADRs, and deterministic evidence manifests: PostgreSQL 18 service and Slice 1 gates without weakening Slice 0.

The first migration creates account/user/grant, OAuth transaction/session, request/canonical version/provenance, idempotency/quota ledger, run/lease, provider attempt/cost, candidate/claim/evidence/result, projection-audit, and immutable audit tables. Every tenant-owned table carries `account_id NOT NULL`. Quota uses account-row serialization and database time over a rolling 168-hour window. Three fixed lease slots are acquired atomically with `FOR UPDATE SKIP LOCKED`. Rollback drops only Slice 1 objects created by the migration; disposable-database tests prove fresh apply, rollback, and reapply.

## Bounded agent roster

| Stable ID       | Workstream                     | Model / effort      | Bounded output                                             | Independent reviewer      |
| --------------- | ------------------------------ | ------------------- | ---------------------------------------------------------- | ------------------------- |
| `S1-PUX-001`    | Product, UX, accessibility     | GPT-5.6 Sol / high  | `apps/web` UI and UI tests                                 | `S1-QA-001`               |
| `S1-API-001`    | Application, API, contracts    | GPT-5.6 Sol / high  | contracts and application/API handlers                     | `S1-CRITIC-001`           |
| `S1-DATA-001`   | Data and concurrency           | GPT-5.6 Sol / high  | migration, repositories, quota, leases, DB tests           | `S1-SEC-001`, `S1-QA-001` |
| `S1-SEC-001`    | Identity, security, privacy    | GPT-5.6 Sol / high  | auth/session/privacy controls and adversarial tests        | `S1-CRITIC-001`           |
| `S1-AI-001`     | AI routing and evidence        | GPT-5.6 Sol / high  | capability adapters, fixtures, evidence/projection tests   | `S1-QA-001`               |
| `S1-SRE-001`    | SRE, telemetry, cost           | GPT-5.6 Sol / high  | telemetry/cost controls, CI and runbooks                   | `S1-CRITIC-001`           |
| `S1-QA-001`     | QA and evaluation              | GPT-5.6 Sol / high  | independent DB/browser/accessibility/adversarial audit     | Role 3 disposition        |
| `S1-REL-001`    | Repository and release safety  | GPT-5.6 Sol / high  | dependency/license/secret/history/boundary/remote evidence | `S1-CRITIC-001`           |
| `S1-CRITIC-001` | Independent integration critic | GPT-5.6 Sol / xhigh | read-only same-byte cross-stack verdict                    | Role 2 pending            |

Each execution record will add actual timestamps, exact input/output hashes, dependencies, commands, test results, defects, corrections, and reviewer disposition. A producer is never the sole approver of its output.

## Gates and rollback boundaries

Implementation proceeds through data/contracts, identity/privacy, provider/evidence, UI/API integration, and governance/release gates. Each gate requires the affected tests plus the full regression. PostgreSQL acceptance uses a local ephemeral container and the hosted CI service; review-only substitution is prohibited. Source-language canaries are synthetic and must be absent from the database, logs, traces, errors, screenshots, snapshots, and committed artifacts after execution.

No GCP, Cloudflare, live OAuth, live provider, DNS, IAM, billing, production, repository-visibility, or real-user-data mutation is permitted. AG7–AG9 remain `NOT_STARTED` or `BLOCKED`. Local container and generated test state are disposable and will be removed using explicit targets after evidence capture. Repository rollback is a normal successor commit; history rewriting, force push, destructive reset, and modification of protected management/planning/authoritative files are prohibited.

Final completion requires all `S1-AC-001` through `S1-AC-022`, all discipline audits at 0 Critical / 0 Major / 0 Minor on identical bytes, a clean exact local/remote commit, and a green hosted run for that commit. Role 3 can only conclude `READY_FOR_ROLE2`; Role 2 remains the final acceptance authority.
