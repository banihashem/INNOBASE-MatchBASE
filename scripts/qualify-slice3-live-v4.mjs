import {
  assessCurrentV4Disposition,
  createV4SourceBinding,
} from "./lib/slice3-live-qualification-v4.mjs";

const binding = await createV4SourceBinding();
const result = assessCurrentV4Disposition(binding);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.disposition !== "READY_TO_QUALIFY") process.exitCode = 2;
