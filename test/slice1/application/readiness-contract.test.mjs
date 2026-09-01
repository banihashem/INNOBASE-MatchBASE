import assert from "node:assert/strict";
import test from "node:test";

import {
  MatchBaseApplication,
  StandardWorkspaceApplication,
} from "../../../packages/application/dist/index.js";
import { MIGRATIONS } from "../../../packages/data/dist/index.js";

const privacyKey = Buffer.alloc(32, 7);
const canonicalizer = {
  async canonicalize() {
    throw new Error("not invoked by readiness");
  },
};

function migrationPool(ids) {
  return {
    async query(text) {
      if (text.includes("to_regclass")) return { rows: [{ present: true }] };
      if (text.includes("SELECT migration_id"))
        return { rows: ids.map((migration_id) => ({ migration_id })) };
      throw new Error(`Unexpected readiness query: ${text}`);
    },
  };
}

function applications(pool, researchAdmission) {
  return [
    new MatchBaseApplication({
      pool,
      privacyKey,
      canonicalizer,
      researchAdmission,
    }),
    new StandardWorkspaceApplication({
      pool,
      privacyKey,
      researchAdmission,
    }),
  ];
}

test("application readiness requires the complete ordered 0001-0011 migration registry", async () => {
  const allIds = MIGRATIONS.map(({ id }) => id);
  for (const app of applications(migrationPool(allIds)))
    assert.equal(await app.readiness(), true);
  for (const app of applications(migrationPool(allIds.slice(0, -1))))
    assert.equal(await app.readiness(), false);
  for (const app of applications(migrationPool([...allIds, "9999_unknown"])))
    assert.equal(await app.readiness(), false);
});

test("application readiness closes when server-owned live admission is not current", async () => {
  const allIds = MIGRATIONS.map(({ id }) => id);
  const blockedAdmission = {
    isReady: () => false,
    decide: () => ({
      id: "synthetic_reference",
      label: "Synthetic reference",
      liveQualified: false,
    }),
  };
  for (const app of applications(migrationPool(allIds), blockedAdmission))
    assert.equal(await app.readiness(), false);
});
