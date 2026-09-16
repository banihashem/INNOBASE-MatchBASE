import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  boundedJson,
  evaluateProposal,
  extractionPrompt,
  isOutsideDirectory,
  noGenerator,
  qualificationDecision,
  resolveQualificationOutput,
  runFixture,
  sha256,
  validateFixtureSplit,
  validateProposal,
  verifyQwenArtifact,
  writeQualificationReport,
} from "../../deployment/local-model/qualification.mjs";

const cases = JSON.parse(
  await readFile(
    new URL(
      "../../deployment/local-model/fixtures/development.json",
      import.meta.url,
    ),
  ),
);
const fixture = cases[0];
const valid = {
  status: "observed",
  value: "USD 820 per metric tonne",
  quote: "KOH 90% flakes, USD 820 per metric tonne, FOB test port.",
  source_date: "2026-09-14",
};

test("source-bound syntax is necessary but does not certify commercial semantics", () => {
  assert.equal(validateProposal(valid, fixture), true);
  const wrong = { ...valid, value: "USD 820 per kilogram" };
  assert.equal(validateProposal(wrong, fixture), true);
  assert.equal(evaluateProposal(wrong, fixture).critical_error, true);
});
test("invented quotation, date and schema extension are rejected", () => {
  for (const wrong of [
    { ...valid, quote: "never present" },
    { ...valid, source_date: "2026-09-16" },
    { ...valid, tool_call: "send" },
  ])
    assert.equal(validateProposal(wrong, fixture), false);
});
test("abstention cannot carry an asserted value", () =>
  assert.equal(
    validateProposal({ ...valid, status: "not_established" }, fixture),
    false,
  ));
test("model prompt contains evidence but excludes evaluation answers and private memory", () => {
  const prompt = extractionPrompt({
    ...fixture,
    expected: { secret: "oracle-hidden" },
    private_memory: { secret: "memory-hidden" },
  });
  assert.ok(prompt.includes(fixture.source.text));
  assert.ok(
    !prompt.includes("oracle-hidden") && !prompt.includes("memory-hidden"),
  );
});

test("actual price fixture does not provide its oracle when evidence has no price", () => {
  const withoutPrice = {
    ...fixture,
    source: { text: "No current price is supplied by this source." },
  };
  assert.equal(fixture.fixture_revision, 2);
  assert.equal(fixture.question.includes(fixture.expected.value), false);
  assert.equal(
    extractionPrompt(withoutPrice).includes(fixture.expected.value),
    false,
  );
  assert.equal(extractionPrompt(withoutPrice).includes("820"), false);
  // The expected answer and pricing-unit rejection rule remain unchanged.
  assert.equal(fixture.expected.value, "USD 820 per metric tonne");
  assert.equal(
    evaluateProposal({ ...valid, value: "USD 820 per kilogram" }, fixture)
      .critical_error,
    true,
  );
});

async function temporarySource(t) {
  const parent = await mkdtemp(
    path.join(os.tmpdir(), "matchbase-local-qualification-"),
  );
  t.after(async () => {
    const resolved = path.resolve(parent);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.match(path.basename(resolved), /^matchbase-local-qualification-/);
    await rm(resolved, { recursive: true, force: true });
  });
  const source = path.join(parent, "source");
  const reports = path.join(parent, "source-reports");
  await mkdir(source);
  await mkdir(reports);
  return { parent, source, reports };
}

test("output containment compares path components and Windows drive boundaries", () => {
  const windows = path.win32;
  assert.equal(
    isOutsideDirectory(
      "C:\\source",
      "C:\\source\\..reports\\result.json",
      windows,
    ),
    false,
  );
  assert.equal(
    isOutsideDirectory(
      "C:\\source",
      "c:\\SOURCE\\ordinary\\result.json",
      windows,
    ),
    false,
  );
  assert.equal(isOutsideDirectory("C:\\source", "C:\\source", windows), false);
  assert.equal(
    isOutsideDirectory(
      "C:\\source",
      "C:\\source-reports\\result.json",
      windows,
    ),
    true,
  );
  assert.equal(
    isOutsideDirectory("C:\\source", "D:\\reports\\result.json", windows),
    true,
  );
});

test("output guard rejects ordinary in-tree paths, dot-prefix directories and source root", async (t) => {
  const { source } = await temporarySource(t);
  await mkdir(path.join(source, "ordinary"));
  await mkdir(path.join(source, "..reports"));
  for (const output of [
    source,
    path.join(source, "ordinary", "result.json"),
    path.join(source, "..reports", "result.json"),
  ]) {
    await assert.rejects(
      resolveQualificationOutput(source, output),
      /outside the source/,
    );
  }
});

test("outside junction into source cannot admit a generated report", async (t) => {
  const { parent, source } = await temporarySource(t);
  const alias = path.join(parent, "apparently-outside");
  await symlink(
    source,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    resolveQualificationOutput(source, path.join(alias, "result.json")),
    /outside the source/,
  );
});

