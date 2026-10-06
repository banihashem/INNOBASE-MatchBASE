import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  createPool,
  migrateUp,
  inTransaction,
  createConsultantDraftSession,
  saveConsultantDraftSession,
  getConsultantDraftSessionById,
  reserveNarrativeIntake,
  admitNarrativeCall,
  recordNarrativeReceipt,
  finishNarrativeIntake,
  readNarrativeIntake,
  editableConsultantDraftData,
  admitConsultantDraftSubmission,
  readConsultantCostEvents,
} from "../../../packages/data/dist/index.js";
import { submitNarrativeIntake } from "../../../packages/application/dist/consultant-narrative-intake.js";
import { summarizeResearchCosts } from "../../../packages/application/dist/consultant-research-cost.js";
import { validateNarrativeMapping } from "../../../packages/contracts/dist/src/index.js";

const database = process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL;
(database ? test : test.skip)(
  "MB-UX-LOGISTICS-001 L01 guarded PostgreSQL narrative ownership, CAS, receipts and lineage",
  async (t) => {
    const pool = createPool({ connectionString: database, max: 6 });
    await migrateUp(pool);
    const account_id = randomUUID(),
      user_profile_id = randomUUID();
    await pool.query(
      "INSERT INTO account(account_id,display_name,status) VALUES($1,'Narrative isolated fixture','active')",
      [account_id],
    );
    t.after(async () => {
      await pool.query(
        "DELETE FROM consultant_draft_session WHERE account_id=$1",
        [account_id],
      );
      await pool.query(
        "DELETE FROM consultant_intake_snapshot WHERE account_id=$1",
        [account_id],
      );
      await pool.query("DELETE FROM account WHERE account_id=$1", [account_id]);
      await pool.end();
    });
    const source =
      "Qingdao to either Tincan or Lekki; two 20-foot containers, 20.5 tonnes net per container; switch B/L required, direct preferred. No inland delivery.";
    async function draft(narrative = source) {
      const created = await createConsultantDraftSession(
        pool,
        account_id,
        user_profile_id,
      );
      await saveConsultantDraftSession(
        pool,
        {
          ...created,
          account_id,
          user_profile_id,
          tier: "consultant",
          status: "active",
          draft_data: { industry: "logistics", originalNarrative: narrative },
        },
        1,
      );
      return {
        account_id,
        user_profile_id,
        draft_id: created.draft_id,
        expected_version: 2,
      };
    }
    const input = await draft();
    await t.test(
      "foreign owner and stale versions fail before reservation",
      async () => {
        await assert.rejects(
          reserveNarrativeIntake(pool, {
            ...input,
            user_profile_id: randomUUID(),
          }),
          (error) => error.status === 404,
        );
        await assert.rejects(
          reserveNarrativeIntake(pool, { ...input, expected_version: 1 }),
          (error) => error.status === 409,
        );
        assert.equal(
          await readNarrativeIntake(
            pool,
            account_id,
            user_profile_id,
            input.draft_id,
          ),
          null,
        );
      },
    );
    let operation;
    await t.test(
      "concurrent submit reserves exactly one operation",
      async () => {
        const results = await Promise.all([
          reserveNarrativeIntake(pool, input),
          reserveNarrativeIntake(pool, input),
        ]);
        assert.equal(results.filter((row) => row.dispatch).length, 1);
        assert.equal(
          results[0].operation.operation_id,
          results[1].operation.operation_id,
        );
        operation = results[0].operation;
      },
    );
    await t.test(
      "client receipts and classification cannot become trusted provenance",
      async () => {
        const clean = editableConsultantDraftData({
          industry: "logistics",
          originalNarrative: source,
          receipts: { cost_usd: -90 },
          proposal: { invented: true },
          classification: { approved: true },
          operation_id: operation.operation_id,
        });
        assert.deepEqual(clean, {
          industry: "logistics",
          originalNarrative: source,
        });
        assert.equal(
          await readNarrativeIntake(
            pool,
            account_id,
            randomUUID(),
            input.draft_id,
          ),
          null,
        );
      },
    );
    const requestId = randomUUID();
    await t.test(
      "dispatch admission is single use and terminal receipts remain immutable",
      async () => {
        await admitNarrativeCall(pool, operation, {
          request_id: requestId,
          model: "openai/gpt-5.2",
        });
        await assert.rejects(
          admitNarrativeCall(pool, operation),
          (error) => error.status === 409,
        );
        await recordNarrativeReceipt(pool, operation.operation_id, {
          request_id: requestId,
          model: "openai/gpt-5.2",
          state: "completed",
          dispatched: true,
          phase: "narrative_intake",
          cost_reported: true,
          cost_usd: 0.01,
          is_byok: true,
          upstream_inference_cost: 0.02,
        });
        await recordNarrativeReceipt(pool, operation.operation_id, {
          request_id: requestId,
          state: "started",
          cost_usd: 999,
        });
        const retained = await readNarrativeIntake(
          pool,
          account_id,
          user_profile_id,
          input.draft_id,
        );
        assert.equal(retained.receipts[requestId].cost_usd, 0.01);
        await assert.rejects(
          pool.query(
            "UPDATE consultant_narrative_intake SET receipts='{}' WHERE operation_id=$1",
            [operation.operation_id],
          ),
          /immutable/,
        );
      },
    );
    await t.test(
      "proposal and source survive reload; submission links cost once without receipt rewrites",
      async () => {
        const proposal = validateNarrativeMapping(source, {
          assignments: [
            { unit_id: 0, boxes: ["productRequirement", "orderProfile"] },
            { unit_id: 1, boxes: ["technicalCompliance"] },
          ],
        });
        await finishNarrativeIntake(
          pool,
          operation.operation_id,
          proposal,
          null,
        );
        const before = await readNarrativeIntake(
          pool,
          account_id,
          user_profile_id,
          input.draft_id,
        );
        const snapshot = {
          snapshot_id: randomUUID(),
          account_id,
          user_profile_id,
          run_id: randomUUID(),
          revision_number: 1,
          product_requirement: source,
          technical_compliance: "",
          order_profile: "",
          content_hash: "f".repeat(64),
        };
        const admission = await inTransaction(pool, (db) =>
          admitConsultantDraftSubmission(db, {
            ...input,
            mode: "live",
            snapshot,
          }),
        );
        assert.equal(admission.replay, false);
        const replay = await inTransaction(pool, (db) =>
          admitConsultantDraftSubmission(db, {
            ...input,
            mode: "live",
            snapshot,
          }),
        );
        assert.equal(replay.replay, true);
        const after = await readNarrativeIntake(
          pool,
          account_id,
          user_profile_id,
          input.draft_id,
        );
        assert.deepEqual(after.receipts, before.receipts);
        assert.deepEqual(after.proposal, proposal);
        const restored = await getConsultantDraftSessionById(
          pool,
          account_id,
          user_profile_id,
          input.draft_id,
        );
        assert.equal(restored.draft_data.originalNarrative, source);
        assert.equal(restored.draft_data.industry, "logistics");
        const events = await readConsultantCostEvents(
          pool,
          account_id,
          snapshot.run_id,
        );
        assert.equal(events.length, 1);
        assert.equal(events[0].detail.request_id, requestId);
        assert.equal(
          (await readConsultantCostEvents(pool, randomUUID(), snapshot.run_id))
            .length,
          0,
        );
        const cost = summarizeResearchCosts(events);
        assert.equal(cost.preparation_usd, 0.03);
        assert.equal(cost.research_usd, 0);
      },
    );
    await t.test(
      "changed source fails dispatch and aborted submission rolls back run lineage",
      async () => {
        const changed = await draft();
        const reserved = (await reserveNarrativeIntake(pool, changed))
          .operation;
        const current = await getConsultantDraftSessionById(
          pool,
          account_id,
          user_profile_id,
          changed.draft_id,
        );
        await saveConsultantDraftSession(
          pool,
          {
            ...current,
            draft_data: {
              industry: "logistics",
              originalNarrative: "Reverse B to A.",
            },
          },
          2,
        );
        await assert.rejects(
          admitNarrativeCall(pool, reserved),
          (error) => error.status === 409,
        );
        const snapshot = {
          snapshot_id: randomUUID(),
          account_id,
          user_profile_id,
          run_id: randomUUID(),
          revision_number: 1,
          product_requirement: "Reverse B to A.",
          technical_compliance: "",
          order_profile: "",
          content_hash: "e".repeat(64),
        };
        await assert.rejects(
          inTransaction(pool, async (db) => {
            await admitConsultantDraftSubmission(db, {
              ...changed,
              expected_version: 3,
              mode: "live",
              snapshot,
            });
            throw new Error("Rollback fixture");
          }),
          /Rollback fixture/,
        );
        assert.equal(
          (
            await readNarrativeIntake(
              pool,
              account_id,
              user_profile_id,
              changed.draft_id,
            )
          ).run_id,
          null,
        );
        assert.equal(
          (
            await getConsultantDraftSessionById(
              pool,
              account_id,
              user_profile_id,
              changed.draft_id,
            )
          ).status,
          "active",
        );
      },
    );
    await t.test(
      "actual service keeps failed transport receipt and never redispatches",
      async () => {
        const savedKey = process.env.MATCHBASE_OPENROUTER_API_KEY,
          savedProvider = process.env.MATCHBASE_PROVIDER_OPENAI;
        process.env.MATCHBASE_OPENROUTER_API_KEY = randomUUID();
        process.env.MATCHBASE_PROVIDER_OPENAI = "openai";
        let calls = 0;
        let successful = false;
        const original = globalThis.fetch;
        globalThis.fetch = async (url, options) => {
          if (String(url).endsWith("/models/user"))
            return Response.json({
              data: [
                {
                  id: "openai/gpt-5.2",
                  supported_parameters: [
                    "structured_outputs",
                    "reasoning",
                    "max_tokens",
                  ],
                },
              ],
            });
          if (String(url).endsWith("/endpoints"))
            return Response.json({
              data: {
                endpoints: [
                  {
                    tag: "openai",
                    provider_name: "OpenAI",
                    supported_parameters: [
                      "structured_outputs",
                      "reasoning",
                      "max_tokens",
                    ],
                  },
                ],
              },
            });
          assert.equal(
            String(url),
            "https://openrouter.ai/api/v1/chat/completions",
          );
          const payload = JSON.parse(options.body);
          assert.equal(payload.plugins, undefined);
          assert.equal(payload.provider.allow_fallbacks, false);
          assert.equal(payload.provider.require_parameters, true);
          calls++;
          if (successful)
            return Response.json({
              id: randomUUID(),
              model: payload.model,
              openrouter_metadata: {
                is_byok: true,
                endpoints: {
                  available: [
                    {
                      selected: true,
                      model: payload.model,
                      provider: "OpenAI",
                    },
                  ],
                },
              },
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: JSON.stringify({
                      assignments: [
                        {
                          unit_id: 0,
                          boxes: ["productRequirement", "orderProfile"],
                        },
                        { unit_id: 1, boxes: ["technicalCompliance"] },
                      ],
                    }),
                  },
                },
              ],
              usage: {
                prompt_tokens: 30,
                completion_tokens: 30,
                cost: 0.01,
                cost_details: { upstream_inference_cost: 0.02 },
              },
            });
          throw new Error("Synthetic transport loss");
        };
        try {
          const failedDraft = await draft();
          const result = await submitNarrativeIntake(pool, failedDraft);
          assert.equal(result.status, "failed");
          assert.equal(calls, 1);
          assert.equal(Object.values(result.receipts)[0].cost_reported, false);
          assert.equal(Object.values(result.receipts)[0].dispatched, true);
          await submitNarrativeIntake(pool, failedDraft);
          assert.equal(calls, 1);
          successful = true;
          const successfulDraft = await draft();
          const completed = await submitNarrativeIntake(pool, successfulDraft);
          assert.equal(completed.status, "completed");
          assert.equal(
            completed.proposal.units.map((unit) => unit.text).join(""),
            source,
          );
          assert.equal(calls, 2);
          await submitNarrativeIntake(pool, successfulDraft);
          assert.equal(calls, 2);
        } finally {
          globalThis.fetch = original;
          if (savedKey === undefined)
            delete process.env.MATCHBASE_OPENROUTER_API_KEY;
          else process.env.MATCHBASE_OPENROUTER_API_KEY = savedKey;
          if (savedProvider === undefined)
            delete process.env.MATCHBASE_PROVIDER_OPENAI;
          else process.env.MATCHBASE_PROVIDER_OPENAI = savedProvider;
        }
      },
    );
    await t.test(
      "new migration rolls back without altering existing source or financial rows",
      async () => {
        const before = await readNarrativeIntake(
          pool,
          account_id,
          user_profile_id,
          input.draft_id,
        );
        const down = await readFile(
          new URL(
            "../../../packages/data/migrations/0029_consultant_narrative_intake.down.sql",
            import.meta.url,
          ),
          "utf8",
        );
        await assert.rejects(
          inTransaction(pool, async (db) => {
            await db.query(down);
            assert.equal(
              (
                await db.query(
                  "SELECT to_regclass('public.consultant_narrative_intake') AS name",
                )
              ).rows[0].name,
              null,
            );
            throw new Error("Rollback schema fixture");
          }),
          /Rollback schema fixture/,
        );
        assert.deepEqual(
          await readNarrativeIntake(
            pool,
            account_id,
            user_profile_id,
            input.draft_id,
          ),
          before,
        );
      },
    );
  },
);
