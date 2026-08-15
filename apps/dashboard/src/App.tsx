import { useMemo, useState } from "react";
import { freshnessState, STATUS_ORDER, VIEW_META } from "./catalog";
import { SourceDrawer } from "./components/SourceDrawer";
import { StatusBadge } from "./components/StatusBadge";
import type { DashboardRecord, EvidenceState, ViewKey } from "./types";
import { VIEW_KEYS } from "./types";
import { useSnapshot } from "./useSnapshot";

function displayTime(value?: string) {
  if (!value || Number.isNaN(Date.parse(value))) return "UNKNOWN";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function Sidebar({
  active,
  onChange,
}: {
  active: ViewKey;
  onChange: (view: ViewKey) => void;
}) {
  return (
    <aside className="sidebar" aria-label="Dashboard sections">
      <div className="brand-mark" aria-label="MatchBASE">
        <span>M</span>
        <div>
          <strong>MatchBASE</strong>
          <small>Control Room</small>
        </div>
      </div>
      <nav>
        {VIEW_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className={
              active === key ? "nav-item nav-item--active" : "nav-item"
            }
            onClick={() => onChange(key)}
            aria-current={active === key ? "page" : undefined}
          >
            <span className="nav-item__short" aria-hidden="true">
              {VIEW_META[key].short}
            </span>
            <span>{VIEW_META[key].label}</span>
          </button>
        ))}
      </nav>
      <div className="readonly-lock">
        <span aria-hidden="true">◉</span>
        <div>
          <strong>READ ONLY</strong>
          <small>No mutation controls</small>
        </div>
      </div>
    </aside>
  );
}

