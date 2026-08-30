import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { describe, it } from "vitest";

import {
  MatchBaseApplication,
  StandardWorkspaceApplication,
} from "@matchbase/application";
import {
  DeterministicFixtureCanonicalizer,
  DeterministicFixtureLanguageIdentifier,
} from "@matchbase/ai-evidence";
import { sha256Base64Url } from "@matchbase/auth";
import { createPool, migrateUp } from "@matchbase/data";
import { createWebRuntime } from "./runtime";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe.sequential : describe.skip;
const digestKey = Buffer.from("task074-output-read-digest-key-0001");
const testBatch = randomUUID();

function digest(value) {
  return createHash("sha256").update(value).digest();
}

async function seedSubject(pool, tier) {
  const ids = {
    accountId: randomUUID(),
    userId: randomUUID(),
    grantorId: randomUUID(),
    requestId: randomUUID(),
    canonicalizationId: randomUUID(),
    canonicalId: randomUUID(),
    modelId: randomUUID(),
    scoringId: randomUUID(),
    handle: `task074-${tier}-${randomUUID()}`,
  };
  const version = Math.floor(Math.random() * 1_000_000_000) + 1;
  await pool.query(
    "INSERT INTO account(account_id,display_name,status) VALUES($1,$2,'active')",
    [ids.accountId, `TASK074 ${tier}`],
  );
  await pool.query(
    `INSERT INTO app_user(user_id,account_id,google_sub,email_verified,status)
     VALUES($1,$2,$3,true,'active'),($4,$2,$5,true,'active')`,
    [
      ids.userId,
      ids.accountId,
      `task074-${ids.userId}`,
      ids.grantorId,
      `task074-grantor-${ids.grantorId}`,
    ],
  );
  await pool.query(
    `INSERT INTO entitlement_grant
       (grant_id,account_id,user_id,tier,grant_actor_kind,granted_by_user_id,justification,effective_from)
     VALUES($1,$2,$3,$4,$5,$6,'task074 isolated test',clock_timestamp()-interval '1 hour')`,
    [
      randomUUID(),
      ids.accountId,
      ids.userId,
      tier,
      tier === "demo" ? "system" : "user",
      tier === "demo" ? null : ids.grantorId,
    ],
  );
  await pool.query(
    `INSERT INTO user_session
       (session_id,account_id,user_id,handle_hash,csrf_token_hash,absolute_expires_at,idle_expires_at)
     VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '30 minutes')`,
    [
      randomUUID(),
      ids.accountId,
      ids.userId,
      Buffer.from(sha256Base64Url(ids.handle), "base64url"),
      Buffer.from(sha256Base64Url("task074-csrf"), "base64url"),
    ],
  );
  await pool.query(
    `INSERT INTO model_policy_version(model_policy_version_id,version,capability_map,content_sha256,released_at)
     VALUES($1,$2,'{}'::jsonb,$3,clock_timestamp())`,
    [ids.modelId, version, digest(`task074-model-${version}`)],
  );
  await pool.query(
    `INSERT INTO scoring_config_version
       (scoring_config_version_id,version,weights_bp,gate_definitions,content_sha256,released_at,product_owner_approval_ref,sme_approval_ref,evaluation_run_ref)
     VALUES($1,$2,'{}'::jsonb,'{}'::jsonb,$3,clock_timestamp(),'task074-po','task074-sme','task074-eval')`,
    [ids.scoringId, version, digest(`task074-score-${version}`)],
  );
  await pool.query(
    `INSERT INTO canonicalization_execution_run
       (canonicalization_run_id,account_id,user_id,subject_request_id,request_correlation_id,started_at)
     VALUES($1,$2,$3,$4,$5,clock_timestamp())`,
    [
      ids.canonicalizationId,
      ids.accountId,
      ids.userId,
      ids.requestId,
      `task074-${ids.requestId}`,
    ],
  );
  await pool.query(
    `INSERT INTO sourcing_request
       (request_id,account_id,created_by_user_id,canonicalization_run_id,lifecycle_state)
     VALUES($1,$2,$3,$4,'confirmed')`,
    [ids.requestId, ids.accountId, ids.userId, ids.canonicalizationId],
  );
  await pool.query(
    `INSERT INTO canonical_request_version
       (canonical_request_version_id,request_id,account_id,version,canonical_document,match_readiness,created_by_user_id)
     VALUES($1,$2,$3,1,'{"fields":[],"hard_constraints":[]}'::jsonb,'ready',$4)`,
    [ids.canonicalId, ids.requestId, ids.accountId, ids.userId],
  );
  await pool.query(
    `INSERT INTO canonical_confirmation
       (confirmation_id,canonical_request_version_id,account_id,actor_user_id,accepted,confirmed_at)
     VALUES($1,$2,$3,$4,true,clock_timestamp())`,
    [randomUUID(), ids.canonicalId, ids.accountId, ids.userId],
  );
  return ids;
}

