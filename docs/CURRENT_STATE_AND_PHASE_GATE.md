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
