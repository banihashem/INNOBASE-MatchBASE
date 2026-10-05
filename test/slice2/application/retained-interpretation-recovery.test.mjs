import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { recoverRetainedConsultantInterpretation } from "../../../packages/application/dist/consultant-v3-service.js";
import { LivePreparationModelGateway } from "../../../packages/application/dist/live-preparation.js";
import { computeIntakeContentHash } from "../../../packages/data/dist/index.js";

// MB-UX-QUALITY-002 L01. Transaction-aware synthetic SQL only; no user database or LLM.
function fixture(t) {
  t.mock.method(globalThis, "fetch", () =>
    assert.fail("Offline recovery must not access the network"),
  );
  t.mock.method(
    LivePreparationModelGateway.prototype,
    "extractAndInterpret",
    () => assert.fail("Offline recovery must not invoke a provider"),
  );
  const identity = {
    account_id: randomUUID(),
    user_profile_id: randomUUID(),
    run_id: randomUUID(),
    execution_id: randomUUID(),
    classification_id: randomUUID(),
  };
  const intake = {
    account_id: identity.account_id,
    user_profile_id: identity.user_profile_id,
    product_requirement: "Industrial mixer",
    technical_compliance: "aterial: polished steel.",
    order_profile: "Delivery to Eastport.",
  };
  const payload = {
    original_language: "en",
    english_translation:
      "Industrial mixer. Material: polished steel. Delivery to Eastport.",
    product_category: "Process equipment",
    product_name: "Industrial mixer",
    explicit_requirements: [
      "product_requirement",
      "technical_compliance",
      "order_profile",
    ].map((source_box) => ({
      source_box,
      source_text_reference:
        source_box === "technical_compliance"
          ? "Material: polished steel."
          : intake[source_box],
      normalized_value:
        source_box === "technical_compliance"
          ? "Polished steel material"
          : intake[source_box],
      requirement_level: "mandatory",
      comparison_operator: "requires",
      concept: source_box,
      value: null,
      unit: null,
      jurisdiction: null,
      lower_bound: null,
      upper_bound: null,
      duration: null,
      supplier_role: null,
      evidence_qualifier: null,
    })),
    ambiguities: [],
    unknowns: [],
    suggested_clarifications: [],
    classification: {
      scheme: "CUSTOM_MATCHBASE",
      code: "UNCLASSIFIED",
      version: "1",
      jurisdiction: "Unknown",
      level: "category",
      label: "Mixers",
      description: "Provisional classification",
    },
  };
  const contentHash = computeIntakeContentHash(
    intake.product_requirement,
    intake.technical_compliance,
    intake.order_profile,
  );
  const timestamp = new Date("2026-01-01T00:00:00Z");
  const session = {
    session_id: randomUUID(),
    ...identity,
    original_intake: intake,
    current_state: "workflow_failed",
    execution_id: identity.execution_id,
    is_invalidated: false,
    created_at: new Date(timestamp),
    updated_at: new Date(timestamp),
    draft_revision: {
      revision_id: randomUUID(),
      english_translation: "",
      created_at: timestamp.toISOString(),
    },
    approved_request_revision: null,
    advisory_output: null,
    advisory_loop_records: null,
    deep_prompt_revision: null,
    approvals: [],
    classification: null,
    workflow_metadata: {
      classification_id: identity.classification_id,
      mode: "live",
      retry_action: "interpretation",
      error: "Interpretation failed (MB-422-LIVE-LINEAGE).",
    },
  };
  const snapshot = {
    ...identity,
    snapshot_id: randomUUID(),
    ...intake,
    content_hash: contentHash,
    revision_number: 1,
  };
  const draft = {
    draft_id: randomUUID(),
    account_id: identity.account_id,
    user_profile_id: identity.user_profile_id,
    tier: "consultant",
    current_run_id: identity.run_id,
    snapshot_id: snapshot.snapshot_id,
    status: "submitted",
    draft_version: 3,
    draft_data: { intake },
    created_at: timestamp,
    updated_at: timestamp,
  };
  const request = {
    request_id: randomUUID(),
    request_hash: "a".repeat(64),
    phase: "step1_translation",
    native_web: false,
  };
  const events = [
    {
      ...identity,
      event_id: "10",
      phase: "step1_translation",
      detail: { ...request, state: "started", dispatched: true },
    },
    {
      ...identity,
      event_id: "11",
      phase: "step1_translation",
      detail: {
        ...request,
        state: "completed",
        provider_receipt_received: true,
        is_byok: true,
        response_truncated: false,
        response_content: JSON.stringify(payload),
        cost_usd: 0.0123,
      },
    },
    {
      ...identity,
      event_id: "12",
      phase: "failed",
      detail: { stage: "interpretation", code: "MB-422-LIVE-LINEAGE" },
    },
  ];
  const args = {
    account_id: identity.account_id,
    user_profile_id: identity.user_profile_id,
    run_id: identity.run_id,
    source_execution_id: identity.execution_id,
    classification_id: identity.classification_id,
    source_event_id: "11",
    expected_intake_hash: contentHash,
    reason:
      "Operator verified a single copyedited source anchor against the original submitted input.",
    corrections: [
      {
        requirement_index: 1,
        source_box: "technical_compliance",
        expected_reference: "Material: polished steel.",
        replacement_reference: intake.technical_compliance,
      },
    ],
  };
  const state = {
    session,
    snapshots: [snapshot],
    draft,
    events,
    downstream: [],
    writes: [],
    queries: [],
    failSave: false,
    databaseTimestamps: {},
  };
  let transaction;
  const query = async (sql, p = []) => {
    state.queries.push(sql);
    if (sql === "BEGIN") {
      transaction = structuredClone({
        session: state.session,
        events: state.events,
        writes: state.writes,
      });
      return { rows: [] };
    }
    if (sql === "ROLLBACK") {
      Object.assign(state, transaction);
      return { rows: [] };
    }
    if (sql === "COMMIT") return { rows: [] };
    if (sql.includes("FROM consultant_workflow_session s")) {
      assert.match(
        sql,
        /SELECT s\.\*,to_jsonb\(s\) AS original_failed_session/,
      );
      assert.match(
        sql,
        /account_id=\$1 AND user_profile_id=\$2 AND run_id=\$3 FOR UPDATE/,
      );
      return {
        rows:
          p[0] === state.session.account_id &&
          p[1] === state.session.user_profile_id &&
          p[2] === state.session.run_id
            ? [
                {
                  ...structuredClone(state.session),
                  original_failed_session: {
                    ...JSON.parse(JSON.stringify(state.session)),
                    ...state.databaseTimestamps,
                  },
                },
              ]
            : [],
      };
    }
    if (sql.includes("FROM consultant_intake_snapshot")) {
      assert.deepEqual(p, [
        identity.account_id,
        identity.user_profile_id,
        identity.run_id,
      ]);
      return { rows: structuredClone(state.snapshots) };
    }
    if (sql.includes("SELECT * FROM consultant_draft_session"))
      return { rows: state.draft ? [structuredClone(state.draft)] : [] };
    if (sql.includes("UNION ALL")) {
      assert.match(sql, /status IN \('queued','running'\)/);
      assert.match(sql, /consultant_research_round/);
      assert.match(sql, /consultant_output_v3/);
      return { rows: structuredClone(state.downstream) };
    }
    if (sql.includes("SELECT event_id::text")) {
      assert.match(
        sql,
        /account_id=\$1 AND user_profile_id=\$2 AND run_id=\$3 AND execution_id=\$4 AND classification_id=\$5/,
      );
      return {
        rows: state.events
          .filter((event) =>
            [
              event.account_id,
              event.user_profile_id,
              event.run_id,
              event.execution_id,
              event.classification_id,
            ].every((value, index) => value === p[index]),
          )
          .map((event) => ({
            event_id: event.event_id,
            phase: event.phase,
            detail: structuredClone(event.detail),
          })),
      };
    }
    if (sql.includes("INSERT INTO consultant_workflow_event")) {
      const event = {
        account_id: p[0],
        user_profile_id: p[1],
        run_id: p[2],
        execution_id: p[3],
        classification_id: p[4],
        phase: p[5],
        detail: JSON.parse(p[6]),
        event_id: "13",
      };
      state.events.push(event);
      state.writes.push("audit");
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO consultant_workflow_session")) {
      if (state.failSave) throw new Error("Synthetic persistence failure");
      assert.doesNotMatch(sql, /original_intake\s*=\s*EXCLUDED/);
      Object.assign(state.session, {
        current_state: p[4],
        draft_revision: JSON.parse(p[6]),
        approved_request_revision: p[7] ? JSON.parse(p[7]) : null,
        advisory_output: p[8] ? JSON.parse(p[8]) : null,
        deep_prompt_revision: p[10] ? JSON.parse(p[10]) : null,
        approvals: JSON.parse(p[11]),
        classification: JSON.parse(p[12]),
        execution_id: p[13],
        last_checkpoint: p[14],
        workflow_metadata: JSON.parse(p[17]),
      });
      state.writes.push("session");
      return { rows: [] };
    }
    assert.fail(`Unexpected SQL: ${sql}`);
  };
  return {
    state,
    args,
    payload,
    pool: {
      query,
      connect: async () => ({ query, release() {} }),
      end: async () => {},
    },
  };
}

