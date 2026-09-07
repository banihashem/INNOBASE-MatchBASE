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
  const heartbeat = setInterval(() => {
    void renewConsultantWorkflowJobLease(db, job)
      .then((valid) => {
        if (!valid) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      });
  }, 20_000);
  heartbeat.unref();
  const assertLease = async () => {
    if (leaseLost || !(await renewConsultantWorkflowJobLease(db, job))) {
      leaseLost = true;
      throw Object.assign(new Error("The workflow execution lease was lost."), {
        code: "execution-lease-lost",
      });
    }
  };
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
      });
    await assertLease();
    await finishConsultantWorkflowJob(db, job);
  } catch (error) {
    if (!leaseLost) {
      await markConsultantWorkflowFailed(db, job.run_id, job.stage, error);
      await finishConsultantWorkflowJob(db, job, "workflow-execution-failed");
    }
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
