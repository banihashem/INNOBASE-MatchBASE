"use client";

import { useEffect, useState } from "react";
import { ConsultantEntry } from "./consultant/ConsultantEntry";
import { ProductFlow } from "./ProductFlow";
import { StandardWorkspace } from "./standard/StandardWorkspace";
import type { WorkspaceSession } from "./standard/types";
import { ConsultantHome } from "./consultant/ConsultantHome";
import { AdminWorkspace } from "./admin/AdminWorkspace";

type Resolution =
  | { state: "loading" }
  | { state: "demo-or-signed-out"; session?: WorkspaceSession }
  | { state: "standard"; session: WorkspaceSession }
  | { state: "consultant"; session: WorkspaceSession }
  | { state: "admin"; session: WorkspaceSession }
  | { state: "unavailable"; tier: string }
  | { state: "error" };

export function ProductRouter({
  authPath,
  signedOutResearchMode,
  consultantOnly = false,
}: {
  authPath: string;
  consultantOnly?: boolean;
  signedOutResearchMode?: {
    id: "synthetic_reference" | "qualified_live_research";
    label: "Synthetic reference" | "Qualified live research";
    live_qualified: boolean;
  };
}) {
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
        if (session.tier === "admin") {
          setResolution({ state: "admin", session });
        } else if (session.tier === "standard") {
          setResolution({ state: "standard", session });
        } else if (session.tier === "consultant") {
          setResolution({ state: "consultant", session });
        } else if (session.tier === "demo") {
          setResolution({ state: "demo-or-signed-out", session });
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
  if (consultantOnly && resolution.state !== "consultant") {
    return (
      <ConsultantEntry
        authPath={authPath}
        state={
          resolution.state === "error"
            ? "error"
            : resolution.state === "demo-or-signed-out" && !resolution.session
              ? "signed-out"
              : "access-required"
        }
        demonstration={signedOutResearchMode?.live_qualified === false}
        csrfToken={
          "session" in resolution ? resolution.session?.csrf_token : undefined
        }
      />
    );
  }
  if (resolution.state === "admin") {
    return <AdminWorkspace initialSession={resolution.session} />;
  }
  if (resolution.state === "standard") {
    return <StandardWorkspace initialSession={resolution.session} />;
  }
  if (resolution.state === "consultant") {
    return <ConsultantHome session={resolution.session} />;
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
  return (
    <ProductFlow
      authPath={authPath}
      signedOutResearchMode={signedOutResearchMode}
    />
  );
}