test("MB-UX-QUALITY-002 L01 offline preview and derived execution preserve all original paid evidence and require human approval", async (t) => {
  const f = fixture(t);
  const original = structuredClone({
    session: f.state.session,
    snapshots: f.state.snapshots,
    draft: f.state.draft,
    events: f.state.events,
  });
  const preview = await recoverRetainedConsultantInterpretation(f.pool, f.args);
  assert.equal(preview.executed, false);
  assert.equal(preview.additional_provider_calls, 0);
  assert.equal(preview.requirement_count, 3);
  assert.deepEqual(f.state.writes, []);
  const result = await recoverRetainedConsultantInterpretation(f.pool, {
    ...f.args,
    execute: true,
    expected_recovery_hash: preview.recovery_hash,
  });
  assert.equal(result.executed, true);
  assert.notEqual(result.execution_id, f.args.source_execution_id);
  assert.deepEqual(f.state.events.slice(0, 3), original.events);
  assert.deepEqual(f.state.snapshots, original.snapshots);
  assert.deepEqual(f.state.draft, original.draft);
  assert.deepEqual(
    f.state.session.original_intake,
    original.session.original_intake,
  );
  for (const key of ["session_id", "account_id", "user_profile_id", "run_id"])
    assert.equal(f.state.session[key], original.session[key]);
  assert.equal(
    f.state.session.draft_revision.revision_id,
    original.session.draft_revision.revision_id,
  );
  assert.equal(
    f.state.session.classification.classification_id,
    f.args.classification_id,
  );
  assert.equal(f.state.session.current_state, "prep_step1_awaiting_approval");
  assert.equal(
    f.state.session.workflow_metadata.step1_interpretation.is_approved,
    false,
  );
  assert.deepEqual(f.state.session.approvals, []);
  assert.equal(f.state.session.approved_request_revision, null);
  assert.equal(f.state.session.advisory_output, null);
  assert.equal(f.state.session.deep_prompt_revision, null);
  const recovered =
    f.state.session.workflow_metadata.step1_interpretation
      .explicit_requirements;
  for (let i = 0; i < recovered.length; i++) {
    assert.equal(
      recovered[i].normalized_value,
      f.payload.explicit_requirements[i].normalized_value,
    );
    assert.equal(
      recovered[i].source_text_reference,
      i === 1
        ? f.args.corrections[0].replacement_reference
        : f.payload.explicit_requirements[i].source_text_reference,
    );
  }
  const audit = f.state.events[3].detail;
  assert.deepEqual(
    audit.original_failed_session,
    JSON.parse(JSON.stringify(original.session)),
  );
  assert.equal(
    audit.original_failed_session.created_at,
    original.session.created_at.toISOString(),
  );
  assert.equal(
    audit.original_failed_session.updated_at,
    original.session.updated_at.toISOString(),
  );
  assert.equal(audit.source_event_id, "11");
  assert.equal(audit.source_execution_id, f.args.source_execution_id);
  assert.notEqual(audit.before_payload_hash, audit.after_payload_hash);
  assert.equal(audit.additional_provider_calls, 0);
  assert.equal(audit.human_approval_required, true);
  assert.deepEqual(f.state.writes, ["audit", "session"]);
  await assert.rejects(
    recoverRetainedConsultantInterpretation(f.pool, {
      ...f.args,
      execute: true,
      expected_recovery_hash: preview.recovery_hash,
    }),
    { code: "MB-409-INTERPRETATION-RECOVERY" },
  );
});

