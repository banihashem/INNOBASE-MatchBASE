import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import test from "node:test";

import { SYNTHETIC_DOMAIN_PACK } from "../../../packages/ai-evidence/dist/src/standard.js";
import {
  StandardWorkspaceApplication,
  standardReleasedFieldPaths,
} from "../../../packages/application/dist/index.js";
import {
  createPool,
  migrateDown,
  migrateUp,
} from "../../../packages/data/dist/index.js";

const databaseUrl = process.env.DATABASE_URL;
const postgresTest = databaseUrl ? test : test.skip;
const privacyKey = "slice2-standard-application-test-key-0000000000000001";

function digest(value) {
  return createHash("sha256").update(value).digest();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

const syntheticScenarios = ["zero", "one", "two", "three", "many"];

function scarcityHardConstraints(suffix) {
  const selector =
    typeof suffix === "number" ? suffix : digest(String(suffix))[0];
  return [
    {
      constraint_id: `mandatory-demand-${suffix}`,
      field_id: "FLD-CORE-TR-01",
      operator: "minimum",
      target: {
        value_state: "provided",
        value: String(45 + (selector % 40)),
      },
      relaxability: "non_relaxable",
    },
    {
      constraint_id: `relaxable-capacity-${suffix}`,
      field_id: "FLD-CORE-SP-04",
      operator: "minimum",
      target: { value_state: "provided", value: String(1200 + selector) },
      relaxability: "relaxable",
      tolerance: "200",
      direction: "lower_is_acceptable",
    },
  ];
}

function selectedSyntheticScenario(canonicalDocument) {
  const material = {
    selector_version: "canonical-registry.v1",
    domain_pack: canonicalDocument.domain_pack,
    fields: canonicalDocument.fields,
    hard_constraints: canonicalDocument.hard_constraints.map(
      ({ constraint_id: _constraintId, ...constraint }) => constraint,
    ),
    exclusions: canonicalDocument.exclusions,
    conditional_requirements: canonicalDocument.conditional_requirements,
    contradictions: canonicalDocument.contradictions,
  };
  return syntheticScenarios[digest(stableJson(material))[0] % 5];
}

async function seedOwner(pool) {
  const ids = {
    accountId: randomUUID(),
    userId: randomUUID(),
    grantorId: randomUUID(),
  };
  const version = Math.floor(Math.random() * 1_000_000_000) + 1;
  await pool.query(
    "INSERT INTO account(account_id,display_name,status) VALUES($1,'Standard API owner','active')",
    [ids.accountId],
  );
  await pool.query(
    "INSERT INTO app_user(user_id,account_id,google_sub,email_verified,status) VALUES($1,$2,$3,true,'active')",
    [ids.userId, ids.accountId, `standard-${ids.userId}`],
  );
  await pool.query(
    "INSERT INTO app_user(user_id,account_id,google_sub,email_verified,status) VALUES($1,$2,$3,true,'active')",
    [ids.grantorId, ids.accountId, `grantor-${ids.grantorId}`],
  );
  await pool.query(
    `INSERT INTO entitlement_grant(grant_id,account_id,user_id,tier,grant_actor_kind,granted_by_user_id,justification,effective_from) VALUES($1,$2,$3,'standard','user',$4,'slice2 application fixture',clock_timestamp())`,
    [randomUUID(), ids.accountId, ids.userId, ids.grantorId],
  );
  await pool.query(
    `INSERT INTO model_policy_version(model_policy_version_id,version,capability_map,content_sha256,released_at) VALUES($1,$2,'{}'::jsonb,$3,clock_timestamp())`,
    [randomUUID(), version, digest(`model-${version}`)],
  );
  await pool.query(
    `INSERT INTO scoring_config_version(scoring_config_version_id,version,weights_bp,gate_definitions,content_sha256,released_at,product_owner_approval_ref,sme_approval_ref,evaluation_run_ref) VALUES($1,$2,'{}'::jsonb,'{}'::jsonb,$3,clock_timestamp(),'po-s2','sme-s2','eval-s2')`,
    [randomUUID(), version, digest(`score-${version}`)],
  );
  return ids;
}

function context(ids) {
  return {
    accountId: ids.accountId,
    userId: ids.userId,
    tier: "standard",
    adminSubRoles: [],
    correlationId: randomUUID(),
    deploymentId: "slice2-api-test",
  };
}

function fields(value = "Industrial component model MX900") {
  return [
    ...SYNTHETIC_DOMAIN_PACK.core_fields,
    ...SYNTHETIC_DOMAIN_PACK.domain_fields,
  ].map((definition) => ({
    field_id: definition.field_id,
    macro_parameter: definition.macro_parameter,
    typed_value:
      definition.requirement !== "required"
        ? { value_state: "not_asked" }
        : definition.field_id === "component_material"
          ? { value_state: "provided", value: "alloy" }
          : definition.kind === "quantity"
            ? { value_state: "provided", value: "45" }
            : { value_state: "provided", value },
  }));
}

async function activation(app, ctx, source) {
  const resolution = await app.resolveDomainPack(ctx, {
    source_text: source,
    category_id: "synthetic_industrial_components",
  });
  assert.equal(resolution.activation_state, "confirmed");
  return resolution.activation_token;
}

async function createFixture(app, ctx, key, overrides = {}) {
  const source = overrides.source_text ?? "Industrial component model MX900";
  return app.createRequest(ctx, key, {
    domain_pack_activation_token: await activation(app, ctx, source),
    source_language: overrides.source_language ?? "en",
    source_text: source,
    fields: overrides.fields ?? fields(overrides.field_value),
    hard_constraints:
      overrides.hard_constraints ?? scarcityHardConstraints(key),
    exclusions: overrides.exclusions ?? [],
    conditional_requirements: overrides.conditional_requirements ?? [],
  });
}

postgresTest(
  "Standard application persists source-free canonical truth, blocks forged readiness, and executes deterministic results",
  async () => {
    const pool = createPool({ connectionString: databaseUrl, max: 4 });
    try {
      await migrateDown(pool).catch(() => false);
      await migrateUp(pool);
      const ids = await seedOwner(pool);
      const ctx = context(ids);
      const app = new StandardWorkspaceApplication({ pool, privacyKey });
      assert.equal(await app.readiness(), true);

      const source = "قطعه صنعتی مدل MX900 — اگر مدل MX900 انتخاب شود";
      const excerpt = "اگر مدل MX900 انتخاب شود";
      const start = Buffer.from(source).indexOf(Buffer.from(excerpt));
      const created = await app.createRequest(
        ctx,
        "standard-request-idempotency-0001",
        {
          domain_pack_activation_token: await activation(app, ctx, source),
          source_language: "fa",
          source_text: source,
          fields: fields("قطعه صنعتی مدل MX900"),
          hard_constraints: [],
          exclusions: [],
          conditional_requirements: [
            {
              requirement_id: "condition-1",
              condition: "اگر مدل MX900 انتخاب شود",
              required_result: "گواهی با کد ISO-9001 الزامی است",
              source_text: excerpt,
              source_start_byte: start,
              source_end_byte: start + Buffer.byteLength(excerpt),
              requirement_level: "mandatory",
            },
          ],
        },
      );
      assert.deepEqual(
        Object.keys(created).sort(),
        [
          "canonical_language",
          "canonical_version_id",
          "conditional_requirements",
          "contradictions",
          "created_at",
          "domain_pack",
          "exclusions",
          "fields",
          "hard_constraints",
          "readiness",
          "request_id",
          "schema_version",
          "source_language",
          "version",
        ].sort(),
      );
      assert.equal(created.source_language, "fa");
      assert.equal(created.fields[0].translated, true);
      assert.equal(created.fields[0].confidence, 0.99);
      assert.equal(
        created.fields[0].typed_value.value,
        "Industrial component model MX900",
      );
      assert.equal(
        created.conditional_requirements[0].canonical_english_condition,
        "If model MX900 is selected",
      );
      assert.equal(
        created.conditional_requirements[0].canonical_english_result,
        "Certification code ISO-9001 is required",
      );
      const stored = await pool.query(
        `SELECT v.canonical_document,l.source_language_tag,f.translated,f.confidence,d.digest_hmac_sha256,c.condition_english,c.required_result_english FROM canonical_request_version v JOIN canonical_language_record l USING(canonical_request_version_id) JOIN request_field f USING(canonical_request_version_id) JOIN original_text_digest d USING(canonical_request_version_id) JOIN conditional_requirement c USING(canonical_request_version_id) WHERE v.canonical_request_version_id=$1 AND f.field_key='FLD-CORE-PS-01'`,
        [created.canonical_version_id],
      );
      assert.equal(stored.rows[0].source_language_tag, "fa");
      assert.equal(stored.rows[0].translated, true);
      assert.equal(Number(stored.rows[0].confidence), 0.99);
      assert.ok(
        stored.rows[0].digest_hmac_sha256.equals(
          createHmac("sha256", privacyKey).update(Buffer.from(source)).digest(),
        ),
      );
      assert.equal(
        stored.rows[0].condition_english,
        "If model MX900 is selected",
      );
      assert.equal(
        stored.rows[0].required_result_english,
        "Certification code ISO-9001 is required",
      );
      assert.equal(
        JSON.stringify(stored.rows[0].canonical_document).includes(source),
        false,
      );
      const canary = await pool.query(
        `SELECT count(*)::int AS findings FROM (SELECT canonical_document::text AS value FROM canonical_request_version UNION ALL SELECT canonical_value::text FROM request_field UNION ALL SELECT condition_english || required_result_english FROM conditional_requirement UNION ALL SELECT detail::text FROM audit_event) stored_text WHERE value LIKE '%' || $1 || '%'`,
        [source],
      );
      assert.equal(canary.rows[0].findings, 0);

      const conflictSource =
        "Industrial component model MX900 with conflicting constraints.";
      const conflicted = await app.createRequest(
        ctx,
        "standard-request-idempotency-0002",
        {
          domain_pack_activation_token: await activation(
            app,
            ctx,
            conflictSource,
          ),
          source_language: "en",
          source_text: conflictSource,
          fields: fields(),
          hard_constraints: [
            {
              constraint_id: "constraint-a",
              field_id: "FLD-CORE-PS-03",
              operator: "equals",
              target: { value_state: "provided", value: "At least 45 kg" },
              relaxability: "non_relaxable",
            },
            {
              constraint_id: "constraint-b",
              field_id: "FLD-CORE-PS-03",
              operator: "not_equals",
              target: { value_state: "provided", value: "At least 45 kg" },
              relaxability: "non_relaxable",
            },
            {
              constraint_id: "constraint-relaxable-capacity",
              field_id: "FLD-CORE-SP-04",
              operator: "minimum",
              target: { value_state: "provided", value: "1200" },
              relaxability: "relaxable",
              tolerance: "200",
              direction: "lower_is_acceptable",
            },
          ],
          exclusions: [],
          conditional_requirements: [],
        },
      );
      assert.equal(conflicted.readiness, "not_ready");
      assert.equal(conflicted.contradictions.length, 1);
      await assert.rejects(
        () => app.confirmVersion(ctx, conflicted.request_id, 1, true),
        (error) => error?.code === "MB-422-CONTRADICTION",
      );
      await assert.rejects(
        () =>
          app.submitRun(
            ctx,
            "standard-run-idempotency-0001",
            conflicted.request_id,
            1,
          ),
        (error) => error?.code === "MB-422-READY",
      );
      assert.equal(
        (await pool.query("SELECT count(*)::int AS count FROM quota_ledger"))
          .rows[0].count,
        0,
      );

      const contradiction = conflicted.contradictions[0];
      const resolved = await app.resolveContradiction(
        ctx,
        conflicted.request_id,
        contradiction.contradiction_id,
        { alternative_id: contradiction.alternatives[0].alternative_id },
        "The owner selected the alloy requirement.",
      );
      assert.equal(resolved.version, 2);
      assert.equal(resolved.readiness, "ready");
      assert.equal(
        resolved.contradictions[0].resolution_state,
        "resolved_by_owner",
      );
      await app.confirmVersion(ctx, conflicted.request_id, 2, true);
      const submitted = await app.submitRun(
        ctx,
        "standard-run-idempotency-0002",
        conflicted.request_id,
        2,
      );
      assert.equal(submitted.quota.limit, 5);
      assert.equal(await app.executeSyntheticRun(ctx, submitted.run_id), true);
      assert.equal(await app.executeSyntheticRun(ctx, submitted.run_id), true);
      const result = await app.getResult(ctx, submitted.run_id);
      assert.ok(["matched", "no_responsible_match"].includes(result.outcome));
      assert.ok(result.candidates.length >= 0 && result.candidates.length <= 3);
      for (let version = 3; version <= 22; version += 1) {
        await pool.query(
          `INSERT INTO canonical_request_version
             (canonical_request_version_id,request_id,account_id,version,canonical_language,canonical_document,protected_spans,match_readiness,parent_version_id,created_by_user_id,created_at)
           SELECT $1,request_id,account_id,$2,canonical_language,canonical_document,protected_spans,match_readiness,canonical_request_version_id,created_by_user_id,clock_timestamp()+make_interval(secs => $4)
             FROM canonical_request_version WHERE canonical_request_version_id=$3`,
          [randomUUID(), version, resolved.canonical_version_id, version],
        );
      }
      const surfaces = [
        ["request_history", await app.listRequests(ctx)],
        ["request_detail", await app.getRequest(ctx, conflicted.request_id)],
        ["version_history", await app.listVersions(ctx, conflicted.request_id)],
        ["run_history", await app.listRuns(ctx)],
        ["run_status", await app.getRun(ctx, submitted.run_id)],
        ["run_result", result],
      ];
      for (const [kind, body] of surfaces) {
        assert.equal(body.projection_version, 5, kind);
        const ledger = await pool.query(
          `SELECT pv.version,pv.definition,pv.content_sha256,p.fields_released,
                  p.projection_version_id AS serving_projection_version_id,
                  a.projection_version_id AS audit_projection_version_id,a.detail
             FROM projection_serving p
             JOIN projection_version pv USING(projection_version_id)
             JOIN audit_event a ON a.request_correlation_id=p.request_correlation_id
               AND a.resource_kind=p.resource_kind AND a.resource_id=p.resource_id
               AND a.event_type='projection.served'
            WHERE p.resource_kind=$1
            ORDER BY p.served_at DESC LIMIT 1`,
          [
            kind === "request_detail"
              ? "request"
              : kind === "version_history"
                ? "request_version_history"
                : kind,
          ],
        );
        const row = ledger.rows[0];
        assert.equal(row.version, 5, `${kind} registry version`);
        assert.equal(
          row.definition.schema_version,
          "standard-disclosure-projection.v5",
        );
        assert.equal(row.definition.version, 5);
        assert.ok(row.definition.resources[kind]);
        assert.ok(
          row.content_sha256.equals(digest(stableJson(row.definition))),
        );
        assert.deepEqual(
          row.fields_released,
          standardReleasedFieldPaths(body),
          `${kind} released fields`,
        );
        assert.equal(row.detail.projectionVersion, 5, `${kind} audit detail`);
        if (kind === "run_result")
          assert.match(
            row.detail.projectionAsOf,
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
            "run_result records the exact DB-clock projection instant",
          );
        assert.equal(
          row.audit_projection_version_id,
          row.serving_projection_version_id,
        );
      }
      const cursor = surfaces[2][1].next_cursor;
      assert.equal(typeof cursor, "string");
      const [encoded] = cursor.split(".");
      const cursorPayload = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      );
      assert.equal(cursorPayload.projection, 5);
      cursorPayload.projection = 4;
      const staleEncoded = Buffer.from(JSON.stringify(cursorPayload)).toString(
        "base64url",
      );
      const staleCursor = `${staleEncoded}.${createHmac("sha256", privacyKey)
        .update(staleEncoded)
        .digest("base64url")}`;
      await assert.rejects(
        () => app.listVersions(ctx, conflicted.request_id, staleCursor),
        /Invalid cursor/iu,
      );
      const servedResult = await pool.query(
        `SELECT fields_released FROM projection_serving
        WHERE run_id=$1 AND resource_kind='run_result'
        ORDER BY served_at DESC LIMIT 1`,
        [submitted.run_id],
      );
      assert.deepEqual(
        servedResult.rows[0].fields_released,
        standardReleasedFieldPaths(result),
      );
      assert.ok(servedResult.rows[0].fields_released.includes("candidates"));
      if (result.candidates.length > 0) {
        assert.ok(
          servedResult.rows[0].fields_released.includes(
            "candidates[].dimension_scores[].score",
          ),
        );
        assert.ok(
          servedResult.rows[0].fields_released.includes(
            "candidates[].citations[].content_sha256",
          ),
        );
      }
      const truth = await pool.query(
        `SELECT (SELECT count(*) FROM quota_ledger WHERE run_id=$1 AND entry_kind='charge')::int AS charges,(SELECT count(*) FROM run_result WHERE run_id=$1)::int AS results,(SELECT count(*) FROM capability_attempt WHERE run_id=$1)::int AS attempts,(SELECT count(*) FROM cost_event WHERE run_id=$1)::int AS costs,(SELECT count(*) FROM canonical_contradiction_resolution)::int AS resolutions`,
        [submitted.run_id],
      );
      assert.deepEqual(truth.rows[0], {
        charges: 1,
        results: 1,
        attempts: 1,
        costs: 1,
        resolutions: 1,
      });
      await app.recordNotModifiedProjection(
        ctx,
        "request",
        created.request_id,
        created.request_id,
      );
      const notModified = await pool.query(
        `SELECT p.fields_released,a.detail FROM projection_serving p JOIN audit_event a ON a.request_correlation_id=p.request_correlation_id AND a.resource_id=p.resource_id AND a.event_type='projection.served' AND cardinality(a.fields_released)=0 WHERE p.resource_id=$1 ORDER BY p.served_at DESC LIMIT 1`,
        [created.request_id],
      );
      assert.deepEqual(notModified.rows[0].fields_released, []);
      assert.equal(notModified.rows[0].detail.notModified, true);
      assert.equal(notModified.rows[0].detail.bodyReleased, false);
      assert.equal(notModified.rows[0].detail.projectionVersion, 5);

      for (const personCanary of [
        "Jane Mary Smith",
        "John Q. Public",
        "Jean Claude Van Damme",
        "علی رضا حسینی",
        "السيد أحمد محمد علي",
      ]) {
        const leaked = await pool.query(
          `SELECT count(*)::int AS findings FROM (
             SELECT typed_value::text AS value FROM candidate_evidenced_value
             UNION ALL SELECT complete_result_document::text FROM run_result
             UNION ALL SELECT detail::text FROM audit_event
           ) released WHERE value LIKE '%' || $1 || '%'`,
          [personCanary],
        );
        assert.equal(leaked.rows[0].findings, 0, personCanary);
      }
    } finally {
      await migrateDown(pool).catch(() => false);
      await pool.end();
    }
  },
);

