import {
  type WorkspaceSession,
  userFacingSessionName,
} from "../standard/types";

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
          <a className="nav-button" href="/admin/product">
            Product research
          </a>
          <a className="nav-button" href="/admin/profile">
            My results
          </a>
          <a className="nav-button" href="/admin/research">
            All research
          </a>
          <a className="nav-button" href="/admin/entitlements">
            Entitlements
          </a>
          <a className="nav-button" href="/admin/requests">
            Governance queue
          </a>
        </nav>
        <div className="identity">
          <span>
            <bdi dir="auto">{userFacingSessionName(initialSession)}</bdi>
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
            Administrative authority and product execution remain distinct.
            Super-admin may use the governed product workspace without changing
            the stored Admin entitlement or inheriting authority from the UI.
          </p>

          <div
            className="admin-quick-launcher"
            style={{
              display: "flex",
              gap: "1rem",
              flexWrap: "wrap",
              margin: "1.5rem 0 2rem",
            }}
          >
            <a
              className="primary-action"
              href="/admin/product"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.875rem 1.5rem",
                fontSize: "1.05rem",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              🚀 Launch new sourcing research
            </a>
            <a
              className="secondary-action"
              href="/admin/entitlements"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.875rem 1.25rem",
                textDecoration: "none",
              }}
            >
              👥 Manage user roles &amp; entitlements
            </a>
            <a
              className="secondary-action"
              href="#system-configuration"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.875rem 1.25rem",
                textDecoration: "none",
              }}
            >
              ⚙️ View system configuration
            </a>
          </div>

          <div className="admin-boundary" role="note">
            <strong>Server-owned authorization boundary</strong>
            <p>
              Each destination independently verifies the Admin tier and the
              required sub-role. This page does not elevate access.
            </p>
          </div>

          <div className="admin-operations-grid">
            <article className="admin-operation-card">
              <p className="eyebrow">Product execution</p>
              <h2>Admin research workspace</h2>
              <p>
                Submit owner-bound product research without changing the Admin
                entitlement. The server re-verifies Super-admin authority and
                records new runs at Consultant disclosure depth.
              </p>
              <a className="primary-action" href="/admin/product">
                Start product research
              </a>
            </article>

            <article className="admin-operation-card">
              <p className="eyebrow">Personal profile</p>
              <h2>My research results</h2>
              <p>
                Review research submitted by this Admin identity and open the
                projection fixed when each run was created.
              </p>
              <a className="secondary-action" href="/admin/profile">
                Open my results
              </a>
            </article>

            <article className="admin-operation-card">
              <p className="eyebrow">System oversight</p>
              <h2>All research runs</h2>
              <p>
                Inspect bounded run records and outcomes across all accounts.
                Inventory and complete-result access require recorded
                operational purposes.
              </p>
              <a className="secondary-action" href="/admin/research">
                Open research inventory
              </a>
            </article>

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

          <section
            id="system-configuration"
            className="admin-role-summary"
            style={{
              marginTop: "2rem",
              borderTop: "1px solid var(--line)",
              paddingTop: "1.5rem",
            }}
            aria-labelledby="system-config-title"
          >
            <p className="eyebrow">Platform Governance &amp; Infrastructure</p>
            <h2 id="system-config-title">System Configuration &amp; Health</h2>
            <p className="lede">
              Live inspection of model route policies, cloud residency
              boundaries, and cryptographic qualification status.
            </p>

            <div
              className="admin-operations-grid"
              style={{ marginTop: "1rem" }}
            >
              <article className="admin-operation-card">
                <p className="eyebrow">Model Gateway</p>
                <h3>Route Policy v4</h3>
                <p>
                  <strong>Active Route Policy:</strong>{" "}
                  <code>slice3-routes.staging-qualified-v4</code>
                  <br />
                  <strong>Primary:</strong> Google Gemini 2.5 Pro &amp; Flash
                  <br />
                  <strong>Fallback:</strong> OpenRouter Azure OpenAI (KMS
                  RSA-SHA256 Qualified)
                </p>
                <div style={{ marginTop: "0.75rem" }}>
                  <span
                    className="tier-badge"
                    style={{ backgroundColor: "#065f46", color: "#6ee7b7" }}
                  >
                    Verified Active
                  </span>
                </div>
              </article>

              <article className="admin-operation-card">
                <p className="eyebrow">Data Residency</p>
                <h3>Europe Boundary (europe-west2)</h3>
                <p>
                  <strong>Host Region:</strong> London (europe-west2)
                  <br />
                  <strong>Edge Protection:</strong> Cloudflare Strict SSL +
                  Google Cloud Armor
                  <br />
                  <strong>Admission:</strong> Server-owned Origin Admission
                </p>
                <div style={{ marginTop: "0.75rem" }}>
                  <span
                    className="tier-badge"
                    style={{ backgroundColor: "#065f46", color: "#6ee7b7" }}
                  >
                    Governed Residency
                  </span>
                </div>
              </article>

              <article className="admin-operation-card">
                <p className="eyebrow">Reporting &amp; PDF</p>
                <h3>Consultant Deliverables</h3>
                <p>
                  <strong>Toolchain:</strong> Consultant PDF Generator Runtime
                  <br />
                  <strong>Domain Packs:</strong> Food &amp; Agricultural
                  Commodities (Active)
                  <br />
                  <strong>Attestation:</strong> Cryptographic Field Provenance
                </p>
                <div style={{ marginTop: "0.75rem" }}>
                  <span
                    className="tier-badge"
                    style={{ backgroundColor: "#065f46", color: "#6ee7b7" }}
                  >
                    Operational
                  </span>
                </div>
              </article>
            </div>
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
