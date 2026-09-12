# Development and maintenance lifecycle

Activity: MB-UX-GOV-003 L01. Canonical workspace authority: `C:/INNOBASE/MatchBASE/PROJECT_START_HERE.md`. Implementation root: `C:/INNOBASE/MatchBASE/03_Implementation/INNOBASE-MatchBASE`.

## Plan and implement

Record the outcome, scope, acceptance criteria and rollback implications in a sanitized GitHub issue. Use a short-lived `codex/<activity>-<description>` branch. Prefix commits with `[ACTIVITY-CODE]`; maintenance automation uses `[MB-MAINT]`. Keep authoritative research, customer data and private validation records in the separate local governance repository. Root governance has no remote.

Preserve saved-result readers, additive migrations, immutable evidence contracts and recovery branches. Historical Slice 0–3 scripts and manifests still have executable consumers; they are not the current product plan. Current Consultant scope is documented in the repository README and the local authority. Non-Consultant product development remains deferred.

## Verify and review

Install with `pnpm install --frozen-lockfile`. `pnpm run check:dev` is fast feedback, not a release certificate. Run `pnpm run snapshot:prepare` before `pnpm run check:full` so generated local dashboard references reflect retained source files. CI uses sanitized anchor-only fixtures; it never needs private governance uploads or live model credentials.

The required GitHub `verify` job runs the full existing governance/security/type/build gate, package and integration tests, repeated standalone cold starts, browser tests and dependency audit against disposable PostgreSQL. It installs Chromium explicitly. Database-dependent Consultant tests receive the disposable test database, not a runtime database. No provider keys are provisioned in CI.

The browser release matrix covers Consultant Home/session, dashboard/profile, request approvals, costs and model tiers, progress/cancellation/recovery, dossiers/PDF, mobile/accessibility, operational admin screens and retained V2 reports. Four real HTTP/auth boundary scenarios remain enabled from the historical live-reference suite. Demo/Standard Home flows are retired from current release acceptance because the product entrypoint is Consultant-only; their source files remain at evidence-pinned paths. API, repository and component compatibility tests continue to run. Synthetic browser suppliers qualify behavior, not real commercial coverage.

Before local Docker packaging, run `C:/INNOBASE/MatchBASE/03_Implementation/INNOBASE-MatchBASE/deployment/local/Manage-LocalDocker.ps1 -Action Build`. This launcher creates a disposable host test database and requires the unit gate before sending the build context to Docker. Do not run test suites using inherited runtime database settings.

Review the complete diff and newly reachable commit history for private material. One independent review and targeted correction are required by local governance; record the actual reviewer and evidence there. Merge only when the exact candidate checks succeed and conversations are resolved. Do not bypass failed checks, fabricate an approval, or publish all local refs with `--all`.

## Version and release

The root `package.json` version is the product release version; internal private workspace package versions are independent compatibility metadata. Releases use matching `v<version>` immutable tags. A prerelease suffix denotes a qualification candidate, not production acceptance. Commit SHA identifies source; Docker digest identifies runtime. Record both in the local entrypoint.

Create a release from the checked merged commit, with sanitized changes, tests, migration/rollback implications and known limitations. Keep prior tags and recovery branches. A GitHub release does not deploy the application. Release notes must not contain customer inputs, research payloads, account/run identifiers, keys or internal reports.

## Operate and maintain

Weekly CI and Dependabot check drift and vulnerabilities. Review dependency changes as code; do not auto-merge or auto-deploy them. Patch critical/high vulnerabilities before release; record any accepted exception explicitly with owner, expiry and evidence. Scheduled checks have read-only permissions and no inference credentials.

Production operationalization remains a separate authorized stage: managed identity, deployment secrets, restore rehearsal, retention policy, monitoring, budgets and live acceptance must be verified there. For local recovery use the Docker runbook; never reseed or delete the persistent volume. A rollback reuses a known compatible image after checking queue idleness and schema compatibility. Database restoration is a separate data operation requiring a verified backup and explicit target.

The active Consultant production boundary and outstanding durable command/result work are recorded in [Consultant production readiness](https://github.com/banihashem/INNOBASE-MatchBASE/blob/main/docs/CONSULTANT_PRODUCTION_READINESS.md). Worker/image source corrections alone do not qualify that journey for production.

## Security references

QUALITY001 L06 pins `pdf-lib@1.17.1` for reading actual rendered PDF page counts. Its transitive `pako@1.0.11` declares `(MIT AND Zlib)`. The installed root LICENSE and `lib/zlib/README` notices were inspected; retain both notices, preserve attribution and mark any future modified sources. Only this exact package/version is admitted under that composite expression. The locked code remains unmodified and the dependency audit reports no known vulnerabilities. [Upstream MIT notice](https://github.com/nodeca/pako/blob/1.0.11/LICENSE) and [zlib notice](https://github.com/nodeca/pako/blob/1.0.11/lib/zlib/README) record the package terms.

The Sharp 0.35.4 security patch brings `@img/sharp-libvips-linux-x64@1.3.3` under `LGPL-3.0-or-later`. The installed package metadata and bundled README notices were inspected; it remains an unmodified prebuilt library used in CI and the local container. The exact package/version is admitted alongside the historical 1.3.2 baseline; unknown packages and versions remain rejected. Preserve the package README notices when packaging. This source-only release does not publish that binary or a container image; binary redistribution and its notice/source obligations must be qualified before any such production delivery. [Upstream third-party notices](https://github.com/lovell/sharp-libvips/blob/main/THIRD-PARTY-NOTICES.md) distinguish library terms from the Apache-licensed packaging scripts.

- [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use): immutable action SHAs and minimal token permissions.
- [GitHub release notes](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes): curated release categories.
- [Next.js security advisory](https://github.com/advisories/GHSA-p293-qw3h-jr36): patched Next.js 16.3.3 baseline.
