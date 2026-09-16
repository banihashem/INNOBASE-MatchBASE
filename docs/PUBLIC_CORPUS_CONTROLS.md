# Public corpus controls

Activity: MB-ARCH-IMPLEMENT-001 L04. This is a backend control boundary, not an activated shared product feature.

`publicCorpusReadiness()` always returns `shared_access_enabled: false` until a verified application identity adapter and its production role binding are separately qualified. The Consultant simulator, a non-bypass role check, successful fixtures, and an environment switch cannot satisfy that requirement. No product route currently invokes acquisition, release, or shared lookup. These controls make no web request or paid model call.

## Acquisition and release

`nominatePublicSource()` returns an HTTPS origin only. It removes path, query and fragment and rejects credentials, literal IPs and local/reserved names. A nomination authorizes nothing. It must not schedule request-driven acquisition: publication timing and rare-category demand leakage remain unresolved. The only supported acquisition purpose is an independently scheduled public catalogue.

A separate releaser records an explicit `manual_unpaid` authority with a catalogue job, exact public source URL, expiry and observation allowance. This is authority to accept supplied independently acquired public evidence; it is not a free provider-call allowance. Automated fetching or model acquisition needs a new explicitly costed admission adapter. Private requests, ranking, confidential prices and private source payloads are rejected as extra acquisition fields. Query strings, percent-encoded paths, fragments and credentials are not accepted as acquisition source URLs.

The authoritative SQL policy also rejects all literal-IP forms, single-label or malformed hosts, reserved/internal/local suffixes, and explicit ports. Acquisition and release recheck this policy so older authority/source rows cannot bypass it; reads and derivative admission reject such legacy origins too. This is syntactic admission without DNS resolution. A public-shaped hostname, tenant subdomain, or supplied licence reference still needs the independent public-purpose review; it does not establish a public resource or authorize network access.

An acquirer records source assertion identity, original publication and retrieval dates, classification, use validity, rights basis and licence reference. Public price observations require an actual publication date less than 30 days old; retrieval does not replace publication. Supported redistributable bases are public domain or explicit redistribution licence. A distinct release capability supplies a rights-review reference before facts become readable. These records are public observations, not verified supplier qualification or independent corroboration of copied assertions. No personalized fit or private vector is promoted.

The internal public acquisition lineage has its own profile, catalogue-run, acquisition-execution and classification assignment IDs. It never copies a private buyer's run or profile. Readers receive public source provenance and facts only. Their own derivative/use manifests retain their authenticated account/profile lineage separately.

## Database privilege boundary

Migration 0023 creates a revoked dedicated schema and forced row-level security. No application role is created or granted access by migration. `provisionPublicCorpusRoles()` is an explicit administrative transaction: it creates separate non-login owner, reader, acquirer and releaser roles; transfers only this schema's ownership; and grants only narrow function execution. Pre-existing role names are refused for inspection rather than adopted. Roles cannot grant themselves capabilities or access private research tables.

Administrative identity binding maps an authenticated PostgreSQL session principal to one account/profile/capability. Functions check `SESSION_USER`, not caller-set request variables or `SET ROLE`. Superuser, bypass-RLS, role-administration, public-schema-owner membership and private-observation readers are rejected. Principal bindings must come from verified identity infrastructure; test fixture bindings do not establish real authentication. Do not give application principals membership in the owner role. The owner has no login and no private-table grants. Security-definer functions use a fixed `pg_catalog` search path and schema-qualified objects.

## Rights, derivatives and restore

Publication must register or recheck dependencies inside the same transaction as the consuming output write. Source epochs and share locks fence concurrent withdrawal. Withdrawal invalidates every observation for the affected source, blocks reacquisition, replaces claim text with a withdrawal marker, invalidates registered use/report/cache/index/summary derivatives and records immutable, gap-free tombstones. Retrieval and export checks reject stale epochs and other profiles' manifests. No private vector/shared training is included. External derivative bytes require their storage adapter to honor invalidation and remove inaccessible bytes; this backend does not promise to delete files already downloaded by users.

Release, lookup, new derivatives and existing derivative/export checks require an active source with an epoch matching the observation, as well as the observation's own eligibility. Restore replay invalidates and redacts every retained observation and dependent derivative for the tombstone's source even if the named assertion is absent from the restored snapshot. Publication remains closed while restore reconciliation is incomplete.

Before serving any restored corpus, call `beginPublicCorpusRestore()`, obtain the complete independently retained tombstone watermark and sequence, then call `reconcilePublicCorpusTombstones()`. Reconciliation rejects incomplete, conflicting or regressed sequences and restores source-level withdrawal before reopening reads. Initial corpus reads are closed until reconciliation at watermark zero. A database backup alone cannot prove that post-backup withdrawals are absent. The restore operator remains responsible for retaining that external ledger and closing restored serving before exposure; no production restore service has been activated here.

## Qualification

The isolated PostgreSQL suite exercises real role grants and session identities, forced RLS after an accidental SELECT grant, private table denial, self-grant/owner-role denial, catalogue-only authority, separate release, profile-specific derivative access, lock contention, source-wide withdrawal/reacquisition denial, and restore replay. It uses supplied fixtures without network acquisition. Production identity, public content licensing, catalogue scheduling/timing privacy, derivative storage deletion, retrieval quality and lifecycle economics remain separate release gates.
