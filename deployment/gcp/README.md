# MatchBASE Google Cloud deployment scaffold

This directory is an execution scaffold, not evidence that a deployment exists.
Every script requires an explicit `-Environment staging` or
`-Environment production` and defaults to plan-only output. No environment
defaults to production. Mutation requires both `-Apply` and the exact mapped
`-ConfirmProjectId`.

| Environment | Project                  | Hostname                         | Artifact bucket                    | Region        |
| ----------- | ------------------------ | -------------------------------- | ---------------------------------- | ------------- |
| staging     | `innobase-matchbase-stg` | `matchbase-staging.innobase.app` | `innobase-matchbase-stg-artifacts` | `me-central1` |
| production  | `innobase-matchbase`     | `matchbase.innobase.app`         | `innobase-matchbase-artifacts`     | `me-central1` |

These are the only accepted targets. Staging is the first execution target.

`me-central1` is only the current technical default. It makes no data-residency,
privacy, regulatory, or legal-compliance claim. Counsel and the Security Owner
must approve the actual target before production traffic.

## Security and release boundaries

- Never pass a secret value to these scripts. Pass only same-project bindings
  in the form `ENV=SECRET_NAME:NUMERIC_VERSION`.
- Both web and worker images must be supplied as Artifact Registry references
  ending in `@sha256:<64 lowercase hex characters>`. Tags are rejected.
- Foundation service accounts receive no project-wide runtime role. The web
  account receives bucket-level `roles/storage.objectViewer`; the worker account
  receives bucket-level `roles/storage.objectCreator`.
- The bucket enforces public-access prevention, uniform bucket-level access,
  versioning, and an explicit soft-delete duration.
- The web service accepts ingress only from internal sources and Cloud Load
  Balancing. Its default Cloud Run URL is not a supported public entry point.
- The ALB backend is bound to a default-deny Cloud Armor policy. Only the exact
  target hostname from explicitly supplied Cloudflare IPv4 egress ranges is
  admitted. Production web startup also requires
  `MATCHBASE_ORIGIN_ADMISSION_KEY` from Secret Manager, and every request must
  carry its exact value in `MB-Origin-Admission`. Configure that header as a
  Cloudflare secret transform; never place the value in DNS, source, plan output,
  or a Cloud Armor expression.
- The load balancer scaffold exposes HTTPS only. DNS and certificate activation
  remain externally observable gates.
- Each target needs its own governed route policy with the same environment,
  `liveActivation=enabled`, and every route both enabled and live-qualified.
  The repository's current production policy remains blocked. No staging policy
  is fabricated by this scaffold.
- Both targets run the application with `MATCHBASE_ENVIRONMENT=production` so
  production identity and fixture prohibitions remain active. The infrastructure
  target is separately recorded in `MATCHBASE_DEPLOYMENT_ENVIRONMENT`.
- Cloud Run worker pools require a current gcloud CLI. Scripts fail instead of
  installing or updating CLI components automatically.

## Reproducible web image

The repository-root `Dockerfile` pins Node 24.14.0 by OCI index digest, pins pnpm
11.19.0, uses the frozen lockfile, builds the existing packaged Next standalone
runtime, and runs as UID/GID 10001. Build from the repository root:

```powershell
$routePolicyPath = 'config/slice3/research-route-policy.staging.v1.json'
$routePolicySha256 = (Get-FileHash -LiteralPath $routePolicyPath -Algorithm SHA256).Hash.ToLowerInvariant()
docker build --pull --target web-runtime `
  --build-arg DEPLOYMENT_ENVIRONMENT=staging `
  --tag staging-web .
docker build --pull --target worker-runtime `
  --build-arg DEPLOYMENT_ENVIRONMENT=staging `
  --build-arg ROUTE_POLICY_PATH=$routePolicyPath `
  --build-arg ROUTE_POLICY_SHA256=$routePolicySha256 `
  --tag "staging-worker-$($routePolicySha256.Substring(0, 16))" .
```

Publishing is deliberately separate. Resolve the pushed Artifact Registry image
to its immutable digest before running `Deploy-CloudRun.ps1`.
The repository image names are closed: `<environment>-web` and
`<environment>-worker-<first-16-route-policy-sha256>`. The deploy script rejects
digests published under any other name, and binds the complete digest and route
policy SHA-256 into each revision.

## Execution order

1. Run `Initialize-Foundation.ps1 -Environment staging` without `-Apply`; archive
   the plan and verify that every resource resolves to the staging map row.
2. Run it with `-Apply -ConfirmProjectId innobase-matchbase-stg` only after the
   isolated staging target has passed external approval.
3. Build, scan, sign, push, and resolve separate web and worker image digests.
4. Run `Deploy-CloudRun.ps1` without `-Apply`; archive the redacted plan.
5. Apply the Cloud Run release. The command pins each revision to a digest,
   pins each secret environment variable to a numeric Secret Manager version,
   and grants each runtime account access only to its exact secret resources.
6. Run `Initialize-ExternalAlb.ps1` without `-Apply`, then apply it.
7. Create a proxied Cloudflare `A` record for
   `matchbase-staging.innobase.app` using the
   emitted static IPv4 address. Keep Cloudflare SSL mode at Full (strict).
8. Wait for the Google-managed certificate to become `ACTIVE`, then execute the
   external Gate B tests. Do not infer readiness from resource creation.
9. Production remains a separate, explicit run of the same sequence with
   `-Environment production`; staging evidence never authorizes production.

Exact dry-run parameter examples are intentionally omitted because secret names,
image digests, bucket names, resource names, and scale limits are release inputs
that must be supplied explicitly rather than copied from placeholders.
