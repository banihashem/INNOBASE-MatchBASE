import { after } from "next/server";

/** MB-UX-PILOT-001 L01: production durable jobs belong to the worker only. */
export function scheduleConsultantWorkflowAcceleration(
  work: () => Promise<unknown>,
): void {
  if (
    process.env.MATCHBASE_ENVIRONMENT === "production" ||
    process.env.NODE_ENV === "production"
  )
    return;
  after(async () => {
    await work();
  });
}
