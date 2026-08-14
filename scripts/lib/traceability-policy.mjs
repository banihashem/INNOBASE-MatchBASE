import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";

const SHA256 = /^[A-F0-9]{64}$/;

function assertUniqueIds(values, label) {
  const ids = values.map((value) => value.id);
  if (ids.some((id) => typeof id !== "string" || !id.trim()))
    throw new Error(`${label} has a missing ID`);
  if (new Set(ids).size !== ids.length)
    throw new Error(`${label} has duplicate IDs`);
  return new Map(values.map((value) => [value.id, value]));
}

export function isContainedDifference(difference, separator) {
  return (
    difference === "" ||
    (!difference.startsWith(`..${separator}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  );
}

function isWithin(root, target) {
  return isContainedDifference(
    relative(realpathSync(root), realpathSync(target)),
    sep,
  );
}

function verifyRegularFile(path, expectedHash, allowedRoot) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(`Traceability evidence is not a regular file: ${path}`);
  if (!isWithin(allowedRoot, path))
    throw new Error(`Traceability evidence escapes its allowed root: ${path}`);
  const hash = createHash("sha256")
    .update(readFileSync(realpathSync(path)))
    .digest("hex")
    .toUpperCase();
  if (hash !== expectedHash)
    throw new Error(`Traceability evidence hash mismatch: ${path}`);
}

function verifyRef(ref, options) {
  if (
    !ref ||
    typeof ref.path !== "string" ||
    !ref.path.trim() ||
    !SHA256.test(ref.sha256)
  )
    throw new Error("Traceability evidence reference is incomplete");

  if (win32.isAbsolute(ref.path)) {
    const difference = win32.relative(
      win32.normalize(options.managementWindowsRoot),
      win32.normalize(ref.path),
    );
    if (
      difference === ".." ||
      difference.startsWith("..\\") ||
      win32.isAbsolute(difference)
    )
      throw new Error(
        "External traceability evidence is outside management root",
      );
    if (options.anchorOnly) return;
    verifyRegularFile(resolve(ref.path), ref.sha256, options.managementRoot);
    return;
  }

  if (
    isAbsolute(ref.path) ||
    ref.path.includes("\\") ||
    ref.path.split("/").includes("..")
  )
    throw new Error("Repository traceability evidence path is not canonical");
  verifyRegularFile(
    resolve(options.repoRoot, ref.path),
    ref.sha256,
    options.repoRoot,
  );
}

function requireIds(chain, field, index) {
  const values = chain[field];
  if (!Array.isArray(values) || values.length === 0)
    throw new Error(`${chain.id} has no ${field}`);
  for (const id of values) {
    if (!index.has(id))
      throw new Error(`${chain.id} references unknown ${field}: ${id}`);
  }
  return values;
}

export function validateTraceability(traceability, model, options) {
  if (traceability?.schemaVersion !== 1)
    throw new Error("Traceability schemaVersion must be 1");
  if (!Array.isArray(traceability.chains) || traceability.chains.length === 0)
    throw new Error("Traceability chains are missing");
  if (
    !options?.repoRoot ||
    !options?.managementRoot ||
    !options?.managementWindowsRoot
  )
    throw new Error("Traceability validation roots are incomplete");

  const chainIndex = assertUniqueIds(
    traceability.chains,
    "Traceability chains",
  );
  const requirements = assertUniqueIds(model.requirements, "Requirements");
  const risks = assertUniqueIds(model.risks, "Risks");
  const backlog = assertUniqueIds(model.backlog, "Backlog");
  const tests = assertUniqueIds(model.tests, "Tests");
  const gates = assertUniqueIds(model.gates, "Gates");
  const deployments = assertUniqueIds(model.deployments, "Deployments");

  for (const chain of traceability.chains) {
    if (!Array.isArray(chain.sourceRefs) || chain.sourceRefs.length === 0)
      throw new Error(`${chain.id} has no source evidence`);
    if (!Array.isArray(chain.designRefs) || chain.designRefs.length === 0)
      throw new Error(`${chain.id} has no design evidence`);
    if (!Array.isArray(chain.decisionRefs) || chain.decisionRefs.length === 0)
      throw new Error(`${chain.id} has no decision evidence`);
    for (const ref of [
      ...chain.sourceRefs,
      ...chain.decisionRefs,
      ...chain.designRefs,
    ])
      verifyRef(ref, options);
    for (const decisionRef of chain.decisionRefs) {
      if (
        decisionRef.path !== model.decisionSource.path ||
        decisionRef.sha256 !== model.decisionSource.sha256
      )
        throw new Error(
          `${chain.id} does not link the current decision source`,
        );
    }

    const requirement = requirements.get(chain.requirementId);
    if (!requirement)
      throw new Error(`${chain.id} references unknown requirement`);
    if (!requirement.traceabilityIds?.includes(chain.id))
      throw new Error(`${chain.requirementId} lacks ${chain.id} backlink`);
    for (const riskId of requireIds(chain, "riskIds", risks)) {
      if (!risks.get(riskId).traceabilityIds?.includes(chain.id))
        throw new Error(`${riskId} lacks ${chain.id} backlink`);
    }

    for (const backlogId of requireIds(chain, "backlogIds", backlog)) {
      const item = backlog.get(backlogId);
      if (!item.traceabilityIds?.includes(chain.id))
        throw new Error(`${backlogId} lacks ${chain.id} backlink`);
      if (!item.requirementIds?.includes(chain.requirementId))
        throw new Error(`${backlogId} lacks requirement backlink`);
      for (const riskId of chain.riskIds) {
        if (!item.riskIds?.includes(riskId))
          throw new Error(`${backlogId} lacks risk backlink`);
      }
      for (const testId of chain.testIds ?? []) {
        if (!item.acceptanceTestIds?.includes(testId))
          throw new Error(`${backlogId} lacks acceptance-test backlink`);
      }
      for (const gateId of chain.gateIds ?? []) {
        if (!item.gateIds?.includes(gateId))
          throw new Error(`${backlogId} lacks gate backlink`);
      }
      if (item.deploymentId !== chain.deploymentId)
        throw new Error(`${backlogId} lacks deployment backlink`);
    }

    for (const testId of requireIds(chain, "testIds", tests)) {
      if (!tests.get(testId).traceabilityIds?.includes(chain.id))
        throw new Error(`${testId} lacks ${chain.id} backlink`);
    }
    for (const gateId of requireIds(chain, "gateIds", gates)) {
      if (!gates.get(gateId).traceabilityIds?.includes(chain.id))
        throw new Error(`${gateId} lacks ${chain.id} backlink`);
    }
    const deployment = deployments.get(chain.deploymentId);
    if (!deployment)
      throw new Error(`${chain.id} references unknown deployment`);
    if (
      typeof deployment.reason !== "string" ||
      !deployment.reason.trim() ||
      typeof deployment.rollback !== "string" ||
      !deployment.rollback.trim()
    )
      throw new Error(`${chain.deploymentId} lacks terminal evidence`);
    if (!deployment.traceabilityIds?.includes(chain.id))
      throw new Error(`${chain.deploymentId} lacks ${chain.id} backlink`);
  }

  for (const requirement of model.requirements) {
    if (
      !Array.isArray(requirement.traceabilityIds) ||
      requirement.traceabilityIds.length === 0 ||
      requirement.traceabilityIds.some((id) => !chainIndex.has(id))
    )
      throw new Error(`${requirement.id} is not covered by traceability`);
  }

  const ag2 = gates.get("AG2");
  if (ag2?.status === "PASS" && traceability.chains.length === 0)
    throw new Error("AG2 cannot PASS without validated traceability");

  return {
    chains: traceability.chains.length,
    requirements: requirements.size,
  };
}
