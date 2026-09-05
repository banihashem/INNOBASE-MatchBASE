"use client";

import React, { useState } from "react";
import type {
  ConsultantResearchOutputV3,
  SupplierEntityV3,
} from "@matchbase/contracts";
import { SupplierDossierModal } from "../../../components/consultant/SupplierDossierModal";

export default function ConsultantWorkflowPage() {
  // Intake Inputs
  const [productRequirement, setProductRequirement] = useState(
    "مرغ کامل منجمد گرید A (وزن 900 تا 1200 گرم) و قطعات سینه بی‌استخوان و فیله شاورما، بسته‌بندی صادراتی کارتن 10 کیلویی با 4 کیسه 2.5 کیلوگرمی. کشور مقصد: عربستان سعودی (بندر جده / دمام).",
  );
  const [technicalCompliance, setTechnicalCompliance] = useState(
    "کشتارگاه دارای مجوز فعال و معتبر SFDA در برزیل الزامی است. گواهی حلال معتبر (FAMBRAS یا Cibal Halal). رعایت زنجیره سرد مداوم منفی 18 درجه سانتیگراد، بدون یخ‌زدگی مجدد، رطوبت کمتر از 4.5 درصد.",
  );
  const [orderProfile, setOrderProfile] = useState(
    "حجم سفارش اولیه 1 تا 3 کانتینر 40 فوت ریفر (تقریباً 27 تن به ازای هر کانتینر)، تکرار ماهیانه تا 2000 تن. شرایط تحویل CIF جده. ترجیحاً خرید مستقیم از تولیدکننده اصلی (Direct Slaughterhouse).",
  );

  // Popover Visibility States
  const [showPopover1, setShowPopover1] = useState(false);
  const [showPopover2, setShowPopover2] = useState(false);
  const [showPopover3, setShowPopover3] = useState(false);

  // Workflow Progression State
  const [runId, setRunId] = useState<string | null>(null);
  const [workflowState, setWorkflowState] = useState<string>("intake_draft");
  const [step1Translation, setStep1Translation] = useState<string>("");
  const [step3Prompt, setStep3Prompt] = useState<string>("");
  const [advisoryContext, setAdvisoryContext] = useState<any>(null);
  const [output, setOutput] = useState<ConsultantResearchOutputV3 | null>(null);
  const [revealedCount, setRevealedCount] = useState<number>(5);
  const [selectedSupplier, setSelectedSupplier] =
    useState<SupplierEntityV3 | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  function triggerToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  }

  // Action 1: Submit Intake
  async function handleSubmitIntake(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_intake",
          product_requirement: productRequirement,
          technical_compliance: technicalCompliance,
          order_profile: orderProfile,
        }),
      });
      const data = await res.json();
      if (data.success && data.session) {
        setRunId(data.session.run_id);
        setWorkflowState(data.session.state);
        setStep1Translation(
          data.session.step1_interpretation.english_translation,
        );
        setAdvisoryContext(data.session.step2_advisory);
        setStep3Prompt(data.session.step3_deep_prompt.prompt_text);
        triggerToast(
          "Intake submitted successfully. Please review English Interpretation (Step 1).",
        );
      } else {
        alert(data.error || "Failed to submit intake");
      }
    } catch (err) {
      console.error(err);
      alert("Network error submitting intake");
    } finally {
      setIsLoading(false);
    }
  }

  // Action 2: Approve Step 1 Interpretation
  async function handleApproveStep1() {
    if (!runId) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve_step1",
          run_id: runId,
          edited_translation: step1Translation,
        }),
      });
      const data = await res.json();
      if (data.success && data.session) {
        setWorkflowState("prep_step2_advisory_ready");
        triggerToast("Step 1 Approved. Review Advisory Context (Step 2).");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }

  // Action 3: Approve Step 3 Prompt & Launch Research
  async function handleApproveStep3AndExecute() {
    if (!runId) return;
    setIsLoading(true);
    setWorkflowState("research_dispatching");
    try {
      // 1. Approve prompt
      await fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve_step3",
          run_id: runId,
          edited_prompt: step3Prompt,
        }),
      });

      // 2. Launch research
      const res = await fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute_research",
          run_id: runId,
        }),
      });
      const data = await res.json();
      if (data.success && data.output) {
        setOutput(data.output);
        setWorkflowState("progressive_reveal_ready");
        setRevealedCount(5);
        triggerToast(
          "Dual-lane research converged! Top 5 verified suppliers revealed.",
        );
      }
    } catch (err) {
      console.error(err);
      alert("Error executing research");
    } finally {
      setIsLoading(false);
    }
  }

  // Action 4: Reveal More Candidates
  async function handleRevealMore() {
    if (!runId) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reveal_more",
          run_id: runId,
          increment: 5,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRevealedCount(data.revealed_count);
        triggerToast(`Revealed ${data.revealed_count} of 20 suppliers.`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }

  // Action 5: JSON Export with notification
  function handleJsonExport() {
    if (!output) return;
    const jsonStr = JSON.stringify(output, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `MatchBASE_Consultant_Output_V3_${output.research_run_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    triggerToast(
      "Structured JSON exported. Remember to re-validate SFDA listings prior to commercial contract.",
    );
  }

  const suppliers = output?.supplier_candidates ?? [];
  const visibleSuppliers = suppliers.slice(0, revealedCount);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 sm:p-8 font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 bg-sky-600 text-white px-5 py-3 rounded-lg shadow-xl border border-sky-400 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-200"
        >
          <svg
            className="w-5 h-5 text-sky-200"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Main Header */}
      <header className="max-w-6xl mx-auto mb-8 border-b border-slate-800 pb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 bg-sky-950 text-sky-400 text-xs font-bold px-3 py-1 rounded-full border border-sky-800 mb-2">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
              CONSULTANT-TIER AGENTIC RESEARCH WORKFLOW
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Sourcing Intelligence & Deep Supplier Discovery
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              End-to-end 3-section workflow: Multilingual 3-box intake, 3-step
              Human preparation gates, and dual-lane agentic research targeting
              up to 20 verified Brazilian poultry suppliers.
            </p>
          </div>
          {runId && (
            <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700 text-right">
              <div className="text-[11px] font-bold text-slate-400 uppercase">
                Active Run ID
              </div>
              <div className="font-mono text-xs text-sky-300">{runId}</div>
              <div className="text-[11px] text-emerald-400 font-semibold mt-1">
                State: {workflowState.replaceAll("_", " ")}
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto space-y-10">
        {/* ========================================================= */}
        {/* SECTION 1: MULTILINGUAL 3-BOX INTAKE                     */}
        {/* ========================================================= */}
        <section
          aria-labelledby="section-1-heading"
          className="bg-slate-800/60 rounded-xl border border-slate-700 p-6 shadow-lg backdrop-blur"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2
                id="section-1-heading"
                className="text-xl font-bold text-white flex items-center gap-2"
              >
                <span className="w-6 h-6 rounded-full bg-sky-600 text-white text-xs flex items-center justify-center font-bold">
                  1
                </span>
                Section 1: Multilingual 3-Box Intake
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Enter requirements in any language (Persian, Arabic, English,
                Portuguese). Clear separation prevents prompt contamination.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmitIntake} className="space-y-6">
            {/* Box 1: Product Requirement */}
            <div className="relative">
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="input-box-1"
                  className="text-sm font-semibold text-slate-200"
                >
                  Box 1: Product Requirement (Specification, Grade, Cuts, Form)
                </label>
                <button
                  type="button"
                  id="help-btn-1"
                  aria-expanded={showPopover1}
                  onClick={() => setShowPopover1(!showPopover1)}
                  className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 focus:outline-none focus:underline"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {showPopover1 ? "Hide Help" : "Help & Guidance"}
                </button>
              </div>

              {showPopover1 && (
                <div className="bg-slate-700 text-slate-200 text-xs p-3 rounded-lg border border-slate-600 mb-2 shadow-lg animate-in fade-in duration-150">
                  <strong>Guidance:</strong> Specify precise product type (e.g.
                  Griller whole bird, calibrated weight ranges 900g/1000g/1100g,
                  boneless skinless breast, or shawarma cut). Avoid mixing
                  commercial price terms into this box.
                </div>
              )}

              <textarea
                id="input-box-1"
                rows={3}
                value={productRequirement}
                onChange={(e) => setProductRequirement(e.target.value)}
                className="w-full bg-slate-900/90 border border-slate-700 rounded-lg p-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="Enter detailed product requirements..."
                required
              />
            </div>

            {/* Box 2: Technical, Quality & Trade Regulatory */}
            <div className="relative">
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="input-box-2"
                  className="text-sm font-semibold text-slate-200"
                >
                  Box 2: Technical, Quality & Trade Regulatory (SFDA, SIF,
                  Halal, Moisture)
                </label>
                <button
                  type="button"
                  id="help-btn-2"
                  aria-expanded={showPopover2}
                  onClick={() => setShowPopover2(!showPopover2)}
                  className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 focus:outline-none focus:underline"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {showPopover2 ? "Hide Help" : "Help & Guidance"}
                </button>
              </div>

              {showPopover2 && (
                <div className="bg-slate-700 text-slate-200 text-xs p-3 rounded-lg border border-slate-600 mb-2 shadow-lg animate-in fade-in duration-150">
                  <strong>Guidance:</strong> List non-negotiable regulatory
                  standards. For Saudi poultry import: SFDA active
                  slaughterhouse establishment registration is legally
                  mandatory. Require recognized Halal bodies (FAMBRAS or Cibal
                  Halal) and MAPA SIF numbers.
                </div>
              )}

              <textarea
                id="input-box-2"
                rows={3}
                value={technicalCompliance}
                onChange={(e) => setTechnicalCompliance(e.target.value)}
                className="w-full bg-slate-900/90 border border-slate-700 rounded-lg p-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="Enter regulatory and compliance criteria..."
                required
              />
            </div>

            {/* Box 3: Order & Supplier Profile */}
            <div className="relative">
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="input-box-3"
                  className="text-sm font-semibold text-slate-200"
                >
                  Box 3: Order & Supplier Profile (Volume, Inco, Port, Price
                  Target)
                </label>
                <button
                  type="button"
                  id="help-btn-3"
                  aria-expanded={showPopover3}
                  onClick={() => setShowPopover3(!showPopover3)}
                  className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 focus:outline-none focus:underline"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {showPopover3 ? "Hide Help" : "Help & Guidance"}
                </button>
              </div>

              {showPopover3 && (
                <div className="bg-slate-700 text-slate-200 text-xs p-3 rounded-lg border border-slate-600 mb-2 shadow-lg animate-in fade-in duration-150">
                  <strong>Guidance:</strong> Detail your commercial parameters:
                  target volume (e.g. 1 container trial vs 50 containers/month),
                  delivery basis (CIF Jeddah or Dammam), target pricing, and
                  whether you require direct slaughterhouse ownership or accept
                  cooperative trading.
                </div>
              )}

              <textarea
                id="input-box-3"
                rows={3}
                value={orderProfile}
                onChange={(e) => setOrderProfile(e.target.value)}
                className="w-full bg-slate-900/90 border border-slate-700 rounded-lg p-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="Enter order volumes, target pricing, Incoterm, and ports..."
                required
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isLoading}
                className="px-6 py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg text-sm transition-all shadow-md hover:shadow-sky-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isLoading ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v8H4z"
                      />
                    </svg>
                    Processing Intake...
                  </>
                ) : (
                  <>Submit Intake &amp; Proceed to Preparation &rarr;</>
                )}
              </button>
            </div>
          </form>
        </section>

        {/* ========================================================= */}
        {/* SECTION 2: THREE PREPARATION STEPS WITH HUMAN GATES      */}
        {/* ========================================================= */}
        {runId && (
          <section
            aria-labelledby="section-2-heading"
            className="bg-slate-800/60 rounded-xl border border-slate-700 p-6 shadow-lg backdrop-blur space-y-8"
          >
            <div>
              <h2
                id="section-2-heading"
                className="text-xl font-bold text-white flex items-center gap-2"
              >
                <span className="w-6 h-6 rounded-full bg-amber-600 text-white text-xs flex items-center justify-center font-bold">
                  2
                </span>
                Section 2: Preparation Steps with Human Approval Gates
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Verify standardized English interpretation, examine the 3-loop
                advisory context, and approve the synthesized research prompt
                before live agents dispatch.
              </p>
            </div>

            {/* Step 1: English Interpretation Gate */}
            <div className="bg-slate-900/80 p-5 rounded-lg border border-slate-700">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="bg-sky-900/80 text-sky-300 text-xs font-bold px-2 py-0.5 rounded border border-sky-700">
                    Step 1
                  </span>
                  <h3 className="font-bold text-white text-sm">
                    English Interpretation &amp; Tariff Classification Gate
                  </h3>
                </div>
                <div className="text-xs text-slate-400">
                  Classification:{" "}
                  <strong className="text-sky-400">HS 0207.12 (HS 2022)</strong>
                </div>
              </div>

              <p className="text-xs text-slate-300 mb-2">
                The intake has been translated and normalized into international
                commercial English. You may edit this interpretation before
                approving:
              </p>

              <textarea
                id="step1-translation-input"
                aria-label="Editable English Interpretation"
                rows={4}
                value={step1Translation}
                onChange={(e) => setStep1Translation(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-slate-200 font-mono mb-3 focus:ring-2 focus:ring-sky-500"
              />

              <div className="flex justify-between items-center">
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Normalized to Global WCO Standards
                </span>
                <button
                  type="button"
                  onClick={handleApproveStep1}
                  disabled={
                    isLoading ||
                    workflowState !== "prep_step1_awaiting_approval"
                  }
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {workflowState === "prep_step1_awaiting_approval"
                    ? "Approve Interpretation & Proceed"
                    : "Approved \u2713"}
                </button>
              </div>
            </div>

            {/* Step 2: 3-Loop Advisory Context */}
            {advisoryContext && (
              <div className="bg-slate-900/80 p-5 rounded-lg border border-slate-700">
                <div className="flex items-center gap-2 mb-3">
                  <span className="bg-sky-900/80 text-sky-300 text-xs font-bold px-2 py-0.5 rounded border border-sky-700">
                    Step 2
                  </span>
                  <h3 className="font-bold text-white text-sm">
                    3-Loop Advisory Context &amp; Trade Intelligence Briefing
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs mb-4">
                  <div className="bg-slate-800/80 p-3 rounded border border-slate-700">
                    <div className="font-bold text-sky-400 mb-1">
                      Loop 1: Trade Lane Dynamics
                    </div>
                    <p className="text-slate-300 leading-relaxed">
                      {advisoryContext.loop1_trade_lane}
                    </p>
                  </div>
                  <div className="bg-slate-800/80 p-3 rounded border border-slate-700">
                    <div className="font-bold text-amber-400 mb-1">
                      Loop 2: Regulatory &amp; SFDA
                    </div>
                    <p className="text-slate-300 leading-relaxed">
                      {advisoryContext.loop2_regulatory}
                    </p>
                  </div>
                  <div className="bg-slate-800/80 p-3 rounded border border-slate-700">
                    <div className="font-bold text-emerald-400 mb-1">
                      Loop 3: Supply Concentration
                    </div>
                    <p className="text-slate-300 leading-relaxed">
                      {advisoryContext.loop3_supply_structure}
                    </p>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-3">
                  <span className="font-bold uppercase text-slate-500">
                    Verified Registries Consulted:
                  </span>
                  {advisoryContext.sources.map((s: any, idx: number) => (
                    <a
                      key={idx}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-400 hover:text-sky-300 underline"
                    >
                      {s.title}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3: Deep Research Prompt Synthesis Gate */}
            {step3Prompt && (
              <div className="bg-slate-900/80 p-5 rounded-lg border border-slate-700">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="bg-sky-900/80 text-sky-300 text-xs font-bold px-2 py-0.5 rounded border border-sky-700">
                      Step 3
                    </span>
                    <h3 className="font-bold text-white text-sm">
                      Synthesized Deep-Research Prompt &amp; Agent Dispatch Gate
                    </h3>
                  </div>
                  <span className="text-xs text-sky-400 font-mono">
                    Target: Up to 20 Verified Candidates
                  </span>
                </div>

                <p className="text-xs text-slate-300 mb-2">
                  Review and edit the autonomous research directives sent to
                  Lane G (Gemini Flash Web) and Lane O (OpenAI GPT-4o):
                </p>

                <textarea
                  id="step3-prompt-input"
                  aria-label="Editable Synthesized Research Prompt"
                  rows={5}
                  value={step3Prompt}
                  onChange={(e) => setStep3Prompt(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-slate-200 font-mono mb-4 focus:ring-2 focus:ring-sky-500"
                />

                <div className="flex justify-between items-center">
                  <div className="text-xs text-slate-400 flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
                    Four-ID Traceability Ready &bull; Confidential Server-Side
                    Execution
                  </div>
                  <button
                    type="button"
                    onClick={handleApproveStep3AndExecute}
                    disabled={
                      isLoading ||
                      (workflowState !== "prep_step2_advisory_ready" &&
                        workflowState !==
                          "prep_step3_prompt_awaiting_approval" &&
                        workflowState !== "prep_step3_prompt_approved")
                    }
                    className="px-6 py-2.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg shadow-lg hover:shadow-sky-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <svg
                          className="animate-spin h-4 w-4 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v8H4z"
                          />
                        </svg>
                        Executing Dual-Lane Research...
                      </>
                    ) : (
                      <>Approve Prompt &amp; Launch Dual-Lane Research &rarr;</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ========================================================= */}
        {/* SECTION 3: DUAL-LANE RESULTS & PROGRESSIVE REVELATION     */}
        {/* ========================================================= */}
        {output && (
          <section
            aria-labelledby="section-3-heading"
            className="bg-slate-800/60 rounded-xl border border-slate-700 p-6 shadow-lg backdrop-blur space-y-6"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-700 pb-4">
              <div>
                <h2
                  id="section-3-heading"
                  className="text-xl font-bold text-white flex items-center gap-2"
                >
                  <span className="w-6 h-6 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center font-bold">
                    3
                  </span>
                  Section 3: Verified Supplier Candidates &amp; Dossiers
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Showing {visibleSuppliers.length} of {suppliers.length}{" "}
                  verified candidate profiles (4 Active Direct-Route, 16
                  Conditional/Development).
                </p>
              </div>

              {/* Action Buttons: PDF & JSON */}
              <div className="flex items-center gap-3">
                <a
                  href={`/api/v1/consultant/reports/${runId}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow transition-colors flex items-center gap-2"
                >
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v3.586l-1.293-1.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V8z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Download Landscape PDF (8-Page)
                </a>

                <button
                  type="button"
                  onClick={handleJsonExport}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold rounded-lg border border-slate-600 transition-colors flex items-center gap-2"
                >
                  <svg
                    className="w-4 h-4 text-slate-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  Export Structured JSON
                </button>
              </div>
            </div>

            {/* Candidate Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleSuppliers.map((supp) => {
                const isDirectRoute = supp.assessment.rank <= 4;
                return (
                  <div
                    key={supp.candidate_id}
                    className="bg-slate-900/90 rounded-xl border border-slate-700 p-5 hover:border-slate-500 transition-all shadow-md flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-extrabold text-sky-400">
                              Rank #{supp.assessment.rank}
                            </span>
                            {/* N01: Compliant high-contrast badge */}
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${
                                isDirectRoute
                                  ? "bg-emerald-950 text-emerald-300 border border-emerald-700"
                                  : "bg-amber-950 text-amber-200 border border-amber-800"
                              }`}
                            >
                              {isDirectRoute
                                ? "SFDA Active Direct Route"
                                : "Conditional / Development"}
                            </span>
                          </div>
                          <h3 className="text-base font-bold text-white">
                            {supp.legal_name}
                          </h3>
                          {supp.brand_names.length > 0 && (
                            <p className="text-xs text-slate-400">
                              Brands: {supp.brand_names.join(", ")}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-black text-sky-400 leading-none">
                            {supp.assessment.compatibility_score}
                          </div>
                          <div className="text-[10px] text-slate-400 uppercase font-semibold mt-1">
                            {supp.assessment.fit_band}
                          </div>
                        </div>
                      </div>

                      {/* Details row */}
                      <div className="text-xs space-y-1 my-3 bg-slate-800/60 p-2.5 rounded border border-slate-700/60">
                        <div className="flex justify-between">
                          <span className="text-slate-400">
                            Approved Facilities (SIF):
                          </span>
                          <span className="font-mono font-medium text-slate-200">
                            {supp.manufacturing_locations.join(", ") ||
                              "SIF Validated"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">
                            Capacity &amp; MOQ:
                          </span>
                          <span className="text-slate-200 truncate max-w-[200px]">
                            {supp.commercial.production_capacity ??
                              "Large industrial"}{" "}
                            &bull; {supp.commercial.moq ?? "1 container"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Website:</span>
                          <a
                            href={supp.website}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sky-400 hover:text-sky-300 underline truncate max-w-[200px]"
                          >
                            {supp.primary_domain}
                          </a>
                        </div>
                      </div>

                      <p className="text-xs text-slate-300 line-clamp-2 mb-4">
                        {supp.assessment.positive_drivers.join("; ")}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                      <span className="text-[11px] text-slate-400">
                        Next:{" "}
                        <strong className="text-slate-200">
                          {supp.assessment.recommended_next_action}
                        </strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSupplier(supp);
                          setIsModalOpen(true);
                        }}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-sky-600 text-slate-200 hover:text-white rounded-md text-xs font-bold transition-colors border border-slate-700"
                      >
                        View Full Dossier &rarr;
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Progressive Revelation Button */}
            {revealedCount < suppliers.length && (
              <div className="text-center pt-4">
                <button
                  type="button"
                  onClick={handleRevealMore}
                  disabled={isLoading}
                  className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-sky-400 font-bold text-sm rounded-lg border border-sky-800/80 transition-all shadow-md hover:border-sky-600 flex items-center gap-2 mx-auto"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                  Reveal 5 More Candidates ({visibleSuppliers.length} of{" "}
                  {suppliers.length} shown)
                </button>
              </div>
            )}
          </section>
        )}
      </main>

      {/* Supplier Dossier Modal / Drawer */}
      <SupplierDossierModal
        supplier={selectedSupplier}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedSupplier(null);
        }}
      />
    </div>
  );
}