postgresTest(
  "zero one and two candidate runs bind scarcity to canonical hard constraints and persisted analysis",
  async () => {
    const pool = createPool({ connectionString: databaseUrl, max: 4 });
    try {
      await migrateDown(pool).catch(() => false);
      await migrateUp(pool);
      const ids = await seedOwner(pool);
      const ctx = context(ids);
      const app = new StandardWorkspaceApplication({ pool, privacyKey });
      const fixtures = new Map();

      for (let index = 0; index < 128 && fixtures.size < 3; index += 1) {
        const created = await createFixture(
          app,
          ctx,
          `scarcity-scenario-${index}`,
          { hard_constraints: scarcityHardConstraints(index) },
        );
        const scenario = selectedSyntheticScenario(created);
        if (
          ["zero", "one", "two"].includes(scenario) &&
          !fixtures.has(scenario)
        )
          fixtures.set(scenario, created);
      }
      assert.deepEqual([...fixtures.keys()].sort(), ["one", "two", "zero"]);

      const expectedCandidateCounts = { zero: 0, one: 1, two: 2 };
      for (const scenario of ["zero", "one", "two"]) {
        const created = fixtures.get(scenario);
        assert.equal(created.hard_constraints.length, 2, scenario);
        assert.equal(
          created.hard_constraints.filter(
            (constraint) => constraint.relaxability === "relaxable",
          ).length,
          1,
          scenario,
        );
        await app.confirmVersion(ctx, created.request_id, 1, true);
        const submitted = await app.submitRun(
          ctx,
          `scarcity-run-${scenario}`,
          created.request_id,
          1,
        );
        assert.equal(
          await app.executeSyntheticRun(ctx, submitted.run_id),
          true,
        );
        const result = await app.getResult(ctx, submitted.run_id);
        assert.equal(result.projection_version, 5, scenario);
        assert.equal(
          result.candidates.length,
          expectedCandidateCounts[scenario],
        );
        assert.equal(
          result.outcome,
          scenario === "zero" ? "no_responsible_match" : "matched",
          scenario,
        );
        assert.equal(
          result.scarcity,
          scenario === "zero" ? "zero" : "limited",
          scenario,
        );
        assert.equal(
          result.scarcity_analysis.reducing_constraints.length,
          scenario === "two" ? 1 : 2,
          scenario,
        );
        assert.equal(
          result.scarcity_analysis.unmet_mandatory_constraints.length,
          scenario === "zero" ? 2 : 0,
          scenario,
        );
        assert.equal(
          result.scarcity_analysis.permitted_relaxations.length,
          scenario === "two" ? 0 : 1,
          scenario,
        );

        const stored = await pool.query(
          `SELECT outcome,unmet_constraints,permitted_relaxations
             FROM scarcity_analysis
            WHERE account_id=$1 AND run_id=$2`,
          [ids.accountId, submitted.run_id],
        );
        assert.equal(stored.rowCount, 1, scenario);
        assert.equal(
          stored.rows[0].outcome,
          scenario === "zero" ? "no_responsible_match" : "scarcity",
          scenario,
        );
        assert.deepEqual(
          stored.rows[0].unmet_constraints,
          result.scarcity_analysis.reducing_constraints.map(
            ({ constraint_id, eliminated_count }) => ({
              constraint_id,
              eliminated_count,
            }),
          ),
          `${scenario} persisted reducing constraints`,
        );
        assert.deepEqual(
          stored.rows[0].permitted_relaxations,
          result.scarcity_analysis.permitted_relaxations.map(
            ({ constraint_id }) => constraint_id,
          ),
          `${scenario} persisted permitted relaxations`,
        );
        const reread = await app.getResult(ctx, submitted.run_id);
        assert.deepEqual(
          reread.scarcity_analysis,
          result.scarcity_analysis,
          `${scenario} read integrity`,
        );
      }
    } finally {
      await migrateDown(pool).catch(() => false);
      await pool.end();
    }
  },
);

