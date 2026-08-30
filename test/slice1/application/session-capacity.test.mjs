import assert from "node:assert/strict";
import test from "node:test";

import { MatchBaseApplication } from "../../../packages/application/dist/index.js";

test("session capacity excludes released terminal leases", async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("FROM quota_ledger")) {
        return { rows: [{ used: 3, next_capacity_at: null }], rowCount: 1 };
      }
      if (sql.includes("FROM account")) {
        return { rows: [{ display_name: "Demo fixture" }], rowCount: 1 };
      }
      if (sql.includes("FROM execution_lease")) {
        assert.match(sql, /released_at IS NULL/u);
        return { rows: [{ active: 0 }], rowCount: 1 };
      }
      throw new Error("Unexpected session query.");
    },
  };
  const app = new MatchBaseApplication({
    pool,
    canonicalizer: {
      capabilityId: "CAP-TRANSLATE",
      canonicalize: async () => {
        throw new Error("Canonicalization must not run during session read.");
      },
    },
    privacyKey: new Uint8Array(32).fill(1),
  });

  const session = await app.me({
    accountId: "10000000-0000-4000-8000-000000000001",
    userId: "20000000-0000-4000-8000-000000000001",
    tier: "demo",
    adminSubRoles: [],
    correlationId: "capacity-regression",
    deploymentId: "capacity-regression",
  });

  assert.deepEqual(session.execution, { active: 0, capacity: 3 });
  assert.equal(queries.length, 3);
});
