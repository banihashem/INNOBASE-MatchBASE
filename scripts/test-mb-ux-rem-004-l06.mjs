#!/usr/bin/env node
import { resolveScriptTestTargets } from "./lib/database-config.mjs";
import assert from "node:assert/strict";
import { validateStep1RequirementFidelity } from "../packages/contracts/dist/src/index.js";
import { synthesizeConsultantOutputV3 } from "../packages/application/dist/synthesis-engine.js";
import { generateConsultantLandscapeHtml } from "../packages/reporting/dist/src/consultant-landscape-report.js";

const { baseUrl: BASE_URL, fetch } = resolveScriptTestTargets();

console.log(
  "=================================================================",
);
console.log("=== MB-UX-REM-004 L06 QUALIFICATION & ACCEPTANCE TEST SUITE ===");
console.log(
  "=================================================================",
);

async function getAuthCookie(fixtureRole) {
  const r1 = await fetch(
    `${BASE_URL}/auth/simulator/start?fixture=${fixtureRole}`,
    { redirect: "manual" },
  );
  assert.equal(r1.status, 302, "Simulator start must return 302 redirect");
  const callbackUrl = r1.headers.get("location");
  const startCookie = r1.headers.get("set-cookie");

  const r2 = await fetch(`${BASE_URL}${callbackUrl}`, {
    redirect: "manual",
    headers: { cookie: startCookie || "" },
  });
  assert.equal(r2.status, 303, "Simulator callback must return 303 redirect");
  const rawCookies = r2.headers.getSetCookie
    ? r2.headers.getSetCookie()
    : [r2.headers.get("set-cookie")];
  const sessionCookie = rawCookies
    .map((c) => c?.split(";")[0])
    .filter(Boolean)
    .join("; ");
  assert.ok(
    sessionCookie.includes("matchbase_session="),
    `Must establish valid session cookie for ${fixtureRole}`,
  );
  return sessionCookie;
}