test("MB-UX-QUALITY-002 L01 failed-session audit retains database-native microsecond timestamps and full JSON row", async (t) => {
  const f = fixture(t);
  f.state.databaseTimestamps = {
    created_at: "2026-01-01T00:00:00.123456+00:00",
    updated_at: "2026-01-01T00:01:00.987654+00:00",
  };
  f.state.session.created_at = new Date(f.state.databaseTimestamps.created_at);
  f.state.session.updated_at = new Date(f.state.databaseTimestamps.updated_at);
  f.state.session.invalidation_reason = null;
  const originalJson = {
    ...JSON.parse(JSON.stringify(f.state.session)),
    ...f.state.databaseTimestamps,
  };
  const preview = await recoverRetainedConsultantInterpretation(f.pool, f.args);
  const result = await recoverRetainedConsultantInterpretation(f.pool, {
    ...f.args,
    execute: true,
    expected_recovery_hash: preview.recovery_hash,
  });
  assert.equal(result.executed, true);
  const audit = f.state.events[3].detail;
  assert.deepEqual(audit.original_failed_session, originalJson);
  assert.equal(
    audit.original_failed_session.created_at,
    "2026-01-01T00:00:00.123456+00:00",
  );
  assert.equal(
    audit.original_failed_session.updated_at,
    "2026-01-01T00:01:00.987654+00:00",
  );
  assert.equal(audit.recovery_hash, preview.recovery_hash);
  assert.equal(
    audit.original_failed_session.original_failed_session,
    undefined,
  );
});

