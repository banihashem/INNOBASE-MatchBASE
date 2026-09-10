import { afterEach, describe, expect, it, vi } from "vitest";
import { workflowMutationHeaders } from "./workflow-request";

afterEach(() => {
  document.cookie = "matchbase_csrf=; Max-Age=0; Path=/";
  vi.unstubAllGlobals();
});
describe("MB-UX-PILOT-001 L01 workflow mutation proof", () => {
  it("uses the current session token and a new admission key for each action", () => {
    document.cookie = "matchbase_csrf=session%2Dproof; Path=/";
    const first = workflowMutationHeaders();
    expect(first["X-CSRF-Token"]).toBe("session-proof");
    expect(first["Idempotency-Key"]).toMatch(
      /^consultant-workflow-[0-9a-f]{32}$/,
    );
    expect(workflowMutationHeaders()["Idempotency-Key"]).not.toBe(
      first["Idempotency-Key"],
    );
    document.cookie = "matchbase_csrf=replaced-session; Path=/";
    expect(workflowMutationHeaders()["X-CSRF-Token"]).toBe("replaced-session");
  });
  it("supports a private-LAN HTTP browser without randomUUID", () => {
    const random = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { getRandomValues: random });
    expect(workflowMutationHeaders()["Idempotency-Key"]).toMatch(
      /^consultant-workflow-[0-9a-f]{32}$/,
    );
  });
  it("does not invent proof when no session cookie exists", () => {
    document.cookie = "matchbase_csrf=; Max-Age=0; Path=/";
    expect(workflowMutationHeaders()["X-CSRF-Token"]).toBe("");
  });
});