test("a genuine sibling directory receives an exclusively created report", async (t) => {
  const { source, reports } = await temporarySource(t);
  const output = path.join(reports, "result.json");
  assert.equal(
    await resolveQualificationOutput(source, output),
    path.join(await realpath(reports), "result.json"),
  );
  await writeQualificationReport(source, output, { diagnostic: true });
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), {
    diagnostic: true,
  });
});

test("existing report is rejected without changing retained evidence", async (t) => {
  const { source, reports } = await temporarySource(t);
  const output = path.join(reports, "result.json");
  await writeFile(output, "original-evidence");
  await assert.rejects(
    resolveQualificationOutput(source, output),
    /already exists/,
  );
  await assert.rejects(
    writeQualificationReport(source, output, { replaced: true }),
    /already exists/,
  );
  assert.equal(await readFile(output, "utf8"), "original-evidence");
});

test("competing report writers cannot overwrite a newly created result", async (t) => {
  const { source, reports } = await temporarySource(t);
  const output = path.join(reports, "result.json");
  const writes = await Promise.allSettled([
    writeQualificationReport(source, output, { writer: 1 }),
    writeQualificationReport(source, output, { writer: 2 }),
  ]);
  assert.equal(
    writes.filter((entry) => entry.status === "fulfilled").length,
    1,
  );
  assert.equal(writes.filter((entry) => entry.status === "rejected").length, 1);
  assert.ok([1, 2].includes(JSON.parse(await readFile(output, "utf8")).writer));
});
test("no-generator control preserves unresolved work without paid escalation", () => {
  const result = noGenerator(fixture);
  assert.equal(result.route, "qualified_cloud_required_not_dispatched");
  assert.equal(evaluateProposal(result.proposal, fixture).omission, true);
});
test("exact private reuse rejects changed scope, rights, source or expiry", () => {
  const remembered = {
    ...fixture,
    private_memory: {
      profile_id: fixture.profile_id,
      entity: fixture.target_entity,
      question: fixture.question,
      source_sha256: sha256(fixture.source.text),
      rights_epoch: 1,
      expires_at: "2026-09-20",
      proposal: valid,
    },
  };
  assert.equal(noGenerator(remembered).route, "exact_private_reuse");
  for (const mutation of [
    { profile_id: "other" },
    { rights_epoch: 2 },
    { source: { text: "changed" } },
    { as_of: "2026-09-20" },
    { target_entity: "other entity" },
  ])
    assert.equal(
      noGenerator({ ...remembered, ...mutation }).route,
      "qualified_cloud_required_not_dispatched",
    );
});
test("held-out acceptance cannot be unlocked by selecting a CLI split", () => {
  assert.throws(
    () => validateFixtureSplit(cases, "acceptance"),
    /independently authorized/,
  );
  assert.throws(() => validateFixtureSplit(cases, "calibration"), /mixed/);
  assert.equal(qualificationDecision().production_activation, false);
});
test("network guard rejects remote, credentialed and unpinned local endpoints", async () => {
  for (const url of [
    "https://example.com",
    "http://10.0.0.1:11434",
    "http://127.0.0.1:3000",
    "http://user:password@127.0.0.1:11434",
  ])
    await assert.rejects(boundedJson(url), /pinned loopback/);
});
test("local transport bounds responses and does not follow redirects", async () => {
  await assert.rejects(
    boundedJson(
      "http://127.0.0.1:11434/api/generate",
      {},
      {
        fetchImpl: async (_, options) => {
          assert.equal(options.redirect, "error");
          return new Response("x".repeat(262145));
        },
      },
    ),
    /exceeded/,
  );
});
test("artifact drift fails before local inference", async () => {
  await assert.rejects(
    verifyQwenArtifact(
      { model: "qwen3.5:4b", model_manifest_sha256: "pinned" },
      async () => ({ models: [{ name: "qwen3.5:4b", digest: "changed" }] }),
    ),
    /does not match/,
  );
});
test("local unavailability leaves unresolved work and never invokes cloud", async () => {
  let calls = 0;
  const result = await runFixture(
    fixture,
    "qwen",
    { model: "qwen3.5:4b", parameters: {} },
    async (url) => {
      calls++;
      assert.ok(url.startsWith("http://127.0.0.1:11434"));
      throw new Error("unavailable");
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.cloud_calls, 0);
  assert.equal(result.route, "unresolved_no_cloud_dispatch");
});
test("truncated model completion cannot become an observation", async () => {
  const result = await runFixture(
    fixture,
    "qwen",
    { model: "qwen3.5:4b", parameters: {} },
    async () => ({
      done: true,
      done_reason: "length",
      response: JSON.stringify(valid),
    }),
  );
  assert.equal(result.failed, true);
});
test("development and calibration use distinct source/entity clusters", async () => {
  const calibration = JSON.parse(
    await readFile(
      new URL(
        "../../deployment/local-model/fixtures/calibration.json",
        import.meta.url,
      ),
    ),
  );
  validateFixtureSplit(cases, "development");
  validateFixtureSplit(calibration, "calibration");
  const clusters = new Set(cases.map((item) => item.cluster_id));
  assert.ok(calibration.every((item) => !clusters.has(item.cluster_id)));
});
