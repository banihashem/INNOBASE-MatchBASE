# MatchBASE current state and phase gate

## Precedence

This is an additive current-state projection. Historical planning, execution
records, failed attempts, audits and immutable results remain unchanged. The
machine-readable current view is
`governance/current-state-projection.v1.json`.

## Current governed identity

- Repository: public `banihashem/INNOBASE-MatchBASE`, branch `main`.
- Published and deployed source:
  `1236a78203f62ff32f7db8b7519c724aa620b8bf`.
- Successful Cloud Build: `6d0b0a4f-ce12-452d-bf2b-441599bfb66b`.
- Historical failed predecessor build:
  `fe5c0b5b-2bcb-40e6-8304-76850d226336`.
- Web: revision `matchbase-staging-web-00036-g4l`, image
  `sha256:088f3a29fadc0bc9caedfd7f93fd19767a3d6d434fc3a0d333d09b20029ae071`.
- Worker: revision `matchbase-staging-worker-00048-f4t`, image
  `sha256:9f0422c70e09bf24f654d8c4e7af4241ef8dd5305af862b62e04e8d134da4816`.
- Route policy: `slice3-routes.2026-09-01.staging-qualified-v3`, SHA-256
  `b752d2d42a63aaad11f3b89f67bad64861ce767f633bee8190549df23a6f4155`.
- Verified pre-migration backup: `1788284251034`, `SUCCESSFUL`.
- Staging schema head: `0013_domain_pack_v2_and_legacy_annotation` after
  migrations `0012` and `0013`.
- Five pre-existing `failed_retryable` records remain unchanged; active leases
  are zero.
- Production: untouched.

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

The public landing page passed live acceptance and displays `Qualified live
research`. The existing Chrome authentication session returned HTTP `401` from
`/api/v1/me`; therefore authenticated exact-request, terminal result, profile,
Admin history and downloaded PDF live acceptance are not yet claimed.

The phase gate remains `BLOCKED` only for:

1. fresh Google authentication and exact agricultural request-to-PDF live
   acceptance;
2. Europe residency convergence for processing and persistent storage;
3. documented SME validation of production weights and separate production
   authorization.

The successor deployment, schema `0013`, public landing page and PDF runtime are
operational. Production release remains blocked and production is untouched.
