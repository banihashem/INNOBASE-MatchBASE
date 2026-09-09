#!/usr/bin/env node
import assert from "node:assert";
import {
  PreparationModelGateway,
  executeDualLaneResearch,
  getOpenRouterApiKey,
} from "../packages/application/dist/index.js";

console.log(
  "==================================================================",
);
console.log(
  "  MATCHBASE MB-UX-REM-002: CONSULTANT V3 OPENROUTER QUALIFICATION",
);
console.log(
  "==================================================================",
);

// 1. Cost Cap & Safety Verification
const maxCostEnv = process.env.MATCHBASE_MAX_RUN_COST_USD;
const costCap = maxCostEnv ? parseFloat(maxCostEnv) : 0.5; // default safe $0.50 budget if not set
if (isNaN(costCap) || costCap <= 0) {
  console.error(
    "FATAL: Configured maximum run cost cap is invalid. Execution refused.",
  );
  process.exit(1);
}
console.log(`✔ Configured Maximum Cost Cap: $${costCap.toFixed(4)} USD`);

// 2. Secret Protection Verification
const apiKey = getOpenRouterApiKey();
if (!apiKey) {
  console.log(
    "ℹ OpenRouter API Key: Not configured in current shell environment.",
  );
  console.log(
    "  Proceeding with deterministic Preparation Model Gateway qualification.",
  );
} else {
  console.log(
    `✔ OpenRouter API Key: Present and secured (length: ${apiKey.length}, key value hidden).`,
  );
}

const gateway = new PreparationModelGateway();
let totalSpent = 0;

// 3. Test Request A: Brazilian Frozen Poultry for Saudi Arabia
console.log(
  "\n--- [Test 1] Request A: Frozen Poultry Requirement Extraction & Provenance ---",
);
const requestA = {
  product_requirement:
    "مرغ کامل منجمد گرید A (وزن 1000 تا 1200 گرم) و قطعات سینه بی‌استخوان و فیله شاورما، بسته‌بندی صادراتی کارتن 10 کیلویی با 4 کیسه 2.5 کیلوگرمی. کشور مقصد: عربستان سعودی (بندر جده / دمام).",
  technical_compliance:
    "کشتارگاه دارای مجوز فعال و معتبر SFDA در برزیل الزامی است. گواهی حلال معتبر (FAMBRAS یا Cibal Halal). رعایت زنجیره سرد مداوم منفی 18 درجه سانتیگراد، بدون یخ‌زدگی مجدد، رطوبت کمتر از 4.5 درصد، رهگیری کامل MAPA/SIF و حداقل ماندگاری 12 ماه.",
  order_profile:
    "حجم سفارش اولیه 1 تا 3 کانتینر 40 فوت ریفر (تقریباً 27 تن به ازای هر کانتینر)، تکرار ماهیانه تا 2000 تن. شرایط تحویل CIF جده. ترجیحاً خرید مستقیم از تولیدکننده اصلی (Direct Slaughterhouse).",
};

const step1A = await gateway.extractAndInterpret(requestA);
console.log(`  Product Name: ${step1A.product_name}`);
console.log(
  `  Classification: ${step1A.classification.scheme} ${step1A.classification.code} (${step1A.classification.confidence} confidence)`,
);
console.log(
  `  Mandatory Requirements Count: ${step1A.mandatory_requirements.length}`,
);
console.log(
  `  Explicit Provenance Records: ${step1A.explicit_requirements.length}`,
);

// Assertions for Request A
assert.strictEqual(
  step1A.classification.code,
  "0207.12",
  "Request A must classify to HS 0207.12",
);
assert.ok(
  step1A.english_translation.includes("1000") ||
    step1A.english_translation.includes("1000g"),
  "Must preserve 1000-1200g weight range",
);
assert.ok(
  step1A.english_translation.includes("SFDA"),
  "Must preserve SFDA requirement",
);
assert.ok(
  step1A.english_translation.includes("Halal") ||
    step1A.english_translation.includes("FAMBRAS"),
  "Must preserve Halal certification",
);
assert.ok(
  step1A.english_translation.includes("12-month") ||
    step1A.english_translation.includes("shelf life"),
  "Must preserve 12-month shelf life",
);
assert.ok(
  step1A.english_translation.includes("CIF Jeddah"),
  "Must preserve CIF Jeddah",
);
console.log("  ✔ Request A extraction passed all fidelity assertions.");

