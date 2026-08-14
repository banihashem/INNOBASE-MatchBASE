import { useEffect, useRef } from "react";
import type { DashboardRecord } from "../types";

interface SourceDrawerProps {
  record: DashboardRecord | null;
  onClose: () => void;
}

function lineLabel(start?: number, end?: number) {
  if (!start) return "Whole artifact";
  return end && end !== start ? `Lines ${start}–${end}` : `Line ${start}`;
}

export function SourceDrawer({ record, onClose }: SourceDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!record) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const background = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".app-shell > .sidebar, .app-shell > .main",
      ),
    );
    const priorAriaHidden = background.map((element) =>
      element.getAttribute("aria-hidden"),
    );
    for (const element of background) {
      element.inert = true;
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }
    closeRef.current?.focus();
    const constrainKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last) ||
        !drawerRef.current?.contains(document.activeElement)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", constrainKeyboard);
    return () => {
      document.removeEventListener("keydown", constrainKeyboard);
      background.forEach((element, index) => {
        element.inert = false;
        element.removeAttribute("inert");
        const prior = priorAriaHidden[index];
        if (prior == null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", prior);
      });
      previouslyFocused?.focus();
    };
  }, [record, onClose]);

  if (!record) return null;
  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside
        ref={drawerRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-title"
      >
        <div className="drawer__header">
          <div>
            <p className="eyebrow">Source drilldown</p>
            <h2 id="source-title">{record.title}</h2>
          </div>
          <button
            ref={closeRef}
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close source drilldown"
          >
            ×
          </button>
        </div>
        <p className="drawer__summary">{record.summary}</p>
        {record.sourceRefs.length === 0 ? (
          <div className="empty-state empty-state--compact">
            <strong>UNKNOWN</strong>
            <span>No source reference is attached to this record.</span>
          </div>
        ) : (
          <ol className="source-list">
            {record.sourceRefs.map((source, index) => (
              <li key={`${source.sourceId}-${index}`}>
                <div className="source-list__top">
                  <code>{source.sourceId}</code>
                  <span>{lineLabel(source.lineStart, source.lineEnd)}</span>
                </div>
                <p className="source-path">{source.path}</p>
                {source.section && (
                  <p>
                    <span className="muted">Section:</span> {source.section}
                  </p>
                )}
                <dl className="source-meta">
                  <div>
                    <dt>SHA-256</dt>
                    <dd>{source.sha256 ?? "UNKNOWN"}</dd>
                  </div>
                  <div>
                    <dt>Observed</dt>
                    <dd>{source.observedAt ?? "UNKNOWN"}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}