postgresTest(
  "conditional source substring mismatch is atomic and persists no request",
  async () => {
    const pool = createPool({ connectionString: databaseUrl, max: 2 });
    try {
      await migrateDown(pool).catch(() => false);
      await migrateUp(pool);
      const ids = await seedOwner(pool);
      const ctx = context(ids);
      const app = new StandardWorkspaceApplication({ pool, privacyKey });
      const source = "Industrial component exact source.";
      const token = await activation(app, ctx, source);
      const before = await pool.query(
        "SELECT count(*)::int AS count FROM sourcing_request",
      );
      await assert.rejects(
        () =>
          app.createRequest(ctx, "standard-request-idempotency-0003", {
            domain_pack_activation_token: token,
            source_language: "en",
            source_text: source,
            fields: fields(),
            hard_constraints: [],
            exclusions: [],
            conditional_requirements: [
              {
                requirement_id: "condition-bad",
                condition: "If the exact source applies",
                required_result: "The exact source must be satisfied",
                source_text: "wrong substring",
                source_start_byte: 0,
                source_end_byte: 5,
                requirement_level: "mandatory",
              },
            ],
          }),
        (error) => error?.code === "MB-422-SOURCE-SUBSTRING",
      );
      const after = await pool.query(
        "SELECT count(*)::int AS count FROM sourcing_request",
      );
      assert.equal(after.rows[0].count, before.rows[0].count);
    } finally {
      await migrateDown(pool).catch(() => false);
      await pool.end();
    }
  },
);

