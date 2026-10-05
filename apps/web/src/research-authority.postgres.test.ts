import { createHash, randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  approveResearchQuote,
  createPool,
  migrateUp,
  researchAuthorityHash,
  saveConsultantWorkflowSession,
  type ConnectionPool,
} from "@matchbase/data";
import {
  getOrRestoreWorkflowSession,
  markConsultantWorkflowFailed,
  researchRequestHash,
} from "@matchbase/application";

// Only HTTP session resolution and worker acceleration are replaced. Authority,
// owner checks, quote creation, transactions and durable queue admission are real.
const boundary = vi.hoisted(() => ({
  pool: null as ConnectionPool | null,
  context: {} as any,
  schedule: vi.fn(),
}));
vi.mock("./db-client", () => ({ getAppDatabasePool: () => boundary.pool }));
vi.mock("./fetch-runtime", () => ({
  resolveRequestSession: async () => boundary.context,
}));
vi.mock("./consultant-job-dispatch", () => ({
  scheduleConsultantWorkflowAcceleration: boundary.schedule,
}));
import { POST } from "../app/api/v1/consultant/research-rounds/route";

const database = process.env.MATCHBASE_CONSULTANT_TEST_DATABASE_URL;
const suite = database ? describe.sequential : describe.skip;
suite(
  "MB-UX-QUALITY-002 L06 real route-to-PostgreSQL research authority",
  () => {
    let pool: ConnectionPool;
    const accounts: string[] = [];
    beforeAll(async () => {
      pool = createPool({ connectionString: database, max: 8 });
      boundary.pool = pool;
      await migrateUp(pool);
    }, 30_000);
    beforeEach(() => {
      boundary.schedule.mockClear();
      vi.stubGlobal(
        "fetch",
        vi.fn(() => {
          throw new Error(
            "External provider access forbidden in authority regression",
          );
        }),
      );
    });
    afterEach(async () => {
      expect(fetch).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
      for (const account of accounts.splice(0)) {
        for (const table of [
          "consultant_workflow_event",
          "consultant_workflow_job",
          "consultant_workflow_session",
        ])
          await pool.query(`DELETE FROM ${table} WHERE account_id=$1`, [
            account,
          ]);
        await pool.query("DELETE FROM account WHERE account_id=$1", [account]);
      }
    });
    afterAll(async () => {
      await pool?.end();
    });
    async function fixture(dimensions = true, configuration = true) {
      const identity = {
        account_id: randomUUID(),
        user_profile_id: randomUUID(),
        run_id: randomUUID(),
        execution_id: randomUUID(),
        classification_id: randomUUID(),
      };
      accounts.push(identity.account_id);
      boundary.context = {
        accountId: identity.account_id,
        userId: identity.user_profile_id,
        tier: "consultant",
        adminSubRoles: [],
        correlationId: randomUUID(),
        deploymentId: "isolated-authority",
      };
      await pool.query(
        "INSERT INTO account(account_id,display_name,status) VALUES($1,'Synthetic authority regression','active')",
        [identity.account_id],
      );
      await saveConsultantWorkflowSession(pool, {
        ...identity,
        session_id: randomUUID(),
        current_state: "prep_step3_prompt_approved",
        original_intake: { product_requirement: "Industrial pumps" },
        approved_request_revision: {
          english_translation: "Industrial pumps",
          revision_id: randomUUID(),
          scope: { region: "A", quantity: 10 },
        },
        deep_prompt_revision: {
          prompt_text: "Find pumps",
          discovery_criteria: ["Approved requirement"],
          is_approved: true,
        },
        workflow_metadata: {
          mode: "demonstration",
          classification_id: identity.classification_id,
          ...(dimensions
            ? {
                ...(configuration
                  ? { search_dimensions: { version: "synthetic" } }
                  : {}),
                search_dimension_plan: {
                  regions: ["A", "B"],
                  nested: { longer_key: true, a: 1 },
                },
              }
            : {}),
        },
      });
      const request = async (body: Record<string, unknown>) =>
        POST(
          new Request("http://localhost/api/v1/consultant/research-rounds", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ run_id: identity.run_id, ...body }),
          }),
        );
      const quoted = await request({
        action: "quote",
        depth: "simple",
        research_tier: "ultra",
      });
      const quote = await quoted.json();
      expect(quoted.status, JSON.stringify(quote)).toBe(200);
      const read = async () =>
        (
          await pool.query(
            "SELECT * FROM consultant_workflow_session WHERE run_id=$1",
            [identity.run_id],
          )
        ).rows[0]!;
      const jobs = async () =>
        (
          await pool.query(
            "SELECT * FROM consultant_workflow_job WHERE run_id=$1",
            [identity.run_id],
          )
        ).rows;
      const approve = () =>
        request({ action: "approve", quote_id: quote.quote_id });
      return { identity, quote, request, read, jobs, approve };
    }
    async function legacyQuote(
      f: Awaited<ReturnType<typeof fixture>>,
      dropDimensions = false,
    ) {
      const row = await f.read();
      const hash = createHash("sha256")
        .update(
          JSON.stringify([
            row.approved_request_revision,
            row.deep_prompt_revision,
            ...(!dropDimensions && row.workflow_metadata.search_dimension_plan
              ? [row.workflow_metadata.search_dimension_plan]
              : []),
          ]),
        )
        .digest("hex");
      await pool.query(
        "UPDATE consultant_research_round SET plan=jsonb_set(plan,'{request_hash}',to_jsonb($2::text)) WHERE round_id=$1",
        [f.quote.quote_id, hash],
      );
      return hash;
    }
    it("unchanged dimensioned JSONB quote admits one durable job, parallel replay preserves the same four IDs and plan", async () => {
      const f = await fixture();
      expect(f.quote.plan.request_hash).toMatch(
        /^research-authority\.v2:[a-f0-9]{64}$/,
      );
      const row = await f.read();
      expect(
        researchAuthorityHash({
          approved_request_revision: Object.fromEntries(
            Object.entries(row.approved_request_revision).reverse(),
          ),
          deep_prompt_revision: Object.fromEntries(
            Object.entries(row.deep_prompt_revision).reverse(),
          ),
          search_dimension_plan: Object.fromEntries(
            Object.entries(
              row.workflow_metadata.search_dimension_plan,
            ).reverse(),
          ),
        }),
      ).toBe(f.quote.plan.request_hash);
      const before = (
        await pool.query(
          "SELECT plan FROM consultant_research_round WHERE round_id=$1",
          [f.quote.quote_id],
        )
      ).rows[0]!.plan;
      const [first, second] = await Promise.all([f.approve(), f.approve()]);
      expect([first.status, second.status]).toEqual([202, 202]);
      const a = await first.json(),
        b = await second.json();
      expect(a.execution_id).toBe(b.execution_id);
      expect(a.job.job_id).toBe(b.job.job_id);
      expect(a.replayed).not.toBe(b.replayed);
      const jobs = await f.jobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        account_id: f.identity.account_id,
        run_id: f.identity.run_id,
        user_profile_id: f.identity.user_profile_id,
        classification_id: f.identity.classification_id,
        execution_id: a.execution_id,
        status: "queued",
      });
      expect(
        (
          await pool.query(
            "SELECT plan FROM consultant_research_round WHERE round_id=$1",
            [f.quote.quote_id],
          )
        ).rows[0]!.plan,
      ).toEqual(before);
    });
    for (const configuration of [true, false])
      it(`R1 correction preserves approved dimensions and authority through failure persistence ${configuration ? "with" : "without"} editable configuration`, async () => {
        const f = await fixture(true, configuration);
        const before = await f.read();
        const restored = await getOrRestoreWorkflowSession(
          pool,
          f.identity.account_id,
          f.identity.run_id,
        );
        expect(restored).not.toBeNull();
        expect(restored!.search_dimension_plan).toEqual(
          before.workflow_metadata.search_dimension_plan,
        );
        expect(researchRequestHash(restored!)).toBe(f.quote.plan.request_hash);
        await markConsultantWorkflowFailed(
          pool,
          f.identity.run_id,
          "research",
          new Error("Synthetic checkpoint failure"),
        );
        const after = await f.read();
        expect(after.current_state).toBe("workflow_failed");
        expect(after.workflow_metadata.search_dimension_plan).toEqual(
          before.workflow_metadata.search_dimension_plan,
        );
        expect(after.workflow_metadata.search_dimensions).toEqual(
          before.workflow_metadata.search_dimensions,
        );
        expect(after.workflow_metadata.search_dimension_revision).toEqual(
          before.workflow_metadata.search_dimension_revision,
        );
        for (const field of [
          "approved_request_revision",
          "deep_prompt_revision",
          "approvals",
          "execution_id",
          "classification",
          "user_profile_id",
          "run_id",
        ])
          expect(after[field]).toEqual(before[field]);
        expect(
          researchAuthorityHash({
            approved_request_revision: after.approved_request_revision,
            deep_prompt_revision: after.deep_prompt_revision,
            search_dimension_plan:
              after.workflow_metadata.search_dimension_plan,
          }),
        ).toBe(f.quote.plan.request_hash);
        expect(
          (
            await pool.query(
              "SELECT plan FROM consultant_research_round WHERE round_id=$1",
              [f.quote.quote_id],
            )
          ).rows[0]!.plan,
        ).toEqual(f.quote.plan);
        expect(await f.jobs()).toHaveLength(0);
      });
    for (const dimensions of [true, false])
      it(`retained legacy ${dimensions ? "three" : "two"}-field quote accepts a canonical current caller without rewriting the legacy plan`, async () => {
        const f = await fixture(dimensions);
        const retainedHash = await legacyQuote(f);
        expect((await f.approve()).status).toBe(202);
        expect(
          (
            await pool.query(
              "SELECT plan FROM consultant_research_round WHERE round_id=$1",
              [f.quote.quote_id],
            )
          ).rows[0]!.plan.request_hash,
        ).toBe(retainedHash);
        expect(await f.jobs()).toHaveLength(1);
      });
    it("retained approved dimensions bind authority even when their editable configuration is absent", async () => {
      const f = await fixture(true, false);
      expect((await f.approve()).status).toBe(202);
      expect(await f.jobs()).toHaveLength(1);
    });
    it("a dimension change committed while approval waits for the session lock rejects stale caller authority", async () => {
      const f = await fixture();
      const writer = await pool.connect();
      let pending: Promise<Response> | undefined;
      try {
        await writer.query("BEGIN");
        await writer.query(
          "SELECT run_id FROM consultant_workflow_session WHERE run_id=$1 FOR UPDATE",
          [f.identity.run_id],
        );
        pending = f.approve();
        await vi.waitFor(async () => {
          const waiting = await pool.query(
            "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%FOR UPDATE%'",
          );
          expect(waiting.rows[0]!.count).toBeGreaterThan(0);
        });
        await writer.query(
          "UPDATE consultant_workflow_session SET workflow_metadata=jsonb_set(workflow_metadata,'{search_dimension_plan,regions}','[\"C\"]'::jsonb) WHERE run_id=$1",
          [f.identity.run_id],
        );
        await writer.query("COMMIT");
        expect((await pending).status).toBe(409);
        expect(await f.jobs()).toHaveLength(0);
      } finally {
        await writer.query("ROLLBACK");
        writer.release();
        await pending;
      }
    });
    it("legacy two-field quote cannot authorize a current dimensioned request", async () => {
      const f = await fixture();
      await legacyQuote(f, true);
      expect((await f.approve()).status).toBe(409);
      expect(await f.jobs()).toHaveLength(0);
    });
    for (const field of [
      "approved_request_revision",
      "deep_prompt_revision",
      "dimensions",
    ])
      it(`rejects a genuine ${field} change against transaction-locked authority`, async () => {
        const f = await fixture();
        if (field === "dimensions")
          await pool.query(
            "UPDATE consultant_workflow_session SET workflow_metadata=jsonb_set(workflow_metadata,'{search_dimension_plan,regions}','[\"C\"]'::jsonb) WHERE run_id=$1",
            [f.identity.run_id],
          );
        else
          await pool.query(
            `UPDATE consultant_workflow_session SET ${field}=${field} || '{"authority_changed":true}'::jsonb WHERE run_id=$1`,
            [f.identity.run_id],
          );
        expect((await f.approve()).status).toBe(409);
        expect(await f.jobs()).toHaveLength(0);
      });
    it("rejects an expired quote, foreign identity and a stale canonical caller without queue admission", async () => {
      const f = await fixture();
      boundary.context = { ...boundary.context, userId: randomUUID() };
      expect((await f.approve()).status).toBe(404);
      boundary.context = {
        ...boundary.context,
        userId: f.identity.user_profile_id,
      };
      await expect(
        approveResearchQuote(
          pool,
          f.identity.account_id,
          f.identity.user_profile_id,
          f.identity.run_id,
          f.quote.quote_id,
          "research-authority.v2:" + "0".repeat(64),
        ),
      ).rejects.toMatchObject({ code: "MB-409-ROUND-APPROVAL" });
      await pool.query(
        "UPDATE consultant_research_round SET plan=jsonb_set(plan,'{expires_at}','\"2000-01-01T00:00:00Z\"'::jsonb) WHERE round_id=$1",
        [f.quote.quote_id],
      );
      expect((await f.approve()).status).toBe(409);
      expect(await f.jobs()).toHaveLength(0);
    });
  },
);
