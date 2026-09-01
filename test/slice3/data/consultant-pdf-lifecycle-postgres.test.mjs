import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  executeNextConsultantPdfRenderJob,
  DatabaseConsultantReportModelBuilder,
  requestConsultantPdfArtifact,
  preserveTerminalResultOnArtifactFailure,
  renderConsultantResultPdfFixture,
} from "../../../packages/application/dist/index.js";
import {
  createPool,
  ensureSessionArtifactGrantForRun,
  migrateUp,
} from "../../../packages/data/dist/index.js";

const databaseUrl = process.env.DATABASE_URL;
const postgresTest = databaseUrl ? test : test.skip;
const digest = (value) => createHash("sha256").update(value).digest();
const qaKeys = [
  "band_label_equals_render_band",
  "wave_separated_from_band",
  "overflow_collision",
  "citation_completeness",
  "prohibited_phrase_scan",
  "weight_fidelity",
  "required_sections_present",
  "template_content_leakage",
  "truncation_disclosure",
  "contradiction_declaration",
  "tagged_structure",
  "doc_title_flag",
  "veraPDF",
  "contrast_ratio",
  "page_geometry_both",
  "hash_and_lineage",
];

const renderer = {
  templateVersion: "a".repeat(64),
  renderer: "explicit-test-double",
  rendererVersion: "1",
  pageGeometry: "a4",
  async render({ runId, result }) {
    return {
      bytes: renderConsultantResultPdfFixture({ runId, result }),
      pageCount: 1,
    };
  },
};
const passingQa = {
  async evaluate() {
    return qaKeys.map((checkKey) => ({
      checkKey,
      outcome: "pass",
      detail: { explicit_test_double: true },
      tool: "explicit-test-double",
      toolVersion: "1",
    }));
  },
};
const makePipeline = (qaEvaluator = passingQa, render = renderer.render) => ({
  templateVersion: renderer.templateVersion,
  renderer: renderer.renderer,
  rendererVersion: renderer.rendererVersion,
  pageGeometry: renderer.pageGeometry,
  async run({ runId, result, resultSha256 }) {
    const rendered = await render({ runId, result });
    const checks = await qaEvaluator.evaluate({
      bytes: rendered.bytes,
      runId,
      result,
      resultSha256,
    });
    return {
      ...rendered,
      checks,
      releasable:
        checks.length === 16 && checks.every((x) => x.outcome === "pass"),
      qualification: {
        schemaVersion: "consultant-pdf-qualification.v1",
        templateSha256: renderer.templateVersion,
        fontSha256: "b".repeat(64),
        toolchainSha256: "c".repeat(64),
        attestationSha256: "d".repeat(64),
        resultSha256,
        reportModelSha256: "e".repeat(64),
        geometries: [
          {
            geometry: "a4",
            sha256: createHash("sha256").update(rendered.bytes).digest("hex"),
            byteSize: rendered.bytes.byteLength,
            pageCount: rendered.pageCount,
            pageSizePoints: [595.276, 841.89],
            tagged: true,
            title: "Explicit test double",
            veraUa1Compliant: true,
            blankContentPages: [],
          },
          {
            geometry: "letter",
            sha256: "f".repeat(64),
            byteSize: 1,
            pageCount: rendered.pageCount,
            pageSizePoints: [612, 792],
            tagged: true,
            title: "Explicit test double",
            veraUa1Compliant: true,
            blankContentPages: [],
          },
        ],
      },
    };
  },
});
const passingPipeline = makePipeline();

