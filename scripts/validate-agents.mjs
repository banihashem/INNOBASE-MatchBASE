import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateAgentRoster } from "./lib/agent-policy.mjs";

const roster = JSON.parse(
  readFileSync(resolve("governance/agents.json"), "utf8"),
);
const result = validateAgentRoster(roster, {
  repoRoot: process.cwd(),
  anchorOnly:
    process.env.MATCHBASE_EXTERNAL_EVIDENCE_MODE === "ANCHOR_ONLY_CI" &&
    process.env.CI === "true",
});
console.log(
  `agents: PASS (${result.agents} roles; ${result.hashedOutputs} output hashes verified)`,
);
