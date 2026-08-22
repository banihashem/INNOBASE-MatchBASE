import {
  assessCurrentV5Disposition,
  createV5SourceBinding,
  executeCurrentV5CredentialGate,
} from "./lib/slice3-live-qualification-v5.mjs";

const binding = await createV5SourceBinding();
const args = process.argv.slice(2);
if (!(args.length === 0 || (args.length === 1 && args[0] === "--execute")))
  throw new Error("V5 CLI accepts only one optional --execute argument.");
const execution =
  args.length === 1
    ? await executeCurrentV5CredentialGate(binding)
    : assessCurrentV5Disposition(binding);
const result = execution?.evidence ?? execution;
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (
  !new Set([
    "PRE_EXECUTION_PENDING",
    "CREDENTIAL_GATE_PASS_AWAITING_SEPARATE_LIVE_QUALIFICATION",
  ]).has(result.disposition)
)
  process.exitCode = 2;
