# MatchBASE Staging product and Admin guide

## Environment

- Public entry point: `https://matchbase-staging.innobase.app/`
- Environment: isolated Staging only
- Authentication: Google OAuth
- Research route: server-assigned; the UI must display either `Synthetic reference` or `Qualified live research`
- Production is not authorized by this guide.

## User profile

Every authenticated Demo, Standard, or Consultant workspace exposes `Profile`.
The profile is owner-scoped and contains canonical request history, research-run
state, outcome, and the result projection fixed at submission time. History is
paginated in bounded pages; `Load more history` retrieves the next owner-bound
page.

An entitlement upgrade does not rewrite or widen a historical result. A Demo
run remains Demo-projected, a Standard run remains Standard-projected, and a
Consultant run remains Consultant-projected when the current entitlement is
sufficient to read it.

## Super-admin product access

An identity must have both the stored `admin` entitlement and an active stored
`super_admin` grant. UI state or request data cannot create this authority.

- `/` — Admin operations home
- `/admin/product` — owner-bound structured request and qualified-live execution
- `/admin/profile` — the Admin identity's own requests, runs, and submission-bound results
- `/admin/research` — bounded system-wide inventory of all users' research across accounts
- `/admin/entitlements` — governed entitlement operations
- `/admin/requests` — governance queue

Admin product execution keeps the persisted identity as `admin`. The server
assigns Consultant product depth for quota, execution, and result projection
only after re-reading the stored `super_admin` grant. A Consultant-tier result
is never down-projected through the Standard result endpoint; it is disclosed
through the Admin profile's Consultant route.

The system-wide inventory excludes email, submitted source text, evidence
bodies, provider failures, and complete result documents. Every inventory page
requires a specific operational purpose. Purpose is bound to pagination and the
immutable access audit. Opening a complete result additionally requires a
written justification, CSRF validation, a unique idempotency key, stored
authority revalidation, and a separate immutable disclosure audit. Account
analysts remain account-scoped and cannot use the system-wide path.

`tier_at_submission` is an immutable server-owned fact. Migration
`0011_admin_system_scope_and_run_tier_immutability` installs an `ALWAYS` trigger
that rejects historical tier changes. An entitlement upgrade permits only the
projection authorized by the stored submission tier; it never rewrites a run.

## Evidence and verification boundary

Qualified live research uses the controlled fetch pipeline and the closed
provider policy. A successful fetch is not external verification. External
verification requires an independent corroborating source or authoritative
registry evidence. Supplier titles and publisher text remain display claims.

The explicit OpenRouter route requires request-level ZDR, denied data
collection, required parameters, disabled broker fallback, closed Google Vertex
ordering, and exact served-provider/model identity.

## Staging acceptance test

1. Open `https://matchbase-staging.innobase.app/` and sign in with Google.
2. Confirm that the header displays the server-assigned research mode.
3. For Super-admin, open `/admin/product`.
4. Submit the three-part request: need, mandatory constraints, and preferences/context.
5. Review and confirm the canonical English request.
6. Start the run and wait for a terminal state. Do not reload while the request is still being canonicalized.
7. Open `/admin/profile`; confirm that the new request and run are present.
8. Open the result from the profile and verify that its projection matches the tier recorded at submission.
9. Open `/admin/research`, enter a specific operational purpose, and load the system-wide inventory.
10. Confirm that the run appears with its opaque account and user identifiers and submission tier, but without email or raw submitted source text.
11. Enter a separate specific disclosure justification and open the complete result. Confirm that the immutable disclosure audit is created before result bytes are returned.

For an ordinary user, use the workspace `Profile` control and repeat steps 4–8.
If the profile has more than 50 requests or runs, use `Load more history` until
no continuation remains.

## Failure handling

- `Rolling quota exceeded` means the owner-bound rolling capacity is exhausted; it is not a provider result.
- A terminal `no responsible match` means the controlled evidence did not prove every mandatory constraint; it is not a processing failure.
- A provider or transport failure remains a terminal failed run and must not be converted into a no-match result or shown indefinitely as pending.
- Preserve the displayed correlation ID when reporting a failure.

## 2026-09-01 qualified Staging acceptance evidence

- Route policy: `slice3-routes.2026-09-01.staging-qualified-v3`
- Route-policy SHA-256: `b752d2d42a63aaad11f3b89f67bad64861ce767f633bee8190549df23a6f4155`
- Web revision: `matchbase-staging-web-00029-tj4`
- Web image: `sha256:9e768f3f9e6c8cfd74df1aae77ad54212044c104bbf0f5c70b9c81f64f5d1489`
- Worker revision: `matchbase-staging-worker-00045-k2b`
- Worker image: `sha256:ca6d1627309ce333dcbde354b17d4588135fa2993988bf24a4de39ca264c191d`
- Final qualified run: `3898ed1c-d237-42eb-9001-a0409a185895`
- Result contract: `complete-result-foundation.v2`
- Result outcome: one eligible and one displayed Consultant candidate, five retained source facts, four excluded evidence records, and no soft-cap truncation.
- Owner profile read: passed through `/admin/profile` with the immutable Consultant submission projection.
- System inventory read: passed through `/admin/research` with a separate inventory purpose.
- Cross-account complete-result read: passed only after a separate operational justification; immutable disclosure audit `84a1e926-885a-40c2-8ef5-cc63a15c4d01` was returned with the result.
- Public health: `GET /api/v1/health` returned HTTP `200` with `{"status":"ok"}`.

Migration `0011_admin_system_scope_and_run_tier_immutability` was applied only to
the authorized Staging database after backup verification. Its down migration
and rollback were verified before the final reapply. Production was not
mutated.

The reviewed implementation, migration, policy, tests, and this guide were
published to `origin/main` in feature commit
`6166195c0fb1d53496c183571aea806217708dc1` before the additive documentation
closure. Credential files and temporary diagnostic files were excluded.
