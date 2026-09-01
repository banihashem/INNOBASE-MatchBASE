# MatchBASE Google Cloud deployment scaffold

This directory is the governed execution scaffold used for the current Staging
deployment. Exact source `1236a78203f62ff32f7db8b7519c724aa620b8bf` was
published, built by successful Cloud Build
`6d0b0a4f-ce12-452d-bf2b-441599bfb66b`, and deployed as web revision
`matchbase-staging-web-00036-g4l` and worker revision
`matchbase-staging-worker-00048-f4t`. Build
`fe5c0b5b-2bcb-40e6-8304-76850d226336` remains a historical failed attempt.
Staging schema head is `0013_domain_pack_v2_and_legacy_annotation`; production
is untouched. Europe residency and authenticated exact-request/PDF acceptance
remain open.
Every script requires an explicit `-Environment staging` or
`-Environment production` and defaults to plan-only output. No environment
defaults to production. Mutation requires both `-Apply` and the exact mapped
`-ConfirmProjectId`. `Migrate-StagingRegion.ps1` is the only exception to the
environment parameter: it is closed to the single Staging project and requires
one explicit migration checkpoint for every apply.

| Environment | Project                  | Hostname                         | Artifact bucket                    | Region        |
| ----------- | ------------------------ | -------------------------------- | ---------------------------------- | ------------- |
| staging     | `innobase-matchbase-stg` | `matchbase-staging.innobase.app` | `innobase-matchbase-stg-artifacts` | `me-central1` |
| production  | `innobase-matchbase`     | `matchbase.innobase.app`         | `innobase-matchbase-artifacts`     | `me-central1` |

These are the only accepted targets. Staging is the first execution target.

`me-central1` is only the current technical default. It makes no data-residency,
privacy, regulatory, or legal-compliance claim. Counsel and the Security Owner
must approve the actual target before production traffic.

`Common.ps1` also contains a separate, closed migration map from the currently
deployed Staging resources in `me-central1` to a blue/green target in
`europe-west2`. That map does not claim the migration has occurred and does not
change the active deployment target used by `Deploy-CloudRun.ps1`.

The migration script defaults are bound to the current deployed successor:
web image `sha256:088f3a29fadc0bc9caedfd7f93fd19767a3d6d434fc3a0d333d09b20029ae071`,
worker image `sha256:9f0422c70e09bf24f654d8c4e7af4241ef8dd5305af862b62e04e8d134da4816`,
and migration head `0013_domain_pack_v2_and_legacy_annotation`. Any successor
deployment must update these bindings and their tests before migration evidence
can be produced.

## Governed Staging region migration

`Migrate-StagingRegion.ps1` plans a same-project migration. Its default
`PlanAll` checkpoint is read-only and does not invoke gcloud. It covers:

- source and regional-capacity preflight;
- an immutable EU Artifact Registry repository and artifact bucket;
- EU user-managed Secret Manager metadata without reading or writing a secret
  version;
- an EU application-log bucket and sink;
- a fresh Cloud SQL backup, rehearsal restore, and final frozen restore;
- verification of separately deployed canary runtimes and creation of an
  unattached EU serverless NEG/backend;
- a real pinned EU maintenance service, serverless NEG, and protected backend;
- a maintenance route, atomic URL-map cutover, coordinated EU web/worker/database
  rollback, and an explicitly pre-write-only source rollback;
- a separately authorized source-retirement checkpoint after a verified EU
  recovery backup and bounded hold.

The scaffold never deletes source resources outside `SourceRetirement`. That
checkpoint has a separate destructive gate, exact resource allowlist, verified
EU backup/restore prerequisite, and hold-expiry check. The scaffold never
accesses a secret value. Database URL versions and other secret versions must be
created through a separate redacted credential procedure after the target
connection name is known.

Every applied checkpoint requires a machine-generated evidence document with
schema `matchbase-staging-region-checkpoint-evidence.v1`, the exact checkpoint,
project and region identities, `outcome: PASS`, a UTC capture time, and
checkpoint-specific facts. Evidence older than 30 minutes is rejected. The
script hashes the exact evidence bytes, adds
observed cloud facts, and appends them to an ordered SHA-256 chain. The ledger is
written with a generation-match precondition:

- `Preflight` anchors the ledger in the current artifact bucket;
- `RegionalFoundation` copies predecessor evidence and moves the canonical
  ledger to the EU artifact bucket;
- every later checkpoint reads, verifies, and extends the EU ledger;
- `Cutover` re-downloads every predecessor evidence object and verifies its hash.

