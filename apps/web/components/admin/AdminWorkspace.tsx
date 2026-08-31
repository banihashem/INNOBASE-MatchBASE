import type { WorkspaceSession } from "../standard/types";

export function AdminWorkspace({
  initialSession,
}: {
  initialSession: WorkspaceSession;
}) {
  const adminRoles = initialSession.admin_sub_roles ?? [];

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header standard-header">
        <a className="brand" href="/" aria-label="MatchBASE home">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <span>MatchBASE</span>
        </a>
        <nav aria-label="Admin operations">
          <a className="nav-button" href="/admin/entitlements">
            Entitlements
          </a>
          <a className="nav-button" href="/admin/requests">
            Governance queue
          </a>
        </nav>
        <div className="identity">
          <span>
            <bdi dir="auto">{initialSession.display_name}</bdi>
          </span>
          <span className="tier-badge">Admin</span>
        </div>
      </header>
      <main className="main standard-main" id="main-content">
        <section
          className="standard-section admin-operations"
          aria-labelledby="admin-workspace-title"
        >
          <p className="eyebrow">Admin operations</p>
          <h1 id="admin-workspace-title">Operational control workspace</h1>
          <p className="lede">
            Administrative access is isolated from product research. The Admin
            tier does not grant Standard runs, Consultant results, or product
            execution capacity.
          </p>

          <div className="admin-boundary" role="note">
            <strong>Server-owned authorization boundary</strong>
            <p>
              Each destination independently verifies the Admin tier and the
              required sub-role. This page does not elevate access.
            </p>
          </div>

          <div className="admin-operations-grid">
            <article className="admin-operation-card">
              <p className="eyebrow">Identity governance</p>
              <h2>Entitlement management</h2>
              <p>
                Review or change tier assignments and administrative sub-roles.
                Mutations require the exact super_admin sub-role and produce a
                durable audit record.
              </p>
              <a className="primary-action" href="/admin/entitlements">
                Open entitlement manager
              </a>
            </article>

            <article className="admin-operation-card">
              <p className="eyebrow">Run governance</p>
              <h2>Governance queue</h2>
              <p>
                Inspect operational escalations, output restrictions, and
                evaluation failures. Access remains limited by the server-owned
                sub-role matrix.
              </p>
              <a className="secondary-action" href="/admin/requests">
                Open governance queue
              </a>
            </article>
          </div>

          <section
            className="admin-role-summary"
            aria-labelledby="admin-role-summary-title"
          >
            <h2 id="admin-role-summary-title">Resolved administrative roles</h2>
            {adminRoles.length > 0 ? (
              <ul>
                {adminRoles.map((role) => (
                  <li key={role}>
                    <code>{role}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p role="status">
                No administrative sub-role is assigned. Protected operations
                will remain unavailable.
              </p>
            )}
          </section>
        </section>
      </main>
      <footer>
        <span>Admin tier · Operational access only</span>
        <span>
          {initialSession.environment === "local"
            ? "Local reference environment"
            : "Staging environment"}
        </span>
      </footer>
    </>
  );
}
