# ADR 0001: Slice 1 Runtime and Dependency Boundary

- Status: Accepted for Slice 1 local reference implementation
- Date: 2026-08-14
- Decision owners: Role 3 orchestration with independent review pending

## Context

Slice 1 requires a production-structured local authenticated path while prohibiting live OAuth, provider, search, GCP, Cloudflare, and production mutations. The accepted repository already uses a pnpm TypeScript monorepo and a Vite governance dashboard. The product surface must use the Next.js App Router and the acceptance database must be real PostgreSQL.

## Decision

1. Add a separate Next.js 16.3.0 application with React 19.2.8 and standalone output. Next.js 16.3.1 was rejected because its publication age was below the repository's supply-chain minimum at selection time. The existing governance dashboard remains a separate Vite application.
2. Pin the official PostgreSQL 18.1 Bookworm image by immutable multi-platform digest `sha256:cc9f4143a8d2fa8cf3749d0cb4d26ecf2d53a77a2ac807e9ebd67ae22426221a`. Local and hosted tests use fresh disposable databases. SQLite is not an acceptance substitute.
3. Use `pg` 8.23.0 as the only database driver. Keep transactions, quota serialization, lease acquisition, and immutable audit constraints explicit in first-party code and SQL.
4. Use `jose` 6.2.8 for standards-conformant JWT signature and registered-claim verification. PKCE, state, nonce, opaque session, CSRF, Origin, simulator, and stored-grant policy remain first-party controls.
5. Use `zod` 4.4.3 only at untrusted API/config boundaries and generate deterministic versioned JSON schemas from first-party contract definitions.
6. Provider adapters use injected transports. No provider SDK is installed and no default transport performs network I/O. Local acceptance enables only the deterministic synthetic fixture route.
7. Browser accessibility uses the pinned Playwright/system-Chrome baseline plus `@axe-core/playwright` 4.13.0. Scripted keyboard, focus, live-region, reduced-motion, and responsive checks remain explicit tests.

## Security and privacy consequences

The local OIDC simulator and synthetic fixture adapter are permitted only in explicit `local` or `test` mode. Production startup fails if either is enabled. Provider route configuration contains identifiers and evidence references, never credentials. Original-language request bodies remain in browser state and the bounded synchronous canonicalization call only; persistence, logs, traces, errors, queues, screenshots, snapshots, and committed fixtures contain non-source canary digests or English canonical data only.

## Operational consequences

The CI job must start a digest-pinned PostgreSQL 18.1 service, wait for readiness, apply the migration, execute rollback/reapply and contention tests, build both applications, and run the existing Slice 0 suite. The local operations runbook names the disposable container and generated paths and includes explicit recovery and cleanup.

## Dependency-license review

The Next.js dependency graph adds three license expressions not present in Slice 0. `0BSD` applies to `tslib` and is permissive. `CC-BY-4.0` applies to the `caniuse-lite` compatibility dataset; the package metadata and attribution remain intact. `Apache-2.0 AND LGPL-3.0-or-later` applies to the platform-specific prebuilt Sharp/libvips package used by the private Next.js build; its package notices remain intact, no library is modified, and this slice creates no public distribution. The license policy recognizes only these exact reviewed expressions. This policy delta requires independent repository/release review before closure.

## Rejected alternatives

- SQLite: rejected because transaction and contention behavior would not satisfy acceptance.
- Live Google/provider calls: rejected because they are outside Slice 1 and would violate the mutation/data boundary.
- Provider SDKs: rejected because injected first-party transport contracts are sufficient for the required no-network contract tests.
- Client-side tier filtering: rejected because the server-side projection is the only disclosure boundary.
- Monetary hard stop: rejected by the owner overlay; unknown or unpriced cost remains a release blocker instead.
