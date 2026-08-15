import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const root = resolve(".");
const rosterPath = resolve(root, "governance/agents.json");
const roster = JSON.parse(readFileSync(rosterPath, "utf8"));
const sha = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
for (const agent of roster.agents) {
  const references = [
    ...agent.deliverables.flatMap((deliverable) => deliverable.outputHashes),
    ...agent.testEvidence.flatMap((test) => test.evidenceRefs),
    ...agent.independentAudit.evidenceRefs,
  ];
  for (const reference of references) {
    if (isAbsolute(reference.path)) continue;
    const path = resolve(root, reference.path);
    if (existsSync(path)) reference.sha256 = sha(path);
  }
}
writeFileSync(rosterPath, `${JSON.stringify(roster, null, 2)}\n`, "utf8");
console.log("governance agent hashes synchronized");
