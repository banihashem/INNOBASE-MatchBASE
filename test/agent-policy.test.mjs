import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateAgentRoster } from "../scripts/lib/agent-policy.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "matchbase-agent-policy-"));
  const output = join(root, "output.txt");
  writeFileSync(output, "verified bytes\n", "utf8");
  const sha256 = createHash("sha256")
    .update(readFileSync(output))
    .digest("hex")
    .toUpperCase();
  const evidence = { path: output, sha256 };
  return {
    root,
    evidence,
    roster: {
      schemaVersion: 1,
      agents: [
        {
          id: "AGENT-TEST",
          role: "Producer",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          executionStatus: "COMPLETED",
          scope: "bounded output",
          independent: false,
          allowedTargets: ["output.txt"],
          deliverables: [
            {
              target: "output.txt",
              status: "COMPLETED",
              outputHashes: [evidence],
            },
          ],
          testEvidence: [
            {
              id: "TEST-1",
              status: "PASS",
              commandOrMethod: "deterministic fixture check",
              evidenceRefs: [evidence],
            },
          ],
          dependencies: [],
          independentAudit: {
            auditorRole: "Independent critic",
            disposition: "PENDING",
            evidenceRefs: [],
          },
        },
      ],
    },
  };
}

function useWindowsSource(roster, sha256) {
  const reference = {
    path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\evidence.md",
    sha256,
  };
  roster.agents[0].allowedTargets = [reference.path];
  roster.agents[0].deliverables[0].target = reference.path;
  roster.agents[0].deliverables[0].outputHashes = [reference];
  roster.agents[0].testEvidence[0].evidenceRefs = [reference];
  return reference;
}

