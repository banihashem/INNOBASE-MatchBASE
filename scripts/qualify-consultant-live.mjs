// MB-UX-LIVE-001 L01. Explicit, opt-in live-provider qualification on the local simulator.
import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

if (!process.argv.includes("--execute"))
  throw new Error("Use --execute only for an authorized live qualification.");
const base =
  process.env.MATCHBASE_QUALIFICATION_BASE_URL ?? "http://localhost:3000";
const stage = process.argv[process.argv.indexOf("--stage") + 1];
const runArg = process.argv.indexOf("--run-id");
let runId = runArg >= 0 ? process.argv[runArg + 1] : null;
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
  const data = await response.json();
  if (!response.ok)
    throw new Error(JSON.stringify({ status: response.status, ...data }));
  return data;
};
const read = async () => {
  const response = await fetch(
    `${base}/api/v1/consultant/workflow?run_id=${runId}`,
    { headers: { cookie } },
  );
  const data = await response.json();
  assert.equal(response.status, 200);
  return data.session;
};
let session;
if (!runId) {
  const response = await post({
    action: "submit_intake",
    mode: "live",
    product_requirement:
      "Industrial electric storage water heater, 500 litres, maximum external diameter 85 cm, for an indoor hotel mechanical room.",
    technical_compliance:
      "Minimum working pressure 10 bar; three-phase 400V 50Hz; documented thermal insulation; safety-valve compatibility; CE and PED compliance; BMS-compatible thermostat integration; local installation support; authorized UAE distributor; two-year UAE warranty.",
    order_profile:
      "10 units for a hotel project. DDP Dubai. Budget and required delivery date are not yet specified.",
  });
  session = response.session;
  runId = session.run_id;
  console.log(
    JSON.stringify({
      phase: "step1",
      run_id: runId,
      execution_id: session.execution_id,
      classification_id: session.classification_id,
      state: session.state,
      mode: session.mode,
    }),
  );
  assert.equal(session.state, "prep_step1_awaiting_approval");
  assert.ok(session.step1_interpretation.english_translation.length > 100);
  assert.equal(session.step2_advisory, null);
  assert.equal(session.step3_deep_prompt, null);
  if (stage === "step1") process.exit(0);
} else session = await read();
if (session.state === "workflow_failed" && process.argv.includes("--retry")) {
  const retried = await post({ action: "retry_workflow", run_id: runId });
  session = retried.session;
}
if (!session.approved_request_revision) {
  const prepared = await post({
    action: "approve_step1",
    run_id: runId,
    edited_translation: session.step1_interpretation.english_translation,
  });
  assert.equal(prepared.processing, true);
}
const waitFor = async (ready) => {
  let checkpoint;
  const deadline = Date.now() + 50 * 60_000;
  while (Date.now() < deadline) {
    const current = await read();
    const changed = JSON.stringify([current.state, current.progress]);
    if (changed !== checkpoint) {
      console.log(
        JSON.stringify({
          run_id: runId,
          execution_id: current.execution_id,
          state: current.state,
          progress: current.progress,
          error: current.error,
        }),
      );
      checkpoint = changed;
    }
    if (current.state === "workflow_failed") throw new Error(current.error);
    if (ready(current)) return current;
    await setTimeout(2_000);
  }
  throw new Error(
    "Qualification timed out; the durable execution remains inspectable.",
  );
};
session = await waitFor((current) => Boolean(current.step3_deep_prompt));
assert.ok(session.step2_advisory.sources.length);
if (stage === "prepare") process.exit(0);
if (!session.step3_deep_prompt.is_approved)
  await post({ action: "approve_step3", run_id: runId });
if (!session.output) await post({ action: "execute_research", run_id: runId });
session = await waitFor((current) => Boolean(current.output));
assert.equal(session.output.research_mode, "live");
assert.ok(session.output.telemetry.verification_loops_count >= 5);
assert.ok(session.output.telemetry.verification_loops_count <= 15);
assert.ok(session.output.supplier_candidates.length <= 20);
assert.equal(
  session.revealed_count,
  Math.min(5, session.output.supplier_candidates.length),
);
console.log(
  JSON.stringify({
    result: "live_pipeline_completed",
    run_id: runId,
    execution_id: session.execution_id,
    supplier_count: session.output.supplier_candidates.length,
    telemetry: session.output.telemetry,
  }),
);