postgresTest(
  "preserves an immutable Standard v4 registry while registering v5 independently",
  async () => {
    const pool = createPool({ connectionString: databaseUrl, max: 2 });
    try {
      await migrateDown(pool).catch(() => false);
      await migrateUp(pool);
      const ids = await seedOwner(pool);
      const ctx = context(ids);
      const app = new StandardWorkspaceApplication({ pool, privacyKey });
      const legacyProjectionVersionId = randomUUID();
      const legacyDefinition = {
        schema_version: "standard-disclosure-projection.v4",
        version: 4,
        tier: "standard",
        resources: { immutable_legacy_v4: [] },
      };
      const legacyDefinitionHash = digest(stableJson(legacyDefinition));
      await pool.query(
        `INSERT INTO projection_version
           (projection_version_id,version,definition,content_sha256,released_at)
         VALUES($1,4,$2::jsonb,$3,clock_timestamp())`,
        [
          legacyProjectionVersionId,
          JSON.stringify(legacyDefinition),
          legacyDefinitionHash,
        ],
      );
      const body = await app.listRequests(ctx);
      assert.equal(body.projection_version, 5);
      const versions = await pool.query(
        `SELECT projection_version_id,version,definition,content_sha256
           FROM projection_version
          WHERE version IN (4,5)
          ORDER BY version`,
      );
      assert.equal(versions.rows.length, 2);
      const legacy = versions.rows[0];
      assert.equal(legacy.projection_version_id, legacyProjectionVersionId);
      assert.equal(legacy.version, 4);
      assert.deepEqual(legacy.definition, legacyDefinition);
      assert.ok(legacy.content_sha256.equals(legacyDefinitionHash));
      const current = versions.rows[1];
      assert.equal(current.version, 5);
      assert.equal(
        current.definition.schema_version,
        "standard-disclosure-projection.v5",
      );
      assert.equal(current.definition.version, 5);
      assert.ok(
        current.content_sha256.equals(digest(stableJson(current.definition))),
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM audit_event
              WHERE event_type='projection.served'`,
          )
        ).rows[0].count,
        1,
      );
    } finally {
      await migrateDown(pool).catch(() => false);
      await pool.end();
    }
  },
);

postgresTest(
  "fails closed on a same-number different Standard v5 projection registry",
  async () => {
    const pool = createPool({ connectionString: databaseUrl, max: 2 });
    try {
      await migrateDown(pool).catch(() => false);
      await migrateUp(pool);
      const ids = await seedOwner(pool);
      const ctx = context(ids);
      const app = new StandardWorkspaceApplication({ pool, privacyKey });
      await pool.query(
        `INSERT INTO projection_version
           (projection_version_id,version,definition,content_sha256,released_at)
         VALUES($1,5,$2::jsonb,$3,clock_timestamp())`,
        [
          randomUUID(),
          JSON.stringify({
            schema_version: "standard-disclosure-projection.v5",
            version: 5,
            tier: "standard",
            resources: { same_shape_different_identity: [] },
          }),
          digest("forged-standard-projection-v5"),
        ],
      );
      await assert.rejects(
        () => app.listRequests(ctx),
        /registry is stale or ambiguous/iu,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count FROM audit_event
              WHERE event_type='projection.served'`,
          )
        ).rows[0].count,
        0,
      );
    } finally {
      await migrateDown(pool).catch(() => false);
      await pool.end();
    }
  },
);