async function seedRun(pool, subject, tier, state) {
  const runId = randomUUID();
  await pool.query(
    `INSERT INTO research_run
       (run_id,account_id,canonical_request_version_id,requested_by_user_id,tier_at_submission,state,state_reason,model_policy_version_id,scoring_config_version_id,idempotency_key_hash,queued_at)
     VALUES($1,$2,$3,$4,$5,$6,'task074-internal-canary',$7,$8,$9,clock_timestamp())`,
    [
      runId,
      subject.accountId,
      subject.canonicalId,
      subject.userId,
      tier,
      state,
      subject.modelId,
      subject.scoringId,
      digest(`task074-run-${runId}`),
    ],
  );
  await pool.query(
    `INSERT INTO run_result
       (run_id,account_id,outcome,eligible_count,considered_count,scarcity,limitations_text,complete_result_document,result_sha256,assembled_at)
     VALUES($1,$2,'candidates',1,1,'{}'::jsonb,'provider-text-canary',$3::jsonb,$4,clock_timestamp())`,
    [
      runId,
      subject.accountId,
      JSON.stringify({
        candidates: [
          {
            candidate_id: "candidate-canary-task074",
            score: 99,
            band: "high",
            citations: ["citation-canary-task074"],
            rationale: "rationale-canary-task074",
          },
        ],
      }),
      digest(`task074-result-${runId}`),
    ],
  );
  return runId;
}

function assertNeutral403(response, body) {
  assert.equal(response.status, 403);
  assert.equal(body.type, "about:matchbase/errors/output-restricted");
  assert.equal(body.code, "MB-403-OUTPUT");
  assert.equal(body.detail, "Run output is not available.");
  const forbidden =
    /candidate|score|band|citation|rationale|provider|run_result|state_reason/u;
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      assert.doesNotMatch(key, forbidden);
      visit(nested);
    }
  }
  visit(body);
  assert.doesNotMatch(body.detail, /escalated|restricted|task074-internal/u);
}

