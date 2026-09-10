/** MB-UX-PILOT-001 L01: attach the current session CSRF proof to each workflow mutation. */
export function workflowMutationHeaders(): Record<string, string> {
  const cookies = document.cookie.split(";").map((value) => value.trim());
  const cookie =
    cookies.find((value) => value.startsWith("__Host-matchbase_csrf=")) ??
    cookies.find((value) => value.startsWith("matchbase_csrf="));
  const csrf = cookie ? cookie.slice(cookie.indexOf("=") + 1) : "";
  return {
    "Content-Type": "application/json",
    "X-CSRF-Token": decodeURIComponent(csrf),
    // Private-LAN HTTP does not expose randomUUID; getRandomValues is available there.
    "Idempotency-Key": `consultant-workflow-${Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, "0")).join("")}`,
  };
}
