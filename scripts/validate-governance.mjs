import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, win32 } from "node:path";
import { isPathWithinRoot } from "./lib/dashboard-source-policy.mjs";
import { validateAgentRoster } from "./lib/agent-policy.mjs";
import { validateProviderRoutes } from "./lib/provider-route-policy.mjs";
import { validateTraceability } from "./lib/traceability-policy.mjs";

const files = [
  "agents.json",
  "artifact-index.json",
  "backlog.json",
  "current-state-projection.v1.json",
  "decisions.json",
  "external-evidence-anchors.json",
  "external-state.json",
  "gates.json",
  "implementation-index.json",
  "provider-routes.json",
  "registers.json",
  "slices.json",
  "traceability.json",
];
for (const file of files) {
  const path = resolve("governance", file);
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value.schemaVersion !== 1)
    throw new Error(`${path}: schemaVersion must be 1`);
}

const gates = JSON.parse(
  readFileSync(resolve("governance/gates.json"), "utf8"),
).gates;
const currentState = JSON.parse(
  readFileSync(resolve("governance/current-state-projection.v1.json"), "utf8"),
);
if (
  currentState.precedence !== "ADDITIVE_CURRENT_STATE_OVERLAY" ||
  currentState.historicalRecordsRemainImmutable !== true ||
  currentState.repository.deployedPredecessor.sourceCommit !==
    "1224b4c485a9f3533a15e1d50b606f7aa53c2d23" ||
  currentState.repository.sourceTransition.runtimeDerived !== true ||
  currentState.repository.sourceTransition.status !==
    "DERIVE_AT_SNAPSHOT_GENERATION" ||
  !["WORKTREE_UNCOMMITTED", "COMMITTED_UNPUBLISHED", "PUBLISHED_SOURCE"].every(
    (state) =>
      currentState.repository.sourceTransition.allowedStates.includes(state),
  ) ||
  currentState.staging.webRevision !== "matchbase-staging-web-00034-cn5" ||
  currentState.staging.schemaHead !==
    "0011_admin_system_scope_and_run_tier_immutability" ||
  currentState.staging.productionStatus !== "UNTOUCHED" ||
  currentState.staging.status !== "DEGRADED_REMEDIATION_PENDING_DEPLOY"
) {
  throw new Error("Current-state projection identity is invalid.");
}
for (const requiredGate of [
  "P5-GATE-STAGING",
  "P5-GATE-UX",
  "P5-GATE-CONTROL-PLANE",
  "ROADMAP-P5-HARDENING",
  "ROADMAP-P6-PILOT",
]) {
  if (!currentState.currentGates.some(({ id }) => id === requiredGate))
    throw new Error(`Current-state projection lacks ${requiredGate}.`);
}
const gateIds = gates.map((gate) => gate.id);
if (new Set(gateIds).size !== gateIds.length)
  throw new Error("Duplicate gate IDs");
if (!["AG0", "AG1", "AG2", "AG3", "AG7"].every((id) => gateIds.includes(id))) {
  throw new Error("Required Slice 0 gate missing");
}

const external = JSON.parse(
  readFileSync(resolve("governance/external-state.json"), "utf8"),
);
const anchorOnly =
  process.env.MATCHBASE_EXTERNAL_EVIDENCE_MODE === "ANCHOR_ONLY_CI";
if (anchorOnly && process.env.CI !== "true")
  throw new Error("ANCHOR_ONLY_CI is allowed only on an explicit CI runner.");
if (process.env.MATCHBASE_EXTERNAL_EVIDENCE_MODE && !anchorOnly)
  throw new Error("Unknown external evidence validation mode.");
const anchors = JSON.parse(
  readFileSync(resolve("governance/external-evidence-anchors.json"), "utf8"),
);
if (anchors.mode !== "ANCHOR_ONLY_CI")
  throw new Error("External evidence anchor mode is invalid.");
const externalEvidenceRoot = anchorOnly
  ? null
  : realpathSync("C:\\INNOBASE\\MatchBASE\\01_Product_Management");