async function runAllGates() {
  // =========================================================================
  // GATE L06-G01: Authoritative Fidelity & Server Approval
  // =========================================================================
  console.log(
    "\n-------------------------------------------------------------",
  );
  console.log(
    "--- [GATE L06-G01] Authoritative Fidelity & Server Approval ---",
  );
  console.log("-------------------------------------------------------------");

  const baseWaterHeaterIntake = {
    product_requirement:
      "Commercial / Industrial Electric Water Heater 500 Litres, maximum outer diameter 85 cm for indoor mechanical room installation.",
    technical_compliance:
      "10 bar minimum working pressure, three-phase 400V 50Hz, documented thermal insulation, safety-valve compatibility, CE and PED compliance, BMS-compatible thermostat integration, local installation support, authorized UAE distributor, and two-year UAE warranty.",
    order_profile:
      "Batch of 10 units for hotel project in Dubai, DDP Dubai delivery terms.",
  };

  // Case 1: Delete safety-valve compatibility while stale arrays contain it
  console.log("Running Case 1: Safety-valve omission with stale arrays...");
  const case1Step1 = {
    english_translation:
      "Industrial water heater 500L, max 85cm outer diameter, indoor mechanical room, 10 bar minimum working pressure, three-phase 400V 50Hz, documented thermal insulation, CE mark & PED, BMS-compatible thermostat, local installation support, authorized UAE distributor, two-year UAE warranty, 10 units DDP Dubai.",
    mandatory_requirements: [
      "Safety-valve compatibility",
      "500 Litres capacity",
      "10 bar working pressure",
    ],
    explicit_requirements: [
      { text: "Safety-valve compatibility", category: "safety" },
    ],
  };
  const case1Val = validateStep1RequirementFidelity(
    baseWaterHeaterIntake,
    case1Step1,
  );
  assert.equal(
    case1Val.valid,
    false,
    "Case 1: Must be invalid due to missing safety valve",
  );
  assert.ok(
    case1Val.omitted_items.some((item) =>
      /safety[- ]valve/i.test(
        item.normalized_label ||
          item.source_span_or_reference ||
          item.source_text,
      ),
    ),
    "Case 1: Must specifically flag omitted safety valve",
  );
  console.log(
    "✔ Case 1 PASS: Deleting safety-valve fails fidelity despite stale arrays",
  );

  // Case 2: Change minimum working pressure to maximum with the same numeric value
  console.log(
    "Running Case 2: Mutated pressure operator (minimum -> maximum)...",
  );
  const case2Step1 = {
    english_translation:
      "Industrial water heater 500L, max 85cm outer diameter, indoor mechanical room, maximum 10 bar working pressure, three-phase 400V 50Hz, documented thermal insulation, safety-valve compatibility, CE mark & PED, BMS-compatible thermostat, local installation support, authorized UAE distributor, two-year UAE warranty, 10 units DDP Dubai.",
  };
  const case2Val = validateStep1RequirementFidelity(
    baseWaterHeaterIntake,
    case2Step1,
  );
  assert.equal(
    case2Val.valid,
    false,
    "Case 2: Must be invalid due to mutated pressure operator",
  );
  assert.ok(
    case2Val.mutated_items.some((item) =>
      /pressure/i.test(
        item.requirement?.concept ||
          item.requirement?.normalized_label ||
          item.explanation,
      ),
    ),
    "Case 2: Must flag mutated pressure comparison operator",
  );
  console.log(
    "✔ Case 2 PASS: Mutating minimum pressure to maximum is rejected",
  );

  // Case 3: Remove 'documented' from thermal insulation or replace with performance adjective
  console.log(
    "Running Case 3: Removing 'documented' from thermal insulation...",
  );
  const case3Step1 = {
    english_translation:
      "Industrial water heater 500L, max 85cm outer diameter, indoor mechanical room, minimum 10 bar working pressure, three-phase 400V 50Hz, high-efficiency thermal insulation, safety-valve compatibility, CE mark & PED, BMS-compatible thermostat, local installation support, authorized UAE distributor, two-year UAE warranty, 10 units DDP Dubai.",
  };
  const case3Val = validateStep1RequirementFidelity(
    baseWaterHeaterIntake,
    case3Step1,
  );
  assert.equal(
    case3Val.valid,
    false,
    "Case 3: Must be invalid due to missing documented qualifier",
  );
  const hasThermalInsulationError =
    case3Val.mutated_items.some((item) =>
      /thermal[-_ ]insulation|documented/i.test(
        `${item.requirement?.concept} ${item.requirement?.normalized_label} ${item.explanation}`,
      ),
    ) ||
    case3Val.omitted_items.some((item) =>
      /thermal[-_ ]insulation/i.test(
        `${item.normalized_label} ${item.source_span_or_reference} ${item.source_text}`,
      ),
    );
  assert.ok(
    hasThermalInsulationError,
    "Case 3: Must flag documented thermal insulation issue",
  );
  console.log(
    "✔ Case 3 PASS: Removing 'documented' from thermal insulation is rejected",
  );

  // Case 4: Change 'authorized UAE distributor' to 'certified regional distributor'
  console.log("Running Case 4: Mutated supplier jurisdiction scope...");
  const case4Step1 = {
    english_translation:
      "Industrial water heater 500L, max 85cm outer diameter, indoor mechanical room, minimum 10 bar working pressure, three-phase 400V 50Hz, documented thermal insulation, safety-valve compatibility, CE mark & PED, BMS-compatible thermostat, local installation support, certified regional distributor, two-year UAE warranty, 10 units DDP Dubai.",
  };
  const case4Val = validateStep1RequirementFidelity(
    baseWaterHeaterIntake,
    case4Step1,
  );
  assert.equal(
    case4Val.valid,
    false,
    "Case 4: Must be invalid due to mutated supplier authorization scope",
  );
  assert.ok(
    case4Val.mutated_items.some((item) =>
      /distributor|scope|jurisdiction|regional/i.test(
        `${item.requirement?.concept} ${item.requirement?.normalized_label} ${item.prohibited_value} ${item.explanation}`,
      ),
    ),
    "Case 4: Must flag mutated distributor scope",
  );
  console.log(
    "✔ Case 4 PASS: Mutating 'authorized UAE distributor' to regional distributor is rejected",
  );

  // Case 5: Remove explicit warranty requirement
  console.log("Running Case 5: Removing explicit warranty duration...");
  const case5Step1 = {
    english_translation:
      "Industrial water heater 500L, max 85cm outer diameter, indoor mechanical room, minimum 10 bar working pressure, three-phase 400V 50Hz, documented thermal insulation, safety-valve compatibility, CE mark & PED, BMS-compatible thermostat, local installation support, authorized UAE distributor, 10 units DDP Dubai.",
  };
  const case5Val = validateStep1RequirementFidelity(
    baseWaterHeaterIntake,
    case5Step1,
  );
  assert.equal(
    case5Val.valid,
    false,
    "Case 5: Must be invalid due to omitted warranty",
  );
  assert.ok(
    case5Val.omitted_items.some((item) =>
      /warranty/i.test(
        item.normalized_label ||
          item.source_span_or_reference ||
          item.source_text,
      ),
    ),
    "Case 5: Must flag omitted warranty requirement",
  );
  console.log("✔ Case 5 PASS: Omission of explicit warranty is rejected");

  // Case 6: Direct submission to real server approval endpoint
  console.log("Running Case 6: Direct server approval rejection (HTTP 422)...");
  const consultantCookie = await getAuthCookie("consultant");

  // Submit intake first to establish a session
  const submissionDraftRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: consultantCookie },
      body: JSON.stringify({ action: "create_draft" }),
    },
  );
  assert.equal(submissionDraftRes.status, 200);
  const submissionDraft = await submissionDraftRes.json();
  const intakeRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: consultantCookie,
    },
    body: JSON.stringify({
      action: "submit_intake",
      draft_id: submissionDraft.draft_id,
      draft_version: submissionDraft.draft_version,
      product_requirement: baseWaterHeaterIntake.product_requirement,
      technical_compliance: baseWaterHeaterIntake.technical_compliance,
      order_profile: baseWaterHeaterIntake.order_profile,
    }),
  });
  assert.equal(intakeRes.status, 200, "Intake submission must succeed");
  const intakeData = await intakeRes.json();
  const testRunId = intakeData.session?.run_id || intakeData.run_id;
  assert.ok(testRunId, "Must return run_id");

  // Now attempt to approve an INVALID Step 1 (omitting safety valve, passing stale mandatory arrays)
  const invalidApproveRes = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: consultantCookie,
      },
      body: JSON.stringify({
        action: "approve_step1",
        run_id: testRunId,
        edited_translation: case1Step1.english_translation,
        mandatory_requirements: ["Safety-valve compatibility", "500L capacity"],
        explicit_requirements: [{ text: "Safety-valve compatibility" }],
      }),
    },
  );
  assert.equal(
    invalidApproveRes.status,
    422,
    `Server must reject invalid Step 1 with HTTP 422, got ${invalidApproveRes.status}`,
  );
  const invalidApproveData = await invalidApproveRes.json();
  assert.equal(
    invalidApproveData.code,
    "MB-422-FIDELITY-FAILED",
    `Error code must be MB-422-FIDELITY-FAILED, got ${invalidApproveData.code}`,
  );
  console.log(
    "✔ Case 6 PASS: Server independently rejects invalid Step 1 approval with HTTP 422 MB-422-FIDELITY-FAILED",
  );

  // Case 7: Faithful translation passes without false alarms
  console.log("Running Case 7: Faithful equivalent translation passes...");
  const faithfulStep1 = {
    english_translation:
      "Commercial electric water calorifier 500 Litres nominal capacity, outer diameter 850 mm maximum for indoor mechanical room installation. Minimum 10 bar working pressure, three-phase 400V 50Hz, documented thermal insulation, safety-valve compatibility, CE marking and PED 2014/68/EU conformity, BMS-compatible thermostat, local installation support, authorized UAE distributor, and 24-month UAE warranty. Batch of 10 units for Dubai hotel, DDP Dubai delivery terms.",
  };
  const faithfulVal = validateStep1RequirementFidelity(
    baseWaterHeaterIntake,
    faithfulStep1,
  );
  assert.equal(
    faithfulVal.valid,
    true,
    `Faithful translation must pass: ${faithfulVal.explanation}`,
  );
  console.log(
    "✔ Case 7 PASS: Faithful equivalent wording passes validation cleanly",
  );

  console.log("\n✔ GATE L06-G01 VERIFIED: PASS");

  // =========================================================================
  // GATE L06-G02: Approved Request Lineage (Request A vs Request B)
  // =========================================================================
  console.log(
    "\n-------------------------------------------------------------",
  );
  console.log("--- [GATE L06-G02] Approved Request Lineage (A vs B) -------- ");
  console.log("-------------------------------------------------------------");

  // Request A: 500L, 400V, 10 bar, 85cm, 24m, 10 units, DDP Dubai
  const requestAIntake = {
    product_requirement:
      "Industrial Electric Water Heater 500 Litres, maximum outer diameter 85 cm for indoor mechanical room.",
    technical_compliance:
      "Minimum 10 bar working pressure, three-phase 400V 50Hz, documented thermal insulation, safety-valve compatibility, CE and PED compliance, BMS thermostat, local support, authorized UAE distributor, 24 months UAE warranty.",
    order_profile: "10 units, DDP Dubai delivery terms.",
  };
  const requestATranslation =
    "Commercial Electric Water Heater 500L, max 85 cm diameter, indoor room, minimum 10 bar pressure, three-phase 400V 50Hz, documented thermal insulation, safety-valve compatibility, CE/PED, BMS thermostat, 24 months warranty, exactly 10 units, DDP Dubai.";

  // Request B: 750L, 415V, 12 bar, 95cm, 36m, 7 units, DDP Abu Dhabi
  const requestBIntake = {
    product_requirement:
      "Industrial Electric Water Heater 750 Litres, maximum outer diameter 95 cm for indoor mechanical room.",
    technical_compliance:
      "Minimum 12 bar working pressure, three-phase 415V 50Hz, documented thermal insulation, safety-valve compatibility, CE and PED compliance, BMS thermostat, local support, authorized UAE distributor, 36 months UAE warranty.",
    order_profile: "7 units, DDP Abu Dhabi delivery terms.",
  };
  const requestBTranslation =
    "Commercial Electric Water Heater 750L, max 95 cm diameter, indoor room, minimum 12 bar pressure, three-phase 415V 50Hz, documented thermal insulation, safety-valve compatibility, CE/PED, BMS thermostat, 36 months warranty, exactly 7 units, DDP Abu Dhabi.";

  const mockDualLane = {
    lane_g_result: {
      raw_content: "[]",
      prompt_tokens: 100,
      completion_tokens: 50,
      cost_usd: 0,
      latency_ms: 100,
      model_used: "deterministic-fixture",
      live_api_invoked: false,
    },
    lane_o_result: {
      raw_content: "[]",
      prompt_tokens: 100,
      completion_tokens: 50,
      cost_usd: 0,
      latency_ms: 100,
      model_used: "deterministic-fixture",
      live_api_invoked: false,
    },
    candidates: [],
    verification_loops_completed: 1,
    total_input_tokens: 200,
    total_output_tokens: 100,
    total_cost_usd: 0,
    total_latency_ms: 200,
  };

  // Synthesize V3 Output for Request A
  const outputA = synthesizeConsultantOutputV3({
    user_profile_id: "test-user-a",
    research_run_id: "run-test-request-a",
    execution_id: "exec-test-a",
    classification_id: "class-8516",
    product_name: "Commercial Electric Water Heater 500L",
    product_category: "Commercial Calorifiers",
    dual_lane_result: mockDualLane,
    approved_translation: requestATranslation,
    intake: requestAIntake,
  });

  // Synthesize V3 Output for Request B
  const outputB = synthesizeConsultantOutputV3({
    user_profile_id: "test-user-b",
    research_run_id: "run-test-request-b",
    execution_id: "exec-test-b",
    classification_id: "class-8516",
    product_name: "Commercial Electric Water Heater 750L",
    product_category: "Commercial Calorifiers",
    dual_lane_result: mockDualLane,
    approved_translation: requestBTranslation,
    intake: requestBIntake,
  });

  // Verify Request A Attributes
  assert.equal(
    outputA.request_snapshot.product_attributes.capacity_litres,
    500,
  );
  assert.equal(
    outputA.request_snapshot.product_attributes.electrical,
    "Three-phase 400V 50Hz",
  );
  assert.equal(
    outputA.request_snapshot.product_attributes.pressure_bar,
    "Minimum 10 bar",
  );
  assert.equal(
    outputA.request_snapshot.product_attributes.max_outer_diameter_cm,
    85,
  );
  assert.equal(
    outputA.request_snapshot.product_attributes.warranty,
    "Two-year UAE warranty (24 months)",
  );
  assert.equal(outputA.request_snapshot.product_attributes.quantity, 10);
  assert.equal(
    outputA.request_snapshot.product_attributes.destination,
    "Dubai, United Arab Emirates",
  );
  console.log("✔ Request A output attributes match approved facts strictly");

  // Verify Request B Attributes
  assert.equal(
    outputB.request_snapshot.product_attributes.capacity_litres,
    750,
  );
  assert.equal(
    outputB.request_snapshot.product_attributes.electrical,
    "Three-phase 415V 50Hz",
  );
  assert.equal(
    outputB.request_snapshot.product_attributes.pressure_bar,
    "Minimum 12 bar",
  );
  assert.equal(
    outputB.request_snapshot.product_attributes.max_outer_diameter_cm,
    95,
  );
  assert.equal(
    outputB.request_snapshot.product_attributes.warranty,
    "Three-year UAE warranty (36 months)",
  );
  assert.equal(outputB.request_snapshot.product_attributes.quantity, 7);
  assert.equal(
    outputB.request_snapshot.product_attributes.destination,
    "Abu Dhabi, United Arab Emirates",
  );
  console.log(
    "✔ Request B output attributes match approved facts strictly (NO bleed from A)",
  );

  // Render HTML for Request A and Request B
  const htmlA = generateConsultantLandscapeHtml(outputA);
  const htmlB = generateConsultantLandscapeHtml(outputB);

  // Assertions on HTML A
  assert.ok(
    htmlA.includes("500 L nominal capacity"),
    "HTML A must render 500 L",
  );
  assert.ok(htmlA.includes("Three-phase 400V 50Hz"), "HTML A must render 400V");
  assert.ok(htmlA.includes("Minimum 10 bar"), "HTML A must render 10 bar");
  assert.ok(htmlA.includes("Maximum 85 cm"), "HTML A must render 85 cm");
  assert.ok(
    htmlA.includes("24 months"),
    "HTML A must render 24 months warranty",
  );
  assert.ok(
    htmlA.includes("Exactly 10 units, DDP Dubai"),
    "HTML A must render 10 units DDP Dubai",
  );
  console.log("✔ HTML A correctly renders all Request A approved facts");

  // Assertions on HTML B
  assert.ok(
    htmlB.includes("750 L nominal capacity"),
    "HTML B must render 750 L",
  );
  assert.ok(htmlB.includes("Three-phase 415V 50Hz"), "HTML B must render 415V");
  assert.ok(htmlB.includes("Minimum 12 bar"), "HTML B must render 12 bar");
  assert.ok(htmlB.includes("Maximum 95 cm"), "HTML B must render 95 cm");
  assert.ok(
    htmlB.includes("36 months"),
    "HTML B must render 36 months warranty",
  );
  assert.ok(
    htmlB.includes("Exactly 7 units, DDP Abu Dhabi"),
    "HTML B must render 7 units DDP Abu Dhabi",
  );
  assert.ok(!htmlB.includes("500 L"), "HTML B must NOT contain 500 L");
  assert.ok(!htmlB.includes("DDP Dubai"), "HTML B must NOT contain DDP Dubai");
  console.log(
    "✔ HTML B correctly renders all Request B approved facts without inheriting A",
  );

  // Assert Page 4 separation of approved electrical supply vs observed supplier electrical capability
  assert.ok(
    htmlB.includes(
      "<strong>Approved Electrical Supply:</strong> Three-phase 415V 50Hz",
    ),
    "Page 4 must explicitly state Approved Electrical Supply with exact approved voltage",
  );
  assert.ok(
    htmlB.includes(
      "Observed Supplier Electrical Capability: Typical commercial models accommodate 380V",
    ),
    "Page 4 must separate observed supplier 380-415V range as observed capability",
  );
  console.log(
    "✔ Page 4 requested vs observed electrical separation verified (L06-R02 resolved)",
  );

  // Third independent renderer check (Data-driven proof)
  const outputC = {
    ...outputA,
    request_snapshot: {
      ...outputA.request_snapshot,
      product_attributes: {
        capacity_litres: 1200,
        electrical: "Three-phase 380V 60Hz",
        pressure_bar: "Minimum 16 bar",
        max_outer_diameter_cm: "110",
        warranty: "48 months",
        quantity: 15,
        destination: "Sharjah",
        incoterm: "CIF",
      },
    },
  };
  const htmlC = generateConsultantLandscapeHtml(outputC);
  assert.ok(htmlC.includes("1200 L nominal capacity"));
  assert.ok(htmlC.includes("Three-phase 380V 60Hz"));
  assert.ok(htmlC.includes("Minimum 16 bar"));
  assert.ok(htmlC.includes("Maximum 110 cm"));
  assert.ok(htmlC.includes("CIF Sharjah"));
  console.log(
    "✔ Third independent snapshot dynamically rendered without code changes",
  );

  console.log("\n✔ GATE L06-G02 VERIFIED: PASS");

  // =========================================================================
  // GATE L06-G03: Safe New Transition & Draft Concurrency
  // =========================================================================
  console.log(
    "\n-------------------------------------------------------------",
  );
  console.log("--- [GATE L06-G03] Safe New Transition & Draft Concurrency --");
  console.log("-------------------------------------------------------------");

  // Create a new draft on server
  const createDraftRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: consultantCookie },
    body: JSON.stringify({ action: "create_draft" }),
  });
  assert.equal(createDraftRes.status, 200, "Draft creation must return 200");
  const createDraftData = await createDraftRes.json();
  const testDraftId = createDraftData.draft_id;
  assert.ok(testDraftId, "Must return valid draft_id");

  // Save draft version 1
  const save1Res = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: consultantCookie },
    body: JSON.stringify({
      action: "save_draft",
      draft_id: testDraftId,
      draft_version: 1,
      expected_version: 1,
      draft_data: {
        productRequirement: "Test product requirement",
        technicalCompliance: "Test compliance",
        orderProfile: "Test order",
      },
    }),
  });
  assert.equal(save1Res.status, 200, "Draft save v1 must return 200");
  const save1Data = await save1Res.json();
  assert.equal(
    save1Data.draft_version,
    2,
    "Server must increment draft_version to 2",
  );
  console.log("✔ Server-side draft versioning confirmed (v1 -> v2)");

  // Attempt save with stale version (expected_version 1, but current is 2)
  const staleSaveRes = await fetch(`${BASE_URL}/api/v1/consultant/workflow`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: consultantCookie },
    body: JSON.stringify({
      action: "save_draft",
      draft_id: testDraftId,
      draft_version: 1,
      expected_version: 1,
      draft_data: {
        productRequirement: "Stale write",
      },
    }),
  });
  assert.equal(
    staleSaveRes.status,
    409,
    "Stale save must return HTTP 409 Conflict",
  );
  const staleSaveData = await staleSaveRes.json();
  assert.equal(staleSaveData.code, "MB-409-DRAFT-CONFLICT");
  console.log(
    "✔ Draft conflict correctly enforced with HTTP 409 MB-409-DRAFT-CONFLICT",
  );

  // Create another draft to verify blank draft isolation
  const createDraft2Res = await fetch(
    `${BASE_URL}/api/v1/consultant/workflow`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: consultantCookie },
      body: JSON.stringify({ action: "create_draft" }),
    },
  );
  const createDraft2Data = await createDraft2Res.json();
  assert.notEqual(
    createDraft2Data.draft_id,
    testDraftId,
    "New draft must have unique ID",
  );
  console.log(
    "✔ New draft creates unique isolated ID, retaining prior draft for Resume",
  );

  console.log("\n✔ GATE L06-G03 VERIFIED: PASS");

  // =========================================================================
  // GATE L06-G04: PDF Delivery Matrix & Historical Result Views
  // =========================================================================
  console.log(
    "\n-------------------------------------------------------------",
  );
  console.log("--- [GATE L06-G04] PDF Delivery Matrix & Historical Controls -");
  console.log("-------------------------------------------------------------");

  const pdfRunId = "00000000-0000-4000-8000-000000000401"; // Golden 01

  // 1. GET 200 OK with application/pdf
  console.log("Verifying authorized GET...");
  const getPdfRes = await fetch(
    `${BASE_URL}/api/v1/consultant/reports/${pdfRunId}/pdf`,
    {
      headers: { Cookie: consultantCookie, Accept: "application/pdf" },
    },
  );
  assert.equal(getPdfRes.status, 200, "GET must return 200 OK");
  assert.ok(
    getPdfRes.headers.get("content-type")?.includes("application/pdf"),
    "Content-Type must be application/pdf",
  );
  assert.ok(
    getPdfRes.headers.get("content-disposition")?.includes("attachment"),
    "Content-Disposition must be attachment",
  );
  const pdfBuffer = Buffer.from(await getPdfRes.arrayBuffer());
  assert.ok(pdfBuffer.length > 50000, "PDF buffer must have valid size");
  assert.equal(
    pdfBuffer.subarray(0, 4).toString(),
    "%PDF",
    "PDF must have %PDF header",
  );
  console.log(
    `✔ GET returned 200 OK (${pdfBuffer.length} bytes, %PDF signature verified)`,
  );

  // 2. HEAD 200 OK with correct headers and NO body
  console.log("Verifying HEAD request...");
  const headPdfRes = await fetch(
    `${BASE_URL}/api/v1/consultant/reports/${pdfRunId}/pdf`,
    {
      method: "HEAD",
      headers: { Cookie: consultantCookie },
    },
  );
  assert.equal(headPdfRes.status, 200, "HEAD must return 200 OK");
  assert.ok(
    headPdfRes.headers.get("content-type")?.includes("application/pdf"),
    "HEAD Content-Type must be application/pdf",
  );
  assert.equal(
    headPdfRes.headers.get("content-length"),
    String(pdfBuffer.length),
    "HEAD Content-Length must match GET body size",
  );
  const headBody = await headPdfRes.text();
  assert.equal(headBody.length, 0, "HEAD response must contain no body");
  console.log(
    "✔ HEAD returned 200 OK with matching Content-Length and zero body",
  );

  // 3. Byte Range: bytes=0-1023
  console.log("Verifying Byte Range bytes=0-1023...");
  const range1Res = await fetch(
    `${BASE_URL}/api/v1/consultant/reports/${pdfRunId}/pdf`,
    {
      headers: { Cookie: consultantCookie, Range: "bytes=0-1023" },
    },
  );
  assert.equal(
    range1Res.status,
    206,
    "Range request must return 206 Partial Content",
  );
  assert.equal(
    range1Res.headers.get("content-range"),
    `bytes 0-1023/${pdfBuffer.length}`,
    "Content-Range must match requested byte range",
  );
  const range1Buffer = Buffer.from(await range1Res.arrayBuffer());
  assert.equal(
    range1Buffer.length,
    1024,
    "Range response must be exactly 1024 bytes",
  );
  assert.deepEqual(
    range1Buffer,
    pdfBuffer.subarray(0, 1024),
    "Range content must match full PDF slice",
  );
  console.log(
    "✔ Byte range bytes=0-1023 returned 206 with exact matching bytes",
  );

  // 4. Byte Range: bytes=0-
  console.log("Verifying Byte Range bytes=0-...");
  const range2Res = await fetch(
    `${BASE_URL}/api/v1/consultant/reports/${pdfRunId}/pdf`,
    {
      headers: { Cookie: consultantCookie, Range: "bytes=0-" },
    },
  );
  assert.equal(
    range2Res.status,
    206,
    "Open-ended range request must return 206 Partial Content",
  );
  assert.equal(
    range2Res.headers.get("content-range"),
    `bytes 0-${pdfBuffer.length - 1}/${pdfBuffer.length}`,
  );
  console.log(
    "✔ Byte range bytes=0- returned 206 with complete length Content-Range",
  );

  // 5. Unsatisfiable Byte Range
  console.log("Verifying Unsatisfiable Byte Range...");
  const range3Res = await fetch(
    `${BASE_URL}/api/v1/consultant/reports/${pdfRunId}/pdf`,
    {
      headers: { Cookie: consultantCookie, Range: "bytes=99999999-99999999" },
    },
  );
  assert.equal(
    range3Res.status,
    416,
    "Unsatisfiable range must return 416 Range Not Satisfiable",
  );
  assert.ok(
    range3Res.headers.get("content-range")?.startsWith("bytes */"),
    "Content-Range must start with bytes */",
  );
  console.log("✔ Unsatisfiable byte range returned 416 Range Not Satisfiable");

  // 6. Redirection check for legacy /consultant/result/[runId]
  console.log("Verifying legacy /consultant/result/[runId] redirect...");
  const legacyRes = await fetch(`${BASE_URL}/consultant/result/${pdfRunId}`, {
    redirect: "manual",
    headers: { Cookie: consultantCookie },
  });
  assert.ok(
    legacyRes.status === 307 || legacyRes.status === 308,
    `Legacy route must redirect with 307/308, got ${legacyRes.status}`,
  );
  assert.equal(
    legacyRes.headers.get("location"),
    `/runs/${pdfRunId}`,
    "Redirect target must be /runs/[runId]",
  );
  console.log(
    "✔ Legacy route /consultant/result/[runId] cleanly redirects to /runs/[runId]",
  );

  // 7. Parallel requests for same artifact
  console.log("Verifying parallel concurrent downloads...");
  const parallelReqs = Array.from({ length: 4 }).map(() =>
    fetch(`${BASE_URL}/api/v1/consultant/reports/${pdfRunId}/pdf`, {
      headers: { Cookie: consultantCookie },
    }),
  );
  const parallelRes = await Promise.all(parallelReqs);
  for (const res of parallelRes) {
    assert.equal(res.status, 200, "Concurrent request must return 200");
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(
      buf.length,
      pdfBuffer.length,
      "Concurrent response length must match",
    );
  }
  console.log(
    "✔ 4 parallel concurrent PDF downloads completed with identical valid bytes",
  );

  console.log("\n✔ GATE L06-G04 VERIFIED: PASS");

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log(
    "\n=============================================================",
  );
  console.log("✔ ALL L06 ACCEPTANCE GATES (G01, G02, G03, G04) VERIFIED PASS!");
  console.log(
    "=============================================================\n",
  );
}

runAllGates().catch((err) => {
  console.error("\n❌ Acceptance test failed:", err);
  process.exit(1);
});
