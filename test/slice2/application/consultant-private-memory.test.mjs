import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  bindPrivateMemoryQuote,
  projectPrivateMemoryContext,
  loadQuotedPrivateMemory,
} from "../../../packages/application/dist/consultant-private-memory.js";
import { privateEvidenceCategoryKey } from "../../../packages/data/dist/consultant-private-evidence.js";

const observation = () => ({
  observation_id: randomUUID(),
  observation_version: "a".repeat(64),
  rights_epoch: 1,
  source_id: randomUUID(),
  source_version_id: randomUUID(),
  entity_version_id: null,
  claim_kind: "product_spec",
  claim_text: "Example manufacturer publishes a potassium hydroxide catalogue.",
  price_date: null,
  payload: {
    buyer_quantity: "SECRET_OLD_ORDER",
    assessment: { fit: 100 },
    original_request: "PRIVATE_OLD_REQUEST",
  },
  source: {
    source_url: "https://verified-manufacturer.com/catalog",
    source_type: "official_website",
    publisher: "Example",
    published_at: "2026-08-15T00:00:00.000Z",
    retrieved_at: new Date(Date.now() - 86400000).toISOString(),
    excerpt_summary: "Potassium hydroxide catalogue",
  },
  entity: null,
  eligible_until: new Date(Date.now() + 86400000 * 10).toISOString(),
  recency: "current",
});
const basePlan = () => ({
  version: "research-round.v1",
  mode: "live",
  max_calls: 10,
  max_input_tokens_per_call: 240000,
  research_models: ["google/gemini-research", "openai/research"],
  estimated_low_usd: 1,
  estimated_high_usd: 15,
  rates: [{ input_usd_per_token: 0.000002 }],
  assumptions: ["Original bounded allowance"],
});
const session = {
  account_id: randomUUID(),
  user_profile_id: randomUUID(),
  classification_id: randomUUID(),
  classification: { scheme: "HS", code: "281520", version: "2022" },
};
const rawRow = (item) => ({
  ...item,
  source_url: item.source.source_url,
  source_type: item.source.source_type,
  source_payload: {
    publisher: item.source.publisher,
    excerpt_summary: item.source.excerpt_summary,
  },
  published_at: item.source.published_at
    ? new Date(item.source.published_at)
    : null,
  retrieved_at: new Date(item.source.retrieved_at),
  eligible_until: new Date(item.eligible_until),
  entity_id: null,
  category_key: privateEvidenceCategoryKey(session.classification),
});
const evidenceDb = (rows, expected = session) => ({
  async query(sql, params) {
    assert.equal(params[0], expected.account_id);
    assert.equal(params[1], expected.user_profile_id);
    if (sql.startsWith("SELECT classification FROM"))
      return { rows: [{ classification: expected.classification }] };
    assert.ok(sql.includes("o.account_id=$1 AND o.user_profile_id=$2"));
    return {
      rows: sql.includes("FOR SHARE")
        ? rows.map((row) => ({ source_id: row.source_id }))
        : rows,
    };
  },
});

test("MB-ARCH-IMPLEMENT-001 L02 memory projection excludes old request quantities and personalized fit", () => {
  const item = observation();
  const context = projectPrivateMemoryContext([item]);
  const serialized = JSON.stringify(context);
  assert.doesNotMatch(
    serialized,
    /SECRET_OLD_ORDER|PRIVATE_OLD_REQUEST|assessment|"fit"/,
  );
  assert.equal(
    context.observations[0].source.published_at,
    item.source.published_at,
  );
  assert.equal(
    context.observations[0].source.retrieved_at,
    item.source.retrieved_at,
  );
  assert.match(context.instruction, /fresh live discovery/);
  assert.match(context.instruction, /same originating assertion/);
});

