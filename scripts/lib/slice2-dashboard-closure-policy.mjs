function one(records, id, label) {
  const matches = records.filter((record) => record.id === id);
  if (matches.length !== 1)
    throw new Error(`${label} must occur exactly once.`);
  return matches[0];
}

function hasSource(record, expected, label) {
  if (
    !record.sourceRefs?.some(
      (source) =>
        source.sourceId === expected.sourceId &&
        source.path === expected.path &&
        source.sha256 === expected.sha256 &&
        source.observedAt === expected.observedAt,
    )
  )
    throw new Error(`${label} lacks exact source identity.`);
}

function closureFacts(record, closure, label) {
  const facts = record.facts ?? {};
  if (
    facts.repository !== closure.repository ||
    facts.commit !== closure.commit ||
    facts.tree !== closure.tree ||
    facts.runId !== closure.runId ||
    facts.jobId !== closure.jobId ||
    facts.conclusion !== closure.conclusion ||
    facts.role3Disposition !== closure.role3Disposition ||
    facts.role2Status !== closure.role2.status ||
    facts.candidateManifestSha256 !== closure.candidate.manifestSha256 ||
    facts.candidateAggregateSha256 !== closure.candidate.aggregateSha256
  )
    throw new Error(`${label} has stale Slice 2 closure facts.`);
}