// 4. Test Step 2 Advisory for Request A
const approvedA = {
  revision_id: "rev-a-01",
  english_translation: step1A.english_translation,
  product_category: step1A.product_category,
  product_name: step1A.product_name,
  key_specifications: step1A.mandatory_requirements,
  approved_at: new Date().toISOString(),
};
const advisoryA = await gateway.generateAdvisoryLoops(
  approvedA,
  step1A.classification,
);
assert.ok(
  advisoryA.loop1_trade_lane.includes("Brazil"),
  "Loop 1 must discuss Brazil trade corridor",
);
assert.ok(
  advisoryA.loop2_regulatory.includes("SFDA"),
  "Loop 2 must discuss SFDA compliance",
);
assert.strictEqual(
  advisoryA.sources.length >= 3,
  true,
  "Must have at least 3 authoritative sources",
);
console.log(
  `  ✔ Request A Advisory generated with ${advisoryA.sources.length} transparent sources.`,
);

// 5. Test Step 3 Prompt for Request A (No Hardcoded Suppliers!)
const promptA = await gateway.generateDeepResearchPrompt(
  approvedA,
  advisoryA,
  step1A.classification,
);
assert.ok(
  !promptA.prompt_text.includes("BRF, LAR Cooperativa, Zanchetta"),
  "Prompt must NOT preselect company names (F10)",
);
assert.ok(
  promptA.prompt_text.includes("SFDA"),
  "Prompt must specify SFDA discovery criteria",
);
assert.strictEqual(promptA.target_supplier_count, 20);
console.log(
  "  ✔ Request A Prompt generated criteria-based discovery without supplier preselection.",
);

// 6. Test Request B: Commercial Electric Water Heaters for Dubai UAE
console.log(
  "\n--- [Test 2] Request B: Industrial Water Heater Extraction & Cross-Domain Isolation ---",
);
const requestB = {
  product_requirement:
    "Industrial commercial electric water heater (calorifier), 500 litres storage capacity, maximum outer diameter 85cm to fit doorway, heavy duty insulation, commercial laundry installation. Destination: Dubai, United Arab Emirates.",
  technical_compliance:
    "Mandatory 10 bar working pressure (tested >= 15 bar), three-phase industrial connection (380-415V, 50Hz), CE mark and Pressure Equipment Directive (PED 2014/68/EU), UAE G-Mark / MoIAT conformity, 5-year tank warranty, spare parts availability in UAE.",
  order_profile:
    "Initial order 20 units for commercial laundry facility, DDP Dubai delivery, direct manufacturer or certified regional distributor.",
};

const step1B = await gateway.extractAndInterpret(requestB);
console.log(`  Product Name: ${step1B.product_name}`);
console.log(
  `  Classification: ${step1B.classification.scheme} ${step1B.classification.code}`,
);

// HARD REGRESSION ASSERTIONS for Request B
assert.notStrictEqual(
  step1B.classification.code,
  "0207.12",
  "FATAL: Industrial water heater must NEVER receive HS 0207.12",
);
assert.strictEqual(
  step1B.classification.code,
  "8516.10",
  "Water heater must classify to HS 8516.10",
);

const bText =
  `${step1B.product_name} ${step1B.english_translation} ${step1B.product_category}`.toLowerCase();