test("MB-UX-QUALITY-002 L01 reviewed preview binds changes below JavaScript Date precision", async (t) => {
  const f = fixture(t);
  f.state.databaseTimestamps.updated_at = "2026-01-01T00:00:00.123456+00:00";
  f.state.session.updated_at = new Date(f.state.databaseTimestamps.updated_at);
  const preview = await recoverRetainedConsultantInterpretation(f.pool, f.args);
  const decodedTimestamp = f.state.session.updated_at.getTime();
  f.state.databaseTimestamps.updated_at = "2026-01-01T00:00:00.123457+00:00";
  assert.equal(
    new Date(f.state.databaseTimestamps.updated_at).getTime(),
    decodedTimestamp,
  );
  const changed = await recoverRetainedConsultantInterpretation(f.pool, f.args);
  assert.notEqual(changed.recovery_hash, preview.recovery_hash);
  await assert.rejects(
    recoverRetainedConsultantInterpretation(f.pool, {
      ...f.args,
      execute: true,
      expected_recovery_hash: preview.recovery_hash,
    }),
    { code: "MB-409-INTERPRETATION-RECOVERY" },
  );
  assert.deepEqual(f.state.writes, []);
});

const invalid = {
  "unretainable audit reason": (f) => {
    f.args.reason = "Operator\0reason";
  },
  "approved interpretation metadata": (f) => {
    f.state.session.workflow_metadata.step1_interpretation = {
      is_approved: true,
    };
  },
  "wrong account": (f) => {
    f.args.account_id = randomUUID();
  },
  "wrong profile": (f) => {
    f.args.user_profile_id = randomUUID();
  },
  "wrong run": (f) => {
    f.args.run_id = randomUUID();
  },
  "stale execution": (f) => {
    f.args.source_execution_id = randomUUID();
  },
  "wrong classification": (f) => {
    f.args.classification_id = randomUUID();
  },
  "invalidated session": (f) => {
    f.state.session.is_invalidated = true;
  },
  "nonfailed state": (f) => {
    f.state.session.current_state = "prep_step1_awaiting_approval";
  },
  "wrong retry action": (f) => {
    f.state.session.workflow_metadata.retry_action = "prepare";
  },
  "prior approval": (f) => {
    f.state.session.approvals = [{ step: "step1" }];
  },
  "approved revision": (f) => {
    f.state.session.approved_request_revision = {};
  },
  "existing prompt": (f) => {
    f.state.session.deep_prompt_revision = {};
  },
  "active job": (f) => {
    f.state.downstream = [{ kind: "job" }];
  },
  "existing quote": (f) => {
    f.state.downstream = [{ kind: "round" }];
  },
  "changed intake": (f) => {
    f.state.session.original_intake.technical_compliance += " changed";
  },
  "wrong intake hash": (f) => {
    f.args.expected_intake_hash = "b".repeat(64);
  },
  "snapshot differs": (f) => {
    f.state.snapshots[0].technical_compliance += " changed";
  },
  "snapshot missing": (f) => {
    f.state.snapshots = [];
  },
  "draft rebound": (f) => {
    f.state.draft.snapshot_id = randomUUID();
  },
  "receipt missing": (f) => {
    f.args.source_event_id = "22";
  },
  "receipt owner differs": (f) => {
    f.state.events[1].user_profile_id = randomUUID();
  },
  "receipt not received": (f) => {
    f.state.events[1].detail.provider_receipt_received = false;
  },
  "unverified BYOK": (f) => {
    f.state.events[1].detail.is_byok = null;
  },
  "native web receipt": (f) => {
    f.state.events[1].detail.native_web = true;
  },
  "truncated receipt": (f) => {
    f.state.events[1].detail.response_truncated = true;
  },
  "started request missing": (f) => {
    f.state.events.splice(0, 1);
  },
  "request hash differs": (f) => {
    f.state.events[0].detail.request_hash = "b".repeat(64);
  },
  "wrong failure": (f) => {
    f.state.events[2].detail.code = "MB-422-LIVE-SCHEMA";
  },
  "already valid reference": (f) => {
    f.args.corrections[0] = {
      requirement_index: 0,
      source_box: "product_requirement",
      expected_reference: "Industrial mixer",
      replacement_reference: "Industrial",
    };
  },
  "replacement from other box": (f) => {
    f.args.corrections[0].replacement_reference = "Industrial mixer";
  },
  "changed source box": (f) => {
    f.args.corrections[0].source_box = "product_requirement";
  },
  "empty replacement": (f) => {
    f.args.corrections[0].replacement_reference = " ";
  },
  "out of range index": (f) => {
    f.args.corrections[0].requirement_index = 120;
  },
  "fractional index": (f) => {
    f.args.corrections[0].requirement_index = 1.5;
  },
  "duplicate corrections": (f) => {
    f.args.corrections.push({ ...f.args.corrections[0] });
  },
  "semantic edit": (f) => {
    f.args.corrections[0].normalized_value = "Different specification";
  },
};
for (const [name, mutate] of Object.entries(invalid))
  test(`MB-UX-QUALITY-002 L01 recovery rejects ${name}`, async (t) => {
    const f = fixture(t);
    mutate(f);
    await assert.rejects(
      recoverRetainedConsultantInterpretation(f.pool, f.args),
      { code: "MB-409-INTERPRETATION-RECOVERY" },
    );
    assert.deepEqual(f.state.writes, []);
  });