Generate the complete plan:

```powershell
./deployment/gcp/Migrate-StagingRegion.ps1
```

Generate one checkpoint plan:

```powershell
./deployment/gcp/Migrate-StagingRegion.ps1 -Checkpoint DatabaseRehearsal
```

Apply exactly one checkpoint only after its preceding evidence gates pass:

```powershell
./deployment/gcp/Migrate-StagingRegion.ps1 `
  -Checkpoint RegionalFoundation `
  -Apply `
  -ConfirmProjectId innobase-matchbase-stg `
  -ResidualRiskAcknowledgement I_ACKNOWLEDGE_GLOBAL_REQUIRED_EDGE_PROVIDER_LIMITATIONS `
  -EvidencePath C:\governed-evidence\regional-foundation.json `
  -GcranePath "$env:LOCALAPPDATA\MatchBASE\tools\gcrane\v0.22.0\gcrane.exe"
```

`RegionalFoundation` Apply accepts only the governed Windows x86_64 `gcrane`
v0.22.0 executable (SHA-256
`094281bd4c98e1dbf805350f3f59a152244324fb86a4b4b908c741d012a9615d`).
The regional sink writes to a log bucket in the same Google Cloud project. That
closed configuration has no writer identity and requires no destination IAM
grant. Custom writer identities and the removed `--unique-writer-identity` flag
are not used.
Install it without changing a system-wide PATH:

```powershell
$toolRoot = Join-Path $env:LOCALAPPDATA "MatchBASE\tools\gcrane\v0.22.0"
$archive = Join-Path $env:TEMP "go-containerregistry_Windows_x86_64.v0.22.0.tar.gz"
New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
Invoke-WebRequest -UseBasicParsing `
  -Uri "https://github.com/google/go-containerregistry/releases/download/v0.22.0/go-containerregistry_Windows_x86_64.tar.gz" `
  -OutFile $archive
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant() -ne "2d4ce27bde9bd3b511bd7c0b5a4c9654dbadf43ee1da9eac083e6f1511282b32") { throw "gcrane archive checksum mismatch" }
tar -xf $archive -C $toolRoot gcrane.exe
if ((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $toolRoot "gcrane.exe")).Hash.ToLowerInvariant() -ne "094281bd4c98e1dbf805350f3f59a152244324fb86a4b4b908c741d012a9615d") { throw "gcrane executable checksum mismatch" }
Remove-Item -LiteralPath $archive -Force
```

`New-StagingRegionEvidence.ps1` is the closed evidence producer. It runs only
allowlisted read-only discovery commands, records their exact argv and stdout
SHA-256, binds the active gcloud account/project, tool versions, candidate Git
commit, explicit web/worker digests and predecessor-ledger metadata, then signs
the exact JSON bytes with a same-project `europe-west2` asymmetric Cloud KMS key.
The migration script downloads only that key version's public key and verifies
the detached RSA/SHA-256 signature before parsing or trusting evidence. Apply
also revalidates the active principal, project, candidate digests, raw-result
hashes and checkpoint-specific live safety facts. Hand-made JSON is rejected.

Generate one evidence envelope without exposing key material:

```powershell
./deployment/gcp/New-StagingRegionEvidence.ps1 `
  -Checkpoint Preflight `
  -CandidateCommit <EXACT_40_CHARACTER_GIT_COMMIT> `
  -WebSourceImageDigest <EXACT_SOURCE_WEB_DIGEST> `
  -WorkerSourceImageDigest <EXACT_SOURCE_WORKER_DIGEST> `
  -KmsKeyVersion projects/innobase-matchbase-stg/locations/europe-west2/keyRings/<KEY_RING>/cryptoKeys/<KEY>/cryptoKeyVersions/<VERSION> `
  -OutputPath C:\governed-evidence\preflight.json
```

Pass both `-EvidenceSignaturePath <evidence>.sig` and the exact
`-EvidenceKmsKeyVersion` to Apply. `SourceRetirement` additionally inventories
every source and target object version with name, generation, size and CRC32C;
reconciles every source generation as a name/size/CRC32C multiset; and proves
every persisted `artifact_version.storage_uri` returned by the closed read-only
`psql` query exists in the EU bucket before deletion. `RegionalFoundation`
copies source generations oldest-first before its live-object rsync so bucket
version history is retained. The database URL is supplied only through
`MATCHBASE_EVIDENCE_DATABASE_URL`; it is replaced by `<REDACTED_DATABASE_URL>`
in signed command provenance and is never printed or written to evidence.
Versioned artifact inventory uses the current `gcloud storage ls --all-versions
--json` contract and validates the nested object metadata before copying or
reconciliation; the removed `storage objects list --all-versions` form is not
used.

