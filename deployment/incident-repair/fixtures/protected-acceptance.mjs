import { readFile } from "node:fs/promises";
import { gradeSyntheticObservations } from "./evaluation.mjs";

// Oracle-only runtime: candidate source is never mounted or imported here.
const accepted = gradeSyntheticObservations(
  await readFile("/observations/result.json", "utf8"),
);
if (!accepted) process.exitCode = 1;
else
  console.log(
    "Protected synthetic acceptance passed; release still requires independent authority.",
  );
