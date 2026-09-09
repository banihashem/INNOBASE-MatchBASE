"use client";

import { useState } from "react";
import "./consultant-entry.css";

export function ConsultantEntry({
  authPath,
  state,
  demonstration = false,
  csrfToken,
}: {
  authPath: string;
  state: "signed-out" | "access-required" | "error";
  demonstration?: boolean;
  csrfToken?: string | undefined;
}) {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  async function switchAccount() {
    setSigningOut(true);
    setError("");
    try {
      const response = await fetch("/auth/logout", {
        method: "POST",
        headers: {
          "X-CSRF-Token": csrfToken ?? "",
          "Idempotency-Key": `signout-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
      });
      if (!response.ok) throw new Error("Sign out failed");
      window.location.assign(authPath);
    } catch {
      setError(
        "We could not sign you out. Your account is unchanged. Try again.",
      );
      setSigningOut(false);
    }
  }
  return (
    <div className="consultant-entry">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="ce-header">
        <a className="ce-brand" href="/">
          Match<span>BASE</span>
          <small>CONSULTANT WORKSPACE</small>
        </a>
        <span className="ce-label">B2B sourcing intelligence</span>
      </header>
      <main id="main-content">
        <section className="ce-hero">
          <div>
            <p className="ce-eyebrow">Research with a clear next step</p>
            <h1>
              Find suppliers.
              <br />
              <span>Understand the fit.</span>
            </h1>
            <p className="ce-lead">
              Turn your buying requirements into a supplier shortlist you can
              assess. Review the plan, control research costs, and explore the
              evidence behind every result.
            </p>
            {state === "error" ? (
              <div className="ce-notice" role="alert">
                <h2>We couldn’t open your workspace</h2>
                <p>
                  Your saved research is retained. Reload to check your
                  connection and sign-in.
                </p>
                <button onClick={() => window.location.reload()}>
                  Reload workspace
                </button>
              </div>
            ) : state === "access-required" ? (
              <div className="ce-notice">
                <h2>Consultant access required</h2>
                <p>
                  This workspace is currently available to Consultant accounts.
                  Signing in does not change your account’s access.
                </p>
                <button disabled={signingOut} onClick={switchAccount}>
                  {signingOut ? "Signing out…" : "Use another account"}
                </button>
                {error && <p role="alert">{error}</p>}
              </div>
            ) : (
              <>
                <a className="ce-primary" href={authPath}>
                  {authPath.startsWith("/auth/simulator/")
                    ? "Sign in as Consultant"
                    : "Continue with Google"}
                  <span aria-hidden="true"> →</span>
                </a>
                <p className="ce-caption">
                  Your requests, approvals and reports stay in your workspace.
                </p>
              </>
            )}
            {demonstration && (
              <p className="ce-notice">
                This environment uses demonstration data. It does not perform
                live supplier research.
              </p>
            )}
          </div>
          <aside
            className="ce-preview"
            aria-label="What your research includes"
          >
            <div className="ce-preview-heading">
              <span className="ce-dot" aria-hidden="true" />
              From request to evidence
            </div>
            <ol>
              <li>
                <span>01</span>
                <div>
                  <h2>Describe your requirements</h2>
                  <p>
                    Product, technical specifications and order profile, in any
                    language.
                  </p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <h2>Review and approve</h2>
                  <p>
                    Check the English interpretation and research plan before
                    searching.
                  </p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <h2>Compare supplier findings</h2>
                  <p>
                    Explore ranked profiles, available prices, dated sources and
                    unresolved gaps.
                  </p>
                </div>
              </li>
            </ol>
            <div className="ce-preview-footer">
              Saved progress <span aria-hidden="true">·</span> Cost approval{" "}
              <span aria-hidden="true">·</span> English PDF reports
            </div>
          </aside>
        </section>
        <section className="ce-principles" aria-label="You stay in control">
          <div>
            <h2>Your decision at every round</h2>
            <p>
              See the estimated cost before research. Further rounds need your
              approval.
            </p>
          </div>
          <div>
            <h2>Evidence you can inspect</h2>
            <p>
              Supplier details distinguish sourced information from gaps that
              still need confirmation.
            </p>
          </div>
          <div>
            <h2>A workspace you can return to</h2>
            <p>
              Reopen saved requests, follow progress and download completed
              reports.
            </p>
          </div>
        </section>
      </main>
      <footer className="ce-footer">
        MatchBASE by INNOBASE <span>Consultant research workspace</span>
      </footer>
    </div>
  );
}
