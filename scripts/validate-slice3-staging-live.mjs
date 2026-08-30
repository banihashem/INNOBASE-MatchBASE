import { verifyStagingLiveQualificationArtifacts } from "./lib/slice3-staging-live-qualification-v1.mjs";

const result = await verifyStagingLiveQualificationArtifacts();
process.stdout.write(`${JSON.stringify(result)}\n`);
