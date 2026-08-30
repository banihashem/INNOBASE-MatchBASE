"use client";

import { useEffect, useState } from "react";
import { ProductFlow } from "./ProductFlow";
import { StandardWorkspace } from "./standard/StandardWorkspace";
import type { WorkspaceSession } from "./standard/types";
import { ConsultantWorkspace } from "./consultant/ConsultantWorkspace";

type Resolution =
  | { state: "loading" }
  | { state: "demo-or-signed-out" }
  | { state: "standard"; session: WorkspaceSession }
  | { state: "consultant"; session: WorkspaceSession }
  | { state: "unavailable"; tier: string }
  | { state: "error" };

export function ProductRouter({ authPath }: { authPath: string }) {
  const [resolution, setResolution] = useState<Resolution>({
    state: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/me", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          setResolution({ state: "demo-or-signed-out" });
          return;
        }
        if (!response.ok) throw new Error("Identity resolution failed.");
        const session = (await response.json()) as WorkspaceSession;
        if (session.tier === "standard") {
          setResolution({ state: "standard", session });
        } else if (session.tier === "consultant") {
          setResolution({ state: "consultant", session });
        } else if (session.tier === "demo") {
          setResolution({ state: "demo-or-signed-out" });
        } else {
          setResolution({ state: "unavailable", tier: session.tier });
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setResolution({ state: "error" });
      });
    return () => controller.abort();
  }, []);

  if (resolution.state === "loading") {
    return (
      <main className="main center-panel" id="main-content" aria-busy="true">
        <p role="status">Loading the workspace…</p>
      </main>
    );
  }
  if (resolution.state === "standard") {
    return <StandardWorkspace initialSession={resolution.session} />;
  }
  if (resolution.state === "consultant") {
    return <ConsultantWorkspace initialSession={resolution.session} />;
  }
  if (resolution.state === "error") {
    return (
      <main className="main center-panel" id="main-content">
        <p className="eyebrow">Workspace unavailable</p>
        <h1>Identity resolution failed.</h1>
        <p className="lede" role="alert">
          The workspace stopped without guessing an authorization tier.
        </p>
      </main>
    );
  }
  if (resolution.state === "unavailable") {
    return (
      <>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <main className="main center-panel" id="main-content">
          <p className="eyebrow">Resolved access · {resolution.tier}</p>
          <h1>No product workflow is enabled for this tier.</h1>
          <p className="lede">
            The current slice does not grant Consultant or Admin product access.
          </p>
        </main>
      </>
    );
  }
  return <ProductFlow authPath={authPath} />;
}
