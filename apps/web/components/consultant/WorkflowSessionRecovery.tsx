"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Identity = { account_id: string; user_id: string; tier: string };
type Recovery = { session?: any; draft?: any };
type SessionControl = {
  request: typeof fetch;
  automaticRequest: typeof fetch;
  automaticWorkPaused: boolean;
  recovery: Recovery | null;
};
const SessionContext = createContext<SessionControl | null>(null);
const nativeRequest: typeof fetch = (...args) => globalThis.fetch(...args);

export function useWorkflowSession() {
  return (
    useContext(SessionContext) ?? {
      request: nativeRequest,
      automaticRequest: nativeRequest,
      automaticWorkPaused: false,
      recovery: null,
    }
  );
}

function sessionRequired() {
  return Response.json(
    {
      error: {
        code: "MB-401-SESSION",
        message:
          "Sign in again to continue. Your edits are retained in this tab.",
      },
    },
    { status: 401 },
  );
}

/** MB-UX-QUALITY-002 L02: reauthenticate without replaying a rejected action. */
export function WorkflowSessionRecovery({ children }: { children: ReactNode }) {
  const identity = useRef<Identity | null>(null);
  const blocked = useRef(false);
  const automaticPaused = useRef(false);
  const generation = useRef(0);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [automaticWorkPaused, setAutomaticWorkPaused] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [mount, setMount] = useState(0);

  const request = useCallback<typeof fetch>(async (input, init) => {
    if (blocked.current) return sessionRequired();
    const started = generation.current;
    const response = await nativeRequest(input, init);
    if (started !== generation.current) return sessionRequired();
    if (String(input) === "/api/v1/me" && response.ok) {
      const data = await response.clone().json();
      if (
        !identity.current &&
        typeof data.account_id === "string" &&
        typeof data.user_id === "string"
      )
        identity.current = data;
    }
    if (response.status === 401) {
      blocked.current = true;
      generation.current += 1;
      automaticPaused.current = true;
      setAutomaticWorkPaused(true);
      setNeedsSignIn(true);
    }
    return response;
  }, []);
  const automaticRequest = useCallback<typeof fetch>(
    (input, init) => {
      if (automaticPaused.current)
        return Promise.resolve(
          blocked.current
            ? sessionRequired()
            : Response.json(
                {
                  error: {
                    message:
                      "Automatic checks and draft saving are paused. Use the explicit controls to continue.",
                  },
                },
                { status: 423 },
              ),
        );
      return request(input, init);
    },
    [request],
  );

  async function checkSignIn() {
    if (checking) return;
    setChecking(true);
    setMessage("");
    try {
      const response = await nativeRequest("/api/v1/me", { cache: "no-store" });
      if (response.status === 401)
        throw new Error(
          "Sign-in is still required. Sign in in the other tab, then check again.",
        );
      if (!response.ok)
        throw new Error(
          "Sign-in could not be verified. Your edits remain in this tab.",
        );
      const current: Identity = await response.json();
      if (
        !current.account_id ||
        !current.user_id ||
        !["consultant", "admin"].includes(current.tier)
      )
        throw new Error(
          "Consultant access is required. Your original workspace remains locked.",
        );
      const previous = identity.current;
      if (
        previous &&
        (previous.account_id !== current.account_id ||
          previous.user_id !== current.user_id)
      )
        throw new Error(
          "A different account is signed in. Sign in with the original account to recover this request.",
        );

      const query = new URLSearchParams(window.location.search);
      const runId = query.get("run_id");
      const draftId = query.get("draft_id");
      let saved: Recovery | null = null;
      if (previous && (runId || draftId)) {
        const selection = runId
          ? `run_id=${encodeURIComponent(runId)}`
          : `draft_id=${encodeURIComponent(draftId!)}`;
        const restored = await nativeRequest(
          `/api/v1/consultant/workflow?${selection}`,
          { cache: "no-store" },
        );
        if (!restored.ok)
          throw new Error(
            "Your saved request could not be reopened for this account. Your edits remain in this tab.",
          );
        saved = await restored.json();
        if (
          (runId && saved?.session?.run_id !== runId) ||
          (!runId && saved?.draft?.draft_id !== draftId) ||
          (runId &&
            draftId &&
            (saved?.draft?.draft_id ?? saved?.session?.draft_id) !== draftId)
        )
          throw new Error(
            "The saved request does not match this tab. Recovery remains locked.",
          );
      }
      identity.current = current;
      blocked.current = false;
      setNeedsSignIn(false);
      setRecovery(saved);
      // A signed-out initial load has no private edits to restore; retry only its reads.
      if (!previous) setMount((value) => value + 1);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Sign-in could not be checked. Your edits remain in this tab.",
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <SessionContext.Provider
      value={{ request, automaticRequest, automaticWorkPaused, recovery }}
    >
      {needsSignIn ? (
        <section
          role="alert"
          className="m-6 rounded-xl border border-amber-500 bg-slate-900 p-6 text-slate-100"
        >
          <h1 className="text-xl font-bold">Sign in again to continue</h1>
          <p>
            Your session ended. Saved research is retained. Unsaved edits stay
            in this tab; keep it open while signing in.
          </p>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block m-2 underline"
          >
            Open sign-in in a new tab
          </a>
          <button
            type="button"
            disabled={checking}
            onClick={() => void checkSignIn()}
            className="m-2 rounded bg-sky-700 px-4 py-2"
          >
            {checking ? "Checking sign-in…" : "Check sign-in"}
          </button>
          {message && <p>{message}</p>}
        </section>
      ) : automaticWorkPaused ? (
        <section
          role="status"
          className="m-6 rounded border border-sky-700 bg-slate-900 p-4 text-slate-100"
        >
          <p>
            Sign-in restored. No approval, save or research action was repeated.
            Review the request before continuing.
          </p>
          <button
            type="button"
            onClick={() => {
              automaticPaused.current = false;
              setAutomaticWorkPaused(false);
            }}
            className="mt-2 underline"
          >
            Resume automatic checks and draft saving
          </button>
        </section>
      ) : null}
      <div hidden={needsSignIn} key={mount}>
        {children}
      </div>
    </SessionContext.Provider>
  );
}
