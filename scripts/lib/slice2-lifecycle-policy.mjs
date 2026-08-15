export function slice2LifecycleProjection(closure) {
  const ready = closure?.role3Disposition === "READY_FOR_ROLE2";
  if (ready && closure?.role2?.status !== "PENDING")
    throw new Error("A ready Slice 2 closure must keep Role 2 pending.");
  return Object.freeze({
    ready,
    portfolioStatus: ready ? "READY_FOR_ROLE2" : "IN_PROGRESS",
    auditGateStatus: ready ? "PASS" : "ACTIVE",
    orchestratorStatus: ready ? "PASS" : "ACTIVE",
    orchestratorExecutionStatus: ready ? "COMPLETED" : "IN_PROGRESS",
    orchestratorAuditDisposition: ready ? "PASS" : "PENDING",
    orchestratorDeliverableStatus: ready ? "COMPLETED" : "IN_PROGRESS",
  });
}