postgresTest(
  "EN FA AR ES structured fixtures persist canonical English only without fake capability telemetry",
  async () => {
    const pool = createPool({ connectionString: databaseUrl, max: 3 });
    try {
      await migrateDown(pool).catch(() => false);
      await migrateUp(pool);
      const ids = await seedOwner(pool);
      const ctx = context(ids);
      const app = new StandardWorkspaceApplication({ pool, privacyKey });
      const fixtures = [
        {
          language: "en",
          field: "Industrial component model MX900",
          constraint: "At least 45 kg",
          exclusion: "Exclude code HS-CODE",
          condition: "If model MX900 is selected",
          result: "Certification code ISO-9001 is required",
        },
        {
          language: "fa",
          field: "قطعه صنعتی مدل MX900",
          constraint: "حداقل 45 kg",
          exclusion: "کد HS-CODE حذف شود",
          condition: "اگر مدل MX900 انتخاب شود",
          result: "گواهی با کد ISO-9001 الزامی است",
        },
        {
          language: "ar",
          field: "مكوّن صناعي طراز MX900",
          constraint: "ما لا يقل عن 45 kg",
          exclusion: "استبعاد الرمز HS-CODE",
          condition: "إذا تم اختيار الطراز MX900",
          result: "شهادة الرمز ISO-9001 مطلوبة",
        },
        {
          language: "es",
          field: "Componente industrial modelo MX900",
          constraint: "Al menos 45 kg",
          exclusion: "Excluir el código HS-CODE",
          condition: "Si se selecciona el modelo MX900",
          result: "Se requiere la certificación ISO-9001",
        },
      ];
      for (const [index, fixture] of fixtures.entries()) {
        const source = `${fixture.field} — ${fixture.condition}`;
        const excerptStart = Buffer.from(source).indexOf(
          Buffer.from(fixture.condition),
        );
        const created = await app.createRequest(
          ctx,
          `standard-language-${index}-idempotency`,
          {
            domain_pack_activation_token: await activation(app, ctx, source),
            source_language: fixture.language,
            source_text: source,
            fields: fields(fixture.field),
            hard_constraints: [
              {
                constraint_id: `language-constraint-${index}`,
                field_id: "FLD-CORE-PS-03",
                operator: "equals",
                target: { value_state: "provided", value: fixture.constraint },
                relaxability: "non_relaxable",
              },
            ],
            exclusions: [
              {
                exclusion_id: `language-exclusion-${index}`,
                field_id: "FLD-CORE-PS-03",
                canonical_english_value: fixture.exclusion,
              },
            ],
            conditional_requirements: [
              {
                requirement_id: `language-condition-${index}`,
                condition: fixture.condition,
                required_result: fixture.result,
                source_text: fixture.condition,
                source_start_byte: excerptStart,
                source_end_byte:
                  excerptStart + Buffer.byteLength(fixture.condition),
                requirement_level: "mandatory",
              },
            ],
          },
        );
        assert.equal(
          created.fields[0].typed_value.value,
          "Industrial component model MX900",
        );
        assert.equal(
          created.hard_constraints[0].target.value,
          "At least 45 kg",
        );
        assert.equal(
          created.exclusions[0].canonical_english_value,
          "Exclude code HS-CODE",
        );
        assert.equal(
          created.conditional_requirements[0].canonical_english_condition,
          "If model MX900 is selected",
        );
        assert.equal(
          created.conditional_requirements[0].canonical_english_result,
          "Certification code ISO-9001 is required",
        );
        if (fixture.language !== "en") {
          const scanned = await pool.query(
            `SELECT count(*)::int AS findings FROM (SELECT canonical_document::text AS value FROM canonical_request_version UNION ALL SELECT COALESCE(canonical_value::text,'') || COALESCE(canonical_raw_value,'') FROM request_field UNION ALL SELECT COALESCE(canonical_comparand::text,'') FROM constraint_item UNION ALL SELECT condition_english || required_result_english FROM conditional_requirement UNION ALL SELECT detail::text FROM audit_event UNION ALL SELECT response_body::text FROM idempotency_record) persisted WHERE value LIKE '%' || $1 || '%' OR value LIKE '%' || $2 || '%' OR value LIKE '%' || $3 || '%' OR value LIKE '%' || $4 || '%' OR value LIKE '%' || $5 || '%'`,
            [
              fixture.field,
              fixture.constraint,
              fixture.exclusion,
              fixture.condition,
              fixture.result,
            ],
          );
          assert.equal(scanned.rows[0].findings, 0);
        }
      }
      const telemetry = await pool.query(
        `SELECT (SELECT count(*) FROM capability_attempt)::int AS attempts,(SELECT count(*) FROM provider_call)::int AS calls,(SELECT count(*) FROM cost_event)::int AS costs`,
      );
      assert.deepEqual(telemetry.rows[0], { attempts: 0, calls: 0, costs: 0 });
    } finally {
      await migrateDown(pool).catch(() => false);
      await pool.end();
    }
  },
);

