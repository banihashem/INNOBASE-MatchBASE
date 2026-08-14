import { useEffect, useState } from "react";
import { normalizeSnapshot, unavailableSnapshot } from "./catalog";
import type { LoadState } from "./types";

export const SNAPSHOT_URL = "/current-snapshot.json";
export const BOOTSTRAP_SNAPSHOT_URL = "/bootstrap-snapshot.json";

export function useSnapshot(): LoadState {
  const [state, setState] = useState<LoadState>({ phase: "LOADING" });

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      const request = (url: string) =>
        fetch(url, {
          cache: "no-store",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
      const primary = await request(SNAPSHOT_URL);
      return primary.status === 404 ? request(BOOTSTRAP_SNAPSHOT_URL) : primary;
    };
    load()
      .then((response) => {
        if (!response.ok)
          throw new Error(`Snapshot request failed (${response.status}).`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) =>
        setState({ phase: "READY", snapshot: normalizeSnapshot(payload) }),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          error instanceof Error ? error.message : "Snapshot load failed.";
        setState({
          phase: "ERROR",
          message,
          snapshot: unavailableSnapshot(message),
        });
      });
    return () => controller.abort();
  }, []);

  return state;
}
