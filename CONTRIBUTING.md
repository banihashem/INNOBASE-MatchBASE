# Contributing

Canonical local authority: `C:/INNOBASE/MatchBASE/PROJECT_START_HERE.md`. This source repository is public; packages remain private and UNLICENSED. Do not publish private governance, customer inputs, provider payloads, credentials or internal audit records.

Use a short-lived `codex/<activity>-<description>` branch and `[ACTIVITY-CODE]` commit prefixes. Preserve recovery branches and public history; never force-push. Define observable acceptance criteria and retain compatibility/migration contracts.

Follow [delivery lifecycle](https://github.com/banihashem/INNOBASE-MatchBASE/blob/main/docs/DELIVERY_LIFECYCLE.md). Install frozen dependencies, prepare snapshots, run full checks and use disposable databases for tests. The required CI check is `verify`. Review the exact candidate before merge. Keep independent review evidence in local governance without impersonating another reviewer on GitHub.

Do not auto-merge dependency changes, weaken a failing check or deploy from a pull-request workflow. GitHub release publication does not authorize production deployment or model spending. Report security issues privately under [SECURITY.md](https://github.com/banihashem/INNOBASE-MatchBASE/blob/main/SECURITY.md).
