import {
  assertSearchDimensionIntentPreserved,
  compileSearchDimensionPlan,
  createSearchDimensionConfiguration,
  hashSearchDimensionConfiguration,
  parseSearchDimensionConfiguration,
  verifySearchDimensionPlan,
  type SearchDimensionConfiguration,
  type SearchDimensionOwnerScope,
  type SearchDimensionPlan,
} from "@matchbase/contracts";
import {
  inTransaction,
  listOwnedSearchDimensionDefinitions,
  lockSearchDimensionSession,
  saveOwnedSearchDimensionDefinitions,
  type ConnectionPool,
  type Queryable,
} from "@matchbase/data";
import { ApplicationFault } from "./types.js";
import {
  getOrRestoreWorkflowSession,
  type WorkflowSession,
} from "./consultant-v3-service.js";

// MB-SEARCH-DIMENSIONS-002 L01: server-owned selection and approval authority.
const editableStates = new Set([
  "prep_step1_awaiting_approval",
  "prep_step2_advisory_ready",
  "prep_step3_prompt_awaiting_approval",
]);
export function searchDimensionOwner(
  session: WorkflowSession,
): SearchDimensionOwnerScope {
  return {
    account_id: session.account_id,
    user_profile_id: session.user_profile_id,
  };
}
export function searchDimensionCategory(session: WorkflowSession): string {
  const classification = session.classification;
  return classification
    ? `${classification.scheme}:${classification.version}:${classification.code}`
    : `category:${session.step1_interpretation.product_category.normalize("NFKC").trim().toLowerCase().slice(0, 80)}`;
}
export function searchDimensionsEditable(session: WorkflowSession): boolean {
  return (
    editableStates.has(session.state) &&
    !session.step3_deep_prompt?.is_approved &&
    !session.round_number
  );
}
function buyerIntent(session: WorkflowSession): string {
  return [
    session.intake.product_requirement,
    session.intake.technical_compliance,
    session.intake.order_profile,
    session.approved_request_revision?.english_translation ??
      session.step1_interpretation.english_translation,
  ].join("\n\n");
}
export function freezeSearchDimensionPlan(
  session: WorkflowSession,
): SearchDimensionPlan | undefined {
  if (!session.search_dimensions) return undefined;
  const plan = compileSearchDimensionPlan(session.search_dimensions, {
    owner_scope: searchDimensionOwner(session),
    primary_classification_id: session.classification_id,
    original_buyer_intent: buyerIntent(session),
  });
  session.search_dimension_plan = plan;
  session.search_dimension_revision = hashSearchDimensionConfiguration(
    session.search_dimensions,
  );
  return plan;
}
export function assertSessionSearchDimensionPlan(
  session: WorkflowSession,
): void {
  if (!session.search_dimensions && !session.search_dimension_plan) return;
  const plan = session.search_dimension_plan;
  if (
    !plan ||
    !verifySearchDimensionPlan(plan) ||
    plan.owner_scope.account_id !== session.account_id ||
    plan.owner_scope.user_profile_id !== session.user_profile_id ||
    plan.primary_classification_id !== session.classification_id ||
    session.search_dimension_revision !==
      hashSearchDimensionConfiguration(plan.configuration) ||
    hashSearchDimensionConfiguration(session.search_dimensions!) !==
      session.search_dimension_revision
  ) {
    throw new ApplicationFault(
      409,
      "dimensions-stale",
      "MB-409-DIMENSIONS",
      "The research dimensions changed. Reload the saved request before approving or researching.",
    );
  }
}

/** Historical approved requests are never backfilled with a new catalogue. */
export async function hydrateSearchDimensions(
  db: Queryable,
  session: WorkflowSession,
): Promise<WorkflowSession> {
  session.search_dimensions_editable = searchDimensionsEditable(session);
  if (session.search_dimensions || !session.search_dimensions_editable)
    return session;
  let configuration = createSearchDimensionConfiguration({
    text: buyerIntent(session),
    owner_scope: searchDimensionOwner(session),
  });
  const custom = await listOwnedSearchDimensionDefinitions(db, {
    ...searchDimensionOwner(session),
    category_key: searchDimensionCategory(session),
  });
  // Reusable private questions retain their reviewed profile membership even
  // when current wording does not nominate that profile.
  configuration = createSearchDimensionConfiguration({
    profile_ids: [
      ...new Set([
        ...configuration.profile_ids,
        ...custom.flatMap((entry) => entry.profile_ids),
      ]),
    ],
  });
  configuration.custom_definitions = custom;
  configuration.selections.push(
    ...custom.map((definition) => ({
      selection_id: definition.id,
      dimension_id: definition.id,
      active: definition.default_active,
      severity: definition.default_severity,
      operator: "research" as const,
      scope: { lot_id: "default", subject_id: "request" },
    })),
  );
  session.search_dimensions = parseSearchDimensionConfiguration(
    configuration,
    searchDimensionOwner(session),
  );
  session.search_dimension_revision = null;
  return session;
}