for (const [name, mutate, code] of [
  [
    "schema violation before correction",
    (p) => {
      p.explicit_requirements[1].comparison_operator = "invalid";
    },
    "MB-422-LIVE-SCHEMA",
  ],
  [
    "remaining bad source anchor",
    (p) => {
      p.explicit_requirements[2].source_text_reference = "Different source";
    },
    "MB-422-LIVE-LINEAGE",
  ],
  [
    "missing source box coverage",
    (p) => {
      p.explicit_requirements.pop();
    },
    "MB-422-LIVE-LINEAGE",
  ],
  [
    "non-English normalization",
    (p) => {
      p.explicit_requirements[1].normalized_value = "فولاد";
    },
    "MB-422-LIVE-TRANSLATION",
  ],
])
  test(`MB-UX-QUALITY-002 L01 recovery rejects ${name}`, async (t) => {
    const f = fixture(t);
    mutate(f.payload);
    f.state.events[1].detail.response_content = JSON.stringify(f.payload);
    await assert.rejects(
      recoverRetainedConsultantInterpretation(f.pool, f.args),
      { code },
    );
    assert.deepEqual(f.state.writes, []);
  });

test("MB-UX-QUALITY-002 L01 execute requires a fresh reviewed preview and rolls back failed persistence", async (t) => {
  const f = fixture(t);
  const preview = await recoverRetainedConsultantInterpretation(f.pool, f.args);
  await assert.rejects(
    recoverRetainedConsultantInterpretation(f.pool, {
      ...f.args,
      execute: true,
    }),
    { code: "MB-409-INTERPRETATION-RECOVERY" },
  );
  await assert.rejects(
    recoverRetainedConsultantInterpretation(f.pool, {
      ...f.args,
      reason: "Changed reason",
      execute: true,
      expected_recovery_hash: preview.recovery_hash,
    }),
    { code: "MB-409-INTERPRETATION-RECOVERY" },
  );
  f.state.failSave = true;
  await assert.rejects(
    recoverRetainedConsultantInterpretation(f.pool, {
      ...f.args,
      execute: true,
      expected_recovery_hash: preview.recovery_hash,
    }),
    /Synthetic persistence failure/,
  );
  assert.deepEqual(f.state.writes, []);
  assert.equal(f.state.events.length, 3);
  assert.equal(f.state.session.execution_id, f.args.source_execution_id);
  assert.equal(f.state.session.current_state, "workflow_failed");
});
