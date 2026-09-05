# Contributing to MatchBASE

This is a private, evidence-gated implementation repository.

## Branch and Development Conventions

1. **Branching:** Work on short-lived branches created from `main` with clear naming:
   - `foundation/<description>` for infrastructure and tooling readiness
   - `feature/<activity-code>-<description>` for product features
   - `fix/<activity-code>-<description>` for defect fixes
2. **Preserved Branches:** Do not force-push, rewrite, or delete historical recovery branches (e.g., `recovery/mb-ux-remediation`).
3. **Commit Discipline:** Every commit message must begin with the activity code or scope:
   - `[ACTIVITY-CODE] Descriptive summary`
4. **Verification Discipline:**
   - Run `pnpm run check:dev` frequently during local iteration for fast feedback.
   - Run `pnpm run check:full` and `pnpm test` before committing or merging to `main`.
   - Never weaken, bypass, or mock out checks to manufacture a false pass.
5. **Secret Hygiene:**
   - Never commit credentials, tokens, passwords, `.env`, or `.env.local` files.
   - Server-side runtime variables must use `MATCHBASE_OPENROUTER_API_KEY` (or `OPENROUTER_API_KEY`).
   - Never use `NEXT_PUBLIC_` prefixes on secret variables.
6. **Deployment Policy:**
   - Never trigger production deployments or billing actions without explicit Human approval.

No public contribution or external distribution is authorized.
