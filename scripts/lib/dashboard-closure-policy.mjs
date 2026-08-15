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
  )
    throw new Error(`${label} does not match the authenticated closure.`);
}

function assertExactSource(record, expected, label) {
  if (
    !expected ||
    !Array.isArray(record.sourceRefs) ||
    record.sourceRefs.length !== 1 ||
    record.sourceRefs[0].sourceId !== expected.sourceId ||
    record.sourceRefs[0].path !== expected.path ||
    record.sourceRefs[0].sha256 !== expected.sha256 ||
    record.sourceRefs[0].observedAt !== expected.observedAt
  )
    throw new Error(`${label} lacks its exact predecessor attestation source.`);
}

export function validateDashboardClosure(
  views,
  closure,
  { predecessorSourceRef } = {},
) {
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
    deployment.facts.predecessorFailureCount !==
    closure.predecessorFailures.length
  )
    throw new Error("Hosted closure predecessor count does not reconcile.");
  const failureRecords = views.deployments.records.filter(({ id }) =>
    id.startsWith("EXT-GITHUB-FAILURE-"),
  );
  if (failureRecords.length !== closure.predecessorFailures.length)
    throw new Error("Hosted predecessor identity records are incomplete.");
  for (let index = 0; index < closure.predecessorFailures.length; index += 1) {
    const expected = closure.predecessorFailures[index];
    const reason = closure.predecessorFailureReasons[index];
    const actual = failureRecords[index];
    if (
      actual.id !== `EXT-GITHUB-FAILURE-${expected.runId}` ||
      actual.status !== "ACTIVE" ||
      actual.facts?.runId !== expected.runId ||
      actual.facts?.jobId !== expected.jobId ||
      actual.facts?.commit !== expected.commit ||
      actual.facts?.conclusion !== expected.conclusion ||
      actual.facts?.reasonCode !== reason.reasonCode
    )
      throw new Error("Hosted predecessor identity does not match closure.");
    assertExactSource(actual, predecessorSourceRef, actual.id);
  }

  const expectedDefects = new Map(
    closure.role2.defects.map((defect) => [defect.id, defect.status]),
  );
  const defects = views.defects.records.filter((record) =>
    expectedDefects.has(record.id),
  );
  if (
    defects.length !== expectedDefects.size ||
    defects.some(
      (record) =>
        record.status !==
          (expectedDefects.get(record.id) === "CLOSED_BY_ROLE2"
            ? "PASS"
            : "ACTIVE") ||
        record.facts.lifecycleStatus !== expectedDefects.get(record.id) ||
        record.facts.role2AuditStatus !== "FAIL" ||
        record.facts.role2Disposition !== "PENDING_ROLE2_CORRECTION_REAUDIT",
    )
  )
    throw new Error("Role 2 correction defects are not decisively projected.");

  const loop = exactRecord(
    views.loops.records,
    "PO-001-R2-S1-L2",
    "Role 2 correction loop",
  );
  if (
    loop.status !== "BLOCKED" ||
    loop.facts.critical !== 0 ||
    loop.facts.major !== 1 ||
    loop.facts.minor !== 0 ||
    loop.facts.disposition !== "PENDING_ROLE2_CORRECTION_REAUDIT"
  )
    throw new Error("Role 2 correction-loop disposition is not decisive.");

  const currentViews = Object.fromEntries(
    Object.entries(views).map(([key, value]) => [
      key,
      {
        ...value,
        records: (value.records ?? []).filter(
          (record) =>
            record.status !== "HISTORICAL" &&
            record.facts?.historyDisposition !== "HISTORICAL",
        ),
      },
    ]),
  );
  const serialized = JSON.stringify(currentViews);
  if (/LOCAL_UNCOMMITTED|PENDING_SUCCESSOR_RUN/u.test(serialized))
    throw new Error("Dashboard contains a stale pre-hosted closure state.");
}