Canary and Cutover evidence is not operator-authored. The producer runs the
fixed `scripts/validate-staging-eu-acceptance.mjs` collector against
the closed canary using a loopback-only browser transport supplied through
`MATCHBASE_EVIDENCE_CDP_ENDPOINT`. It first clears MatchBASE cookies, completes
a real Google OAuth start/callback round trip, verifies that the callback issues
a new session and CSRF pair, and creates a new synthetic-only intake and run.
`MATCHBASE_EVIDENCE_GOOGLE_EMAIL` selects the exact signed-in test identity; it
does not supply or bypass Google credentials.
No session cookie, run ID, artifact grant ID, or artifact token can be supplied
as acceptance authority. The collector waits for that run's terminal result and
downloads only the uniquely run-bound PDF exposed by the profile. Cost is independently queried from
`cost_event`; missing, unknown, unpriced, non-USD or over-cap events fail.
Recent `europe-west2` application logs are independently queried through gcloud.
No free-form fact document is accepted.

The EU acceptance origin is never caller-selected. The public origin is the
closed `matchbase-staging-eu-canary.innobase.app` target; the direct origin,
service UID and generation come from the live `europe-west2` Cloud Run service.
The Canary uses the distinct `staging-eu-canary` deployment target and
`matchbase-staging-web-canary-ew2` service. Its runtime must expose exactly
`MATCHBASE_ORIGIN=https://matchbase-staging-eu-canary.innobase.app` and
`GOOGLE_REDIRECT_URI=https://matchbase-staging-eu-canary.innobase.app/auth/google/callback`.
The same redirect URI must be registered on the Google OAuth client before
Canary evidence can pass; the genuine Google callback is the authoritative
machine proof of that prerequisite. The main `staging-eu` target retains
`matchbase-staging.innobase.app` and cannot deploy under the Canary service name.
Canary routing adds only the closed canary host rule/path matcher and verifies
that the main Staging URL-map default service did not change.
Before producing Canary evidence, run `Configure-StagingCanaryEdge.ps1` in plan
mode and then Apply with the exact project confirmation. It reserves Cloud Armor
priorities `2000..2014` for the closed Cloudflare IPv4 list and exact Canary
Host while preserving original priorities `1000..1014` and default deny. It
creates Certificate Manager DNS authorizations for both exact hostnames. Their
CNAMEs remain DNS-only in Cloudflare while the application A remains proxied.
After authorization, a dual-SAN certificate and exact main/Canary certificate
map entries are created. Preflight permits only the known legacy main
certificate with no map or the exact governed map; every unrelated attachment,
name, SAN, type, state, or entry collision blocks mutation.
Issuance is asynchronous. Apply polls only Certificate Manager state and
observation time using bounded timeout and interval parameters. `PROVISIONING`
continues, `ACTIVE` permits proxy attachment, `FAILED` terminates with the
provider reason, and timeout leaves the HTTPS proxy unchanged. A rerun
revalidates the same governed resources and resumes polling without recreating
or detaching them.

Cloudflare Apply requires `CLOUDFLARE_API_TOKEN`,
`MATCHBASE_CANARY_ORIGIN_ADMISSION_KEY`, and the exact zone ID. Values remain
in memory and are never printed. The script preserves all unrelated late
transform rules, installs one exact Canary-host `MB-Origin-Admission` rule,
creates or reconciles the proxied A record to the governed global IPv4, and
refuses to proceed unless the zone already uses Full (strict). A proxied A
record supplies Cloudflare public IPv4 and IPv6 edge answers; evidence requires
both public A and AAAA resolution even though the origin connection is bound to
the governed IPv4. Canary OAuth acceptance is blocked until Cloud Armor rules,
certificate `ACTIVE`/SANs, HTTPS proxy attachment, proxied DNS, A/AAAA answers,
Full strict, and the redacted admission-value hash all pass independently.
The candidate Ready condition and exact revision are derived from the live
Cloud Run service. OAuth callback, canonicalization, run creation, terminal
result, and PDF timestamps must all follow candidate readiness. The producer
then matches the OAuth subject, run, artifact grant, PDF SHA-256, byte size, and
released result version against closed database queries.