postgresTest(
  "complete pack semantics reject omission, macro, kind, unit, and enum forgery atomically",
  async () => {
    const pool = createPool({ connectionString: databaseUrl, max: 3 });
    try {
      await migrateDown(pool).catch(() => false);
      await migrateUp(pool);
      const ids = await seedOwner(pool);
      const ctx = context(ids);
      const app = new StandardWorkspaceApplication({ pool, privacyKey });
      const source = "Industrial component model MX900";
      const token = await activation(app, ctx, source);
      const valid = fields();
      const attempts = [
        valid.slice(0, -1),
        valid.map((field, index) =>
          index === 0
            ? { ...field, macro_parameter: "supplier_producer_profile" }
            : field,
        ),
        valid.map((field) =>
          field.field_id === "FLD-CORE-TR-01"
            ? {
                ...field,
                typed_value: { value_state: "provided", value: "not-a-number" },
              }
            : field,
        ),
        valid.map((field) =>
          field.field_id === "dimensional_tolerance"
            ? {
                ...field,
                typed_value: {
                  value_state: "provided",
                  value: "0.5",
                  unit: "cm",
                },
              }
            : field,
        ),
        valid.map((field) =>
          field.field_id === "component_material"
            ? {
                ...field,
                typed_value: { value_state: "provided", value: "steel" },
              }
            : field,
        ),
      ];
      for (const [index, forged] of attempts.entries()) {
        await assert.rejects(
          () =>
            app.createRequest(ctx, `pack-forgery-${index}`, {
              domain_pack_activation_token: token,
              source_language: "en",
              source_text: source,
              fields: forged,
              hard_constraints: [],
              exclusions: [],
              conditional_requirements: [],
            }),
          (error) =>
            ["MB-422-SCHEMA", "MB-422-CANONICAL"].includes(error?.code),
        );
      }
      const truth = await pool.query(
        `SELECT (SELECT count(*) FROM sourcing_request)::int AS requests,(SELECT count(*) FROM canonical_request_version)::int AS versions,(SELECT count(*) FROM idempotency_record)::int AS replays`,
      );
      assert.deepEqual(truth.rows[0], { requests: 0, versions: 0, replays: 0 });

      const partialFields = fields().map((field) =>
        field.field_id === "FLD-CORE-PS-03"
          ? { ...field, typed_value: { value_state: "not_asked" } }
          : field,
      );
      const partial = await createFixture(app, ctx, "pack-partial", {
        fields: partialFields,
      });
      assert.equal(partial.readiness, "partially_ready");
      const emptyFields = fields().map((field) =>
        field.field_id === "FLD-CORE-PS-03"
          ? { ...field, typed_value: { value_state: "empty" } }
          : field,
      );
      const empty = await createFixture(app, ctx, "pack-empty", {
        fields: emptyFields,
      });
      assert.equal(empty.readiness, "not_ready");
      await assert.rejects(
        () => app.confirmVersion(ctx, empty.request_id, 1, true),
        (error) => error?.code === "MB-422-CONTRADICTION",
      );
    } finally {
      await migrateDown(pool).catch(() => false);
      await pool.end();
    }
  },
);

