import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assessStagingLiveQualification,
  executeStagingLiveQualification,
} from "./lib/slice3-staging-live-qualification-v1.mjs";

const EXECUTION_SIGNAL = "I_AUTHORIZE_SYNTHETIC_STAGING_QUALIFICATION_V1";

export async function run(
  args = process.argv.slice(2),
  environment = process.env,
) {
  if (!(args.length === 0 || (args.length === 1 && args[0] === "--execute"))) {
    throw new Error("Staging qualification accepts only optional --execute.");
  }
  if (args.length === 0) return assessStagingLiveQualification();
  if (
    environment.MATCHBASE_SLICE3_STAGING_LIVE_QUALIFICATION !== EXECUTION_SIGNAL
  ) {
    return Object.freeze({
      schemaVersion: "matchbase.slice3-staging-live-qualification-preflight/v1",
      disposition: "BLOCKED_PREREQUISITE",
      blockers: Object.freeze(["EXACT_EXECUTION_SIGNAL_ABSENT"]),
      credentialValuesInspected: false,
      externalHttpCalls: 0,
      providerModelPosts: 0,
      billableCalls: 0,
      cloudMutations: 0,
    });
  }
  return executeStagingLiveQualification();
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const result = await run();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (
    result.disposition !== "PASS" &&
    result.disposition !== "READY_TO_QUALIFY"
  ) {
    process.exitCode = 2;
  }
}

export const SLICE3_STAGING_EXECUTION_SIGNAL = EXECUTION_SIGNAL;
