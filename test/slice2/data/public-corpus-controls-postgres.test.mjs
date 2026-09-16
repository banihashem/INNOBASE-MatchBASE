import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createPool, migrateUp } from "../../../packages/data/dist/index.js";
import {
  nominatePublicSource,
  authorizePublicCatalogueAcquisition,
  acquirePublicCatalogueEvidence,
  releasePublicCatalogueEvidence,
  lookupReleasedPublicEvidence,
  registerPublicEvidenceDerivative,
  isPublicEvidenceDerivativeEligible,
  withdrawPublicEvidence,
  beginPublicCorpusRestore,
  reconcilePublicCorpusTombstones,
  publicCorpusReadiness,
  qualifiedPublicCorpusReaderReady,
  loadReleasedPublicEvidenceReferences,
} from "../../../packages/data/dist/consultant-public-corpus.js";
import {
  provisionPublicCorpusRoles,
  reconcilePublicCorpusRoles,
} from "../../../packages/data/dist/public-corpus-administration.js";

const anchor = process.env.MATCHBASE_DISPOSABLE_TEST_DATABASE_URL;
const dbTest = anchor ? test : test.skip;
const date = (days = 0) => new Date(Date.now() + days * 86400000).toISOString();
const classification = { scheme: "HS", code: "281520", version: "2022" };
function withSyntheticUserInfo(url) {
  const value = new URL(url);
  value.username = "synthetic-fixture";
  value.password = "synthetic-fixture";
  return value.href;
}

test("public nominations retain only the origin and never authorize acquisition", () => {
  assert.deepEqual(
    nominatePublicSource(
      "https://supplier.com/private-buyer/orders?secret=buyer#intent",
    ),
    {
      origin: "https://supplier.com",
      acquisition_authorized: false,
      release_authorized: false,
    },
  );
  for (const url of [
    withSyntheticUserInfo("https://supplier.com/a"),
    "http://supplier.com",
    "https://127.0.0.1",
    "https://supplier.local",
    "https://supplier.internal",
    "https://supplier.localdomain",
    "https://supplier.home.arpa",
    "https://supplier.onion",
    "https://supplier",
    "https://0.0.0.0",
    "https://[::1]",
    "https://2130706433",
    "https://0x7f000001",
    "https://0177.0.0.1",
    "https://supplier.com:443",
    "https://supplier.com:5000",
  ])
    assert.equal(nominatePublicSource(url), null);
});