postgresTest(
  "canonical English edits preserve unit, raw expression, and user-corrected provenance",
  async () => {
    const pool = createPool({ connectionString: databaseUrl, max: 3 });
    try {
      await migrateDown(pool).catch(() => false);
      await migrateUp(pool);
      const ids = await seedOwner(pool);
      const ctx = context(ids);
      const app = new StandardWorkspaceApplication({ pool, privacyKey });
      const created = await createFixture(app, ctx, "fa-edit-create", {
        source_language: "fa",
        source_text: "قطعه صنعتی مدل MX900",
        field_value: "قطعه صنعتی مدل MX900",
      });
      const editedFields = fields().map((field) =>
        field.field_id === "dimensional_tolerance"
          ? {
              ...field,
              typed_value: {
                value_state: "provided",
                value: "0.5",
                unit: "mm",
                raw_expression: "0.5 mm",
              },
            }
          : field,
      );
      const mutation = await app.createVersionIdempotent(
        ctx,
        "fa-edit-version",
        created.request_id,
        {
          fields: editedFields,
          hard_constraints: [],
          exclusions: [],
          readiness: "ready",
        },
      );
      assert.equal(mutation.replayed, false);
      const edited = mutation.body;
      assert.equal(edited.source_language, "fa");
      const tolerance = edited.fields.find(
        (field) => field.field_id === "dimensional_tolerance",
      );
      assert.deepEqual(tolerance.typed_value, {
        value_state: "provided",
        value: "0.5",
        unit: "mm",
        raw_expression: "0.5 mm",
      });
      const stored = await pool.query(
        `SELECT f.canonical_unit,f.canonical_raw_value,p.origin,p.source_language_tag FROM request_field f JOIN canonical_field_provenance p USING(field_id) WHERE f.canonical_request_version_id=$1 AND f.field_key='dimensional_tolerance'`,
        [edited.canonical_version_id],
      );
      assert.deepEqual(stored.rows[0], {
        canonical_unit: "mm",
        canonical_raw_value: "0.5 mm",
        origin: "user_corrected",
        source_language_tag: "en",
      });
    } finally {
      await migrateDown(pool).catch(() => false);
      await pool.end();
    }
  },
);