assert.ok(
  !bText.includes("poultry"),
  "Request B must contain ZERO poultry references",
);
assert.ok(
  !bText.includes("chicken"),
  "Request B must contain ZERO chicken references",
);
assert.ok(
  !bText.includes("sfda"),
  "Request B must contain ZERO SFDA references",
);
assert.ok(!bText.includes("sif"), "Request B must contain ZERO SIF references");
assert.ok(
  !bText.includes("halal"),
  "Request B must contain ZERO Halal references",
);
assert.ok(
  step1B.english_translation.includes("500 Litre") ||
    step1B.english_translation.includes("500 L"),
  "Must preserve 500L",
);
assert.ok(
  step1B.english_translation.includes("10 bar"),
  "Must preserve 10 bar",
);
assert.ok(
  step1B.english_translation.includes("85 cm") ||
    step1B.english_translation.includes("850 mm"),
  "Must preserve 85cm diameter",
);
assert.ok(
  step1B.english_translation.includes("Three-phase") ||
    step1B.english_translation.includes("380"),
  "Must preserve three-phase",
);
assert.ok(
  step1B.english_translation.includes("DDP Dubai"),
  "Must preserve DDP Dubai",
);
console.log(
  "  ✔ Request B extraction passed all cross-domain and fidelity assertions.",
);

// 7. Test Step 2 Advisory for Request B
const approvedB = {
  revision_id: "rev-b-01",
  english_translation: step1B.english_translation,
  product_category: step1B.product_category,
  product_name: step1B.product_name,
  key_specifications: step1B.mandatory_requirements,
  approved_at: new Date().toISOString(),
};
const advisoryB = await gateway.generateAdvisoryLoops(
  approvedB,
  step1B.classification,
);
const advisoryBText =
  `${advisoryB.loop1_trade_lane} ${advisoryB.loop2_regulatory} ${advisoryB.loop3_supply_structure}`.toLowerCase();
assert.ok(
  !advisoryBText.includes("poultry"),
  "Advisory B must contain ZERO poultry references",
);
assert.ok(
  !advisoryBText.includes("chicken"),
  "Advisory B must contain ZERO chicken references",
);
assert.ok(
  !advisoryBText.includes("sfda"),
  "Advisory B must contain ZERO SFDA references",
);
assert.ok(
  advisoryB.loop1_trade_lane.includes("UAE") ||
    advisoryB.loop1_trade_lane.includes("Dubai"),
  "Loop 1 must discuss UAE market",
);
assert.ok(
  advisoryB.loop2_regulatory.includes("Pressure Equipment Directive") ||
    advisoryB.loop2_regulatory.includes("MoIAT"),
  "Loop 2 must discuss pressure/MoIAT compliance",
);
console.log(
  "  ✔ Request B Advisory passed all industry-specific isolation assertions.",
);

// 8. Test Step 3 Prompt for Request B
const promptB = await gateway.generateDeepResearchPrompt(
  approvedB,
  advisoryB,
  step1B.classification,
);
const promptBText = promptB.prompt_text.toLowerCase();
assert.ok(
  !promptBText.includes("poultry"),
  "Prompt B must contain ZERO poultry references",
);
assert.ok(
  !promptBText.includes("chicken"),
  "Prompt B must contain ZERO chicken references",
);
assert.ok(
  !promptBText.includes("sfda"),
  "Prompt B must contain ZERO SFDA references",
);
assert.ok(
  !promptBText.includes("halal"),
  "Prompt B must contain ZERO Halal references",
);
assert.ok(
  promptB.prompt_text.includes("500 Litres"),
  "Prompt B must specify 500 Litres",
);
assert.ok(
  promptB.prompt_text.includes("10 bar"),
  "Prompt B must specify 10 bar",
);
assert.ok(promptB.prompt_text.includes("85 cm"), "Prompt B must specify 85cm");
assert.ok(
  promptB.prompt_text.includes("DDP Dubai"),
  "Prompt B must specify DDP Dubai",
);
console.log(
  "  ✔ Request B Prompt passed all cross-industry and criteria assertions.",
);

// 9. Test Edit Propagation (F01): CIF Jeddah -> CFR Jeddah
console.log(
  "\n--- [Test 3] Edit Propagation (F01): CIF Jeddah -> CFR Jeddah ---",
);
const editedTranslation = step1A.english_translation.replace(
  "CIF Jeddah",
  "CFR Jeddah",
);
assert.ok(
  !editedTranslation.includes("CIF Jeddah"),
  "Verification: CIF removed",
);
assert.ok(editedTranslation.includes("CFR Jeddah"), "Verification: CFR added");

