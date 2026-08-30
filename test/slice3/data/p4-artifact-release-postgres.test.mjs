import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { ArtifactDownloadApplication } from "../../../packages/application/dist/index.js";
import { handleArtifactDownloadRoute } from "../../../apps/web/src/artifact-download-route-core.ts";
import {
  createPool,
  issueArtifactAccessGrant,
  migrateUp,
  retrieveArtifactWithGrant,
  revokeArtifactAccessGrant,
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

class MutableObjectReader {
  value;

  constructor(value) {
    this.value = value;
  }

  async read() {
    return this.value === null ? null : Uint8Array.from(this.value);
  }
}

postgresTest(
  "P4 artifact release rejects direct release, freezes terminal lineage, and audits grant retrieval",
  async () => {
    const databaseName = `matchbase_p4_artifact_${randomUUID().replaceAll("-", "")}`;
    const control = createPool({ connectionString: databaseUrl, max: 1 });
    let isolated;
    try {
      await control.query(`CREATE DATABASE ${databaseName}`);
      const url = new URL(databaseUrl);
      url.pathname = `/${databaseName}`;
      isolated = createPool({ connectionString: url.toString(), max: 2 });
      await migrateUp(isolated);

      const ids = {
        account: randomUUID(),
        owner: randomUUID(),
        grantor: randomUUID(),
        request: randomUUID(),
        canonicalization: randomUUID(),
        canonical: randomUUID(),
        model: randomUUID(),
        scoring: randomUUID(),
        projection: randomUUID(),
        confirmation: randomUUID(),
        run: randomUUID(),
        artifact: randomUUID(),
        version: randomUUID(),
        account2: randomUUID(),
        owner2: randomUUID(),
        grantor2: randomUUID(),
      };
      const versionNumber = Math.floor(Math.random() * 1_000_000_000) + 1;
      await isolated.query(
        "INSERT INTO account(account_id,display_name,status) VALUES($1,'P4 artifact','active')",
        [ids.account],
      );
      await isolated.query(
        "INSERT INTO account(account_id,display_name,status) VALUES($1,'P4 artifact tenant 2','active')",
        [ids.account2],
      );
      await isolated.query(
        `INSERT INTO app_user(user_id,account_id,google_sub,status)
         VALUES($1,$3,$2,'active'),($4,$3,$5,'active')`,
        [
          ids.owner,
          `owner-${ids.owner}`,
          ids.account,
          ids.grantor,
          `grantor-${ids.grantor}`,
        ],
      );
      await isolated.query(
        `INSERT INTO entitlement_grant
          (grant_id,account_id,user_id,tier,grant_actor_kind,granted_by_user_id,
           justification,effective_from)
         VALUES($1,$2,$3,'consultant','user',$4,'P4 fixture',clock_timestamp()-interval '1 hour')`,
        [randomUUID(), ids.account, ids.owner, ids.grantor],
      );
      await isolated.query(
        `INSERT INTO app_user(user_id,account_id,google_sub,status)
         VALUES($1,$3,$2,'active'),($4,$3,$5,'active')`,
        [
          ids.owner2,
          `owner-${ids.owner2}`,
          ids.account2,
          ids.grantor2,
          `grantor-${ids.grantor2}`,
        ],
      );
      await isolated.query(
        `INSERT INTO entitlement_grant
          (grant_id,account_id,user_id,tier,grant_actor_kind,granted_by_user_id,
           justification,effective_from)
         VALUES($1,$2,$3,'consultant','user',$4,'P4 tenant fixture',clock_timestamp()-interval '1 hour')`,
        [randomUUID(), ids.account2, ids.owner2, ids.grantor2],
      );
      await isolated.query(
        `INSERT INTO model_policy_version
          (model_policy_version_id,version,capability_map,content_sha256,released_at)
         VALUES($1,$2,'{}',$3,clock_timestamp())`,
        [ids.model, versionNumber, digest("model")],
      );
      await isolated.query(
        `INSERT INTO scoring_config_version
          (scoring_config_version_id,version,weights_bp,gate_definitions,content_sha256,
           released_at,product_owner_approval_ref,sme_approval_ref,evaluation_run_ref)
         VALUES($1,$2,'{}','{}',$3,clock_timestamp(),'po','sme','eval')`,
        [ids.scoring, versionNumber, digest("scoring")],
      );
      await isolated.query(
        `INSERT INTO projection_version
          (projection_version_id,version,definition,content_sha256,released_at)
         VALUES($1,$2,'{}',$3,clock_timestamp())`,
        [ids.projection, versionNumber, digest("projection")],
      );
      await isolated.query(
        `INSERT INTO canonicalization_execution_run
          (canonicalization_run_id,account_id,user_id,subject_request_id,
           request_correlation_id,started_at)
         VALUES($1,$2,$3,$4,$5,clock_timestamp())`,
        [
          ids.canonicalization,
          ids.account,
          ids.owner,
          ids.request,
          randomUUID(),
        ],
      );
      await isolated.query(
        `INSERT INTO sourcing_request
          (request_id,account_id,created_by_user_id,canonicalization_run_id,lifecycle_state)
         VALUES($1,$2,$3,$4,'confirmed')`,
        [ids.request, ids.account, ids.owner, ids.canonicalization],
      );
      await isolated.query(
        `INSERT INTO canonical_request_version
          (canonical_request_version_id,request_id,account_id,version,
           canonical_document,match_readiness,created_by_user_id)
         VALUES($1,$2,$3,1,'{"product":"synthetic"}','ready',$4)`,
        [ids.canonical, ids.request, ids.account, ids.owner],
      );
      await isolated.query(
        `INSERT INTO canonical_confirmation
          (confirmation_id,canonical_request_version_id,account_id,actor_user_id,
           accepted,confirmed_at)
         VALUES($1,$2,$3,$4,true,clock_timestamp())`,
        [ids.confirmation, ids.canonical, ids.account, ids.owner],
      );
      await isolated.query(
        `INSERT INTO research_run
          (run_id,account_id,canonical_request_version_id,requested_by_user_id,
           tier_at_submission,state,model_policy_version_id,scoring_config_version_id,
           idempotency_key_hash,queued_at,started_at,completed_at)
         VALUES($1,$2,$3,$4,'consultant','no_responsible_match',$5,$6,$7,
                clock_timestamp(),clock_timestamp(),clock_timestamp())`,
        [
          ids.run,
          ids.account,
          ids.canonical,
          ids.owner,
          ids.model,
          ids.scoring,
          digest("idempotency"),
        ],
      );
      await isolated.query(
        `INSERT INTO run_result
          (run_id,account_id,outcome,eligible_count,considered_count,scarcity,
           limitations_text,complete_result_document,result_sha256,assembled_at)
         VALUES($1,$2,'no_responsible_match',0,3,'{"kind":"zero_eligible"}',
                'Synthetic limitation','{"schema_version":"complete-result-foundation.v2"}',
                $3,clock_timestamp())`,
        [ids.run, ids.account, digest("result")],
      );
      await isolated.query(
        `INSERT INTO artifact(artifact_id,account_id,run_id,artifact_kind)
         VALUES($1,$2,$3,'consultant_pdf')`,
        [ids.artifact, ids.account, ids.run],
      );

      const insertVersion = `INSERT INTO artifact_version
        (artifact_version_id,artifact_id,account_id,version,state,result_version,
         result_sha256,canonical_request_version_id,projection_version_id,
         analyst_decision_set_id,scoring_config_version_id,model_policy_version_id,
         template_version,renderer,renderer_version,page_geometry,
         storage_uri,file_sha256,byte_size,page_count,rendered_at,released_at,
         generated_by_subject_id)
       VALUES($1,$2,$3,1,$4,'complete-result-foundation.v2:1',$5,$6,$7,
              'analyst-decisions-1',$8,$9,'template.v1','isolated-local','1.0.0','a4',
              $10,$11,$12,$13,$14,$15,$16)`;
      await assert.rejects(
        isolated.query(insertVersion, [
          ids.version,
          ids.artifact,
          ids.account,
          "released",
          digest("result"),
          ids.canonical,
          ids.projection,
          ids.scoring,
          ids.model,
          "local://artifact/1",
          digest("artifact-bytes"),
          14,
          1,
          new Date(),
          new Date(),
          ids.owner,
        ]),
        /all sixteen blocking QA checks/u,
      );
      await isolated.query(insertVersion, [
        ids.version,
        ids.artifact,
        ids.account,
        "rendering",
        digest("result"),
        ids.canonical,
        ids.projection,
        ids.scoring,
        ids.model,
        null,
        null,
        null,
        null,
        null,
        null,
        ids.owner,
      ]);
      await assert.rejects(
        isolated.query(
          "UPDATE artifact_version SET result_version='forged' WHERE artifact_version_id=$1",
          [ids.version],
        ),
        /Artifact lineage is immutable/u,
      );
      await assert.rejects(
        isolated.query(
          `INSERT INTO artifact_qa_check
            (qa_check_id,artifact_version_id,account_id,check_key,outcome)
           VALUES($1,$2,$3,'weight_fidelity','pass')`,
          [randomUUID(), ids.version, ids.account2],
        ),
        (error) => error.code === "23503",
      );
      await assert.rejects(
        isolated.query(
          `UPDATE artifact_version SET state='released',storage_uri='local://artifact/1',
             file_sha256=$2,byte_size=14,page_count=1,rendered_at=clock_timestamp(),
             released_at=clock_timestamp() WHERE artifact_version_id=$1`,
          [ids.version, digest("artifact-bytes")],
        ),
        /all sixteen blocking QA checks/u,
      );
      for (const checkKey of qaKeys)
        await isolated.query(
          `INSERT INTO artifact_qa_check
            (qa_check_id,artifact_version_id,account_id,check_key,outcome)
           VALUES($1,$2,$3,$4,'pass')`,
          [randomUUID(), ids.version, ids.account, checkKey],
        );
      const releasedBytes = Buffer.from("artifact-bytes");
      await isolated.query(
        `UPDATE artifact_version SET state='released',storage_uri='local://artifact/1',
           file_sha256=$2,byte_size=$3,page_count=1,rendered_at=clock_timestamp(),
           released_at=clock_timestamp() WHERE artifact_version_id=$1`,
        [ids.version, digest(releasedBytes), releasedBytes.byteLength],
      );
      await assert.rejects(
        isolated.query(
          "UPDATE artifact_version SET file_sha256=$2 WHERE artifact_version_id=$1",
          [ids.version, digest("forged")],
        ),
        /Terminal artifact versions are immutable/u,
      );

      for (const [version, blockingOutcome] of [
        [2, "warn"],
        [3, "fail"],
      ]) {
        const blockedVersionId = randomUUID();
        await isolated.query(
          `INSERT INTO artifact_version
            (artifact_version_id,artifact_id,account_id,version,state,result_version,
             result_sha256,canonical_request_version_id,projection_version_id,
             analyst_decision_set_id,scoring_config_version_id,model_policy_version_id,
             template_version,renderer,renderer_version,page_geometry,generated_by_subject_id)
           SELECT $1,artifact_id,account_id,$2,'rendering',result_version,result_sha256,
                  canonical_request_version_id,projection_version_id,analyst_decision_set_id,
                  scoring_config_version_id,model_policy_version_id,template_version,
                  renderer,renderer_version,page_geometry,generated_by_subject_id
             FROM artifact_version WHERE artifact_version_id=$3`,
          [blockedVersionId, version, ids.version],
        );
        for (const checkKey of qaKeys)
          await isolated.query(
            `INSERT INTO artifact_qa_check
              (qa_check_id,artifact_version_id,account_id,check_key,outcome)
             VALUES($1,$2,$3,$4,$5)`,
            [
              randomUUID(),
              blockedVersionId,
              ids.account,
              checkKey,
              checkKey === "contrast_ratio" ? blockingOutcome : "pass",
            ],
          );
        await assert.rejects(
          isolated.query(
            `UPDATE artifact_version SET state='released',storage_uri=$2,
               file_sha256=$3,byte_size=$4,page_count=1,rendered_at=clock_timestamp(),
               released_at=clock_timestamp() WHERE artifact_version_id=$1`,
            [
              blockedVersionId,
              `local://artifact/${version}`,
              digest(`artifact-${version}`),
              Buffer.byteLength(`artifact-${version}`),
            ],
          ),
          /all sixteen blocking QA checks/u,
        );
      }

      const issued = await issueArtifactAccessGrant(isolated, {
        artifactVersionId: ids.version,
        accountId: ids.account,
        subjectUserId: ids.owner,
        subjectTier: "consultant",
        expiresAt: new Date(Date.now() + 60_000),
        token: "A".repeat(43),
      });
      await assert.rejects(
        isolated.query(
          `INSERT INTO artifact_access_grant
            (grant_id,artifact_version_id,account_id,subject_user_id,subject_tier,
             expires_at,url_sha256)
           VALUES($1,$2,$3,$4,'consultant',clock_timestamp()+interval '1 minute',$5)`,
          [
            randomUUID(),
            ids.version,
            ids.account2,
            ids.owner2,
            digest("cross-tenant"),
          ],
        ),
        (error) => error.code === "23503",
      );
      await assert.rejects(
        issueArtifactAccessGrant(isolated, {
          artifactVersionId: ids.version,
          accountId: ids.account,
          subjectUserId: ids.owner,
          subjectTier: "admin",
          expiresAt: new Date(Date.now() + 60_000),
        }),
        /require justification/u,
      );
      const reader = new MutableObjectReader(releasedBytes);
      const retrievalInput = {
        grantId: issued.grantId,
        token: issued.token,
        accountId: ids.account,
        subjectUserId: ids.owner,
        correlationId: randomUUID(),
        deploymentId: "p4-artifact-postgres-test",
      };
      const retrieved = await retrieveArtifactWithGrant(
        isolated,
        reader,
        retrievalInput,
      );
      assert.deepEqual(Buffer.from(retrieved.bytes), releasedBytes);
      const downloadApplication = new ArtifactDownloadApplication(
        isolated,
        reader,
      );
      const downloadContext = {
        accountId: ids.account,
        userId: ids.owner,
        tier: "consultant",
        adminSubRoles: [],
        correlationId: randomUUID(),
        deploymentId: "p4-artifact-http-boundary-test",
      };
      const downloaded = await handleArtifactDownloadRoute({
        method: "GET",
        pathname: `/api/v1/artifacts/${issued.grantId}/download`,
        artifactToken: issued.token,
        context: downloadContext,
        application: downloadApplication,
      });
      assert.equal(downloaded.status, 200);
      assert.deepEqual(Buffer.from(downloaded.bytes), releasedBytes);
      assert.equal(downloaded.headers["Content-Type"], "application/pdf");
      assert.equal(downloaded.headers["Cache-Control"], "private, no-store");
      assert.equal("storage_uri" in downloaded, false);
      assert.equal(JSON.stringify(downloaded).includes(issued.token), false);
      await assert.rejects(
        downloadApplication.download(
          { ...downloadContext, correlationId: randomUUID() },
          issued.grantId,
          "B".repeat(43),
        ),
        (error) =>
          error.status === 403 &&
          error.code === "MB-403-ARTIFACT" &&
          error.message === "The artifact is not available." &&
          error.auditRecorded === true,
      );
      await assert.rejects(
        retrieveArtifactWithGrant(isolated, reader, {
          ...retrievalInput,
          token: "wrong-token",
          correlationId: randomUUID(),
        }),
        /invalid, expired, revoked, or not entitled/u,
      );
      await assert.rejects(
        retrieveArtifactWithGrant(isolated, reader, {
          ...retrievalInput,
          grantId: randomUUID(),
          correlationId: randomUUID(),
        }),
        /invalid, expired, revoked, or not entitled/u,
      );
      await assert.rejects(
        retrieveArtifactWithGrant(isolated, reader, {
          ...retrievalInput,
          accountId: ids.account2,
          subjectUserId: ids.owner2,
          correlationId: randomUUID(),
        }),
        /invalid, expired, revoked, or not entitled/u,
      );
      const expiredGrantId = randomUUID();
      await isolated.query(
        `INSERT INTO artifact_access_grant
          (grant_id,artifact_version_id,account_id,subject_user_id,subject_tier,
           issued_at,expires_at,url_sha256)
         VALUES($1,$2,$3,$4,'consultant',clock_timestamp()-interval '2 minutes',
                clock_timestamp()-interval '1 minute',$5)`,
        [
          expiredGrantId,
          ids.version,
          ids.account,
          ids.owner,
          digest("expired-token"),
        ],
      );
      await assert.rejects(
        retrieveArtifactWithGrant(isolated, reader, {
          ...retrievalInput,
          grantId: expiredGrantId,
          token: "expired-token",
          correlationId: randomUUID(),
        }),
        /invalid, expired, revoked, or not entitled/u,
      );
      reader.value = Buffer.from("tampered");
      await assert.rejects(
        retrieveArtifactWithGrant(isolated, reader, {
          ...retrievalInput,
          correlationId: randomUUID(),
        }),
        /integrity verification failed/u,
      );
      reader.value = null;
      await assert.rejects(
        retrieveArtifactWithGrant(isolated, reader, {
          ...retrievalInput,
          correlationId: randomUUID(),
        }),
        /integrity verification failed/u,
      );
      await revokeArtifactAccessGrant(isolated, {
        grantId: issued.grantId,
        accountId: ids.account,
        reason: "synthetic revocation",
      });
      await assert.rejects(
        retrieveArtifactWithGrant(isolated, reader, {
          ...retrievalInput,
          correlationId: randomUUID(),
        }),
        /invalid, expired, revoked, or not entitled/u,
      );
      const outcomes = await isolated.query(
        `SELECT outcome,fields_released FROM audit_event
          WHERE event_type='artifact.download' ORDER BY occurred_at,audit_id`,
      );
      assert.deepEqual(
        outcomes.rows.map(({ outcome }) => outcome).sort(),
        [
          "allow",
          "allow",
          "deny",
          "deny",
          "deny",
          "deny",
          "deny",
          "deny",
          "error",
          "error",
        ].sort(),
      );
      assert.deepEqual(
        outcomes.rows.find(({ outcome }) => outcome === "allow")
          .fields_released,
        ["artifact_bytes"],
      );
      assert.equal(
        (
          await isolated.query(
            "SELECT count(*)::integer AS count FROM artifact_access_grant_use",
          )
        ).rows[0].count,
        2,
      );
    } finally {
      await isolated?.end();
      await control
        .query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
            WHERE datname=$1 AND pid<>pg_backend_pid()`,
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
