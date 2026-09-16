import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  REPAIR_CONTRACT,
  sha256,
  validateRepairProposal,
} from "./protocol.mjs";
import {
  readCandidateObservations,
  MAX_OBSERVATION_BYTES,
} from "./evaluation.mjs";

const execute = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const image =
  "node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8";
const temporary = await mkdtemp(path.join(os.tmpdir(), "matchbase-repair-"));
const input = path.join(temporary, "input");
const candidate = path.join(temporary, "candidate");
const oracle = path.join(temporary, "oracle");
const probe = path.join(temporary, "probe");
const observations = path.join(temporary, "observations");
const cleanupTarget = path.resolve(temporary);
if (
  path.dirname(cleanupTarget) !== path.resolve(os.tmpdir()) ||
  !path.basename(cleanupTarget).startsWith("matchbase-repair-")
)
  throw new Error("Temporary cleanup boundary changed.");
const mount = (source, destination, readonly = true) => {
  if (source.includes(","))
    throw new Error("Comma-containing bind paths are unsupported.");
  return [
    "--mount",
    `type=bind,source=${source},target=${destination}${readonly ? ",readonly" : ""}`,
  ];
};
async function container(mounts, script, maxBuffer = 65536) {
  const name = `matchbase-repair-${randomUUID()}`;
  try {
    return await execute(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        name,
        "--pull",
        "never",
        "--network",
        "none",
        "--read-only",
        "--user",
        "1000:1000",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "64",
        "--memory",
        "512m",
        "--cpus",
        "1",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,noexec,size=16m",
        "--label",
        "matchbase.role=isolated-repair-qualification",
        ...mounts,
        image,
        "node",
        script,
      ],
      { timeout: 45000, maxBuffer, windowsHide: true },
    );
  } finally {
    // Killing a timed-out Docker client does not prove that its container stopped.
    let label = "";
    try {
      label = (
        await execute(
          "docker",
          [
            "inspect",
            "--format",
            '{{index .Config.Labels "matchbase.role"}}',
            name,
          ],
          { timeout: 10000, windowsHide: true },
        )
      ).stdout.trim();
    } catch {
      /* --rm already removed a completed container. */
    }
    if (label === "isolated-repair-qualification")
      await execute("docker", ["rm", "--force", name], {
        timeout: 10000,
        windowsHide: true,
      });
  }
}
try {
  await Promise.all([
    mkdir(input),
    mkdir(candidate),
    mkdir(oracle),
    mkdir(probe),
    mkdir(observations),
  ]);
  await Promise.all([
    copyFile(
      path.join(directory, "fixtures/broken-policy.mjs"),
      path.join(input, "source.mjs"),
    ),
    copyFile(
      path.join(directory, "fixtures/seeded-repair.mjs"),
      path.join(input, "repair.mjs"),
    ),
    copyFile(
      path.join(directory, "fixtures/protected-acceptance.mjs"),
      path.join(oracle, "acceptance.mjs"),
    ),
    copyFile(
      path.join(directory, "evaluation.mjs"),
      path.join(oracle, "evaluation.mjs"),
    ),
    copyFile(
      path.join(directory, "fixtures/candidate-probe.mjs"),
      path.join(probe, "probe.mjs"),
    ),
  ]);
  const original = await readFile(path.join(input, "source.mjs"), "utf8");
  const oracleBefore = sha256(
    Buffer.concat(
      await Promise.all([
        readFile(path.join(oracle, "acceptance.mjs")),
        readFile(path.join(oracle, "evaluation.mjs")),
      ]),
    ),
  );
  const evaluate = async () => {
    const execution = await container(
      [...mount(candidate, "/candidate"), ...mount(probe, "/probe")],
      "/probe/probe.mjs",
      MAX_OBSERVATION_BYTES,
    );
    // A successful exit or candidate-controlled success string grants nothing.
    readCandidateObservations(execution.stdout);
    await writeFile(path.join(observations, "result.json"), execution.stdout);
    return container(
      [...mount(observations, "/observations"), ...mount(oracle, "/oracle")],
      "/oracle/acceptance.mjs",
    );
  };
  await writeFile(path.join(candidate, "recovery-policy.mjs"), original);
  let rejectedSeed = false;
  try {
    await evaluate();
  } catch (error) {
    if (typeof error.code !== "number" || error.code !== 1) throw error;
    rejectedSeed = true;
  }
  if (!rejectedSeed)
    throw new Error(
      "The protected evaluator did not reject the seeded defect.",
    );
  const repaired = await container(
    [
      ...mount(input, "/inputs"),
      "--tmpfs",
      "/candidate:rw,nosuid,nodev,noexec,size=128k,mode=1777",
    ],
    "/inputs/repair.mjs",
  );
  const proposal = JSON.parse(repaired.stdout);
  const admission = validateRepairProposal(
    proposal,
    { "src/recovery-policy.mjs": original },
    ["src/recovery-policy.mjs"],
  );
  await writeFile(
    path.join(candidate, "recovery-policy.mjs"),
    proposal.changes[0].content,
  );
  const evaluated = await evaluate();
  if (
    sha256(
      Buffer.concat(
        await Promise.all([
          readFile(path.join(oracle, "acceptance.mjs")),
          readFile(path.join(oracle, "evaluation.mjs")),
        ]),
      ),
    ) !== oracleBefore ||
    (await readFile(path.join(input, "source.mjs"), "utf8")) !== original
  )
    throw new Error("Protected source or oracle was changed.");
  const result = {
    version: "isolated-repair-qualification.v2",
    tested_at: new Date().toISOString(),
    image,
    contract: REPAIR_CONTRACT,
    candidate: admission,
    seeded_defect_rejected: rejectedSeed,
    protected_oracle_sha256: oracleBefore,
    executor: "deterministic-synthetic-adapter",
    evaluation_boundary:
      "candidate-only container -> bounded schema-validated data -> oracle-only container",
    autonomous_model_repair_qualified: false,
    repair_output:
      "Bounded proposal received from isolated tmpfs; no writable host mount.",
    evaluation_output: evaluated.stdout.trim(),
    runtime_modified: false,
  };
  const root = path.join(
    process.env.LOCALAPPDATA || os.tmpdir(),
    "MatchBASE",
    "incident-repair-qualification",
  );
  await mkdir(root, { recursive: true });
  const target = path.join(root, `qualification-${Date.now()}.json`);
  await writeFile(target, JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(
    JSON.stringify({
      status: "synthetic-boundary-qualified",
      report: target,
      may_deploy: false,
    }),
  );
} finally {
  // This exact directory was created by mkdtemp in this invocation; no user path is deleted.
  await rm(cleanupTarget, { recursive: true, force: true });
}