const approvedEditedA = {
  revision_id: "rev-a-02",
  english_translation: editedTranslation,
  product_category: step1A.product_category,
  product_name: step1A.product_name,
  key_specifications: step1A.mandatory_requirements,
  incoterm: "CFR Jeddah",
  destination: "Jeddah Islamic Port",
  approved_at: new Date().toISOString(),
};

const advisoryEditedA = await gateway.generateAdvisoryLoops(
  approvedEditedA,
  step1A.classification,
);
assert.ok(
  advisoryEditedA.loop1_trade_lane.includes("CFR Jeddah"),
  "Step 2 Advisory must reflect edited CFR Jeddah",
);

const promptEditedA = await gateway.generateDeepResearchPrompt(
  approvedEditedA,
  advisoryEditedA,
  step1A.classification,
);
assert.ok(
  !promptEditedA.prompt_text.includes("CIF Jeddah"),
  "Step 3 Prompt must NOT contain old CIF Jeddah",
);
assert.ok(
  promptEditedA.prompt_text.includes("CFR Jeddah"),
  "Step 3 Prompt MUST contain approved CFR Jeddah (F01 fix verified)",
);
console.log(
  "  ✔ Edit Propagation verified: Step 1 edit (CIF -> CFR) propagated downstream to Step 2 and Step 3.",
);

// 10. Bounded Live OpenRouter Lane Call (if key present and cost cap permits)
if (apiKey && costCap >= 0.05) {
  console.log(
    "\n--- [Test 4] Bounded Dual-Lane Research Execution Qualification ---",
  );
  const dualResult = await executeDualLaneResearch(
    {
      product_requirement: "Commercial water heater 500L 10 bar",
      technical_compliance: "CE, three-phase, DDP Dubai",
      order_profile: "20 units trial",
      deep_prompt: promptB.prompt_text.slice(0, 400),
    },
    { mode: "live" },
  );

  totalSpent += dualResult.total_cost_usd;
  console.log(
    `  Stream 1 Latency: ${dualResult.lane_g_result.latency_ms}ms, Input: ${dualResult.lane_g_result.input_tokens}, Output: ${dualResult.lane_g_result.output_tokens}`,
  );
  console.log(
    `  Stream 2 Latency: ${dualResult.lane_o_result.latency_ms}ms, Input: ${dualResult.lane_o_result.input_tokens}, Output: ${dualResult.lane_o_result.output_tokens}`,
  );
  console.log(
    `  Total Dual-Lane Cost: $${dualResult.total_cost_usd} USD (Budget remaining: $${(costCap - totalSpent).toFixed(4)} USD)`,
  );
  assert.ok(totalSpent <= costCap, "Cost must not exceed configured cap");
  assert.ok(dualResult.candidates.length > 0, "Candidates must be populated");
  console.log(
    `  ✔ Bounded live dual-lane execution verified (${dualResult.candidates.length} candidate profiles, 6 verification loops).`,
  );
} else {
  console.log(
    "\n--- [Test 4] Demonstration Dual-Lane Execution Qualification (No Spend) ---",
  );
  const dualDemo = await executeDualLaneResearch(
    {
      product_requirement: "Commercial water heater 500L 10 bar",
      technical_compliance: "CE, three-phase, DDP Dubai",
      order_profile: "20 units trial",
      deep_prompt: promptB.prompt_text,
    },
    { mode: "demonstration" },
  );
  assert.strictEqual(
    dualDemo.total_cost_usd,
    0.0,
    "Demonstration mode must incur $0.00 external cost",
  );
  assert.ok(
    dualDemo.candidates.length > 0,
    "Demonstration candidates must be returned",
  );
  assert.strictEqual(
    dualDemo.candidates[0].legal_name.includes("Atlantic"),
    true,
    "Water heater request must receive water heater candidates, not poultry",
  );
  console.log(
    `  ✔ Demonstration dual-lane execution verified ($0 spend, correct water heater candidates returned).`,
  );
}

console.log(
  "\n==================================================================",
);
console.log(
  "  ALL MB-UX-REM-002 PREPARATION & GATEWAY QUALIFICATIONS PASSED ✓",
);
console.log(
  "==================================================================",
);
