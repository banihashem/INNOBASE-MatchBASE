# Security policy

## Reporting

Report vulnerabilities privately to the repository owner. Do not open public issues containing exploit details, credentials, personal data, or protected MatchBASE artifacts.

## Non-negotiable controls

- Never commit secrets, service-account keys, access tokens, cookies, environment files, or original provider payloads.
- Use workload identity or a managed secret store for future deployed workloads. Long-lived local keys are prohibited.
- Treat authoritative and planning artifacts as read-only inputs outside the repository.
- Keep intake originals transient. Persist only sanitized English canonical data and provenance metadata when the relevant product slice is authorized.
- Apply least privilege and deny-by-default service boundaries.
- A failed secret, boundary, governance, test, or build check blocks merge and deployment.

There is no deployed MatchBASE workload in Slice 0.
