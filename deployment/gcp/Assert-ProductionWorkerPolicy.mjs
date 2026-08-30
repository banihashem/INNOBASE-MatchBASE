import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const targetEnvironment = process.argv[2];
const policyPath = process.argv[3];
const expectedSha256 = process.argv[4];
if (
  !["staging", "production"].includes(targetEnvironment) ||
  !policyPath ||
  ![4, 5].includes(process.argv.length)
) {
  throw new Error(
    "An explicit staging or production environment and exactly one research route policy path are required.",
  );
}

const resolvedPolicyPath = resolve(policyPath);
const policyRelativePath = relative(
  resolve("config/slice3"),
  resolvedPolicyPath,
);
if (
  !/^[A-Za-z0-9._-]+\.json$/u.test(policyRelativePath) ||
  policyRelativePath.includes("/") ||
  policyRelativePath.includes("\\")
) {
  throw new Error("The route policy must be a direct config/slice3 JSON file.");
}

const policyBytes = await readFile(resolvedPolicyPath);
const policySha256 = createHash("sha256").update(policyBytes).digest("hex");
if (expectedSha256 !== undefined && expectedSha256 !== policySha256) {
  throw new Error(
    "The supplied route-policy SHA-256 does not match the governed policy bytes.",
  );
}
const policy = JSON.parse(policyBytes.toString("utf8"));
if (
  !policy ||
  typeof policy !== "object" ||
  Array.isArray(policy) ||
  policy.schemaVersion !== "research-route-policy.v1" ||
  policy.environment !== targetEnvironment ||
  policy.liveActivation !== "enabled" ||
  !Array.isArray(policy.routes) ||
  policy.routes.length < 1 ||
  policy.routes.some(
    (route) =>
      !route ||
      typeof route !== "object" ||
      route.enabled !== true ||
      route.liveQualified !== true,
  )
) {
  throw new Error(
    `${targetEnvironment} worker image is blocked: its governed route policy is not fully enabled and live-qualified.`,
  );
}

process.stdout.write(
  `${targetEnvironment} worker policy accepted: ${policy.policyVersion} sha256:${policySha256}\n`,
);