describePostgres("TASK074 output restriction runtime parity", () => {
  it("native and Fetch runtimes deny every Demo and Standard fresh status/result read before output disclosure", async () => {
    const pool = createPool({ connectionString: databaseUrl, max: 12 });
    let server;
    let closeFetchRuntime;
    try {
      await migrateUp(pool);
      const demo = await seedSubject(pool, "demo");
      const standard = await seedSubject(pool, "standard");
      const runs = [];
      for (const [tier, subject] of [
        ["demo", demo],
        ["standard", standard],
      ])
        for (const state of ["escalated", "restricted"])
          runs.push({
            tier,
            subject,
            state,
            runId: await seedRun(pool, subject, tier, state),
          });

      const demoApplication = new MatchBaseApplication({
        pool,
        canonicalizer: new DeterministicFixtureCanonicalizer({
          digestKey,
          digestKeyId: "task074-v1",
          languageIdentifier: new DeterministicFixtureLanguageIdentifier(),
        }),
        privacyKey: digestKey,
      });
      const standardApplication = new StandardWorkspaceApplication({
        pool,
        privacyKey: digestKey,
      });
      const config = {
        environment: "test",
        origin: "http://127.0.0.1",
        deploymentId: "task074-native",
        databaseUrl,
        oidcSimulatorEnabled: false,
        syntheticFixtureEnabled: true,
        digestKey,
        port: 0,
      };
      server = createServer(
        createWebRuntime({
          config,
          pool,
          application: demoApplication,
          standardApplication,
        }),
      );
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const nativeBase = `http://127.0.0.1:${address.port}`;

      process.env.DATABASE_URL = databaseUrl;
      process.env.MATCHBASE_ENVIRONMENT = "test";
      process.env.MATCHBASE_ORIGIN = "http://127.0.0.1";
      process.env.MATCHBASE_DEPLOYMENT_ID = "task074-fetch";
      process.env.MATCHBASE_DIGEST_KEY = digestKey.toString("utf8");
      process.env.MATCHBASE_SYNTHETIC_FIXTURE = "true";
      process.env.MATCHBASE_OIDC_SIMULATOR = "false";
      const fetchRuntime = await import("./fetch-runtime");
      closeFetchRuntime = fetchRuntime.closeFetchRuntime;

      for (const runtime of ["native", "fetch"])
        for (const { subject, runId } of runs)
          for (const suffix of ["", "/result"]) {
            const headers = {
              Cookie: `${runtime === "native" ? "__Host-matchbase_session" : "matchbase_session"}=${encodeURIComponent(subject.handle)}`,
              "MB-Correlation-Id": `task074-${testBatch}-${runtime}-${randomUUID()}`,
            };
            const response =
              runtime === "native"
                ? await fetch(`${nativeBase}/api/v1/runs/${runId}${suffix}`, {
                    headers,
                  })
                : await fetchRuntime.handleRoute(
                    new Request(
                      `http://127.0.0.1/api/v1/runs/${runId}${suffix}`,
                      { headers },
                    ),
                  );
            assertNeutral403(response, await response.json());
          }

      const audits = await pool.query(
        `SELECT account_id,actor_user_id,resource_id,request_correlation_id,deployment_id,detail
           FROM audit_event
          WHERE event_type='access.denied'
            AND detail->>'reasonCode'='output_restricted'
            AND request_correlation_id LIKE $1
          ORDER BY occurred_at`,
        [`task074-${testBatch}-%`],
      );
      assert.equal(audits.rowCount, 16);
      for (const audit of audits.rows) {
        assert.ok(audit.account_id);
        assert.ok(audit.actor_user_id);
        assert.ok(audit.resource_id);
        assert.ok(audit.request_correlation_id);
        assert.match(audit.deployment_id, /^task074-(?:native|fetch)$/u);
        assert.deepEqual(
          Object.keys(audit.detail).sort(),
          ["reasonCode", "refusalCode", "routeClass"].sort(),
        );
        assert.equal(
          JSON.stringify(audit.detail).includes("task074-internal-canary"),
          false,
        );
      }

      const beforeAuditFailure = await pool.query(
        `SELECT count(*)::int AS count FROM audit_event
          WHERE event_type='access.denied'
            AND detail->>'reasonCode'='output_restricted'`,
      );
      await pool.query(`
        CREATE FUNCTION task074_reject_output_deny() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.event_type='access.denied'
             AND NEW.detail->>'reasonCode'='output_restricted' THEN
            RAISE EXCEPTION 'task074 synthetic audit refusal';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER task074_reject_output_deny
        BEFORE INSERT ON audit_event
        FOR EACH ROW EXECUTE FUNCTION task074_reject_output_deny();
      `);
      try {
        const target = runs[0];
        const auditFailure = await fetchRuntime.handleRoute(
          new Request(`http://127.0.0.1/api/v1/runs/${target.runId}/result`, {
            headers: {
              Cookie: `matchbase_session=${encodeURIComponent(target.subject.handle)}`,
            },
          }),
        );
        const auditFailureBody = await auditFailure.json();
        assert.equal(auditFailure.status, 503);
        assert.equal(auditFailureBody.code, "MB-503-AUDIT");
      } finally {
        await pool.query(
          `DROP TRIGGER task074_reject_output_deny ON audit_event;
           DROP FUNCTION task074_reject_output_deny();`,
        );
      }
      const afterAuditFailure = await pool.query(
        `SELECT count(*)::int AS count FROM audit_event
          WHERE event_type='access.denied'
            AND detail->>'reasonCode'='output_restricted'`,
      );
      assert.equal(
        afterAuditFailure.rows[0].count,
        beforeAuditFailure.rows[0].count,
      );

      const outsider = await seedSubject(pool, "demo");
      const foreign = runs[0];
      const cross = await fetchRuntime.handleRoute(
        new Request(`http://127.0.0.1/api/v1/runs/${foreign.runId}/result`, {
          headers: {
            Cookie: `matchbase_session=${encodeURIComponent(outsider.handle)}`,
          },
        }),
      );
      const crossBody = await cross.json();
      assert.equal(cross.status, 403);
      assert.equal(crossBody.code, "MB-403-RESOURCE");
      assert.equal(JSON.stringify(crossBody).includes(foreign.runId), false);
      assert.equal(
        JSON.stringify(crossBody).includes("output-restricted"),
        false,
      );
    } finally {
      if (closeFetchRuntime) await closeFetchRuntime();
      if (server)
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      await pool.end();
    }
  });
});
