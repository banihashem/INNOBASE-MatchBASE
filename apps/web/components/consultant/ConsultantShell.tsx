import type { ReactNode } from "react";
import "./consultant-experience.css";

export function ConsultantShell({
  children,
  active,
  actions,
}: {
  children: ReactNode;
  active?: "home" | "history" | "research" | "reports" | "profile";
  actions?: ReactNode;
}) {
  return (
    <div className="consultant-experience">
      <a className="cx-skip" href="#main-content">
        Skip to content
      </a>
      <header className="consultant-shell-header">
        <div className="consultant-shell-header-inner">
          <a href="/" className="cx-brand" aria-label="MatchBASE dashboard">
            <span className="cx-brand-mark" aria-hidden="true">
              M
            </span>
            <span>
              MatchBASE<small>CONSULTANT WORKSPACE</small>
            </span>
          </a>
          <nav aria-label="Consultant navigation">
            {(
              [
                ["home", "Dashboard"],
                ["history", "Research"],
                ["reports", "Reports"],
                ["profile", "Profile"],
              ] as const
            ).map(([key, label]) => (
              <a
                key={key}
                href={`/?view=${key}`}
                aria-current={
                  active === key || (key === "history" && active === "research")
                    ? "page"
                    : undefined
                }
              >
                {label}
              </a>
            ))}
          </nav>
          {actions && <div className="cx-shell-actions">{actions}</div>}
        </div>
      </header>
      <main id="main-content" className="consultant-shell-main">
        {children}
      </main>
    </div>
  );
}
