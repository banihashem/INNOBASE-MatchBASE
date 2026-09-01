import assert from "node:assert/strict";
import test from "node:test";

import {
  StandardWorkspaceApplication,
  standardDisclosureProjectionRegistryRelease,
} from "../../../packages/application/dist/index.js";

const accountId = "00000000-0000-4000-8000-000000000101";
const userId = "00000000-0000-4000-8000-000000000102";
const requestId = "00000000-0000-4000-8000-000000000103";
const projectionVersionId = "00000000-0000-4000-8000-000000000104";

const adminContext = {
  accountId,
  userId,
  tier: "admin",
  adminSubRoles: ["super_admin"],
  correlationId: "admin-request-history-compatibility",
  deploymentId: "test",
};

function repository({
  document,
  runRows = [],
  storedTier = "admin",
  storedSuperAdmin = true,
}) {
  const calls = [];
  const release = standardDisclosureProjectionRegistryRelease();
  const query = async (text, values = []) => {
    calls.push({ text, values });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/u.test(text))
      return { rows: [], rowCount: 0 };
    if (text.includes("FROM entitlement_grant eg"))
      return {
        rows: [{ tier: storedTier, is_super_admin: storedSuperAdmin }],
        rowCount: 1,
      };
    if (
      text.includes("FROM sourcing_request r JOIN canonical_request_version v")
    )
      return {
        rows: [
          {
            request_id: requestId,
            created_at: new Date("2026-08-31T10:00:00.000Z"),
            updated_at: new Date("2026-08-31T10:01:00.000Z"),
            current_version: 1,
            canonical_document: document,
            latest_state: null,
            latest_outcome: null,
          },
        ],
        rowCount: 1,
      };
    if (text.includes("SELECT rr.run_id,v.request_id,v.version"))
      return { rows: runRows, rowCount: runRows.length };
    if (text.includes("INSERT INTO projection_version"))
      return { rows: [], rowCount: 1 };
    if (text.includes("FROM projection_version WHERE version=$1"))
      return {
        rows: [
          {
            projection_version_id: projectionVersionId,
            definition: JSON.parse(release.definition),
            content_sha256: release.contentSha256,
          },
        ],
        rowCount: 1,
      };
    if (
      text.includes("INSERT INTO projection_serving") ||
      text.includes("INSERT INTO audit_event")
    )
      return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected query: ${text}`);
  };
  return {
    calls,
    application: new StandardWorkspaceApplication({
      pool: {
        query,
        connect: async () => ({ query, release() {} }),
        end: async () => undefined,
      },
      privacyKey: Buffer.alloc(32, 7),
    }),
  };
}

test("Super-admin request history reads immutable Demo canonical rows and records a constrained projection", async () => {
  const fixture = repository({
    document: {
      schema_version: "canonical-request.v1",
      canonical_text: "Historical Demo canonical request",
      fields: [
        {
          fieldId: "need",
          valueState: "provided",
          canonicalValue: "Industrial filtration equipment",
        },
        {
          fieldId: "mandatory_constraints",
          valueState: "provided",
          canonicalValue: "Delivery through Dubai",
        },
        {
          fieldId: "preferences_context",
          valueState: "explicitly_unknown",
          canonicalValue: "Unknown",
        },
      ],
    },
  });

  const history = await fixture.application.listRequests(adminContext);

  assert.equal(history.items[0].request_id, requestId);
  assert.equal(
    history.items[0].canonical_summary,
    "need: Industrial filtration equipment; mandatory_constraints: Delivery through Dubai",
  );
  const serving = fixture.calls.find((call) =>
    call.text.includes("INSERT INTO projection_serving"),
  );
  assert.ok(serving);
  assert.equal(serving.values[9], requestId);
  assert.equal(serving.values[10], null);
});

test("current Standard request summaries retain the closed structured field reader", async () => {
  const fixture = repository({
    storedTier: "standard",
    storedSuperAdmin: false,
    document: {
      schema_version: "structured-standard-request.v1",
      fields: [
        {
          field_id: "component",
          typed_value: { value_state: "provided", value: "MX900" },
        },
        {
          field_id: "quantity",
          typed_value: { value_state: "provided", value: "45" },
        },
      ],
    },
  });

  const history = await fixture.application.listRequests(
    { ...adminContext, tier: "standard", adminSubRoles: [] },
    undefined,
    "",
    "all",
    false,
  );

  assert.equal(
    history.items[0].canonical_summary,
    "component: MX900; quantity: 45",
  );
});

test("historical terminal live failures are selected as failed and excluded from active runs", async () => {
  const fixture = repository({
    storedTier: "standard",
    storedSuperAdmin: false,
    document: { schema_version: "structured-standard-request.v1", fields: [] },
    runRows: [
      {
        run_id: "00000000-0000-4000-8000-000000000105",
        request_id: requestId,
        version: 1,
        state: "failed",
        queued_at: new Date("2026-09-01T00:00:00.000Z"),
        started_at: new Date("2026-09-01T00:01:00.000Z"),
        completed_at: new Date("2026-09-01T00:02:00.000Z"),
        eligible_count: null,
        tier_at_submission: "standard",
        research_mode: "qualified_live_research",
      },
    ],
  });
  const history = await fixture.application.listRuns(
    { ...adminContext, tier: "standard", adminSubRoles: [] },
    "",
    undefined,
    "failed",
    false,
  );
  assert.equal(history.items[0].state, "failed");
  assert.equal(history.items[0].terminal, true);
  assert.equal(history.items[0].outcome, "failed");
  assert.equal("poll_after_ms" in history.items[0], false);
  const read = fixture.calls.find((call) =>
    call.text.includes("SELECT rr.run_id,v.request_id,v.version"),
  );
  assert.match(read.text, /LEFT JOIN live_research_terminal/iu);
  assert.match(read.text, /lt\.live_research_terminal_id IS NULL/iu);
  assert.match(read.text, /lt\.live_research_terminal_id IS NOT NULL/iu);
});

test("a claimed Super-admin session without the stored grant remains denied", async () => {
  const fixture = repository({
    storedSuperAdmin: false,
    document: { schema_version: "canonical-request.v1", fields: [] },
  });

  await assert.rejects(
    fixture.application.listRequests(adminContext, undefined, "", "all", false),
    (error) => error.status === 403 && error.code === "MB-403-STANDARD",
  );
  assert.equal(
    fixture.calls.some((call) =>
      call.text.includes(
        "FROM sourcing_request r JOIN canonical_request_version v",
      ),
    ),
    false,
  );
});
