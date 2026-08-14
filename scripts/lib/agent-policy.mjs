import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";

const EXECUTION_STATES = new Set([
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "CORRECTION_REQUIRED",
  "BLOCKED",
]);
const DELIVERABLE_STATES = new Set([
  "PENDING",
  "IN_PROGRESS",
  "OBSERVED",
  "COMPLETED",
  "BLOCKED",
]);
const TEST_STATES = new Set(["PENDING", "PASS", "FAIL", "BLOCKED"]);
const AUDIT_DISPOSITIONS = new Set(["PENDING", "PASS", "FAIL", "BLOCKED"]);
const REASONING_EFFORTS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string.`);
}

function withinRoot(root, candidate) {
  const difference = relative(resolve(root), resolve(candidate));
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  );
}

function withinWindowsRoot(root, candidate) {
  const difference = win32.relative(
    win32.normalize(root),
    win32.normalize(candidate),
  );
  return (
    difference === "" ||
    (!difference.startsWith("..\\") &&
      difference !== ".." &&
      !win32.isAbsolute(difference))
  );
}

function normalizeTarget(value) {
  return String(value)
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .toLowerCase();
}

function targetVariants(target, repoRoot) {
  const variants = new Set([normalizeTarget(target)]);
  const absolute = win32.isAbsolute(target) || isAbsolute(target);
  if (absolute && isAbsolute(target) && withinRoot(repoRoot, resolve(target)))
    variants.add(normalizeTarget(relative(repoRoot, resolve(target))));
  return variants;
}

function targetMatches(target, allowedTargets, repoRoot) {
  const variants = targetVariants(target, repoRoot);
  return allowedTargets.some((allowedTarget) => {
    const allowed = normalizeTarget(allowedTarget);
    if (allowed.endsWith("/**")) {
      const prefix = allowed.slice(0, -3);
      return [...variants].some(
        (variant) => variant === prefix || variant.startsWith(`${prefix}/`),
      );
    }
    return variants.has(allowed);
  });
}

function verifyHashReference(reference, context) {
  requireText(reference?.path, `${context}.path`);
  if (!/^[A-F0-9]{64}$/.test(reference?.sha256 ?? ""))
    throw new Error(`${context}.sha256 must be uppercase SHA-256.`);
  const windowsAbsolute = win32.isAbsolute(reference.path);
  const nativeAbsolute = isAbsolute(reference.path);
  const insideNativeRepository =
    nativeAbsolute && withinRoot(context.repoRoot, resolve(reference.path));
  const insideWindowsManagement =
    windowsAbsolute &&
    withinWindowsRoot(context.managementWindowsRoot, reference.path);
  if (windowsAbsolute && !insideWindowsManagement && !insideNativeRepository)
    throw new Error(
      `${context.label} Windows path is outside the management and repository roots: ${reference.path}`,
    );
  if (context.anchorOnly && windowsAbsolute) return;
  const evidencePath =
    windowsAbsolute || nativeAbsolute
      ? resolve(reference.path)
      : resolve(context.repoRoot, reference.path);
  if (
    !windowsAbsolute &&
    !nativeAbsolute &&
    !withinRoot(context.repoRoot, evidencePath)
  )
    throw new Error(
      `${context.label} escapes repository root: ${reference.path}`,
    );
  if (!existsSync(evidencePath)) {
    throw new Error(`${context.label} is missing: ${reference.path}`);
  }
  const stat = lstatSync(evidencePath);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(
      `${context.label} must be a regular file: ${reference.path}`,
    );
  const realPath = realpathSync(evidencePath);
  const insideRepository = withinRoot(realpathSync(context.repoRoot), realPath);
  const insideManagement =
    existsSync(context.managementRoot) &&
    withinRoot(realpathSync(context.managementRoot), realPath);
  if (!insideRepository && !insideManagement)
    throw new Error(
      `${context.label} resolves outside repository and management roots: ${reference.path}`,
    );
  const actual = createHash("sha256")
    .update(readFileSync(realPath))
    .digest("hex")
    .toUpperCase();
  if (actual !== reference.sha256)
    throw new Error(`${context.label} hash mismatch: ${reference.path}`);
}

export function validateAgentRoster(
  roster,
  {
    repoRoot = process.cwd(),
    anchorOnly = false,
    managementRoot = "C:\\INNOBASE\\MatchBASE\\01_Product_Management",
    managementWindowsRoot = "C:\\INNOBASE\\MatchBASE\\01_Product_Management",
  } = {},
) {
  if (roster?.schemaVersion !== 1 || !Array.isArray(roster.agents))
    throw new Error("Agent roster schema is invalid.");
  if (roster.agents.length === 0) throw new Error("Agent roster is empty.");
  const ids = new Set();
  const roles = new Set();

  for (const agent of roster.agents) {
    requireText(agent.id, "agent.id");
    requireText(agent.role, `${agent.id}.role`);
    requireText(agent.model, `${agent.id}.model`);
    requireText(agent.scope, `${agent.id}.scope`);
    if (ids.has(agent.id)) throw new Error(`Duplicate agent id: ${agent.id}`);
    if (roles.has(agent.role))
      throw new Error(`Duplicate agent role: ${agent.role}`);
    ids.add(agent.id);
    roles.add(agent.role);
    if (!REASONING_EFFORTS.has(agent.reasoningEffort))
      throw new Error(`${agent.id}.reasoningEffort is invalid.`);
    if (!EXECUTION_STATES.has(agent.executionStatus))
      throw new Error(`${agent.id}.executionStatus is invalid.`);
    if (typeof agent.independent !== "boolean")
      throw new Error(`${agent.id}.independent must be boolean.`);
    if (
      !Array.isArray(agent.allowedTargets) ||
      agent.allowedTargets.length === 0
    )
      throw new Error(`${agent.id}.allowedTargets must be non-empty.`);
    agent.allowedTargets.forEach((target, index) =>
      requireText(target, `${agent.id}.allowedTargets[${index}]`),
    );
    if (!Array.isArray(agent.deliverables) || agent.deliverables.length === 0)
      throw new Error(`${agent.id}.deliverables must be non-empty.`);
    for (const [index, deliverable] of agent.deliverables.entries()) {
      requireText(
        deliverable.target,
        `${agent.id}.deliverables[${index}].target`,
      );
      if (!targetMatches(deliverable.target, agent.allowedTargets, repoRoot))
        throw new Error(
          `${agent.id} deliverable is outside allowedTargets: ${deliverable.target}`,
        );
      if (!DELIVERABLE_STATES.has(deliverable.status))
        throw new Error(
          `${agent.id}.deliverables[${index}].status is invalid.`,
        );
      if (!Array.isArray(deliverable.outputHashes))
        throw new Error(
          `${agent.id}.deliverables[${index}].outputHashes must be an array.`,
        );
      for (const [
        hashIndex,
        outputHash,
      ] of deliverable.outputHashes.entries()) {
        if (!targetMatches(outputHash.path, agent.allowedTargets, repoRoot))
          throw new Error(
            `${agent.id} output is outside allowedTargets: ${outputHash.path}`,
          );
        verifyHashReference(outputHash, {
          repoRoot,
          anchorOnly,
          managementRoot,
          managementWindowsRoot,
          label: `${agent.id} output`,
          toString: () =>
            `${agent.id}.deliverables[${index}].outputHashes[${hashIndex}]`,
        });
      }
      if (
        deliverable.status === "COMPLETED" &&
        deliverable.outputHashes.length === 0
      )
        throw new Error(
          `${agent.id} completed deliverable lacks an output hash.`,
        );
    }
    if (!Array.isArray(agent.testEvidence) || agent.testEvidence.length === 0)
      throw new Error(`${agent.id}.testEvidence must be non-empty.`);
    for (const [index, test] of agent.testEvidence.entries()) {
      requireText(test.id, `${agent.id}.testEvidence[${index}].id`);
      requireText(
        test.commandOrMethod,
        `${agent.id}.testEvidence[${index}].commandOrMethod`,
      );
      if (!TEST_STATES.has(test.status))
        throw new Error(
          `${agent.id}.testEvidence[${index}].status is invalid.`,
        );
      if (!Array.isArray(test.evidenceRefs))
        throw new Error(
          `${agent.id}.testEvidence[${index}].evidenceRefs must be an array.`,
        );
      for (const reference of test.evidenceRefs)
        verifyHashReference(reference, {
          repoRoot,
          anchorOnly,
          managementRoot,
          managementWindowsRoot,
          label: `${agent.id} test evidence`,
        });
      if (test.status === "PASS" && test.evidenceRefs.length === 0)
        throw new Error(`${agent.id} PASS test lacks exact evidence.`);
    }
    if (!Array.isArray(agent.dependencies))
      throw new Error(`${agent.id}.dependencies must be an array.`);
    agent.dependencies.forEach((dependency, index) =>
      requireText(dependency, `${agent.id}.dependencies[${index}]`),
    );
    const audit = agent.independentAudit;
    if (!audit || !AUDIT_DISPOSITIONS.has(audit.disposition))
      throw new Error(`${agent.id}.independentAudit disposition is invalid.`);
    requireText(audit.auditorRole, `${agent.id}.independentAudit.auditorRole`);
    if (!Array.isArray(audit.evidenceRefs))
      throw new Error(
        `${agent.id}.independentAudit.evidenceRefs must be an array.`,
      );
    for (const reference of audit.evidenceRefs)
      verifyHashReference(reference, {
        repoRoot,
        anchorOnly,
        managementRoot,
        managementWindowsRoot,
        label: `${agent.id} audit evidence`,
      });
    if (audit.disposition === "PASS") {
      if (audit.auditorRole === agent.role)
        throw new Error(`${agent.id} cannot independently audit itself.`);
      if (audit.evidenceRefs.length === 0)
        throw new Error(`${agent.id} PASS audit lacks exact evidence.`);
    }
    if (agent.executionStatus === "COMPLETED") {
      if (
        agent.deliverables.some(
          (deliverable) => deliverable.status !== "COMPLETED",
        )
      )
        throw new Error(`${agent.id} completion exceeds deliverable state.`);
      if (!agent.testEvidence.some((test) => test.status === "PASS"))
        throw new Error(`${agent.id} completion lacks PASS test evidence.`);
    }
  }
  return {
    agents: roster.agents.length,
    hashedOutputs: roster.agents
      .flatMap((agent) => agent.deliverables)
      .flatMap((deliverable) => deliverable.outputHashes).length,
  };
}
