import {
  claimConsultantWorkflowJob,
  failExpiredConsultantWorkflowJobs,
  finishConsultantWorkflowJob,
  renewConsultantWorkflowJobLease,
  type Queryable,
} from "@matchbase/data";
import {
  executeConsultantWorkflowResearch,
  generateApprovedConsultantPreparation,
  getOrRestoreWorkflowSession,
  markConsultantWorkflowFailed,
} from "./consultant-v3-service.js";

/** The persistent job is shared by the local worker and the HTTP after-response accelerator. */
export async function runNextConsultantWorkflowJob(
  db: Queryable,
  jobId?: string,
): Promise<boolean> {
  await failExpiredConsultantWorkflowJobs(db);
  const job = await claimConsultantWorkflowJob(db, jobId);
  if (!job) return false;
  let leaseLost = false;
  const cancellation = new AbortController();
  const loseLease = () => {
    leaseLost = true;
    if (!cancellation.signal.aborted)
      cancellation.abort(
        Object.assign(new Error("The workflow execution lease was lost."), {
          code: "execution-lease-lost",
        }),
      );
    return cancellation.signal.reason;
  };
  const assertLease = async () => {
    if (leaseLost) throw cancellation.signal.reason;
    try {
      const valid = await renewConsultantWorkflowJobLease(db, job);
      if (!valid || leaseLost) throw loseLease();
    } catch {
      throw loseLease();
    }
  };
  const heartbeat = setInterval(() => {
    // A failed renewal cannot establish ownership; cancel pending research I/O.
    void assertLease().catch(() => {});
  }, 20_000);
  heartbeat.unref();
  try {
    const session = await getOrRestoreWorkflowSession(
      db,
      job.account_id,
      job.run_id,
    );
    if (!session || session.execution_id !== job.execution_id)
      throw new Error("The queued execution is no longer current.");
    await assertLease();
    if (job.stage === "prepare")
      await generateApprovedConsultantPreparation(job.run_id, db, assertLease);
    else
      await executeConsultantWorkflowResearch(db, job.run_id, {
        mode: job.mode,
        assertLease,
        signal: cancellation.signal,
      });
    await assertLease();
    await finishConsultantWorkflowJob(db, job);
  } catch (error) {
    // A provider failure is writable only while this execution still owns its lease.
    await assertLease().catch(() => {});
    if (!leaseLost) {
      await markConsultantWorkflowFailed(db, job.run_id, job.stage, error);
      await finishConsultantWorkflowJob(db, job, "workflow-execution-failed");
    }
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