Evidence production and Apply both require a completely clean tracked and
untracked worktree. Artifact Registry SLSA/in-toto provenance for each immutable
web and worker digest is parsed as a closed schema: exact subject digest, Git
material revision, source repository, builder ID, and build type are mandatory.
Unrelated text matches are rejected. Its hashes
are included in every ledger entry, immutable across checkpoints, and retrieved
again from Artifact Registry during Apply.

`Maintenance` does not accept a human readiness string. Its evidence must carry
zero active runs, zero queued runs, zero unreleased leases, and the exact hash of
the closed SQL query. Apply then performs and verifies these cloud-side actions:

- switch the URL map to the real EU maintenance backend;
- replace the source worker with a pinned `/bin/sleep 2147483647` quiescent
  revision;
- read the URL map and worker configuration back and fail on drift.

`Cutover` verifies the complete predecessor chain and exact live EU identities:

- web and worker image digests;
- route-policy SHA-256 and runtime image identity variables;
- Cloud SQL binding, region, state, PostgreSQL version, and migration head;
- OAuth, complete research, PDF, profile/admin, origin denial, responsive
  browser, latency, cost, and EU log-routing acceptance.

`PreWriteRollback` is prohibited after the first EU write. Apply directly runs
the closed target-database query against the Cutover ledger timestamp and requires
zero created research runs. Apply first
routes to maintenance, quiesces the EU worker, restores and verifies the exact
source worker/database, and only then returns the edge.

`Rollback` is the post-write path. It requires an exact previous EU web
revision, exact previous EU worker digest, numeric verified EU backup ID, and
matching evidence. It routes to maintenance, quiesces the EU worker, proves the
source worker remains quiesced, restores the EU database, restores both EU
runtime identities, and returns only to the EU backend. Returning a
write-capable application to the stale `me-central1` database is prohibited.

`SourceRetirement` is required to remove persistent source copies and close the
infrastructure portion of residency. It is unavailable until the hold timestamp
recorded by `Cutover` has expired and a successful European backup/restore,
artifact digest, EU secret replication, EU log routing, migration head, active
EU backend, and quiescent source worker are machine-verified. Apply additionally
requires:

```text
I_AUTHORIZE_VERIFIED_SOURCE_RETIREMENT_AND_CRYPTOGRAPHIC_ERASURE
```

The exact retirement order removes the unused source backend and NEG, source
web and worker runtimes, Cloud SQL deletion protection and instance, source
secrets, source bucket contents and bucket, and source Artifact Registry
repository. Target service accounts, global URL map, IP, certificate, Cloud
Armor policy, and EU resources are not deletion targets. Secret deletion remains
provider-recoverable during its service recovery window; SQL/bucket/repository
deletion occurs only after the EU recovery proof.

The residual acknowledgement does not resolve or waive the residuals. It makes
them impossible to overlook during mutation:

- the existing project `_Required` log bucket is global and immutable;
- the existing Cloudflare and global external Application Load Balancer edge
  are not region-pinned;
- the direct Gemini and general OpenRouter provider endpoints are not proven to
  process exclusively in Europe.

No European-residency claim is allowed until those boundaries, the protected
canary, regional load and latency, Cloud SQL integrity, OAuth, complete research
and PDF, profile/admin, audit, cost, origin-denial, and browser acceptance gates
all have recorded evidence and `SourceRetirement` has completed. Even then, the
global `_Required`, edge, and provider boundaries remain explicit residuals.

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
$routePolicyPath = 'config/slice3/research-route-policy.staging.v3.json'
$routePolicySha256 = (Get-FileHash -LiteralPath $routePolicyPath -Algorithm SHA256).Hash.ToLowerInvariant()
docker build --pull --target web-runtime `
  --build-arg DEPLOYMENT_ENVIRONMENT=staging `
  --build-arg ROUTE_POLICY_PATH=$routePolicyPath `
  --build-arg ROUTE_POLICY_SHA256=$routePolicySha256 `
  --tag staging-web .
docker build --pull --target worker-runtime `
  --build-arg DEPLOYMENT_ENVIRONMENT=staging `
  --build-arg ROUTE_POLICY_PATH=$routePolicyPath `
  --build-arg ROUTE_POLICY_SHA256=$routePolicySha256 `
  --tag "staging-worker-$($routePolicySha256.Substring(0, 16))" .