export function assertSearchDimensionRevision(
  session: WorkflowSession,
  expected: unknown,
): void {
  if ((session.search_dimension_revision ?? null) !== expected)
    throw new ApplicationFault(
      409,
      "dimensions-stale",
      "MB-409-DIMENSIONS",
      "Search dimensions changed in another window. Reload the saved request before continuing.",
    );
}

export async function saveConsultantSearchDimensions(
  pool: ConnectionPool,
  input: {
    account_id: string;
    user_profile_id: string;
    run_id: string;
    expected_revision: unknown;
    configuration: unknown;
  },
): Promise<WorkflowSession> {
  return inTransaction(pool, async (db) => {
    await lockSearchDimensionSession(
      db,
      input.account_id,
      input.user_profile_id,
      input.run_id,
    );
    const session = await getOrRestoreWorkflowSession(
      db,
      input.account_id,
      input.run_id,
    );
    if (!session)
      throw new ApplicationFault(
        404,
        "dimensions-not-found",
        "MB-404-DIMENSIONS",
        "Research not found.",
      );
    assertSearchDimensionRevision(session, input.expected_revision);
    await hydrateSearchDimensions(db, session);
    let configuration: SearchDimensionConfiguration;
    try {
      if (
        !input.configuration ||
        typeof input.configuration !== "object" ||
        Array.isArray(input.configuration)
      )
        throw new Error("Invalid configuration");
      const candidate = input.configuration as Record<string, unknown>;
      // Owner claims in client payloads confer no authority.
      const custom = Array.isArray(candidate.custom_definitions)
        ? candidate.custom_definitions.map((entry) => ({
            ...(entry as Record<string, unknown>),
            owner_scope: searchDimensionOwner(session),
          }))
        : candidate.custom_definitions;
      configuration = parseSearchDimensionConfiguration(
        { ...candidate, custom_definitions: custom },
        searchDimensionOwner(session),
      );
      assertSearchDimensionIntentPreserved(
        session.search_dimensions!,
        configuration,
      );
      for (const prior of session.search_dimensions!.selections.filter(
        (entry) => entry.original_requirement || entry.severity === "mandatory",
      )) {
        const previousDefinition =
          session.search_dimensions!.custom_definitions.find(
            (entry) => entry.id === prior.dimension_id,
          );
        if (
          previousDefinition &&
          JSON.stringify(previousDefinition) !==
            JSON.stringify(
              configuration.custom_definitions.find(
                (entry) => entry.id === prior.dimension_id,
              ),
            )
        )
          throw new Error(
            "Explicit custom requirement definition cannot change through selection controls.",
          );
      }
      compileSearchDimensionPlan(configuration, {
        owner_scope: searchDimensionOwner(session),
        primary_classification_id: session.classification_id,
        original_buyer_intent: buyerIntent(session),
      });
    } catch {
      throw new ApplicationFault(
        422,
        "dimensions-invalid",
        "MB-422-DIMENSIONS",
        "Invalid dimensions or a change to an explicit requirement. Keep original requirements and use compatible values.",
      );
    }
    configuration.custom_definitions =
      await saveOwnedSearchDimensionDefinitions(
        db,
        {
          ...searchDimensionOwner(session),
          run_id: session.run_id,
          execution_id: session.execution_id,
          classification_id: session.classification_id,
          category_key: searchDimensionCategory(session),
        },
        configuration.custom_definitions,
      );
    session.search_dimensions = configuration;
    freezeSearchDimensionPlan(session);
    // Preserve the generated prompt; the compiler supplies dimension instructions at dispatch.
    if (session.step3_deep_prompt)
      session.research_prompt_version_id = crypto.randomUUID();
    await db.query(
      `UPDATE consultant_workflow_session SET workflow_metadata=workflow_metadata || $4::jsonb, updated_at=now() WHERE account_id=$1 AND user_profile_id=$2 AND run_id=$3`,
      [
        session.account_id,
        session.user_profile_id,
        session.run_id,
        JSON.stringify({
          search_dimensions: session.search_dimensions,
          search_dimension_plan: session.search_dimension_plan,
          search_dimension_revision: session.search_dimension_revision,
          research_prompt_version_id: session.research_prompt_version_id,
        }),
      ],
    );
    return session;
  });
}
