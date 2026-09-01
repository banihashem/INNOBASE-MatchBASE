"use client";

import { useEffect, useState } from "react";
import { ConsultantWorkspace } from "../consultant/ConsultantWorkspace";
import { StandardWorkspace } from "../standard/StandardWorkspace";
import type { WorkspaceSession } from "../standard/types";

type GateState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "error" }
  | { readonly kind: "allowed"; readonly session: WorkspaceSession };

function authorized(session: WorkspaceSession): boolean {
  return (
    session.tier === "admin" &&
    (session.admin_sub_roles ?? []).includes("super_admin")
  );
}

export function AdminProductGate({
  view,
}: {
  readonly view: "product" | "profile";
}) {
  const [state, setState] = useState<GateState>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/me", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const session = (await response.json()) as WorkspaceSession;
        setState(
          authorized(session)
            ? { kind: "allowed", session }
            : { kind: "denied" },
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, []);

  if (state.kind === "allowed")
    return view === "product" ? (
      <StandardWorkspace
        initialSession={state.session}
        workspaceBadge="Admin · Product"
      />
    ) : (
      <ConsultantWorkspace
        initialSession={state.session}
        workspaceBadge="Admin · Full results"
        initialView="profile"
      />
    );
  return (
    <main className="main center-panel" id="main-content">
      <p className="eyebrow">Admin product boundary</p>
      <h1>
        {state.kind === "loading"
          ? "Verifying Super-admin authority"
          : "Admin product workspace unavailable"}
      </h1>
      {state.kind === "denied" ? (
        <p role="alert">An active stored Super-admin grant is required.</p>
      ) : null}
      {state.kind === "error" ? (
        <p role="alert">Stored authority could not be verified.</p>
      ) : null}
    </main>
  );
}