export function validateSlice2DashboardClosure(
  views,
  closure,
  { closureSourceRef, auditSourceRef, predecessorSourceRef = closureSourceRef },
) {
  const ready = closure.role3Disposition === "READY_FOR_ROLE2";
  const portfolio = one(
    views.portfolio.records,
    "SLICE-2",
    "Slice 2 portfolio",
  );
  closureFacts(portfolio, closure, "Slice 2 portfolio");
  hasSource(portfolio, closureSourceRef, "Slice 2 portfolio");
  if (
    portfolio.facts.lifecycleStatus !==
    (ready ? "READY_FOR_ROLE2" : "IN_PROGRESS")
  )
    throw new Error("Slice 2 portfolio lifecycle is stale.");

  const auditGate = one(views.gates.records, "S2-G1", "S2-G1 gate");
  closureFacts(auditGate, closure, "S2-G1");
  hasSource(auditGate, auditSourceRef, "S2-G1");
  if (
    auditGate.facts.lifecycleStatus !== (ready ? "PASS" : "ACTIVE") ||
    (ready && auditGate.status !== "PASS")
  )
    throw new Error("S2-G1 audit lifecycle is stale.");

  for (const id of ["S2-G2", "S2-G9"]) {
    const record = one(views.gates.records, id, `${id} gate`);
    closureFacts(record, closure, id);
    hasSource(record, closureSourceRef, id);
    if (record.facts.lifecycleStatus !== closure.gates[id])
      throw new Error(`${id} gate lifecycle is stale.`);
  }

  for (const [id, expected] of Object.entries(closure.acceptance)) {
    const record = one(views.tests.records, id, `${id} acceptance`);
    closureFacts(record, closure, id);
    hasSource(record, closureSourceRef, id);
    if (record.facts.lifecycleStatus !== expected)
      throw new Error(`${id} acceptance lifecycle is stale.`);
  }

  const success = one(
    views.deployments.records,
    "EXT-S2-GITHUB-CLOSURE",
    "Slice 2 hosted closure",
  );
  closureFacts(success, closure, "Slice 2 hosted closure");
  hasSource(success, closureSourceRef, "Slice 2 hosted closure");
  if (success.facts.predecessorCount !== closure.predecessors.length)
    throw new Error("Slice 2 predecessor count is stale.");
  const predecessorRecords = views.deployments.records.filter(({ id }) =>
    id.startsWith("EXT-S2-GITHUB-PREDECESSOR-"),
  );
  if (predecessorRecords.length !== closure.predecessors.length)
    throw new Error("Slice 2 predecessor dashboard set is incomplete.");
  for (let index = 0; index < closure.predecessors.length; index += 1) {
    const expected = closure.predecessors[index];
    const actual = predecessorRecords[index];
    if (
      actual.id !== `EXT-S2-GITHUB-PREDECESSOR-${expected.runId}` ||
      actual.facts.runId !== expected.runId ||
      actual.facts.jobId !== expected.jobId ||
      actual.facts.commit !== expected.commit ||
      actual.facts.tree !== expected.tree ||
      actual.facts.conclusion !== expected.conclusion ||
      actual.facts.reasonCode !== expected.reason
    )
      throw new Error("Slice 2 predecessor dashboard tuple was substituted.");
    hasSource(actual, predecessorSourceRef, actual.id);
  }

  for (const expected of closure.role2.defects) {
    const record = one(views.defects.records, expected.id, expected.id);
    hasSource(record, closureSourceRef, expected.id);
    if (
      record.facts.lifecycleStatus !== expected.status ||
      record.facts.role2Status !== closure.role2.status ||
      record.facts.role2Disposition !== closure.role2.disposition
    )
      throw new Error(`${expected.id} dashboard lifecycle is stale.`);
  }

  for (const id of closure.audits) {
    const record = one(views.evidence.records, id, id);
    hasSource(record, auditSourceRef, id);
    if (
      record.facts.lifecycleStatus !== "PASS" ||
      record.facts.critical !== 0 ||
      record.facts.major !== 0 ||
      record.facts.minor !== 0 ||
      record.facts.candidateManifestSha256 !==
        closure.candidate.manifestSha256 ||
      record.facts.candidateAggregateSha256 !==
        closure.candidate.aggregateSha256
    )
      throw new Error(`${id} dashboard audit binding is stale.`);
  }

  const orchestrator = one(
    views.agents.records,
    "AGENT-S2-ORCHESTRATOR",
    "Slice 2 orchestrator",
  );
  hasSource(orchestrator, auditSourceRef, "Slice 2 orchestrator");
  if (
    orchestrator.facts.executionStatus !==
      (ready ? "COMPLETED" : "IN_PROGRESS") ||
    orchestrator.facts.auditDisposition !== (ready ? "PASS" : "PENDING") ||
    (ready && orchestrator.status !== "PASS")
  )
    throw new Error("Slice 2 orchestrator lifecycle is stale.");

  for (const [id, allowed] of [
    ["EXT-GCP", ["BLOCKED", "UNKNOWN"]],
    ["EXT-CLOUDFLARE", ["BLOCKED", "UNKNOWN"]],
    ["EXT-DEPLOYMENT", ["ACTIVE", "BLOCKED", "UNKNOWN"]],
  ]) {
    const record = one(views.deployments.records, id, id);
    if (record.status === "HISTORICAL") {
      const currentId =
        id === "EXT-GCP"
          ? "EXT-CURRENT-GCP-STAGING"
          : id === "EXT-CLOUDFLARE"
            ? "EXT-CURRENT-CLOUDFLARE-STAGING"
            : "EXT-CURRENT-DEPLOYMENT";
      const current = one(
        views.deployments.records,
        currentId,
        `${id} current-state successor`,
      );
      if (
        !["ACTIVE", "BLOCKED"].includes(current.status) ||
        (id === "EXT-DEPLOYMENT" && current.status !== "BLOCKED")
      )
        throw new Error(`${id} current-state successor is not fail-closed.`);
    } else if (!allowed.includes(record.status))
      throw new Error(`${id} contains a false live-readiness claim.`);
  }

  if (ready) {
    const serialized = JSON.stringify({
      portfolio: portfolio,
      gates: [
        auditGate,
        one(views.gates.records, "S2-G2", "S2-G2"),
        one(views.gates.records, "S2-G9", "S2-G9"),
      ],
      acceptance: Object.keys(closure.acceptance).map((id) =>
        one(views.tests.records, id, id),
      ),
      closure: success,
      orchestrator,
    });
    if (
      /LOCAL_UNCOMMITTED|PENDING_SUCCESSOR_RUN|UNKNOWN|BLOCKED/u.test(
        serialized,
      )
    )
      throw new Error(
        "Slice 2 current closure contains a stale pending claim.",
      );
  }
}