test("migration 0012 preserves historical released artifacts and scopes qualification to new rows", async () => {
  const sql = await readFile(
    new URL(
      "../../../packages/data/migrations/0012_consultant_pdf_render_ledger.up.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(sql, /qualification_contract_version IS NULL OR/u);
  assert.match(sql, /consultant-pdf-qualification\.v1/u);
  const lifecycle = await readFile(
    new URL(
      "../../../packages/application/src/consultant-pdf-lifecycle.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    lifecycle,
    /qualification_contract_version\) VALUES\([^\n]+,'consultant-pdf-qualification\.v1'\)/u,
  );
});

postgresTest(
  "Consultant PDF lifecycle closes terminal lineage, idempotency, failures and tenancy",
  async () => {
    const databaseName = `matchbase_pdf_lifecycle_${randomUUID().replaceAll("-", "")}`;
    const control = createPool({ connectionString: databaseUrl, max: 1 });
    let isolated;
    try {
      await control.query(`CREATE DATABASE ${databaseName}`);
      const url = new URL(databaseUrl);
      url.pathname = `/${databaseName}`;
      isolated = createPool({ connectionString: url.toString(), max: 3 });
      await migrateUp(isolated);
      const ids = {
        account: randomUUID(),
        user: randomUUID(),
        grantor: randomUUID(),
        account2: randomUUID(),
        user2: randomUUID(),
        grantor2: randomUUID(),
        model: randomUUID(),
        scoring: randomUUID(),
        projection: randomUUID(),
      };
      await isolated.query(
        "INSERT INTO account(account_id,display_name,status) VALUES($1,'PDF tenant','active'),($2,'Other tenant','active')",
        [ids.account, ids.account2],
      );
      for (const [account, user, grantor, label] of [
        [ids.account, ids.user, ids.grantor, "one"],
        [ids.account2, ids.user2, ids.grantor2, "two"],
      ]) {
        await isolated.query(
          "INSERT INTO app_user(user_id,account_id,google_sub,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active')",
          [user, account, `owner-${label}`, grantor, `grantor-${label}`],
        );
        await isolated.query(
          "INSERT INTO entitlement_grant(grant_id,account_id,user_id,tier,grant_actor_kind,granted_by_user_id,justification,effective_from) VALUES($1,$2,$3,'consultant','user',$4,'fixture',clock_timestamp()-interval '1 hour')",
          [randomUUID(), account, user, grantor],
        );
      }
      const version = Math.floor(Math.random() * 1_000_000_000) + 1;
      await isolated.query(
        "INSERT INTO model_policy_version(model_policy_version_id,version,capability_map,content_sha256,released_at) VALUES($1,$2,'{}',$3,clock_timestamp())",
        [ids.model, version, digest("model")],
      );
      await isolated.query(
        "INSERT INTO scoring_config_version(scoring_config_version_id,version,weights_bp,gate_definitions,content_sha256,released_at,product_owner_approval_ref,sme_approval_ref,evaluation_run_ref) VALUES($1,$2,'{}','{}',$3,clock_timestamp(),'po','sme','eval')",
        [ids.scoring, version, digest("score")],
      );
      await isolated.query(
        "INSERT INTO projection_version(projection_version_id,version,definition,content_sha256,released_at) VALUES($1,$2,'{}',$3,clock_timestamp())",
        [ids.projection, version, digest("projection")],
      );

      async function terminalRun(state) {
        const request = randomUUID(),
          canonicalization = randomUUID(),
          canonical = randomUUID(),
          run = randomUUID();
        await isolated.query(
          "INSERT INTO canonicalization_execution_run(canonicalization_run_id,account_id,user_id,subject_request_id,request_correlation_id,started_at) VALUES($1,$2,$3,$4,$5,clock_timestamp())",
          [canonicalization, ids.account, ids.user, request, randomUUID()],
        );
        await isolated.query(
          "INSERT INTO sourcing_request(request_id,account_id,created_by_user_id,canonicalization_run_id,lifecycle_state) VALUES($1,$2,$3,$4,'confirmed')",
          [request, ids.account, ids.user, canonicalization],
        );
        await isolated.query(
          "INSERT INTO canonical_request_version(canonical_request_version_id,request_id,account_id,version,canonical_document,match_readiness,created_by_user_id) VALUES($1,$2,$3,1,'{}','ready',$4)",
          [canonical, request, ids.account, ids.user],
        );
        await isolated.query(
          "INSERT INTO canonical_confirmation(confirmation_id,canonical_request_version_id,account_id,actor_user_id,accepted,confirmed_at) VALUES($1,$2,$3,$4,true,clock_timestamp())",
          [randomUUID(), canonical, ids.account, ids.user],
        );
        await isolated.query(
          "INSERT INTO research_run(run_id,account_id,canonical_request_version_id,requested_by_user_id,tier_at_submission,state,model_policy_version_id,scoring_config_version_id,idempotency_key_hash,queued_at,started_at,completed_at) VALUES($1,$2,$3,$4,'consultant',$5,$6,$7,$8,clock_timestamp(),clock_timestamp(),clock_timestamp())",
          [
            run,
            ids.account,
            canonical,
            ids.user,
            state,
            ids.model,
            ids.scoring,
            digest(run),
          ],
        );
        const resultHash = digest(`result-${run}`);
        await isolated.query(
          "INSERT INTO run_result(run_id,account_id,outcome,eligible_count,considered_count,limitations_text,complete_result_document,result_sha256,assembled_at) VALUES($1,$2,$3,$4,$4,'fixture',$5::jsonb,$6,clock_timestamp())",
          [
            run,
            ids.account,
            state === "complete" ? "candidates" : "no_responsible_match",
            state === "complete" ? 2 : 0,
            JSON.stringify({
              schema_version: "complete-result-foundation.v2",
              landscape: {
                eligible_count: state === "complete" ? 2 : 0,
                displayed_count: state === "complete" ? 2 : 0,
              },
            }),
            resultHash,
          ],
        );
        await isolated.query(
          "INSERT INTO evidence_item(evidence_item_id,run_id,account_id,source_kind,local_fixture_id,title,publisher_domain,retrieved_at,content_sha256,verification_disposition) VALUES($1,$2,$3,'local_fixture','consultant-pdf-test','Retained test evidence','fixture.invalid',clock_timestamp(),$4,'synthetic')",
          [randomUUID(), run, ids.account, digest(`evidence-${run}`)],
        );
        await isolated.query(
          "INSERT INTO projection_serving(projection_serving_id,account_id,subject_user_id,tier,resource_kind,resource_id,projection_version_id,fields_released,item_count,request_correlation_id,run_id) VALUES($1,$2,$3,'consultant','research_run',$4,$5,'{}',0,'pdf-fixture',$4)",
          [randomUUID(), ids.account, ids.user, run, ids.projection],
        );
        return { run, resultHash };
      }
      const objects = new Map();
      let writes = 0;
      const writer = {
        async putImmutable(name, bytes) {
          writes++;
          if (objects.has(name)) throw new Error("exists");
          objects.set(name, Uint8Array.from(bytes));
          return `gs://test/${name}`;
        },
      };
      for (const state of ["complete", "no_responsible_match"]) {
        const item = await terminalRun(state);
        const built = await new DatabaseConsultantReportModelBuilder(
          isolated,
        ).build({
          accountId: ids.account,
          generatedByUserId: ids.user,
          runId: item.run,
          result: {
            schema_version: "complete-result-foundation.v2",
            landscape: {
              eligible_count: state === "complete" ? 2 : 0,
              displayed_count: state === "complete" ? 2 : 0,
            },
          },
          resultSha256: item.resultHash.toString("hex"),
          canonicalRequestVersionId: (
            await isolated.query(
              "SELECT canonical_request_version_id FROM research_run WHERE run_id=$1",
              [item.run],
            )
          ).rows[0].canonical_request_version_id,
          projectionVersionId: ids.projection,
          scoringConfigVersionId: ids.scoring,
          modelPolicyVersionId: ids.model,
          analystDecisionSetId: "server-owned-live-research",
          templateVersion: renderer.templateVersion,
          pageGeometry: "a4",
        });
        assert.equal(
          built.reportModel.schema_version,
          "consultant-report-model.v1",
        );
        const input = {
          accountId: ids.account,
          runId: item.run,
          userId: ids.user,
          actorTier: "consultant",
          correlationId: randomUUID(),
          deploymentId: "postgres-test",
          pipeline: passingPipeline,
          idempotencyKey: `pdf-${item.run}`,
        };
        const first = await requestConsultantPdfArtifact(isolated, input);
        const second = await requestConsultantPdfArtifact(isolated, input);
        assert.deepEqual(second, first);
        assert.equal(first.state, "queued");
        const completed = await executeNextConsultantPdfRenderJob(isolated, {
          writer,
          pipeline: passingPipeline,
          deploymentId: "postgres-test",
        });
        assert.equal(completed.artifact_version_id, first.artifact_version_id);
        const row = (
          await isolated.query(
            "SELECT state,result_sha256,projection_version_id,scoring_config_version_id,model_policy_version_id,file_sha256,qualification_evidence,qualification_sha256 FROM artifact_version WHERE artifact_version_id=$1",
            [first.artifact_version_id],
          )
        ).rows[0];
        assert.equal(row.state, "released");
        assert.deepEqual(row.result_sha256, item.resultHash);
        assert.equal(row.projection_version_id, ids.projection);
        assert.equal(row.scoring_config_version_id, ids.scoring);
        assert.equal(row.model_policy_version_id, ids.model);
        assert.equal(row.file_sha256.length, 32);
        assert.equal(
          row.qualification_evidence.resultSha256,
          item.resultHash.toString("hex"),
        );
        assert.equal(row.qualification_evidence.geometries.length, 2);
        assert.equal(row.qualification_sha256.length, 32);
        const qaLineage = await isolated.query(
          "SELECT count(*)::int AS count FROM artifact_qa_check WHERE artifact_version_id=$1 AND detail->>'qualificationSha256'=encode($2::bytea,'hex')",
          [first.artifact_version_id, row.qualification_sha256],
        );
        assert.equal(qaLineage.rows[0].count, 16);
        const grant = await ensureSessionArtifactGrantForRun(isolated, {
          runId: item.run,
          accountId: ids.account,
          subjectUserId: ids.user,
          subjectTier: "consultant",
        });
        assert.equal(grant.artifactVersionId, first.artifact_version_id);
        assert.equal(
          await ensureSessionArtifactGrantForRun(isolated, {
            runId: item.run,
            accountId: ids.account2,
            subjectUserId: ids.user2,
            subjectTier: "consultant",
          }),
          null,
        );
      }
      assert.equal(writes, 2);
      const qaItem = await terminalRun("complete");
      await assert.rejects(
        requestConsultantPdfArtifact(isolated, {
          accountId: ids.account,
          runId: qaItem.run,
          userId: ids.user,
          actorTier: "consultant",
          correlationId: randomUUID(),
          deploymentId: "postgres-test",
          pipeline: passingPipeline,
          idempotencyKey: `pdf-${qaItem.run}`,
        }).then(() =>
          executeNextConsultantPdfRenderJob(isolated, {
            writer,
            pipeline: makePipeline({
              async evaluate() {
                return qaKeys.map((checkKey) => ({
                  checkKey,
                  outcome: checkKey === "veraPDF" ? "fail" : "pass",
                  detail: { explicit_test_double: true },
                  tool: "test",
                  toolVersion: "1",
                }));
              },
            }),
            deploymentId: "postgres-test",
          }),
        ),
        /blocking QA/u,
      );
      assert.equal(
        (
          await isolated.query(
            "SELECT state FROM artifact_version v JOIN artifact a USING(artifact_id) WHERE a.run_id=$1",
            [qaItem.run],
          )
        ).rows[0].state,
        "qa_failed",
      );
      assert.equal(writes, 2, "QA failure must not create an object");
      const renderItem = await terminalRun("complete");
      await assert.rejects(
        requestConsultantPdfArtifact(isolated, {
          accountId: ids.account,
          runId: renderItem.run,
          userId: ids.user,
          actorTier: "consultant",
          correlationId: randomUUID(),
          deploymentId: "postgres-test",
          pipeline: passingPipeline,
          idempotencyKey: `pdf-${renderItem.run}`,
        }).then(() =>
          executeNextConsultantPdfRenderJob(isolated, {
            writer,
            pipeline: makePipeline(passingQa, async () => {
              throw new Error("renderer unavailable");
            }),
            deploymentId: "postgres-test",
          }),
        ),
        /renderer failed/u,
      );
      assert.equal(
        (
          await isolated.query(
            "SELECT state FROM artifact_version v JOIN artifact a USING(artifact_id) WHERE a.run_id=$1",
            [renderItem.run],
          )
        ).rows[0].state,
        "render_failed",
      );
      assert.equal(writes, 2, "render failure must not create an object");
      const writeItem = await terminalRun("no_responsible_match");
      await assert.rejects(
        requestConsultantPdfArtifact(isolated, {
          accountId: ids.account,
          runId: writeItem.run,
          userId: ids.user,
          actorTier: "consultant",
          correlationId: randomUUID(),
          deploymentId: "postgres-test",
          pipeline: passingPipeline,
          idempotencyKey: `pdf-${writeItem.run}`,
        }).then(() =>
          executeNextConsultantPdfRenderJob(isolated, {
            pipeline: passingPipeline,
            writer: {
              async putImmutable() {
                throw new Error("create-only collision");
              },
            },
            deploymentId: "postgres-test",
          }),
        ),
        /create-only collision/u,
      );
      assert.equal(
        (
          await isolated.query(
            "SELECT state FROM artifact_version v JOIN artifact a USING(artifact_id) WHERE a.run_id=$1",
            [writeItem.run],
          )
        ).rows[0].state,
        "render_failed",
      );
      const terminal = Object.freeze({
        runId: writeItem.run,
        disposition: "ok",
      });
      assert.equal(
        await preserveTerminalResultOnArtifactFailure(terminal, async () => {
          throw new Error("artifact failed");
        }),
        terminal,
      );
    } finally {
      await isolated?.end();
      await control
        .query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",
          [databaseName],
        )
        .catch(() => undefined);
      await control
        .query(`DROP DATABASE IF EXISTS ${databaseName}`)
        .catch(() => undefined);
      await control.end();
    }
  },
);