function RecordCard({
  record,
  onInspect,
}: {
  record: DashboardRecord;
  onInspect: (record: DashboardRecord) => void;
}) {
  const facts = Object.entries(record.facts ?? {});
  return (
    <article className="record-card">
      <div className="record-card__header">
        <div>
          <p className="record-id">{record.id}</p>
          <h3>{record.title}</h3>
        </div>
        <StatusBadge state={record.status} />
      </div>
      <p>{record.summary}</p>
      {facts.length > 0 && (
        <dl className="facts">
          {facts.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value === null ? "UNKNOWN" : String(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="record-card__footer">
        <div className="record-context">
          <span>{record.owner ?? "Owner UNKNOWN"}</span>
          <span>{displayTime(record.updatedAt)}</span>
        </div>
        <button
          type="button"
          className="source-button"
          onClick={() => onInspect(record)}
        >
          Inspect {record.sourceRefs.length} source
          {record.sourceRefs.length === 1 ? "" : "s"}
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </article>
  );
}

export default function App() {
  const load = useSnapshot();
  const [active, setActive] = useState<ViewKey>("portfolio");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<EvidenceState | "ALL">("ALL");
  const [selected, setSelected] = useState<DashboardRecord | null>(null);
  const snapshot = load.snapshot;
  const view = snapshot?.views[active];
  const records = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return (view?.records ?? []).filter((record) => {
      const matchesStatus = status === "ALL" || record.status === status;
      const haystack =
        `${record.id} ${record.title} ${record.summary} ${record.owner ?? ""} ${(record.tags ?? []).join(" ")}`.toLocaleLowerCase();
      return matchesStatus && (!normalized || haystack.includes(normalized));
    });
  }, [query, status, view]);
  const counts = useMemo(() => {
    const all = Object.values(snapshot?.views ?? {})
      .flatMap((item) => item.records)
      .filter((item) => item.status !== "HISTORICAL");
    return {
      total: all.length,
      pass: all.filter((item) => item.status === "PASS").length,
      blocked: all.filter(
        (item) => item.status === "BLOCKED" || item.status === "ERROR",
      ).length,
      unknown: all.filter(
        (item) => item.status === "UNKNOWN" || item.status === "STALE",
      ).length,
    };
  }, [snapshot]);
  const freshness = snapshot ? freshnessState(snapshot.generatedAt) : "UNKNOWN";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Sidebar
        active={active}
        onChange={(key) => {
          setActive(key);
          setQuery("");
          setStatus("ALL");
        }}
      />
      <main id="main-content" className="main" tabIndex={-1}>
        <header className="topbar">
          <div>
            <p className="eyebrow">Product management observability</p>
            <h1>{VIEW_META[active].label}</h1>
          </div>
          <div className="snapshot-state">
            <span>Snapshot</span>
            <StatusBadge state={load.phase === "ERROR" ? "ERROR" : freshness} />
            <time dateTime={snapshot?.generatedAt}>
              {displayTime(snapshot?.generatedAt)} UTC
            </time>
          </div>
        </header>

        {load.phase === "LOADING" && (
          <div className="state-banner state-banner--loading" role="status">
            <strong>LOADING</strong>
            <span>Reading the current evidence snapshot.</span>
          </div>
        )}
        {load.phase === "ERROR" && (
          <div className="state-banner state-banner--error" role="alert">
            <strong>ERROR</strong>
            <span>{load.message}</span>
          </div>
        )}
        {freshness === "STALE" && load.phase !== "ERROR" && (
          <div className="state-banner state-banner--stale" role="status">
            <strong>STALE</strong>
            <span>
              The snapshot is older than 24 hours. Treat every conclusion as
              unverified.
            </span>
          </div>
        )}
        {snapshot?.notice && (
          <div className="state-banner" role="note">
            <strong>NOTICE</strong>
            <span>{snapshot.notice}</span>
          </div>
        )}

        <section className="metrics" aria-label="Snapshot metrics">
          <div className="metric">
            <span>Current records</span>
            <strong>{counts.total}</strong>
            <small>excluding superseded history</small>
          </div>
          <div className="metric metric--pass">
            <span>Verified</span>
            <strong>{counts.pass}</strong>
            <small>records with PASS evidence</small>
          </div>
          <div className="metric metric--blocked">
            <span>Blocked</span>
            <strong>{counts.blocked}</strong>
            <small>blocked or error records</small>
          </div>
          <div className="metric metric--unknown">
            <span>Uncertain</span>
            <strong>{counts.unknown}</strong>
            <small>unknown or stale records</small>
          </div>
        </section>

        <section className="view-panel" aria-labelledby="view-title">
          <div className="view-panel__heading">
            <div>
              <div className="heading-line">
                <h2 id="view-title">
                  {view?.label ?? VIEW_META[active].label}
                </h2>
                <StatusBadge state={view?.status ?? "UNKNOWN"} />
              </div>
              <p>{view?.description ?? VIEW_META[active].description}</p>
            </div>
            <span className="record-count">{records.length} visible</span>
          </div>
          <div className="filters" role="search">
            <label className="search-field">
              <span>Search this view</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ID, title, owner, or tag"
              />
            </label>
            <label className="select-field">
              <span>Evidence state</span>
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as EvidenceState | "ALL")
                }
              >
                <option value="ALL">All states</option>
                {STATUS_ORDER.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="record-grid">
            {records.map((record) => (
              <RecordCard
                key={record.id}
                record={record}
                onInspect={setSelected}
              />
            ))}
            {load.phase !== "LOADING" && records.length === 0 && (
              <div className="empty-state">
                <span className="empty-state__glyph" aria-hidden="true">
                  ∅
                </span>
                <strong>
                  {view?.records.length ? "No matching records" : "UNKNOWN"}
                </strong>
                <span>
                  {view?.records.length
                    ? "Change the local filters."
                    : "No evidence records are available for this view."}
                </span>
              </div>
            )}
          </div>
        </section>
        <footer>
          <span>Schema {snapshot?.schemaVersion ?? "UNKNOWN"}</span>
          <span>Build {snapshot?.buildRef ?? "UNKNOWN"}</span>
          <span>Client-side filters only</span>
        </footer>
      </main>
      <SourceDrawer record={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
