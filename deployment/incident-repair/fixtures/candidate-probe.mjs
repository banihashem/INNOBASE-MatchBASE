import { pathToFileURL } from "node:url";

// Candidate runtime receives test inputs only. Every emitted byte is untrusted;
// acceptance, expected answers and assertions live in another runtime/container.
const target = process.argv[2] ?? "/candidate/recovery-policy.mjs";
const candidate = await import(pathToFileURL(target).href);
const observations = [];
for (const [index, input] of [0, 1, 3, 5, 12, 24].entries()) {
  observations.push({
    case_id: `case-${index}`,
    value: await candidate.attemptsAllowed(input),
  });
}
process.stdout.write(
  JSON.stringify({ version: "candidate-observations.v1", observations }),
);