dbTest(
  "public catalogue roles, release and withdrawal operate in a disposable database",
  async (t) => {
    const suffix = randomUUID().replaceAll("-", "");
    const dbName = `matchbase_public_${suffix}`;
    const prefix = `mbpub_${suffix.slice(0, 12)}`;
    const admin = createPool({ connectionString: anchor, max: 4 });
    const child = new URL(anchor);
    child.pathname = `/${dbName}`;
    let db;
    const clients = [];
    const createdRoles = [];
    t.after(async () => {
      for (const c of clients) {
        await c.query("RESET SESSION AUTHORIZATION");
        c.release();
      }
      if (db) await db.end();
      // Pool shutdown can resolve before PostgreSQL has observed every socket close.
      // Wait for this owned database to drain instead of killing closing clients.
      let remaining = 1;
      for (let attempt = 0; attempt < 80 && remaining > 0; attempt += 1) {
        const result = await admin.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1",
          [dbName],
        );
        remaining = result.rows[0].count;
        if (remaining > 0) await delay(25);
      }
      assert.equal(remaining, 0, "Owned public-corpus test clients must close");
      await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
      for (const role of createdRoles.reverse())
        await admin.query(`DROP ROLE IF EXISTS ${role}`);
      await admin.end();
    });
    await admin.query(`CREATE DATABASE ${dbName}`);
    db = createPool({ connectionString: child.toString(), max: 10 });
    await migrateUp(db);
    const roles = await provisionPublicCorpusRoles(db, prefix);
    createdRoles.push(...Object.values(roles));
    const accounts = [randomUUID(), randomUUID()];
    async function actor(name, capability, accountIndex = 0) {
      const role = `${prefix}_${name}`;
      const profile = randomUUID();
      createdRoles.push(role);
      await db.query(
        `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT IN ROLE ${roles[capability]}`,
      );
      await db.query(
        "INSERT INTO matchbase_public.principal VALUES($1,$2,$3,$4,'qualification-fixture-binding',true)",
        [role, accounts[accountIndex], profile, capability],
      );
      const c = await db.connect();
      clients.push(c);
      await c.query(`SET SESSION AUTHORIZATION ${role}`);
      return { client: c, role, profile, account: accounts[accountIndex] };
    }
    const acquirer = await actor("acq", "acquirer");
    const releaser = await actor("rel", "releaser");
    const first = await actor("one", "reader");
    const second = await actor("two", "reader", 1);
    const query = (client) =>
      lookupReleasedPublicEvidence(client, classification, "potassium");
    let authority;
    let observation;
    let derivative;
    const evidence = {
      source_url: "https://supplier.com/catalogue",
      source_assertion_sha256: "a".repeat(64),
      published_at: date(-1),
      retrieved_at: date(-0.01),
      valid_until: date(5),
      claim_kind: "product_capability",
      claim_text: "Supplier catalogue lists potassium hydroxide.",
      classification_scheme: "HS",
      classification_code: "281520",
      classification_version: "2022",
      rights_basis: "explicit_redistribution_license",
      rights_reference: "https://supplier.com/licence",
    };

    await t.test(
      "capability reconciliation is idempotent and owns every upgraded function",
      async () => {
        assert.deepEqual(await reconcilePublicCorpusRoles(db, prefix), roles);
        const owners = await db.query(
          `SELECT DISTINCT r.rolname AS owner FROM pg_proc p
           JOIN pg_namespace n ON n.oid=p.pronamespace
           JOIN pg_roles r ON r.oid=p.proowner
           WHERE n.nspname='matchbase_public'`,
        );
        assert.deepEqual(owners.rows, [{ owner: roles.owner }]);
      },
    );

    await t.test(
      "default runtime is disabled and unqualified DB owners cannot impersonate public readers",
      async () => {
        assert.deepEqual(await publicCorpusReadiness(db), {
          shared_access_enabled: false,
          database_principal_non_bypass: false,
          reason: "verified_identity_adapter_not_qualified",
        });
        assert.equal(
          (await publicCorpusReadiness(first.client)).shared_access_enabled,
          false,
        );
        await assert.rejects(query(db), /not authorized/);
        await assert.rejects(query(first.client), /tombstone reconciliation/);
        await reconcilePublicCorpusTombstones(releaser.client, 0, []);
        assert.equal(
          await qualifiedPublicCorpusReaderReady(first.client, {
            account_id: first.account,
            user_profile_id: first.profile,
          }),
          true,
        );
        assert.equal(
          await qualifiedPublicCorpusReaderReady(first.client, {
            account_id: first.account,
            user_profile_id: second.profile,
          }),
          false,
        );
      },
    );
    await t.test(
      "SQL grants isolate private tables, role administration, pending data and caller identities",
      async () => {
        for (const actor of [acquirer, releaser, first, second]) {
          await assert.rejects(
            actor.client.query(
              "SELECT * FROM public.consultant_private_observation",
            ),
            /permission denied/,
          );
          await assert.rejects(
            actor.client.query(`GRANT ${roles.releaser} TO ${actor.role}`),
            /permission denied|admin option/,
          );
          await assert.rejects(
            actor.client.query(`SET ROLE ${roles.owner}`),
            /permission denied/,
          );
          await assert.rejects(
            actor.client.query(
              "UPDATE matchbase_public.principal SET capability='releaser'",
            ),
            /permission denied/,
          );
        }
        await db.query(
          `GRANT SELECT ON matchbase_public.observation,matchbase_public.derivative TO ${roles.reader}`,
        );
        assert.deepEqual(
          (
            await first.client.query(
              "SELECT * FROM matchbase_public.observation",
            )
          ).rows,
          [],
        );
      },
    );
    await t.test(
      "nomination cannot authorize acquisition and private URL context is rejected by SQL",
      async () => {
        await assert.rejects(
          authorizePublicCatalogueAcquisition(acquirer.client, {
            catalogue_job_id: randomUUID(),
            source_url: evidence.source_url,
            expires_at: date(1),
            max_observations: 2,
            explicit_manual_unpaid_approval: true,
          }),
          /permission denied/,
        );
        for (const source_url of [
          "https://supplier.com/catalogue?buyer=private",
          "https://supplier.com/private%2Fbuyer",
          "https://127.0.0.1/catalogue",
          "https://0.0.0.0/catalogue",
          "https://8.8.8.8/catalogue",
          "https://2130706433/catalogue",
          "https://0x7f000001/catalogue",
          "https://0177.0.0.1/catalogue",
          "https://[::1]/catalogue",
          "https://[2001:db8::1]/catalogue",
          "https://supplier.internal/catalogue",
          "https://supplier.localdomain/catalogue",
          "https://supplier.home.arpa/catalogue",
          "https://supplier.onion/catalogue",
          "https://supplier/catalogue",
          "https://-supplier.com/catalogue",
          "https://supplier..com/catalogue",
          "https://supplier.com:443/catalogue",
          "https://supplier.com:5000/catalogue",
          withSyntheticUserInfo("https://supplier.com/catalogue"),
          "https://supplier.com/catalogue#private",
        ])
          await assert.rejects(
            authorizePublicCatalogueAcquisition(releaser.client, {
              catalogue_job_id: randomUUID(),
              source_url,
              expires_at: date(1),
              max_observations: 2,
              explicit_manual_unpaid_approval: true,
            }),
            /authority is invalid/,
          );
        await assert.rejects(
          authorizePublicCatalogueAcquisition(releaser.client, {
            catalogue_job_id: randomUUID(),
            source_url: evidence.source_url,
            expires_at: date(1),
            max_observations: 2,
            explicit_manual_unpaid_approval: false,
          }),
          /authority is invalid/,
        );
        authority = await authorizePublicCatalogueAcquisition(releaser.client, {
          catalogue_job_id: randomUUID(),
          source_url: evidence.source_url,
          expires_at: date(1),
          max_observations: 2,
          explicit_manual_unpaid_approval: true,
        });
        await assert.rejects(
          acquirePublicCatalogueEvidence(acquirer.client, authority, {
            ...evidence,
            private_request: "buyer demand",
          }),
          /Only independently sourced/,
        );
        await assert.rejects(
          acquirePublicCatalogueEvidence(acquirer.client, authority, {
            ...evidence,
            claim_kind: "public_price",
            published_at: null,
          }),
          /freshness/,
        );
        observation = await acquirePublicCatalogueEvidence(
          acquirer.client,
          authority,
          evidence,
        );
        await acquirePublicCatalogueEvidence(acquirer.client, authority, {
          ...evidence,
          source_assertion_sha256: "c".repeat(64),
          claim_text: "Unreleased catalogue potassium observation",
        });
        const lineage = (
          await db.query(
            "SELECT acquisition_profile_id,acquisition_run_id,acquisition_execution_id,classification_id FROM matchbase_public.observation WHERE observation_id=$1",
            [observation],
          )
        ).rows[0];
        assert.equal(
          Object.values(lineage).every((value) =>
            /^[0-9a-f-]{36}$/u.test(value),
          ),
          true,
        );
        assert.deepEqual(await query(first.client), []);
      },
    );
    await t.test(
      "only a distinct release capability publishes source provenance without private lineage",
      async () => {
        const ref = { observation_id: observation, rights_epoch: 1 };
        await assert.rejects(
          releasePublicCatalogueEvidence(
            acquirer.client,
            ref,
            "review-fixture",
          ),
          /permission denied/,
        );
        await db.query(`GRANT ${roles.releaser} TO ${acquirer.role}`);
        await assert.rejects(
          releasePublicCatalogueEvidence(
            acquirer.client,
            ref,
            "review-fixture",
          ),
          /not authorized/,
        );
        await releasePublicCatalogueEvidence(
          releaser.client,
          ref,
          "Independent licence and public catalogue review fixture",
        );
        const rows = await query(first.client);
        assert.equal(rows.length, 1);
        assert.equal(
          (await loadReleasedPublicEvidenceReferences(first.client, [ref]))
            .length,
          1,
        );
        assert.equal(rows[0].claim_text, evidence.claim_text);
        for (const key of [
          "account_id",
          "profile_id",
          "authority_id",
          "acquired_by",
          "private_request",
          "run_id",
        ])
          assert.equal(Object.hasOwn(rows[0], key), false);
        assert.equal(
          (
            await lookupReleasedPublicEvidence(
              first.client,
              { ...classification, code: "other" },
              "potassium",
            )
          ).length,
          0,
        );
        assert.equal((await query(second.client)).length, 1);
        assert.deepEqual(
          (
            await first.client.query(
              "SELECT * FROM matchbase_public.observation",
            )
          ).rows,
          [],
        );
        derivative = await registerPublicEvidenceDerivative(first.client, {
          kind: "report",
          artifact_reference: "owned-report-fixture",
          dependencies: [ref],
        });
        assert.equal(
          await isPublicEvidenceDerivativeEligible(first.client, derivative),
          true,
        );
        assert.equal(
          await isPublicEvidenceDerivativeEligible(second.client, derivative),
          false,
        );
        assert.deepEqual(
          (
            await second.client.query(
              "SELECT * FROM matchbase_public.derivative",
            )
          ).rows,
          [],
        );
      },
    );
    await t.test(
      "publication locks current rights and withdrawal invalidates every derivative kind",
      async () => {
        for (const kind of ["use_manifest", "cache", "index", "summary"])
          await registerPublicEvidenceDerivative(first.client, {
            kind,
            artifact_reference: `${kind}-fixture`,
            dependencies: [{ observation_id: observation, rights_epoch: 1 }],
          });
        await first.client.query("BEGIN");
        assert.equal(
          await isPublicEvidenceDerivativeEligible(first.client, derivative),
          true,
        );
        await releaser.client.query("SET lock_timeout='100ms'");
        await assert.rejects(
          withdrawPublicEvidence(
            releaser.client,
            observation,
            "rights_withdrawn",
          ),
          (e) => e.code === "55P03",
        );
        await first.client.query("COMMIT");
        await releaser.client.query("RESET lock_timeout");
        await assert.rejects(
          withdrawPublicEvidence(
            releaser.client,
            observation,
            "invalid_reason",
          ),
          /check constraint/,
        );
        assert.equal(
          await withdrawPublicEvidence(
            releaser.client,
            observation,
            "rights_withdrawn",
          ),
          2,
        );
        assert.deepEqual(await query(first.client), []);
        assert.equal(
          await isPublicEvidenceDerivativeEligible(first.client, derivative),
          false,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM matchbase_public.derivative WHERE valid",
            )
          ).rows[0].n,
          0,
        );
        await assert.rejects(
          registerPublicEvidenceDerivative(first.client, {
            kind: "cache",
            artifact_reference: "stale",
            dependencies: [{ observation_id: observation, rights_epoch: 1 }],
          }),
          /no longer eligible/,
        );
        assert.equal(
          (
            await db.query(
              "SELECT claim_text FROM matchbase_public.observation WHERE observation_id=$1",
              [observation],
            )
          ).rows[0].claim_text,
          "[withdrawn]",
        );
        await assert.rejects(
          acquirePublicCatalogueEvidence(acquirer.client, authority, {
            ...evidence,
            source_assertion_sha256: "b".repeat(64),
          }),
          /Source rights were withdrawn/,
        );
      },
    );
    await t.test(
      "restore closes serving and requires complete external tombstones before reopening",
      async () => {
        await beginPublicCorpusRestore(releaser.client);
        await db.query(
          "UPDATE matchbase_public.observation SET state='released',rights_epoch=1,claim_text='Old backup potassium claim' WHERE observation_id=$1",
          [observation],
        );
        await db.query("UPDATE matchbase_public.derivative SET valid=true");
        await assert.rejects(query(first.client), /tombstone reconciliation/);
        await assert.rejects(
          reconcilePublicCorpusTombstones(releaser.client, 2, []),
          /Complete externally retained/,
        );
        const tombstones = (
          await db.query(
            "SELECT sequence::int,observation_id,source_url,rights_epoch,reason_code FROM matchbase_public.tombstone ORDER BY sequence",
          )
        ).rows;
        assert.deepEqual(
          tombstones.map((t) => t.sequence),
          [1, 2],
        );
        await assert.rejects(
          reconcilePublicCorpusTombstones(
            releaser.client,
            2,
            tombstones.map((t) => ({ ...t, rights_epoch: 3 })),
          ),
          /conflicts/,
        );
        await reconcilePublicCorpusTombstones(releaser.client, 2, tombstones);
        assert.deepEqual(await query(first.client), []);
        assert.equal(
          await isPublicEvidenceDerivativeEligible(first.client, derivative),
          false,
        );
        assert.equal(
          (
            await db.query(
              "SELECT rights_epoch FROM matchbase_public.observation WHERE observation_id=$1",
              [observation],
            )
          ).rows[0].rights_epoch,
          2,
        );
      },
    );
    await t.test(
      "different restored assertion tombstones invalidate the entire source and every admission path",
      async () => {
        const source_url = "https://supplier.com/restored-catalogue";
        const approval = await authorizePublicCatalogueAcquisition(
          releaser.client,
          {
            catalogue_job_id: randomUUID(),
            source_url,
            expires_at: date(1),
            max_observations: 2,
            explicit_manual_unpaid_approval: true,
          },
        );
        const surviving = await acquirePublicCatalogueEvidence(
          acquirer.client,
          approval,
          { ...evidence, source_url },
        );
        const pending = await acquirePublicCatalogueEvidence(
          acquirer.client,
          approval,
          { ...evidence, source_url, source_assertion_sha256: "d".repeat(64) },
        );
        const ref = { observation_id: surviving, rights_epoch: 1 };
        await releasePublicCatalogueEvidence(
          releaser.client,
          ref,
          "Independent restored source fixture review",
        );
        const report = await registerPublicEvidenceDerivative(first.client, {
          kind: "report",
          artifact_reference: "surviving-restored-report",
          dependencies: [ref],
        });
        assert.equal(
          (await query(first.client)).some(
            (row) => row.observation_id === surviving,
          ),
          true,
        );
        assert.equal(
          await isPublicEvidenceDerivativeEligible(first.client, report),
          true,
        );
        // A legacy/restored stale observation cannot override its current source epoch.
        await db.query(
          "UPDATE matchbase_public.source SET rights_epoch=2 WHERE source_url=$1",
          [source_url],
        );
        assert.equal(
          (await query(first.client)).some(
            (row) => row.observation_id === surviving,
          ),
          false,
        );
        assert.equal(
          await isPublicEvidenceDerivativeEligible(first.client, report),
          false,
        );
        await assert.rejects(
          registerPublicEvidenceDerivative(first.client, {
            kind: "cache",
            artifact_reference: "stale-source-epoch",
            dependencies: [ref],
          }),
          /no longer eligible/,
        );
        await assert.rejects(
          releasePublicCatalogueEvidence(
            releaser.client,
            { observation_id: pending, rights_epoch: 1 },
            "Pending stale source release",
          ),
          /not authorized/,
        );
        await db.query(
          "UPDATE matchbase_public.source SET rights_epoch=1 WHERE source_url=$1",
          [source_url],
        );
        await beginPublicCorpusRestore(releaser.client);
        await assert.rejects(
          releasePublicCatalogueEvidence(
            releaser.client,
            { observation_id: pending, rights_epoch: 1 },
            "Release while restored serving is closed",
          ),
          /tombstone reconciliation/,
        );
        const absentObservation = randomUUID();
        await reconcilePublicCorpusTombstones(releaser.client, 3, [
          {
            sequence: 3,
            observation_id: absentObservation,
            source_url,
            rights_epoch: 2,
            reason_code: "rights_withdrawn",
          },
        ]);
        assert.equal(
          (await query(first.client)).some(
            (row) => row.observation_id === surviving,
          ),
          false,
        );
        assert.equal(
          await isPublicEvidenceDerivativeEligible(first.client, report),
          false,
        );
        await assert.rejects(
          registerPublicEvidenceDerivative(first.client, {
            kind: "cache",
            artifact_reference: "withdrawn-source",
            dependencies: [ref],
          }),
          /no longer eligible/,
        );
        await assert.rejects(
          releasePublicCatalogueEvidence(
            releaser.client,
            { observation_id: pending, rights_epoch: 1 },
            "Pending withdrawn source release",
          ),
          /not authorized/,
        );
        const rows = (
          await db.query(
            "SELECT state,rights_epoch,claim_text FROM matchbase_public.observation WHERE source_url=$1",
            [source_url],
          )
        ).rows;
        assert.equal(rows.length, 2);
        assert.equal(
          rows.every(
            (row) =>
              row.state === "withdrawn" &&
              row.rights_epoch === 2 &&
              row.claim_text === "[withdrawn]",
          ),
          true,
        );
        assert.equal(
          (
            await db.query(
              "SELECT valid FROM matchbase_public.derivative WHERE derivative_id=$1",
              [report],
            )
          ).rows[0].valid,
          false,
        );
      },
    );
    await t.test(
      "legacy internal authority and source rows cannot bypass acquisition or publication guards",
      async () => {
        const publicUrl = "https://supplier.com/legacy-catalogue";
        const invalidUrl = "https://supplier.internal/catalogue";
        const approval = await authorizePublicCatalogueAcquisition(
          releaser.client,
          {
            catalogue_job_id: randomUUID(),
            source_url: publicUrl,
            expires_at: date(1),
            max_observations: 2,
            explicit_manual_unpaid_approval: true,
          },
        );
        const pending = await acquirePublicCatalogueEvidence(
          acquirer.client,
          approval,
          { ...evidence, source_url: publicUrl },
        );
        // Administrative fixture mutation models records admitted by an older policy; no caller can perform it.
        await db.query(
          "UPDATE matchbase_public.authority SET source_url=$1 WHERE authority_id=$2",
          [invalidUrl, approval],
        );
        await assert.rejects(
          acquirePublicCatalogueEvidence(acquirer.client, approval, {
            ...evidence,
            source_url: invalidUrl,
            source_assertion_sha256: "e".repeat(64),
          }),
          /Current independent acquisition authority/,
        );
        await db.query(
          "INSERT INTO matchbase_public.source(source_url) VALUES($1)",
          [invalidUrl],
        );
        await db.query(
          "UPDATE matchbase_public.observation SET source_url=$1 WHERE observation_id=$2",
          [invalidUrl, pending],
        );
        await assert.rejects(
          releasePublicCatalogueEvidence(
            releaser.client,
            { observation_id: pending, rights_epoch: 1 },
            "Legacy internal origin release review",
          ),
          /not authorized/,
        );
        await db.query(
          "UPDATE matchbase_public.observation SET state='released' WHERE observation_id=$1",
          [pending],
        );
        assert.equal(
          (await query(first.client)).some(
            (row) => row.observation_id === pending,
          ),
          false,
        );
        await assert.rejects(
          registerPublicEvidenceDerivative(first.client, {
            kind: "cache",
            artifact_reference: "legacy-internal-origin",
            dependencies: [{ observation_id: pending, rights_epoch: 1 }],
          }),
          /no longer eligible/,
        );
      },
    );
  },
);
