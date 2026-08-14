const requiredDefects = new Set(["S1-L1-D001", "S1-L1-D002", "S1-L1-D003"]);

function exactRecord(records, id, label) {
  const matches = records.filter((record) => record.id === id);
  if (matches.length !== 1)
    throw new Error(`${label} must occur exactly once.`);
  return matches[0];
}

function assertClosureFacts(record, closure, label) {
  const facts = record.facts ?? {};
  if (
    record.status !== "ACTIVE" ||
    facts.repository !== closure.repository ||
    facts.commit !== closure.commit ||
    facts.tree !== closure.tree ||
    facts.runId !== closure.runId ||
    facts.jobId !== closure.jobId ||
    facts.conclusion !== "success" ||
    facts.closureStatus !== "HOSTED_VERIFIED" ||
    facts.role2Status !== "PENDING_ROLE2"
  ) {
    throw new Error(`${label} does not match the authenticated closure.`);
  }
}

export function validateDashboardClosure(views, closure) {
  const gate = exactRecord(views.gates.records, "AG6", "AG6 closure record");
  const acceptance = exactRecord(
    views.tests.records,
    "S1-AC-022",
    "S1-AC-022 closure record",
  );
  const deployment = exactRecord(
    views.deployments.records,
    "EXT-GITHUB-CLOSURE",
    "Hosted closure deployment record",
  );
  const evidence = exactRecord(
    views.evidence.records,
    "EVIDENCE-S1-EXTERNAL-CLOSURE",
    "Hosted closure evidence record",
  );
  for (const [record, label] of [
    [gate, "AG6"],
    [acceptance, "S1-AC-022"],
    [deployment, "EXT-GITHUB-CLOSURE"],
    [evidence, "EVIDENCE-S1-EXTERNAL-CLOSURE"],
  ])
    assertClosureFacts(record, closure, label);

  if (
    deployment.facts.predecessorFailures !== closure.predecessorFailures.length
  )
    throw new Error("Hosted closure predecessor failures are incomplete.");

  const defects = views.defects.records.filter((record) =>
    requiredDefects.has(record.id),
  );
  if (
    defects.length !== 3 ||
    defects.some(
      (record) =>
        record.status !== "ACTIVE" ||
        !["OPEN", "CORRECTED_PENDING_ROLE2"].includes(
          record.facts.lifecycleStatus,
        ) ||
        record.facts.role2AuditStatus !== "FAIL" ||
        record.facts.role2Disposition !== "PENDING_ROLE2_CORRECTION_REAUDIT",
    )
  )
    throw new Error(
      "Role 2 open correction defects are not decisively projected.",
    );

  const loop = exactRecord(
    views.loops.records,
    "PO-001-R2-S1-L1",
    "Role 2 correction loop",
  );
  if (
    loop.status !== "BLOCKED" ||
    loop.facts.critical !== 0 ||
    loop.facts.major !== 3 ||
    loop.facts.minor !== 0 ||
    loop.facts.disposition !== "PENDING_ROLE2_CORRECTION_REAUDIT"
  )
    throw new Error("Role 2 correction-loop disposition is not decisive.");

  const serialized = JSON.stringify(views);
  if (/LOCAL_UNCOMMITTED|PENDING_SUCCESSOR_RUN/u.test(serialized))
    throw new Error("Dashboard contains a stale pre-hosted closure state.");
}
