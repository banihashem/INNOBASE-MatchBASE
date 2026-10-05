import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { researchDiscoveryPhase } from "../../../packages/contracts/dist/src/index.js";
import {
  appendConsultantWorkflowEvent,
  createPool,
  enqueueConsultantWorkflowJob,
  hashResearchAuthority,
  migrateUp,
  getConsultantWorkflowSessionByRunId,
  researchAuthorityHash,
  readConsultantProviderRouteRejectionEvents,
  resumeFailedConsultantResearchExecution,
  saveConsultantWorkflowSession,
} from "../../../packages/data/dist/index.js";
import { applyConsultantIncidentRecovery } from "../../../packages/application/dist/consultant-incident-controller.js";

const database = process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL;
const dbTest = database ? test : test.skip;

for (const rejectedIndexes of [[2], [2, 4]])
  dbTest(
    `MB-UX-QUALITY-002 L08 queues one same-execution quorum resume with ${rejectedIndexes.length} definitive rejected routes without extending authority`,
    async (t) => {
      const db = createPool({ connectionString: database, max: 4 });
      const identity = Object.fromEntries(
        [
          "account_id",
          "user_profile_id",
          "run_id",
          "execution_id",
          "classification_id",
        ].map((key) => [key, randomUUID()]),
      );
      t.after(async () => {
        try {
          for (const table of [
            "consultant_research_stage",
            "consultant_research_attempt",
            "consultant_provider_call",
            "consultant_workflow_event",
            "consultant_research_round",
            "consultant_workflow_job",
            "consultant_workflow_session",
          ])
            await db.query(`DELETE FROM ${table} WHERE account_id=$1`, [
              identity.account_id,
            ]);
          await db.query("DELETE FROM account WHERE account_id=$1", [
            identity.account_id,
          ]);
        } finally {
          await db.end();
        }
      });
      await migrateUp(db);
      await db.query(
        "INSERT INTO account(account_id,display_name,status) VALUES($1,'Quorum resume isolated fixture','active')",
        [identity.account_id],
      );
      await saveConsultantWorkflowSession(db, {
        ...identity,
        session_id: randomUUID(),
        current_state: "workflow_failed",
        last_checkpoint: "workflow_failed",
        original_intake: { product_requirement: "Industrial service" },
        approved_request_revision: {
          english_translation: "Industrial service",
        },
        deep_prompt_revision: {
          is_approved: true,
          prompt_text: "Find suppliers",
        },
        workflow_metadata: {
          mode: "live",
          classification_id: identity.classification_id,
          error: "Provider route rejected",
          retry_action: "research",
          ...(rejectedIndexes.length === 2
            ? { search_dimension_plan: { dimensions: ["product", "identity"] } }
            : {}),
        },
      });
      const models = [
        "google/test",
        "openai/test",
        "anthropic/test",
        "deepseek/test",
        "x-ai/test",
      ];
      const savedSession = await getConsultantWorkflowSessionByRunId(
        db,
        identity.account_id,
        identity.run_id,
      );
      const requestHash =
        rejectedIndexes.length === 2
          ? researchAuthorityHash({
              ...savedSession,
              search_dimension_plan:
                savedSession.workflow_metadata.search_dimension_plan,
            })
          : createHash("sha256")
              .update(
                JSON.stringify([
                  savedSession.approved_request_revision,
                  savedSession.deep_prompt_revision,
                ]),
              )
              .digest("hex");
      const plan = {
        version: "research-round.v1",
        round_number: 1,
        research_tier: "ultra",
        research_models: models,
        request_hash: requestHash,
        extraction_model: "openai/test",
        synthesis_model: "openai/test",
        max_calls: 30,
        execution_recovery: {
          version: "durable.v1",
          max_resumes: 2,
          valid_for_ms: 86400000,
        },
      };
      const roundId = randomUUID();
      await db.query(
        `INSERT INTO consultant_research_round(round_id,account_id,user_profile_id,run_id,classification_id,round_number,plan,status,execution_id,approved_at,completed_at)
       VALUES($1,$2,$3,$4,$5,1,$6,'failed',$7,clock_timestamp(),clock_timestamp())`,
        [
          roundId,
          identity.account_id,
          identity.user_profile_id,
          identity.run_id,
          identity.classification_id,
          JSON.stringify(plan),
          identity.execution_id,
        ],
      );
      const job = await enqueueConsultantWorkflowJob(
        db,
        identity,
        "research",
        "live",
      );
      await db.query(
        `UPDATE consultant_workflow_job SET status='failed',error_code='workflow-execution-failed',completed_at=clock_timestamp()
       WHERE job_id=$1`,
        [job.job_id],
      );
      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      const rejectedRequestIds = new Map();
      for (const [index, model] of models.entries()) {
        const requestId = randomUUID();
        const rejected = rejectedIndexes.includes(index);
        if (rejected) rejectedRequestIds.set(index, requestId);
        await db.query(
          `INSERT INTO consultant_research_attempt(request_id,account_id,user_profile_id,run_id,execution_id,classification_id,
         job_id,lease_token,round_id,operation_key,stage_key,phase,model,input_sha256,approval_sha256,outcome,provider_outcome,receipt)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [
            requestId,
            identity.account_id,
            identity.user_profile_id,
            identity.run_id,
            identity.execution_id,
            identity.classification_id,
            job.job_id,
            randomUUID(),
            roundId,
            `operation-${index}`,
            hashResearchAuthority(`stage-${index}`),
            researchDiscoveryPhase(model),
            model,
            hashResearchAuthority(`input-${index}`),
            hashResearchAuthority(plan),
            rejected ? "failed" : "completed",
            rejected ? "rejected" : "received",
            JSON.stringify({ state: rejected ? "failed" : "completed" }),
          ],
        );
        if (rejected) continue;
        const manifest = {
          version: "research-stage.v1",
          stage_kind: `${researchDiscoveryPhase(model)}:1:provider_response`,
          qualification: "received_unvalidated",
          operation_key: `operation-${index}`,
          input_sha256: hashResearchAuthority(`input-${index}`),
          policy_sha256: hashResearchAuthority("policy"),
          approval_sha256: hashResearchAuthority(plan),
        };
        await db.query(
          `INSERT INTO consultant_research_stage(stage_id,account_id,user_profile_id,run_id,execution_id,classification_id,
         job_id,round_id,manifest_sha256,manifest,result,result_sha256,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            randomUUID(),
            identity.account_id,
            identity.user_profile_id,
            identity.run_id,
            identity.execution_id,
            identity.classification_id,
            job.job_id,
            roundId,
            hashResearchAuthority(manifest),
            JSON.stringify(manifest),
            JSON.stringify({ requested_model: model }),
            hashResearchAuthority({ requested_model: model }),
            expiresAt,
          ],
        );
      }
      const rejectedRequestId = rejectedRequestIds.get(2);
      await appendConsultantWorkflowEvent(db, identity, "discovery_openai", {
        state: "failed",
        request_id: rejectedRequestId,
        requested_model: "anthropic/test",
        dispatched: true,
        provider_dispatch_rejected: true,
        provider_receipt_received: false,
        provider_http_failure: {
          http_status: 404,
          request_format: "text",
          category: "privacy",
        },
      });
      await appendConsultantWorkflowEvent(db, identity, "discovery_anthropic", {
        state: "failed",
        request_id: rejectedRequestId,
        requested_model: "anthropic/test",
        dispatched: true,
        provider_dispatch_rejected: true,
        provider_receipt_received: false,
        provider_http_failure: { http_status: 404, category: "privacy" },
      });
      assert.equal(
        (await readConsultantProviderRouteRejectionEvents(db, identity)).length,
        0,
      );
      await appendConsultantWorkflowEvent(db, identity, "discovery_anthropic", {
        state: "failed",
        request_id: rejectedRequestId,
        requested_model: "anthropic/test",
        dispatched: true,
        provider_dispatch_rejected: true,
        provider_receipt_received: false,
        provider_http_failure: {
          http_status: 404,
          request_format: "text",
          category: "privacy",
        },
      });
      const retainedEvents = await readConsultantProviderRouteRejectionEvents(
        db,
        identity,
      );
      assert.equal(retainedEvents.length, 1);
      assert.equal(retainedEvents[0].detail.request_id, rejectedRequestId);
      if (rejectedIndexes.length === 2) {
        // The actual L08 incident had two definitive HTTP 402 billing rejections.
        for (const index of rejectedIndexes)
          await appendConsultantWorkflowEvent(
            db,
            identity,
            researchDiscoveryPhase(models[index]),
            {
              state: "failed",
              request_id: rejectedRequestIds.get(index),
              requested_model: models[index],
              dispatched: true,
              provider_dispatch_rejected: true,
              provider_receipt_received: false,
              provider_http_failure: {
                http_status: 402,
                request_format: "text",
                category: "billing",
              },
            },
          );
      }

      const legacyManifest = {
        version: "research-stage.v1",
        stage_kind: "discovery_gemini_extraction_index:1:extraction",
        qualification: "validated_extraction",
        operation_key: "legacy-extraction-operation",
        input_sha256: hashResearchAuthority("legacy-extraction-input"),
        policy_sha256: hashResearchAuthority("legacy-extraction-policy"),
        approval_sha256: hashResearchAuthority(plan),
      };
      const legacyStageId = randomUUID();
      await db.query(
        `INSERT INTO consultant_research_stage(stage_id,account_id,user_profile_id,run_id,execution_id,classification_id,
       job_id,round_id,manifest_sha256,manifest,result,result_sha256,expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          legacyStageId,
          identity.account_id,
          identity.user_profile_id,
          identity.run_id,
          identity.execution_id,
          identity.classification_id,
          job.job_id,
          roundId,
          hashResearchAuthority(legacyManifest),
          JSON.stringify(legacyManifest),
          JSON.stringify({ retained: true }),
          hashResearchAuthority({ retained: true }),
          expiresAt,
        ],
      );
      await assert.rejects(
        resumeFailedConsultantResearchExecution(
          db,
          identity.account_id,
          identity.run_id,
          identity.execution_id,
        ),
        { code: "MB-409-EXECUTION-RESUME" },
      );
      await db.query(
        "DELETE FROM consultant_research_stage WHERE stage_id=$1",
        [legacyStageId],
      );

      const dryRun = await resumeFailedConsultantResearchExecution(
        db,
        identity.account_id,
        identity.run_id,
        identity.execution_id,
      );
      const approvedBefore = (
        await db.query(
          "SELECT approved_at FROM consultant_research_round WHERE round_id=$1",
          [roundId],
        )
      ).rows[0].approved_at;
      assert.equal(dryRun.queued, false);
      assert.equal(dryRun.completed_models, 5 - rejectedIndexes.length);
      assert.equal(dryRun.rejected_models, rejectedIndexes.length);
      assert.equal(dryRun.retained_stages, 5 - rejectedIndexes.length);
      assert.equal(
        (
          await db.query(
            "SELECT status FROM consultant_workflow_job WHERE job_id=$1",
            [job.job_id],
          )
        ).rows[0].status,
        "failed",
      );

      for (const field of [
        "approved_request_revision",
        "deep_prompt_revision",
        "workflow_metadata",
      ]) {
        await t.test(
          `changed ${field} cannot reuse ${rejectedIndexes.length === 2 ? "canonical dimensioned" : "legacy"} approval`,
          async () => {
            const previous = savedSession[field];
            const changed =
              field === "workflow_metadata"
                ? {
                    ...previous,
                    search_dimension_plan: { dimensions: ["changed scope"] },
                  }
                : { ...previous, changed: true };
            await db.query(
              `UPDATE consultant_workflow_session SET ${field}=$2 WHERE run_id=$1`,
              [identity.run_id, JSON.stringify(changed)],
            );
            try {
              await assert.rejects(
                resumeFailedConsultantResearchExecution(
                  db,
                  identity.account_id,
                  identity.run_id,
                  identity.execution_id,
                  true,
                ),
                { code: "MB-409-EXECUTION-RESUME" },
              );
            } finally {
              await db.query(
                `UPDATE consultant_workflow_session SET ${field}=$2 WHERE run_id=$1`,
                [identity.run_id, JSON.stringify(previous)],
              );
            }
          },
        );
      }

      if (rejectedIndexes.length === 2) {
        const resume = (
          account = identity.account_id,
          execution = identity.execution_id,
        ) =>
          resumeFailedConsultantResearchExecution(
            db,
            account,
            identity.run_id,
            execution,
            true,
          );
        await t.test(
          "foreign account and stale execution cannot resume",
          async () => {
            await assert.rejects(resume(randomUUID()), {
              code: "MB-409-EXECUTION-RESUME",
            });
            await assert.rejects(resume(identity.account_id, randomUUID()), {
              code: "MB-409-EXECUTION-RESUME",
            });
          },
        );
        const stage = (
          await db.query(
            "SELECT * FROM consultant_research_stage WHERE account_id=$1 ORDER BY stage_id LIMIT 1",
            [identity.account_id],
          )
        ).rows[0];
        for (const [label, changes] of [
          ["foreign stage profile", { user_profile_id: randomUUID() }],
          ["foreign stage classification", { classification_id: randomUUID() }],
          ["corrupt retained result", { result: {} }],
          ["expired retained stage", { expires_at: "2000-01-01T00:00:00Z" }],
          ["mismatched manifest", { manifest_sha256: "0".repeat(64) }],
        ]) {
          await t.test(label, async () => {
            const replace = async (row) => {
              await db.query(
                "DELETE FROM consultant_research_stage WHERE stage_id=$1",
                [stage.stage_id],
              );
              await db.query(
                "INSERT INTO consultant_research_stage SELECT * FROM jsonb_populate_record(NULL::consultant_research_stage,$1::jsonb)",
                [JSON.stringify(row)],
              );
            };
            await replace({ ...stage, ...changes });
            try {
              await assert.rejects(resume(), {
                code: "MB-409-EXECUTION-RESUME",
              });
            } finally {
              await replace(stage);
            }
          });
        }
        const guardedChanges = [
          [
            "unknown dispatch",
            "UPDATE consultant_research_attempt SET provider_outcome='unknown' WHERE request_id=$1",
            [rejectedRequestId],
            "UPDATE consultant_research_attempt SET provider_outcome='rejected' WHERE request_id=$1",
            [rejectedRequestId],
          ],
          [
            "foreign attempt classification",
            "UPDATE consultant_research_attempt SET classification_id=$2 WHERE request_id=$1",
            [rejectedRequestId, randomUUID()],
            "UPDATE consultant_research_attempt SET classification_id=$2 WHERE request_id=$1",
            [rejectedRequestId, identity.classification_id],
          ],
          [
            "expired original approval",
            "UPDATE consultant_research_round SET approved_at='2000-01-01' WHERE round_id=$1",
            [roundId],
            "UPDATE consultant_research_round SET approved_at=$2 WHERE round_id=$1",
            [roundId, approvedBefore],
          ],
          [
            "cancelled execution",
            "UPDATE consultant_workflow_session SET last_checkpoint='user_cancelled' WHERE run_id=$1",
            [identity.run_id],
            "UPDATE consultant_workflow_session SET last_checkpoint='workflow_failed' WHERE run_id=$1",
            [identity.run_id],
          ],
          [
            "exhausted resume allowance",
            "UPDATE consultant_workflow_job SET resume_count=2 WHERE job_id=$1",
            [job.job_id],
            "UPDATE consultant_workflow_job SET resume_count=0 WHERE job_id=$1",
            [job.job_id],
          ],
        ];
        for (const [
          label,
          change,
          values,
          restore,
          previous,
        ] of guardedChanges) {
          await t.test(label, async () => {
            await db.query(change, values);
            try {
              await assert.rejects(resume(), {
                code: "MB-409-EXECUTION-RESUME",
              });
            } finally {
              await db.query(restore, previous);
            }
          });
        }
        await t.test(
          "two of five retained models cannot form a quorum",
          async () => {
            await db.query(
              "DELETE FROM consultant_research_stage WHERE stage_id=$1",
              [stage.stage_id],
            );
            try {
              await assert.rejects(resume(), {
                code: "MB-409-EXECUTION-RESUME",
              });
            } finally {
              await db.query(
                "INSERT INTO consultant_research_stage SELECT * FROM jsonb_populate_record(NULL::consultant_research_stage,$1::jsonb)",
                [JSON.stringify(stage)],
              );
            }
          },
        );
        await t.test(
          "all consumed attempts retain the original call ceiling",
          async () => {
            const extra = [];
            try {
              for (let index = 5; index < plan.max_calls; index++) {
                const requestId = randomUUID();
                extra.push(requestId);
                await db.query(
                  `INSERT INTO consultant_research_attempt
              SELECT (jsonb_populate_record(NULL::consultant_research_attempt,
                to_jsonb(a) || jsonb_build_object('request_id',$2::text,'operation_key',$2::text))).*
              FROM consultant_research_attempt a WHERE request_id=$1`,
                  [rejectedRequestId, requestId],
                );
              }
              await assert.rejects(resume(), {
                code: "MB-409-EXECUTION-RESUME",
              });
            } finally {
              await db.query(
                "DELETE FROM consultant_research_attempt WHERE request_id=ANY($1::uuid[])",
                [extra],
              );
            }
          },
        );
      }

      const executed =
        rejectedIndexes.length === 2
          ? {
              queued:
                (await applyConsultantIncidentRecovery(db, job, "research", {
                  code: "MB-502-LIVE-PROVIDER",
                  disposition: "blocked_by_authority",
                })) === "resumed_saved_stages",
            }
          : await resumeFailedConsultantResearchExecution(
              db,
              identity.account_id,
              identity.run_id,
              identity.execution_id,
              true,
            );
      assert.equal(executed.queued, true);
      const state = await db.query(
        `SELECT j.status,j.resume_count,r.status AS round_status,s.current_state,s.workflow_metadata
       FROM consultant_workflow_job j JOIN consultant_research_round r ON r.execution_id=j.execution_id
       JOIN consultant_workflow_session s ON s.account_id=j.account_id AND s.run_id=j.run_id
       WHERE j.job_id=$1`,
        [job.job_id],
      );
      assert.equal(state.rows[0].status, "queued");
      assert.equal(state.rows[0].resume_count, 1);
      assert.equal(state.rows[0].round_status, "approved");
      assert.equal(state.rows[0].current_state, "research_dispatching");
      const retainedApproval = (
        await db.query(
          "SELECT approved_at,plan FROM consultant_research_round WHERE round_id=$1",
          [roundId],
        )
      ).rows[0];
      assert.equal(
        retainedApproval.approved_at.getTime(),
        approvedBefore.getTime(),
      );
      assert.deepEqual(
        retainedApproval.plan,
        plan,
        "recovery cannot change any quoted model, route or allowance",
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM consultant_research_attempt WHERE account_id=$1",
            [identity.account_id],
          )
        ).rows[0].count,
        5,
        "requeue adds no attempt or charge",
      );
      assert.equal(
        state.rows[0].workflow_metadata.recovery_state,
        "resuming_saved_stages",
      );
      await assert.rejects(
        resumeFailedConsultantResearchExecution(
          db,
          identity.account_id,
          identity.run_id,
          identity.execution_id,
          true,
        ),
        { code: "MB-409-EXECUTION-RESUME" },
      );
    },
  );
