# MatchBASE current state and phase gate

## Precedence

This document is an additive current-state projection. Historical planning,
execution records, audits, failures and immutable results remain unchanged.
When a historical register conflicts with this projection about present
operational state, use
`governance/current-state-projection.v1.json` for the current view and retain
the historical record as provenance.

## Deployed predecessor, current source transition and Staging identity

- Source branch: `main`
- Deployed predecessor source:
  `1224b4c485a9f3533a15e1d50b606f7aa53c2d23`
- Initial governed remediation candidate: commit
  `77c58cd4c95dc8016d369080b095bed0e554cad1`, pushed to `origin/main`.
- Current hotfix source: derived at snapshot-generation time. The
  generator reports one of `WORKTREE_UNCOMMITTED`, `COMMITTED_UNPUBLISHED` or
  `PUBLISHED_SOURCE`, together with HEAD, `origin/main`, dirty state and an
  exact candidate SHA-256. No transition-sensitive state is hardcoded.
- Cloud Build GitHub connection: `COMPLETE` at
  `projects/innobase-matchbase-stg/locations/me-central1/connections/matchbase-github`.
- Linked repository resource:
  `projects/innobase-matchbase-stg/locations/me-central1/connections/matchbase-github/repositories/matchbase`,
  remote `https://github.com/banihashem/INNOBASE-MatchBASE.git`.
- GitHub App access is selected-repository scope including MatchBASE, not all
  repositories. Temporary `roles/secretmanager.admin` access was revoked.
- Repository visibility is `PUBLIC`, independently observed through the GitHub
  repository API after the owner changed it on 2026-09-01. Cloud Build remains
  bound to the governed linked-repository resource and exact commit.
- Build `7a956868-3d02-414b-b4dc-988d7c215cdf` succeeded for exact linked-source
  revision `fee259e18ce4a6ba73195e06f3248be0043d64a3` and published web digest
  `sha256:aef287862e2ce0dcb0a8e960df3226afc107f3a7e12024d8c882cc1f1ea8e212`
  and worker digest
  `sha256:e95f35067717731badf61accd80e2c974a6a63443dc3a739fb136667c86226ba`.
  Provenance inspection returned only `image_summary`, unknown SLSA build level,
  and no `provenance_summary`; the governed publisher failed closed and no
  deployment occurred. The `options.requestedVerifyOption=VERIFIED` correction
  is uncommitted/runtime-derived. Both earlier failed builds remain historical.
- Role 2 passed the repository deployment-admission remediation. Before any
  mutation, `Deploy-CloudRun.ps1` requires `CandidateCommit` to equal clean
  `HEAD` and `origin/main`, plus live source SLSA provenance for both exact
  digests. The main-region path validates the direct image. The EU path validates
  exact live target identity and deterministic same-name/same-digest
  `me-central1` source provenance. Build `7a956868...` images remain
  non-deployable. The combined VERIFIED/deploy-gate patch is
  uncommitted/runtime-derived.
- Build `9023f76a-e60c-41c0-b21d-d46f0d6a5817` succeeded with VERIFIED
  provenance requested for revision `1f1a438685cb951a5bb30a17ca072aab1e1c6be6`
  and published web digest
  `sha256:1efa936f4fa1ea56c39c2985a1616b1e22f9f9ad8b782ada2ee589020ebb0817`
  plus worker digest
  `sha256:f5f40a8602c4f23dcea0e3b3e9a7e5a6153d2e2ea135cf297e1eda8ca4b0146b`.
  SLSA level 3 appeared as one v1 and one legacy v0.1 occurrence. Parser
  cardinality/old-schema admission failed closed; no deployment occurred. The
  parser/build-record/retry correction is uncommitted/runtime-derived.
- Build `b68c1bba-1e09-46ab-86f0-a493acbb7276` succeeded with VERIFIED for
  revision `e0af82b0af8bbfa8203f3d3cb04e836964bce4dc`, publishing web digest
  `sha256:a2a0a031997d12564975103ae0b073aadfe2b1e8fb00494afe6e0b41514ec76f`
  and worker digest
  `sha256:4cc8bd46d3931b1a918a2af1505f390a5f86a6c3aae56d4877f4a8399163ae7a`.
  Dual provenance validation passed. Publisher then failed closed on PowerShell
  StrictMode scalar `.Count` before exact build-record admission/output. No
  deployment occurred. Explicit array-count patch/tests are
  uncommitted/runtime-derived.
- Staging project: `innobase-matchbase-stg`
- Region: `me-central1`
- Public origin: `https://matchbase-staging.innobase.app`
- Web revision: `matchbase-staging-web-00034-cn5`, 100 percent traffic
- Worker revision: `matchbase-staging-worker-00045-k2b`
- Database migration head: `0011_admin_system_scope_and_run_tier_immutability`
- Production: untouched
- Current Staging disposition: degraded; the deployed revisions are
  predecessors and do not contain the current remediation candidate.
- Residency disposition: nonconforming; `me-central1` does not satisfy the
  owner-authorized Europe processing and persistent-storage boundary.

## Operational capabilities

The deployed predecessor established qualified-live, profile and Admin
capabilities in its recorded acceptance. Current remediation is not bound to a
successor deployment; those predecessor results cannot be projected as
acceptance of the runtime-derived current source.

## Phase disposition

The completed P5 Staging feature loop is not equivalent to completion of
Roadmap P5, `Evaluation and Hardening`. Roadmap P5 remains active until all of
the following have exact evidence:

1. T-1 through T-11 are enforced as CI release blockers, including a
   demonstrated failing gate that blocks merge.
2. A Staging revision rollback is executed and timed.
3. A PITR restore is executed and timed in a non-production project.
4. The per-run spend ceiling is demonstrated to abort a run.
5. Every launch and rollback runbook has a named owner and recorded read
   acknowledgement.
6. Independent Role 2 repository/remediation audit: PASS with zero Critical or
   Major defects on the exact stable bytes. This does not satisfy the separate
   external-state, deployment, migration or live-acceptance evidence gates.

The initial governed remediation candidate was committed and pushed. No image
build or publication, Staging/EU deployment, database migration,
OAuth/Cloudflare apply, or live acceptance has been performed for it. The
current hotfix remains runtime-derived and has no hardcoded future commit hash.
Each operational transition remains a separate evidence-gated operation.

Roadmap P6 real-data pilot remains blocked until every Roadmap P5 exit criterion
and every P6 precondition passes. Production release remains unauthorized.

## Machine-readable projection

The dashboard and governance consumers must use
`governance/current-state-projection.v1.json`. Historical Slice 0 through P4
records remain visible as historical evidence and must not override present
Staging facts.
