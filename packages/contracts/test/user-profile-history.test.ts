import assert from "node:assert/strict";
import test from "node:test";
import { parseUserProfileHistoryV1 } from "../src/v1/user-profile-history.js";
import { parseUserProfileHistoryV2 } from "../src/v1/user-profile-history-v2.js";

const history = {
  schema_version: "user-profile-history.v1",
  current_tier: "consultant",
  requests: [
    {
      request_id: "request-1",
      canonical_request_version: 2,
      canonical_summary: "Procure a governed product",
      lifecycle_state: "confirmed",
      created_at: "2026-08-31T00:00:00.000Z",
      updated_at: "2026-08-31T01:00:00.000Z",
      run_count: 2,
    },
  ],
  runs: [
    {
      run_id: "run-1",
      request_id: "request-1",
      canonical_request_version: 1,
      submitted_tier: "demo",
      state: "complete",
      outcome: "matched",
      queued_at: "2026-08-31T00:00:00.000Z",
      updated_at: "2026-08-31T00:05:00.000Z",
      result_available: true,
      result_projection: "demo",
      links: {
        request: "/api/v1/requests/request-1",
        run: "/api/v1/runs/run-1",
        result: "/api/v1/runs/run-1/result",
      },
    },
  ],
  page: { limit: 50, has_more: false, next_cursor: null },
};

test("accepts a historical Demo projection after an entitlement upgrade", () => {
  const parsed = parseUserProfileHistoryV1(history);
  assert.equal(parsed.current_tier, "consultant");
  assert.equal(parsed.runs[0]?.submitted_tier, "demo");
  assert.equal(parsed.runs[0]?.result_projection, "demo");
  assert.ok(Object.isFrozen(parsed));
});

test("rejects projection widening and unknown fields", () => {
  assert.throws(() =>
    parseUserProfileHistoryV1({
      ...history,
      runs: [{ ...history.runs[0], result_projection: "consultant" }],
    }),
  );
  assert.throws(() =>
    parseUserProfileHistoryV1({ ...history, hidden_evidence: [] }),
  );
  assert.throws(() =>
    parseUserProfileHistoryV1({
      ...history,
      page: { limit: 50, has_more: true, next_cursor: null },
    }),
  );
});

test("adds one closed server-owned product group without changing v1", () => {
  const parsed = parseUserProfileHistoryV2({
    ...history,
    schema_version: "user-profile-history.v2",
    requests: history.requests.map((request) => ({
      ...request,
      product_group: "Industrial controllers",
    })),
  });
  assert.equal(parsed.requests[0]?.product_group, "Industrial controllers");
  assert.equal(history.schema_version, "user-profile-history.v1");
  assert.throws(() =>
    parseUserProfileHistoryV2({
      ...history,
      schema_version: "user-profile-history.v2",
      requests: history.requests.map((request) => ({
        ...request,
        product_group: "",
      })),
    }),
  );
});

test("accepts an exactly run-bound released artifact descriptor and rejects drift", () => {
  const artifact = {
    run_id: "run-1",
    artifact_version_id: "artifact-version-1",
    version: 2,
    grant_id: "grant-1",
    href: "/api/v1/artifacts/grant-1/download",
  };
  assert.equal(
    parseUserProfileHistoryV1({
      ...history,
      runs: [{ ...history.runs[0], artifact_download: artifact }],
    }).runs[0]?.artifact_download?.run_id,
    "run-1",
  );
  assert.throws(() =>
    parseUserProfileHistoryV1({
      ...history,
      runs: [
        {
          ...history.runs[0],
          artifact_download: { ...artifact, run_id: "other-run" },
        },
      ],
    }),
  );
});