test("validates exact output and test-evidence hashes", () => {
  const value = fixture();
  try {
    assert.deepEqual(
      validateAgentRoster(value.roster, { repoRoot: value.root }),
      {
        agents: 1,
        hashedOutputs: 1,
      },
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("rejects completed deliverables without output hashes", () => {
  const value = fixture();
  try {
    value.roster.agents[0].deliverables[0].outputHashes = [];
    assert.throws(
      () => validateAgentRoster(value.roster, { repoRoot: value.root }),
      /lacks an output hash/,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("rejects stale output hashes", () => {
  const value = fixture();
  try {
    value.roster.agents[0].deliverables[0].outputHashes[0].sha256 = "0".repeat(
      64,
    );
    assert.throws(
      () => validateAgentRoster(value.roster, { repoRoot: value.root }),
      /hash mismatch/,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("rejects self-approved independent audit", () => {
  const value = fixture();
  try {
    value.roster.agents[0].independentAudit = {
      auditorRole: "Producer",
      disposition: "PASS",
      evidenceRefs: [value.evidence],
    };
    assert.throws(
      () => validateAgentRoster(value.roster, { repoRoot: value.root }),
      /cannot independently audit itself/,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("recognizes Windows absolute evidence anchors on a hosted non-Windows runner", () => {
  const value = fixture();
  try {
    const windowsAnchor = {
      path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\evidence.md",
      sha256: "A".repeat(64),
    };
    value.roster.agents[0].allowedTargets = [windowsAnchor.path];
    value.roster.agents[0].deliverables[0].target = windowsAnchor.path;
    value.roster.agents[0].deliverables[0].outputHashes = [windowsAnchor];
    value.roster.agents[0].testEvidence[0].evidenceRefs = [windowsAnchor];
    assert.doesNotThrow(() =>
      validateAgentRoster(value.roster, {
        repoRoot: value.root,
        anchorOnly: true,
      }),
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("rejects deliverables and outputs outside allowed targets", () => {
  const value = fixture();
  try {
    value.roster.agents[0].allowedTargets = ["another-output.txt"];
    assert.throws(
      () => validateAgentRoster(value.roster, { repoRoot: value.root }),
      /outside allowedTargets/,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("rejects hosted Windows anchors outside the management root", () => {
  const value = fixture();
  try {
    const outside = {
      path: "C:\\outside\\evidence.md",
      sha256: "A".repeat(64),
    };
    value.roster.agents[0].allowedTargets = [outside.path];
    value.roster.agents[0].deliverables[0].target = outside.path;
    value.roster.agents[0].deliverables[0].outputHashes = [outside];
    value.roster.agents[0].testEvidence[0].evidenceRefs = [outside];
    assert.throws(
      () =>
        validateAgentRoster(value.roster, {
          repoRoot: value.root,
          anchorOnly: true,
        }),
      /outside the management and repository roots/,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("rejects normalized traversal hidden behind the management prefix", () => {
  const value = fixture();
  try {
    const traversal = {
      path: "C:\\INNOBASE\\MatchBASE\\01_Product_Management\\..\\outside\\evil.md",
      sha256: "A".repeat(64),
    };
    value.roster.agents[0].allowedTargets = [traversal.path];
    value.roster.agents[0].deliverables[0].target = traversal.path;
    value.roster.agents[0].deliverables[0].outputHashes = [traversal];
    value.roster.agents[0].testEvidence[0].evidenceRefs = [traversal];
    assert.throws(
      () =>
        validateAgentRoster(value.roster, {
          repoRoot: value.root,
          anchorOnly: true,
        }),
      /outside the management and repository roots/,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("rejects a repository-relative traversal even when target bytes exist", () => {
  const value = fixture();
  try {
    const traversal = {
      path: "../output.txt",
      sha256: value.evidence.sha256,
    };
    value.roster.agents[0].allowedTargets = [traversal.path];
    value.roster.agents[0].deliverables[0].target = traversal.path;
    value.roster.agents[0].deliverables[0].outputHashes = [traversal];
    assert.throws(
      () => validateAgentRoster(value.roster, { repoRoot: value.root }),
      /escapes repository root/,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("binds historical agent outputs to immutable Git objects while current paths evolve", () => {
  const root = realpathSync(new URL("..", import.meta.url));
  const roster = JSON.parse(
    readFileSync(new URL("../governance/agents.json", import.meta.url), "utf8"),
  );
  const source = fixture();
  try {
    for (const reference of roster.agents.flatMap((agent) => [
      ...agent.deliverables.flatMap((deliverable) => deliverable.outputHashes),
      ...agent.testEvidence.flatMap((item) => item.evidenceRefs),
      ...agent.independentAudit.evidenceRefs,
    ])) {
      if (reference.path.startsWith("C:\\") && reference.gitBlob === undefined)
        reference.sha256 = source.evidence.sha256;
    }
    const options = {
      repoRoot: root,
      regularSourceRoot: source.root,
      regularSourceResolver: () => source.evidence.path,
    };
    assert.doesNotThrow(() => validateAgentRoster(roster, options));
    const mutated = structuredClone(roster);
    const reference = mutated.agents
      .flatMap((agent) => agent.deliverables)
      .flatMap((deliverable) => deliverable.outputHashes)
      .find((output) => output.gitBlob);
    assert.ok(reference);
    reference.gitBlob = "0".repeat(40);
    assert.throws(
      () => validateAgentRoster(mutated, options),
      /Git object binding is invalid/,
    );
  } finally {
    rmSync(source.root, { recursive: true, force: true });
  }
});

test("resolves a Windows identity through a contained regular fixture", () => {
  const value = fixture();
  try {
    useWindowsSource(value.roster, value.evidence.sha256);
    assert.doesNotThrow(() =>
      validateAgentRoster(value.roster, {
        repoRoot: value.root,
        regularSourceRoot: value.root,
        regularSourceResolver: () => value.evidence.path,
      }),
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

for (const [name, resolver, pattern] of [
  ["missing", (value) => join(value.root, "missing.md"), /source is missing/u],
  ["nonregular", (value) => value.root, /must be a regular file/u],
  [
    "traversal",
    (value) => join(value.root, "..", "outside.md"),
    /escaped its fixture root/u,
  ],
]) {
  test(`rejects a ${name} injected Windows source`, () => {
    const value = fixture();
    try {
      useWindowsSource(value.roster, value.evidence.sha256);
      assert.throws(
        () =>
          validateAgentRoster(value.roster, {
            repoRoot: value.root,
            regularSourceRoot: value.root,
            regularSourceResolver: () => resolver(value),
          }),
        pattern,
      );
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  });
}

test("rejects an injected Windows source hash substitution", () => {
  const value = fixture();
  try {
    useWindowsSource(value.roster, "0".repeat(64));
    assert.throws(
      () =>
        validateAgentRoster(value.roster, {
          repoRoot: value.root,
          regularSourceRoot: value.root,
          regularSourceResolver: () => value.evidence.path,
        }),
      /resolver source hash mismatch/u,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});