if (
  external.gcp.mutation !== "NONE" ||
  external.cloudflare.mutation !== "NONE"
) {
  throw new Error("Slice 0 cannot claim external platform mutation");
}
for (const [surfaceName, surface] of Object.entries({
  github: external.github,
  gcp: external.gcp,
  cloudflare: external.cloudflare,
})) {
  if (
    !Array.isArray(surface.evidenceRefs) ||
    surface.evidenceRefs.length === 0
  ) {
    throw new Error("External-state observation lacks evidence references.");
  }
  for (const evidence of surface.evidenceRefs) {
    if (
      typeof evidence.path !== "string" ||
      !win32.isAbsolute(evidence.path) ||
      !/^[A-F0-9]{64}$/.test(evidence.sha256) ||
      typeof evidence.method !== "string" ||
      !evidence.method.trim() ||
      typeof evidence.result !== "string" ||
      !evidence.result.trim()
    ) {
      throw new Error("External-state evidence reference is incomplete.");
    }
    const anchor = anchors.surfaces?.[surfaceName];
    if (
      !anchor ||
      ["path", "sha256", "method", "result"].some(
        (field) => anchor[field] !== evidence[field],
      )
    )
      throw new Error("External-state evidence does not match its CI anchor.");
    if (anchorOnly) continue;
    const evidencePath = resolve(evidence.path);
    const evidenceStat = lstatSync(evidencePath);
    if (evidenceStat.isSymbolicLink() || !evidenceStat.isFile())
      throw new Error("External-state evidence must be a regular file.");
    const evidenceRealPath = realpathSync(evidencePath);
    if (!isPathWithinRoot(externalEvidenceRoot, evidenceRealPath))
      throw new Error(
        "External-state evidence resolves outside management root.",
      );
    const actualHash = createHash("sha256")
      .update(readFileSync(evidenceRealPath))
      .digest("hex")
      .toUpperCase();
    if (actualHash !== evidence.sha256)
      throw new Error("External-state evidence hash mismatch.");
  }
}

const providerPolicy = JSON.parse(
  readFileSync(resolve("governance/provider-routes.json"), "utf8"),
);
validateProviderRoutes(providerPolicy);

const registers = JSON.parse(
  readFileSync(resolve("governance/registers.json"), "utf8"),
);
const slice1Evidence = JSON.parse(
  readFileSync(resolve("evidence/slice1/local-validation.json"), "utf8"),
);
const slice1Tests = new Map(
  registers.tests
    .filter((test) => /^S1-AC-\d{3}$/u.test(test.id))
    .map((test) => [test.id, test]),
);
if (slice1Tests.size !== 22)
  throw new Error("Governance must expose all 22 Slice 1 criteria.");
for (const acceptance of slice1Evidence.acceptance ?? []) {
  const test = slice1Tests.get(acceptance.id);
  if (!test || test.status !== acceptance.status)
    throw new Error(`${acceptance.id} governance status is not reconciled.`);
  if (!test.evidenceRefs?.includes("evidence/slice1/local-validation.json"))
    throw new Error(`${acceptance.id} lacks exact local evidence linkage.`);
}
const slice2Evidence = JSON.parse(
  readFileSync(resolve("evidence/slice2/local-validation.json"), "utf8"),
);
const slice2Tests = new Map(
  registers.tests
    .filter((test) => /^S2-AC-\d{3}$/u.test(test.id))
    .map((test) => [test.id, test]),
);
if (slice2Tests.size !== 34)
  throw new Error("Governance must expose all 34 Slice 2 criteria.");
for (const acceptance of slice2Evidence.acceptance ?? []) {
  const test = slice2Tests.get(acceptance.id);
  if (!test || test.status !== acceptance.status)
    throw new Error(`${acceptance.id} governance status is not reconciled.`);
  if (!test.evidenceRefs?.includes("evidence/slice2/local-validation.json"))
    throw new Error(`${acceptance.id} lacks exact Slice 2 evidence linkage.`);
}
const slices = JSON.parse(
  readFileSync(resolve("governance/slices.json"), "utf8"),
).slices;
if (!slices.some((slice) => slice.id === "SLICE-2"))
  throw new Error("Slice 2 governance record is missing.");
if (!["S2-G0", "S2-G1", "S2-G2"].every((id) => gateIds.includes(id)))
  throw new Error("Slice 2 gate record is missing.");
const backlog = JSON.parse(
  readFileSync(resolve("governance/backlog.json"), "utf8"),
).items;
const traceability = JSON.parse(
  readFileSync(resolve("governance/traceability.json"), "utf8"),
);
const decisions = JSON.parse(
  readFileSync(resolve("governance/decisions.json"), "utf8"),
);
validateTraceability(
  traceability,
  {
    requirements: registers.requirements,
    risks: registers.risks,
    backlog,
    tests: registers.tests,
    gates,
    deployments: registers.deployments,
    decisionSource: {
      path: decisions.source,
      sha256: decisions.sourceSha256,
    },
  },
  {
    repoRoot: realpathSync("."),
    managementRoot: externalEvidenceRoot ?? realpathSync("."),
    managementWindowsRoot: "C:\\INNOBASE\\MatchBASE\\01_Product_Management",
    anchorOnly,
  },
);

const agentRoster = JSON.parse(
  readFileSync(resolve("governance/agents.json"), "utf8"),
);
validateAgentRoster(agentRoster, {
  repoRoot: realpathSync("."),
  anchorOnly,
});

console.log(
  `governance: PASS (${files.length} registers; external evidence ${anchorOnly ? "ANCHOR_ONLY_CI" : "EXACT_LOCAL_SHA256"})`,
);
