# Security policy

Report vulnerabilities privately to the repository owner through GitHub private vulnerability reporting. Do not place exploit details, credentials, customer data or internal evidence in public issues.

The latest qualified prerelease receives fixes. Earlier tags remain historical; no production support SLA is asserted. Production deployment remains separately gated. The canonical local authority is `C:/INNOBASE/MatchBASE/PROJECT_START_HERE.md`.

- Keep API keys, database credentials, cookies, private provider payloads and backups out of source and Git history. Use process/runtime secrets locally and managed identity/secrets for future deployments.
- Protect saved original requests, approvals, outputs and usage records through account ownership checks and restricted database access. Do not claim that originals are transient: current Consultant workflows retain them for lineage. Production retention/deletion policy requires separate qualification.
- Use least privilege. CI has read-only repository access, synthetic disposable databases and no live inference credentials. SHA-pin third-party actions and freeze dependencies.
- Failed secret, boundary, test, build or high/critical dependency checks block release. Never bypass them to close an activity.
- Weekly maintenance and Dependabot detect drift. A security update still requires full regression validation and an independently reviewed change.
- Preserve immutable research and cost history during recovery; do not turn missing evidence or unknown cost into a successful result.

See [delivery lifecycle](https://github.com/banihashem/INNOBASE-MatchBASE/blob/main/docs/DELIVERY_LIFECYCLE.md) for release/rollback boundaries. Local Docker qualification is not proof of production security or recovery readiness.
