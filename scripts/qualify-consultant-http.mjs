// MB-UX-LIVE-001 L01: real HTTP, database, worker and PDF; explicit fixture mode, zero provider calls.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
const base =
  process.env.MATCHBASE_QUALIFICATION_BASE_URL ?? "http://localhost:3000";
const start = await fetch(`${base}/auth/simulator/start?fixture=consultant`, {
  redirect: "manual",
});
assert.equal(start.status, 302);
const callback = await fetch(new URL(start.headers.get("location"), base), {
  redirect: "manual",
  headers: { cookie: start.headers.get("set-cookie") ?? "" },
});
assert.equal(callback.status, 303);
const cookie = callback.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ");
const post = async (body) => {
  const response = await fetch(`${base}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify({ status: response.status, ...value }));
  return { status: response.status, ...value };
};
const created = await post({
  action: "submit_intake",
  mode: "demonstration",
  product_requirement: "Frozen whole chicken poultry from Brazil",
  technical_compliance: "Halal certification",
  order_profile: "Delivery to Saudi Arabia",
});
const runId = created.session.run_id;
const read = async () => {
  const response = await fetch(
    `${base}/api/v1/consultant/workflow?run_id=${runId}`,
    { headers: { cookie } },
  );
  assert.equal(response.status, 200);
  return (await response.json()).session;
};
const waitFor = async (ready) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const session = await read();
    assert.notEqual(session.state, "workflow_failed", session.error);
    if (ready(session)) return session;
    await setTimeout(500);
  }
  throw new Error("The durable local job did not finish.");
};
const approved = await post({ action: "approve_step1", run_id: runId });
assert.equal(approved.status, 202);
await waitFor((session) => Boolean(session.step3_deep_prompt));
await post({ action: "approve_step3", run_id: runId });
assert.equal(
  (await post({ action: "execute_research", run_id: runId })).status,
  202,
);
const completed = await waitFor((session) => Boolean(session.output));
assert.equal(completed.output.research_mode, "fixture");
assert.equal(completed.output.telemetry.verification_loops_count, 0);
assert.equal(completed.output.supplier_candidates.length, 20);
assert.equal(completed.revealed_count, 5);
for (const expected of [10, 15, 20]) {
  await post({ action: "reveal_more", run_id: runId });
  assert.equal((await read()).revealed_count, expected);
}
const pdfUrl = `${base}/api/v1/consultant/reports/${runId}/pdf`;
assert.equal((await fetch(pdfUrl, { redirect: "manual" })).status, 401);
const pdf = await fetch(pdfUrl, { headers: { cookie } });
assert.equal(pdf.status, 200);
const bytes = Buffer.from(await pdf.arrayBuffer());
assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
assert.ok(bytes.length > 10_000);
const head = await fetch(pdfUrl, { method: "HEAD", headers: { cookie } });
assert.equal(head.status, 200);
assert.equal(Number(head.headers.get("content-length")), bytes.length);
const range = await fetch(pdfUrl, {
  headers: { cookie, range: "bytes=0-1023" },
});
assert.equal(range.status, 206);
assert.ok(
  Buffer.from(await range.arrayBuffer()).equals(bytes.subarray(0, 1024)),
);
console.log(
  JSON.stringify({
    activity: "MB-UX-LIVE-001 L01",
    qualification: "fixture HTTP/DB/worker/PDF",
    run_id: runId,
    execution_id: completed.execution_id,
    classification_id: completed.classification_id,
    supplier_count: 20,
    reveal_counts: [5, 10, 15, 20],
    pdf_bytes: bytes.length,
    pdf_sha256: createHash("sha256").update(bytes).digest("hex"),
    result: "PASS",
    live_provider_claim: false,
  }),
);
