# MatchBASE current state and phase gate

## Precedence

This is an additive current-state projection. Historical planning, execution
records, failed attempts, audits and immutable results remain unchanged. The
machine-readable current view is
`governance/current-state-projection.v1.json`.

## Current governed identity

- Repository: public `banihashem/INNOBASE-MatchBASE`, branch `main`.
- Governed migration control-plane candidate, published to `origin/main`:
  `a0da3b9d676813e69f05f7c276c0db1f5e402882`.
- Application candidate built and deployed to both Staging regions:
  `dbefc73403a2077d3c09876ecf9db7b51c34e37a`.
- Successful connected-repository Cloud Build:
  `c5e46468-b14d-4cce-9895-33d1f0f3d09c`.
- Historical failed predecessor build:
  `fe5c0b5b-2bcb-40e6-8304-76850d226336`.
- Source-region web: revision `matchbase-staging-web-00051-l9q`.
- Source-region worker pool: revision `matchbase-staging-worker-00062-zxc`.
- Europe main web: revision `matchbase-staging-web-00002-cw9`.
- Europe Canary web: revision
  `matchbase-staging-web-canary-ew2-00004-jqf`.
- Europe worker pool: revision `matchbase-staging-worker-00004-w6h`.
- Exact web image in both regions:
  `sha256:45a9cb9848cab20ba0a1b5d08a3d8c10ed944e68c3159b136ad5c4b753c4f4ad`.
- Exact worker image in both regions:
  `sha256:a1fefec5774b855712bb177a03ac8c33d1e1f0dbead047b86a59368dc5cb75f2`.
- Route policy: `slice3-routes.2026-09-01.staging-qualified-v3`, SHA-256
  `b752d2d42a63aaad11f3b89f67bad64861ce767f633bee8190549df23a6f4155`.
- Verified pre-migration backup: `1788284251034`, `SUCCESSFUL`.
- Staging schema head: `0013_domain_pack_v2_and_legacy_annotation` after
  migrations `0012` and `0013`.
- Five pre-existing `failed_retryable` records remain unchanged; active leases
  are zero.
- Production: untouched.

## Europe Staging migration state

The append-only migration ledger in the Europe artifacts bucket contains three
valid ordered entries: `Preflight`, `RegionalFoundation`, and
`DatabaseRehearsal`. The next admissible checkpoint is `Canary`; no later
checkpoint is claimed.

The exact Canary hostname
`https://matchbase-staging-eu-canary.innobase.app` is isolated by one exact host
rule. There is no wildcard host route. The dual-SAN Certificate Manager
certificate is active and attached through the certificate map. Cloud Armor
admits the closed Cloudflare IPv4 set only when the exact Canary host and
origin-admission header are present. Cloudflare holds the matching static
header transform rule. The admission secret was rotated after an operational
exposure, written as new Secret Manager versions in both regions, applied to
the Cloudflare rule, and consumed by fresh source, Europe main, and Europe
Canary revisions. The retired local value is non-operational; Secret Manager is
the runtime authority.

The 2026-09-02 post-rotation observation returned HTTP `200` through the public
Cloudflare Canary hostname and HTTP `403` when the same hostname was resolved
directly to the load-balancer IPv4 without the admission header. Public DNS
returned Cloudflare A and AAAA answers. The scoped Cloudflare token remained
active in the account; no credential value is recorded in repository evidence.

The public main hostname still defaults to the source backend in
`me-central1`. Europe residency is therefore not claimed. Signed Canary,
Maintenance, FinalRestore, and Cutover checkpoints must pass before the main
hostname can move to `europe-west2`.

## Consultant PDF runtime

The asynchronous Consultant PDF lifecycle is enabled in Staging. The web queues
work and the worker performs governed render, sixteen-gate validation,
create-only storage and audited release. Runtime identities are:

- template:
  `473c4a1383b3ae99965a62eed29defa195cd1236a521581efa9c7f31b8afac9f`;
- font:
  `abdc775b21b1bc470d50c97e790d276f2054b7504e56e5bd3e64f48d68582322`;
- toolchain:
  `af3810688779ce540e91eb42fc17304267c6384026d9eadc9d9e230957a083c0`;
- allowed attestation:
  `6585ad8d7f8788480cdab833ba9a703dbc683e6dd86d25aeb809da7e508c1d98`.

## Preserved predecessor chain

The current projection does not erase the deployment-admission correction
history. Builds `7a956868-3d02-414b-b4dc-988d7c215cdf`,
`9023f76a-e60c-41c0-b21d-d46f0d6a5817` and
`b68c1bba-1e09-46ab-86f0-a493acbb7276` succeeded but failed closed at their
recorded provenance/parser/build-record gates and were never deployed. Build
`fe5c0b5b-2bcb-40e6-8304-76850d226336` is the immediate failed predecessor to
the successful successor build. Web revision `matchbase-staging-web-00034-cn5`,
worker revision `matchbase-staging-worker-00045-k2b`, and schema head `0011`
remain historical deployed-predecessor evidence. Full details remain in the
append-only product-management log and current-state convergence record.

The linked-source boundary also remains preserved: Cloud Build connection
`projects/innobase-matchbase-stg/locations/me-central1/connections/matchbase-github`
was `COMPLETE`, the governed repository resource ended in
`/repositories/matchbase`, the remote was the public MatchBASE GitHub
repository, the GitHub App remained selected-repository scoped, and temporary
Secret Manager Admin access was revoked. Build `7a956868...` published web
`sha256:aef287862e2ce0dcb0a8e960df3226afc107f3a7e12024d8c882cc1f1ea8e212`
and worker
`sha256:e95f35067717731badf61accd80e2c974a6a63443dc3a739fb136667c86226ba`
before failing closed on absent usable provenance summary. Build `9023f76a...`
published web
`sha256:1efa936f4fa1ea56c39c2985a1616b1e22f9f9ad8b782ada2ee589020ebb0817`
and worker
`sha256:f5f40a8602c4f23dcea0e3b3e9a7e5a6153d2e2ea135cf297e1eda8ca4b0146b`
before parser cardinality/schema rejection. Build `b68c1bba...` published web
`sha256:a2a0a031997d12564975103ae0b073aadfe2b1e8fb00494afe6e0b41514ec76f`
and worker
`sha256:4cc8bd46d3931b1a918a2af1505f390a5f86a6c3aae56d4877f4a8399163ae7a`
before the StrictMode scalar-count admission failure. These identities remain
historical and non-deployable.

## Acceptance and phase disposition

The source public landing page and isolated Europe Canary landing page both
display `Qualified live research`. Edge TLS, exact-host routing, origin
admission, source/target digest equality, schema head `0013`, and database
rehearsal have passed. Authenticated EU Canary exact-request, terminal result,
profile, Admin history and downloaded PDF evidence require a fresh Google
OAuth session and are not yet claimed.

The phase gate remains `BLOCKED` only for:

1. signed EU Canary Google-authenticated exact agricultural request-to-PDF
   acceptance;
2. Maintenance, FinalRestore and Cutover ledger checkpoints;
3. documented SME validation of production weights and separate production
   authorization.

The dual-region candidate, schema `0013`, isolated Canary edge, database
rehearsal and PDF runtime are operational. Production release remains blocked
and production is untouched.