test("MB-ARCH-IMPLEMENT-001 L02 memory quotation binds versions and processing cost without adding call authority", () => {
  const base = basePlan();
  const item = observation();
  const plan = bindPrivateMemoryQuote(base, [item], 3);
  assert.equal(plan.max_calls, base.max_calls);
  assert.equal(plan.max_input_tokens_per_call, base.max_input_tokens_per_call);
  assert.deepEqual(plan.research_models, base.research_models);
  assert.ok(plan.estimated_low_usd > base.estimated_low_usd);
  assert.equal(plan.estimated_high_usd, base.estimated_high_usd);
  assert.equal(plan.private_memory.needs_refresh_count, 3);
  assert.equal(
    plan.private_memory.observation_refs[0].source_version_id,
    item.source_version_id,
  );
  assert.equal(
    plan.private_memory.input_bytes,
    Buffer.byteLength(
      JSON.stringify(projectPrivateMemoryContext([item])),
      "utf8",
    ),
  );
});

test("MB-ARCH-IMPLEMENT-001 L02 dated prices retain their original observation date when publication is unknown", () => {
  const item = {
    ...observation(),
    claim_kind: "pricing",
    price_date: "2026-09-10T00:00:00.000Z",
  };
  item.source.published_at = null;
  const projected = projectPrivateMemoryContext([item]).observations[0];
  assert.equal(projected.price_date, item.price_date);
  assert.equal(projected.source.published_at, null);
  assert.notEqual(projected.price_date, projected.source.retrieved_at);
});

test("MB-ARCH-IMPLEMENT-001 L02 oversized memory is excluded whole with a visible count", () => {
  const large = observation();
  large.source.excerpt_summary = "original evidence ".repeat(8000);
  const small = observation();
  const plan = bindPrivateMemoryQuote(basePlan(), [large, small], 4);
  assert.equal(plan.private_memory.excluded_by_budget_count, 1);
  assert.equal(plan.private_memory.observation_refs.length, 1);
  assert.equal(
    plan.private_memory.observation_refs[0].observation_id,
    small.observation_id,
  );
  assert.ok(plan.private_memory.input_bytes <= 32000);
  assert.equal(
    large.source.excerpt_summary.length,
    "original evidence ".repeat(8000).length,
  );
});

test("MB-ARCH-IMPLEMENT-001 L02 expired observation cannot be silently bound or reused", async () => {
  const item = observation();
  const plan = bindPrivateMemoryQuote(basePlan(), [item], 0);
  item.eligible_until = new Date(Date.now() - 1).toISOString();
  assert.throws(() => bindPrivateMemoryQuote(basePlan(), [item], 0), {
    code: "MB-409-MEMORY-REQUOTE",
  });
  plan.private_memory.valid_until = item.eligible_until;
  await assert.rejects(
    loadQuotedPrivateMemory(
      {
        query() {
          throw new Error("No lookup after expiry");
        },
      },
      session,
      plan,
    ),
    { code: "MB-409-MEMORY-REQUOTE" },
  );
});

test("MB-ARCH-IMPLEMENT-001 L02 quote reuse validates profile ownership, exact source metadata and rights epoch", async () => {
  const item = observation();
  const plan = bindPrivateMemoryQuote(basePlan(), [item], 0);
  const rows = [rawRow(item)];
  const db = evidenceDb(rows);
  const context = await loadQuotedPrivateMemory(db, session, plan);
  assert.deepEqual(context, projectPrivateMemoryContext([item]));
  rows[0].rights_epoch = 2;
  await assert.rejects(loadQuotedPrivateMemory(db, session, plan), {
    code: "MB-409-PRIVATE-EVIDENCE",
  });
  rows[0].rights_epoch = 1;
  rows[0].source_payload.publisher = "Changed source identity";
  await assert.rejects(loadQuotedPrivateMemory(db, session, plan), {
    code: "MB-409-MEMORY-REQUOTE",
  });
});

test("MB-ARCH-IMPLEMENT-001 L02 missing private selection cannot fall back silently to fresh paid research", async () => {
  const item = observation();
  const plan = bindPrivateMemoryQuote(basePlan(), [item], 0);
  await assert.rejects(loadQuotedPrivateMemory(evidenceDb([]), session, plan), {
    code: "MB-409-PRIVATE-EVIDENCE",
  });
});