```

Publishing is deliberately separate. Resolve the pushed Artifact Registry image
to its immutable digest before running `Deploy-CloudRun.ps1`.

The governed Staging publisher is `Publish-StagingImages.ps1`. Its build source
is the exact commit in the closed Cloud Build 2nd-generation repository resource
`projects/innobase-matchbase-stg/locations/me-central1/connections/matchbase-github/repositories/matchbase`, never the local directory or an ungoverned raw Git URL. It
requires a clean worktree, the committed `cloudbuild.staging.yaml`, all required
APIs, the closed Artifact Registry repository, and a build service account with
exactly project `roles/logging.logWriter`, repository
`roles/artifactregistry.writer`, and no ancestor roles. The Cloud Build config
lists both images in its top-level `images` field; it contains no explicit push.
After publication the script resolves both immutable digests and validates each
Artifact Registry SLSA/in-toto statement with the closed EU provenance parser.
Before mutation it reads the repository as JSON and requires its exact
`me-central1` resource name, Docker format, and immutable tags. It also requires
Cloud Build, Artifact Registry, and Container Analysis APIs plus the complete
publisher permissions needed to submit builds and retrieve stored provenance.
The connection must be COMPLETE, not reconciling, and bound to GitHub App
installation `142544573`; the linked repository must retain the exact governed
remote URI and non-empty etags. Historical build
`2dc5254a-4048-4d19-a81b-fc3ee30f7d78` failed source fetch.
Historical build `acffc5a1-1c2f-4e70-920d-d0b558f87f08` then fetched source but
failed Docker step 0. Build `7a956868-3d02-414b-b4dc-988d7c215cdf` succeeded at
revision `fee259e18ce4a6ba73195e06f3248be0043d64a3` and published two images, but
`--show-provenance` returned only `image_summary`, unknown SLSA build level, and
no `provenance_summary`. Publisher admission therefore failed closed and no
deployment occurred. The `options.requestedVerifyOption=VERIFIED` correction was
runtime-derived/uncommitted at that historical checkpoint and was later
superseded by the published successful successor.

Build `9023f76a-e60c-41c0-b21d-d46f0d6a5817` subsequently succeeded with
`requestedVerifyOption=VERIFIED` at exact revision
`1f1a438685cb951a5bb30a17ca072aab1e1c6be6` and published two images. SLSA
level 3 appeared as one v1 plus one legacy v0.1 occurrence. The parser rejected
the cardinality/old schema and publisher admission failed closed before
deployment. Parser/build-record/retry correction was runtime-derived/uncommitted
at that historical checkpoint and was later superseded.

Build `b68c1bba-1e09-46ab-86f0-a493acbb7276` then succeeded with VERIFIED for
revision `e0af82b0af8bbfa8203f3d3cb04e836964bce4dc` and published two images.
Dual provenance validation passed, but PowerShell StrictMode scalar `.Count`
failed closed before exact build-record admission/output. No deployment
occurred. Explicit array-count patch/tests were runtime-derived/uncommitted at
that historical checkpoint and were later superseded.

Role 2 passed the repository deployment-admission remediation. Deployment still
fails closed unless `CandidateCommit` equals a clean `HEAD` and `origin/main`
and live source SLSA provenance validates both exact digests before mutation.
The main-region path validates the direct image. The EU path validates the exact
live target image identity and deterministic same-name/same-digest
`me-central1` source provenance. The two build `7a956868...` images remain
non-deployable. The combined VERIFIED/deploy-gate patch was
runtime-derived/uncommitted at that historical checkpoint and was later
published in the successful successor.

Plan and execute only after the candidate commit is pushed to `origin/main`:

```powershell
$candidate = (git rev-parse HEAD).Trim()
./deployment/gcp/Publish-StagingImages.ps1 -CandidateCommit $candidate
./deployment/gcp/Publish-StagingImages.ps1 -CandidateCommit $candidate `
  -Apply -ConfirmProjectId innobase-matchbase-stg
```

The repository image names are closed: `<environment>-web` and
`<environment>-worker-<first-16-route-policy-sha256>`. The deploy script rejects
digests published under any other name, and binds the complete digest and route
policy SHA-256 into each revision. Both images contain the exact qualified policy
bytes and verify their policy hash, environment, activation state, qualified route
set, and version before starting. The staging web secret set must bind
`MATCHBASE_GEMINI_API_KEY` to a numeric version of the closed target-map secret
`matchbase-gemini-api-key` for direct canonicalization. OpenRouter credentials
remain worker-only. After exact worker secret-access validation, deployment sets
the non-secret web marker `MATCHBASE_LIVE_RESEARCH_CREDENTIALS_VERIFIED=true`;
the web process never infers worker readiness from provider-key presence.

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