postgresTest(
  "version and multi-contradiction confirmation idempotency are concurrent and rollback-safe",
  async () => {
    const pool = createPool({ connectionString: databaseUrl, max: 8 });
    try {
      await migrateDown(pool).catch(() => false);
      await migrateUp(pool);
      const ids = await seedOwner(pool);
      const ctx = context(ids);
      const app = new StandardWorkspaceApplication({ pool, privacyKey });
      const conflicted = await createFixture(app, ctx, "two-conflicts-create", {
        hard_constraints: [
          {
            constraint_id: "c1-a",
            field_id: "FLD-CORE-PS-03",
            operator: "equals",
            target: { value_state: "provided", value: "At least 45 kg" },
            relaxability: "non_relaxable",
          },
          {
            constraint_id: "c1-b",
            field_id: "FLD-CORE-PS-03",
            operator: "not_equals",
            target: { value_state: "provided", value: "At least 45 kg" },
            relaxability: "non_relaxable",
          },
          {
            constraint_id: "c2-a",
            field_id: "FLD-CORE-TR-02",
            operator: "equals",
            target: { value_state: "provided", value: "At least 45 kg" },
            relaxability: "non_relaxable",
          },
          {
            constraint_id: "c2-b",
            field_id: "FLD-CORE-TR-02",
            operator: "not_equals",
            target: { value_state: "provided", value: "At least 45 kg" },
            relaxability: "non_relaxable",
          },
        ],
      });
      assert.equal(conflicted.contradictions.length, 2);
      const resolutions = conflicted.contradictions.map((contradiction) => ({
        contradiction_id: contradiction.contradiction_id,
        selected_alternative: {
          alternative_id: contradiction.alternatives[0].alternative_id,
        },
        reason_english: "The owner selected this canonical constraint.",
      }));
      const invalid = structuredClone(resolutions);
      invalid[1].selected_alternative.alternative_id = randomUUID();
      await assert.rejects(
        () =>
          app.confirmVersionIdempotent(
            ctx,
            "confirm-crash-rollback",
            conflicted.request_id,
            1,
            { accepted: true, contradiction_resolutions: invalid },
          ),
        (error) => error?.code === "MB-422-CONTRADICTION",
      );
      let truth = await pool.query(
        `SELECT (SELECT count(*) FROM canonical_request_version WHERE request_id=$1)::int AS versions,(SELECT count(*) FROM canonical_contradiction_resolution)::int AS resolutions,(SELECT count(*) FROM canonical_confirmation)::int AS confirmations,(SELECT count(*) FROM idempotency_record WHERE route LIKE '%confirmation')::int AS replays`,
        [conflicted.request_id],
      );
      assert.deepEqual(truth.rows[0], {
        versions: 1,
        resolutions: 0,
        confirmations: 0,
        replays: 0,
      });

      const confirmations = await Promise.all(
        Array.from({ length: 6 }, () =>
          app.confirmVersionIdempotent(
            ctx,
            "confirm-concurrent",
            conflicted.request_id,
            1,
            { accepted: true, contradiction_resolutions: resolutions },
          ),
        ),
      );
      assert.equal(confirmations.filter((item) => !item.replayed).length, 1);
      assert.equal(
        new Set(confirmations.map((item) => item.body.canonical_version_id))
          .size,
        1,
      );
      assert.equal(confirmations[0].body.version, 2);
      truth = await pool.query(
        `SELECT (SELECT count(*) FROM canonical_request_version WHERE request_id=$1)::int AS versions,(SELECT count(*) FROM canonical_contradiction_resolution)::int AS resolutions,(SELECT count(*) FROM canonical_confirmation)::int AS confirmations,(SELECT count(*) FROM idempotency_record WHERE route LIKE '%confirmation')::int AS replays`,
        [conflicted.request_id],
      );
      assert.deepEqual(truth.rows[0], {
        versions: 2,
        resolutions: 2,
        confirmations: 1,
        replays: 1,
      });
      const finalDocument = (
        await pool.query(
          "SELECT canonical_document FROM canonical_request_version WHERE canonical_request_version_id=$1",
          [confirmations[0].body.canonical_version_id],
        )
      ).rows[0].canonical_document;
      assert.equal(finalDocument.hard_constraints.length, 2);
      assert.ok(
        finalDocument.hard_constraints.every(
          (constraint) => constraint.operator === "equals",
        ),
      );

      const versionInput = {
        fields: fields(),
        hard_constraints: finalDocument.hard_constraints,
        exclusions: [],
        readiness: "ready",
      };
      const versions = await Promise.all(
        Array.from({ length: 6 }, () =>
          app.createVersionIdempotent(
            ctx,
            "version-concurrent",
            conflicted.request_id,
            versionInput,
          ),
        ),
      );
      assert.equal(versions.filter((item) => !item.replayed).length, 1);
      assert.equal(
        new Set(versions.map((item) => item.body.canonical_version_id)).size,
        1,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM canonical_request_version WHERE request_id=$1",
            [conflicted.request_id],
          )
        ).rows[0].count,
        3,
      );
      await assert.rejects(
        () =>
          app.createVersionIdempotent(
            ctx,
            "version-concurrent",
            conflicted.request_id,
            {
              ...versionInput,
              exclusions: [
                {
                  exclusion_id: "different",
                  field_id: "FLD-CORE-PS-03",
                  canonical_english_value: "Exclude code HS-CODE",
                },
              ],
            },
          ),
        (error) => error?.code === "MB-409-IDEMPOTENCY",
      );
    } finally {
      await migrateDown(pool).catch(() => false);
      await pool.end();
    }
  },
);

postgresTest(
  "cancellation is truthful, idempotent, and serializes against terminal worker persistence",
  async () => {
    const pool = createPool({ connectionString: databaseUrl, max: 8 });
    try {
      await migrateDown(pool).catch(() => false);
      await migrateUp(pool);
      const ids = await seedOwner(pool);
      const ctx = context(ids);
      const app = new StandardWorkspaceApplication({ pool, privacyKey });
      const created = await createFixture(app, ctx, "cancel-create");
      await app.confirmVersion(ctx, created.request_id, 1, true);
      const firstRun = await app.submitRun(
        ctx,
        "cancel-run-1",
        created.request_id,
        1,
      );
      const cancellations = await Promise.all(
        Array.from({ length: 6 }, () => app.cancelRun(ctx, firstRun.run_id)),
      );
      assert.equal(
        cancellations.filter((item) => item.idempotent_replay === false).length,
        1,
      );
      assert.ok(
        cancellations.every(
          (item) => item.state === "cancelled" && item.cancellation_accepted,
        ),
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM audit_event WHERE event_type='run.cancelled' AND resource_id=$1",
            [firstRun.run_id],
          )
        ).rows[0].count,
        1,
      );

      const terminalRun = await app.submitRun(
        ctx,
        "cancel-run-2",
        created.request_id,
        1,
      );
      await pool.query(
        "UPDATE research_run SET state='failed',completed_at=clock_timestamp() WHERE run_id=$1",
        [terminalRun.run_id],
      );
      const terminalCancel = await app.cancelRun(ctx, terminalRun.run_id);
      assert.deepEqual(terminalCancel, {
        run_id: terminalRun.run_id,
        state: "failed",
        cancellation_accepted: false,
        idempotent_replay: false,
      });

      const racedRun = await app.submitRun(
        ctx,
        "cancel-run-3",
        created.request_id,
        1,
      );
      await Promise.all([
        app.executeSyntheticRun(ctx, racedRun.run_id),
        app.cancelRun(ctx, racedRun.run_id),
      ]);
      const raced = await pool.query(
        `SELECT rr.state,EXISTS(SELECT 1 FROM run_result rs WHERE rs.run_id=rr.run_id) AS has_result FROM research_run rr WHERE rr.run_id=$1`,
        [racedRun.run_id],
      );
      assert.ok(
        ["cancelled", "complete", "no_responsible_match"].includes(
          raced.rows[0].state,
        ),
      );
      assert.equal(
        raced.rows[0].state === "cancelled" && raced.rows[0].has_result,
        false,
      );
    } finally {
      await migrateDown(pool).catch(() => false);
      await pool.end();
    }
  },
);
