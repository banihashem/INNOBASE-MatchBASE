import { randomUUID } from "node:crypto";
import {
  bindPublicCorpusReader,
  createPool,
  provisionPublicCorpusRoles,
  reconcilePublicCorpusRoles,
} from "../packages/data/dist/index.js";

const connectionString = process.env.MATCHBASE_DATABASE_URL?.trim();
const databaseRole = process.env.MATCHBASE_PUBLIC_READER_ROLE?.trim();
const databasePassword =
  process.env.MATCHBASE_PUBLIC_READER_DATABASE_PASSWORD?.trim();
const accountId = process.env.MATCHBASE_PUBLIC_READER_ACCOUNT_ID?.trim();
const profileId = process.env.MATCHBASE_PUBLIC_READER_PROFILE_ID?.trim();
const reference =
  process.env.MATCHBASE_PUBLIC_READER_IDENTITY_REFERENCE?.trim();
if (
  !connectionString ||
  !databaseRole ||
  !databasePassword ||
  !accountId ||
  !profileId ||
  !reference
)
  throw new Error(
    "Public reader provisioning requires the database URL, reader role/password, account/profile IDs and verified identity reference.",
  );
if (
  !/^[a-z][a-z0-9_]{2,62}$/u.test(databaseRole) ||
  !/^[A-Za-z0-9_-]{32,128}$/u.test(databasePassword)
)
  throw new Error("Public reader role or generated password is invalid.");

const pool = createPool({ connectionString, max: 3 });
const capabilityPrefix = "matchbase_public";
const capabilities = {
  owner: `${capabilityPrefix}_owner`,
  reader: `${capabilityPrefix}_reader`,
  acquirer: `${capabilityPrefix}_acquirer`,
  releaser: `${capabilityPrefix}_releaser`,
};
let bootstrapRole;
async function cleanupBootstrap() {
  if (!bootstrapRole) return;
  await pool.query(
    "DELETE FROM matchbase_public.principal WHERE database_role=$1",
    [bootstrapRole],
  );
  await pool.query(`DROP ROLE IF EXISTS ${bootstrapRole}`);
  bootstrapRole = undefined;
}
try {
  const existing = await pool.query(
    "SELECT rolname FROM pg_roles WHERE rolname=ANY($1::name[])",
    [Object.values(capabilities)],
  );
  if (existing.rows.length === 0)
    await provisionPublicCorpusRoles(pool, capabilityPrefix);
  else if (existing.rows.length !== Object.keys(capabilities).length)
    throw new Error(
      "Public corpus capability roles are only partially provisioned.",
    );
  else await reconcilePublicCorpusRoles(pool, capabilityPrefix);

  const login = await pool.query(
    "SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=$1",
    [databaseRole],
  );
  if (!login.rows[0])
    await pool.query(
      `CREATE ROLE ${databaseRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD '${databasePassword}'`,
    );
  else if (
    !login.rows[0].rolcanlogin ||
    login.rows[0].rolsuper ||
    login.rows[0].rolbypassrls ||
    login.rows[0].rolcreaterole
  )
    throw new Error("Existing public reader login role is unsafe.");
  else
    await pool.query(
      `ALTER ROLE ${databaseRole} PASSWORD '${databasePassword}'`,
    );

  await bindPublicCorpusReader(pool, {
    database_role: databaseRole,
    reader_capability_role: capabilities.reader,
    account_id: accountId,
    profile_id: profileId,
    verified_identity_reference: reference,
  });

  const restored = await pool.query(
    "SELECT restore_ready FROM matchbase_public.control WHERE singleton",
  );
  if (!restored.rows[0]?.restore_ready) {
    const bootstrap = `mbpub_bootstrap_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
    bootstrapRole = bootstrap;
    await pool.query(
      `CREATE ROLE ${bootstrap} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT IN ROLE ${capabilities.releaser}`,
    );
    await pool.query(
      "INSERT INTO matchbase_public.principal(database_role,account_id,profile_id,capability,verified_identity_reference,enabled) VALUES($1,$2,$3,'releaser',$4,true)",
      [bootstrap, accountId, profileId, `${reference}:bootstrap`],
    );
    const client = await pool.connect();
    let authorized = false;
    try {
      await client.query(`SET SESSION AUTHORIZATION ${bootstrap}`);
      authorized = true;
      await client.query(
        "SELECT matchbase_public.reconcile_tombstones(0,'[]'::jsonb)",
      );
    } finally {
      if (authorized) await client.query("RESET SESSION AUTHORIZATION");
      client.release();
    }
    await cleanupBootstrap();
  }
  process.stdout.write("public-reader:provisioned\n");
} finally {
  await cleanupBootstrap();
  await pool.end();
}
