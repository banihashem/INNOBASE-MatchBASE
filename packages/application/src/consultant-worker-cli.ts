import { createPool } from "@matchbase/data";
import { setTimeout } from "node:timers/promises";
import { runNextConsultantWorkflowJob } from "./consultant-workflow-worker.js";

const connectionString =
  process.env.MATCHBASE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("MATCHBASE_DATABASE_URL or DATABASE_URL is required.");
const pool = createPool({ connectionString, max: 5 });
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
try {
  while (!stopped) {
    try {
      if (!(await runNextConsultantWorkflowJob(pool))) await setTimeout(2_000);
    } catch {
      // Provider details and request contents belong in account-scoped execution events.
      console.error("Consultant worker could not access its durable queue.");
      await setTimeout(5_000);
    }
  }
} finally {
  await pool.end();
}
