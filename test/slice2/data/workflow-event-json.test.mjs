import assert from "node:assert/strict";
import test from "node:test";
import { serializeWorkflowEventDetail } from "../../../packages/data/dist/workflow-event-json.js";
import { createPool } from "../../../packages/data/dist/database.js";

test("L17 audit preserves valid Unicode and literal escapes and omits unsafe content without mutating input", () => {
  const input = {
    response_content: "Supplier ماشین 😀 \\u0000",
    response_citations: [
      {
        url: "https://supplier.example/",
        content_excerpt: "\u001f�\b\u0000binary",
      },
    ],
    other: "\ud800",
    low: "\udc00",
  };
  const saved = JSON.parse(serializeWorkflowEventDetail(input));
  assert.equal(saved.response_content, input.response_content);
  assert.equal(saved.response_citations[0].content_excerpt, null);
  assert.equal(saved.other, null);
  assert.equal(saved.low, null);
  assert.equal(saved.storage_content_safety.omitted_unsafe_strings, 3);
  assert.equal(
    input.response_citations[0].content_excerpt,
    "\u001f�\b\u0000binary",
  );
  assert.deepEqual(
    JSON.parse(serializeWorkflowEventDetail({ value: "😀ماشین" })),
    { value: "😀ماشین" },
  );
});
test(
  "L17 PostgreSQL reproduces 22P05 and accepts safe audit JSON with intact usage",
  { skip: !process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL },
  async () => {
    const pool = createPool({
      connectionString: process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL,
    });
    try {
      const input = {
        state: "completed",
        cost_usd: 0.23,
        response_citations: [{ content_excerpt: "\u0000binary" }],
      };
      await assert.rejects(
        pool.query("SELECT $1::jsonb AS detail", [JSON.stringify(input)]),
        { code: "22P05" },
      );
      const result = await pool.query("SELECT $1::jsonb AS detail", [
        serializeWorkflowEventDetail(input),
      ]);
      assert.equal(result.rows[0].detail.cost_usd, 0.23);
      assert.equal(
        result.rows[0].detail.response_citations[0].content_excerpt,
        null,
      );
    } finally {
      await pool.end();
    }
  },
);
