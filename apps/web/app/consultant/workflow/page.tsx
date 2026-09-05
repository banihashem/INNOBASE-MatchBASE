"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  ConsultantResearchOutputV3,
  SupplierEntityV3,
} from "@matchbase/contracts";
import { SupplierDossierModal } from "../../../components/consultant/SupplierDossierModal";

const DEMONSTRATION_EXAMPLES = {
  poultry: {
    label:
      "Example A: Brazilian Poultry for Saudi Arabia (Frozen Whole & Cuts)",
    product_requirement:
      "مرغ کامل منجمد گرید A (وزن 900 تا 1200 گرم) و قطعات سینه بی‌استخوان و فیله شاورما، بسته‌بندی صادراتی کارتن 10 کیلویی با 4 کیسه 2.5 کیلوگرمی. کشور مقصد: عربستان سعودی (بندر جده / دمام). تاریخ انقضا حداقل 12 ماه.",
    technical_compliance:
      "کشتارگاه دارای مجوز فعال و معتبر SFDA در برزیل الزامی است. گواهی حلال معتبر (FAMBRAS یا Cibal Halal). رعایت زنجیره سرد مداوم منفی 18 درجه سانتیگراد، بدون یخ‌زدگی مجدد، رطوبت کمتر از 4.5 درصد، کدهای معتبر MAPA SIF.",
    order_profile:
      "حجم سفارش اولیه 1 تا 3 کانتینر 40 فوت ریفر (تقریباً 27 تن به ازای هر کانتینر)، تکرار ماهیانه تا 2000 تن. شرایط تحویل CFR بندر جده. ترجیحاً خرید مستقیم از تولیدکننده اصلی (Direct Slaughterhouse).",
  },
  water_heaters: {
    label:
      "Example B: Commercial Electric Water Heaters for UAE (500L, 10 Bar)",
    product_requirement:
      "آبگرمکن برقی صنعتی مخزنی 500 لیتری ایستاده، فشار کاری مجاز 10 بار، المنت برقی 18 کیلووات سه‌فاز 400 ولت 50 هرتز، حداکثر قطر خارجی مخزن 850 میلی‌متر جهت عبور از درب استاندارد تاسیسات، عایق حرارتی پلی‌اورتان متراکم.",
    technical_compliance:
      "استاندارد CE اروپا، تطابق با استاندارد مخازن تحت فشار PED 2014/68/EU، تاییدیه ECAS امارات، پوشش داخلی لعاب شیشه‌ای (vitreous enamel) و آند منیزیم دوبل جهت جلوگیری از خوردگی آب سخت حاشیه خلیج فارس.",
    order_profile:
      "تعداد 45 دستگاه برای پروژه هتل در دبی، تحویل DDP در منطقه صنعتی دبی. گارانتی مخزن حداقل 5 سال و قطعات برقی حداقل 2 سال همراه با ارائه برگه تست هیدرواستاتیک کارخانه.",
  },
};

export default function ConsultantWorkflowPage() {
  // Intake Inputs (Empty by default - F12)
  const [productRequirement, setProductRequirement] = useState("");
  const [technicalCompliance, setTechnicalCompliance] = useState("");
  const [orderProfile, setOrderProfile] = useState("");

  // Popover Visibility States
  const [showPopover1, setShowPopover1] = useState(false);
  const [showPopover2, setShowPopover2] = useState(false);
  const [showPopover3, setShowPopover3] = useState(false);

  const popoverBtnRef1 = useRef<HTMLButtonElement | null>(null);
  const popoverBtnRef2 = useRef<HTMLButtonElement | null>(null);
  const popoverBtnRef3 = useRef<HTMLButtonElement | null>(null);

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

  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [researchMode, setResearchMode] = useState<"demonstration" | "live">(
    "demonstration",
  );

  function triggerToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  }

  // Session & Entitlement State
  const [userSession, setUserSession] = useState<{
    tier: string;
    userId: string;
    accountId: string;
  } | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  // Resume Modal State
  const [isResumeModalOpen, setIsResumeModalOpen] = useState(false);
  const [incompleteSessions, setIncompleteSessions] = useState<any[]>([]);
  const [activeDraftSession, setActiveDraftSession] = useState<any>(null);
  const [draftId, setDraftId] = useState<string>(() =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "draft-" + Date.now(),
  );

  // Session verification & purge old localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("matchbase_workflow_draft_v1");
        localStorage.removeItem("matchbase_active_workflow_run_id");
      } catch {
        // ignore
      }
    }

    void fetch("/api/v1/me", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          setUserSession(null);
          return;
        }
        const data = await res.json();
        setUserSession({
          tier: data.tier,
          userId: data.user_id,
          accountId: data.account_id,
        });

        // If not consultant, clear any local draft in memory
        if (data.tier !== "consultant" && data.tier !== "admin") {
          setProductRequirement("");
          setTechnicalCompliance("");
          setOrderProfile("");
          setRunId(null);
          setOutput(null);
        }
      })
      .catch(() => setUserSession(null))
      .finally(() => setSessionLoading(false));
  }, []);

  // Check URL params for run_id or action=resume
  useEffect(() => {
    if (typeof window === "undefined") return;
    const searchParams = new URLSearchParams(window.location.search);
    const urlRunId = searchParams.get("run_id");
    const action = searchParams.get("action");

    if (urlRunId && !runId) {
      void loadExistingSession(urlRunId);
    } else if (action === "resume") {
      void handleOpenResumeModal();
    }
  }, []);

  // Server-side debounced draft auto-save
  useEffect(() => {
    if (
      !userSession ||
      (userSession.tier !== "consultant" && userSession.tier !== "admin")
    )
      return;
    if (runId) return; // Do not overwrite draft once a run is submitted
    if (!productRequirement && !technicalCompliance && !orderProfile) {
      setDraftStatus("idle");
      return;
    }
    setDraftStatus("saving");
    const timer = setTimeout(() => {
      void fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_draft",
          draft_id: draftId,
          draft_data: {
            productRequirement,
            technicalCompliance,
            orderProfile,
            savedAt: new Date().toISOString(),
          },
        }),
      })
        .then((res) => {
          if (res.ok) setDraftStatus("saved");
          else setDraftStatus("idle");
        })
        .catch(() => setDraftStatus("idle"));
    }, 800);
    return () => clearTimeout(timer);
  }, [
    productRequirement,
    technicalCompliance,
    orderProfile,
    runId,
    draftId,
    userSession,
  ]);

  // Set contextual page title (F13)
  useEffect(() => {
    if (output) {
      document.title = `${output.request_snapshot.product_name} — Consultant Research | MatchBASE`;
    } else if (runId) {
      document.title = `Run ${runId.slice(-8)} — Consultant Research | MatchBASE`;
    } else {
      document.title = "Consultant Research Workflow | MatchBASE";
    }
  }, [output, runId]);

  // Handle Escape key for popovers (F08)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (showPopover1) {
          setShowPopover1(false);
          popoverBtnRef1.current?.focus();
        }
        if (showPopover2) {
          setShowPopover2(false);
          popoverBtnRef2.current?.focus();
        }
        if (showPopover3) {
          setShowPopover3(false);
          popoverBtnRef3.current?.focus();
        }
        if (isResumeModalOpen) {
          setIsResumeModalOpen(false);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showPopover1, showPopover2, showPopover3, isResumeModalOpen]);

  async function handleOpenResumeModal() {
    setIsResumeModalOpen(true);
    try {
      const [resInc, resDraft] = await Promise.all([
        fetch("/api/v1/consultant/workflow?incomplete=true", {
          cache: "no-store",
        }),
        fetch("/api/v1/consultant/workflow?active_draft=true", {
          cache: "no-store",
        }),
      ]);
      if (resInc.ok) {
        const d = await resInc.json();
        setIncompleteSessions(d.sessions ?? []);
      }
      if (resDraft.ok) {
        const d = await resDraft.json();
        setActiveDraftSession(d.draft ?? null);
      }
    } catch (e) {
      console.error("Failed to fetch resume options:", e);
    }
  }

  function handleResumeDraft(draft: any) {
    if (draft?.draft_data) {
      setProductRequirement(draft.draft_data.productRequirement ?? "");
      setTechnicalCompliance(draft.draft_data.technicalCompliance ?? "");
      setOrderProfile(draft.draft_data.orderProfile ?? "");
      setDraftId(draft.draft_id);
      setIsResumeModalOpen(false);
      triggerToast("Resumed server-saved draft.");
    }
  }

  async function handleAbandonDraft(idToAbandon: string) {
    try {
      await fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "abandon_draft",
          draft_id: idToAbandon,
        }),
      });
      setActiveDraftSession(null);
      triggerToast("Server draft discarded.");
    } catch (e) {
      console.error("Failed to abandon draft:", e);
    }
  }

  function handleResumeSession(targetRunId: string) {
    setIsResumeModalOpen(false);
    void loadExistingSession(targetRunId);
  }

  async function loadExistingSession(targetRunId: string) {
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/v1/consultant/workflow?run_id=${encodeURIComponent(targetRunId)}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          const s = data.session;
          setRunId(s.run_id);
          setWorkflowState(s.state);
          if (s.intake) {
            setProductRequirement(s.intake.product_requirement ?? "");
            setTechnicalCompliance(s.intake.technical_compliance ?? "");
            setOrderProfile(s.intake.order_profile ?? "");
          }
          if (s.step1_interpretation) {
            setStep1Translation(
              s.step1_interpretation.english_translation ?? "",
            );
          }
          if (s.step2_advisory) {
            setAdvisoryContext(s.step2_advisory);
          }
          if (s.step3_deep_prompt) {
            setStep3Prompt(s.step3_deep_prompt.prompt_text ?? "");
          }
          if (s.output) {
            setOutput(s.output);
          }
          if (typeof s.revealed_count === "number") {
            setRevealedCount(s.revealed_count);
          }
          window.history.replaceState(
            {},
            "",
            `/consultant/workflow?run_id=${s.run_id}`,
          );
          triggerToast(
            `Workflow session restored (Run ID: ${s.run_id.slice(-8)})`,
          );
        }
      }
    } catch (err) {
      console.error("Failed to load session:", err);
    } finally {
      setIsLoading(false);
    }
  }

  function handleStartNew() {
    setRunId(null);
    setWorkflowState("intake_draft");
    setProductRequirement("");
    setTechnicalCompliance("");
    setOrderProfile("");
    setStep1Translation("");
    setStep3Prompt("");
    setAdvisoryContext(null);
    setOutput(null);
    setRevealedCount(5);
    setDraftStatus("idle");
    setDraftId(
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "draft-" + Date.now(),
    );
    window.history.replaceState({}, "", "/consultant/workflow?mode=new");
    triggerToast("Started new blank sourcing workflow.");
  }

  // Load demonstration examples (F12)
  function handleLoadExample(type: "poultry" | "water_heaters") {
    const example = DEMONSTRATION_EXAMPLES[type];
    setProductRequirement(example.product_requirement);
    setTechnicalCompliance(example.technical_compliance);
    setOrderProfile(example.order_profile);
    triggerToast(`Loaded ${example.label}`);
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
        setStep3Prompt(data.session.step3_deep_prompt?.prompt_text ?? "");
        setDraftStatus("idle");
        window.history.replaceState(
          {},
          "",
          `/consultant/workflow?run_id=${data.session.run_id}`,
        );
        triggerToast(
          "Intake submitted and persisted. Review English Interpretation (Step 1).",
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

  // Action 2: Approve Step 1 Interpretation (Propagates edit downstream - F01)
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
        setWorkflowState(data.session.state);
        setAdvisoryContext(data.session.step2_advisory);
        if (data.session.step3_deep_prompt) {
          setStep3Prompt(data.session.step3_deep_prompt.prompt_text);
        }
        triggerToast(
          "Step 1 Approved. Edits propagated to Stage 2 & 3. Review Advisory Context.",
        );
      } else {
        alert(data.error || "Failed to approve Step 1");
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
          mode: researchMode,
        }),
      });
      const data = await res.json();
      if (data.success && data.output) {
        setOutput(data.output);
        setWorkflowState("progressive_reveal_ready");
        setRevealedCount(5);
        triggerToast(
          "Autonomous research complete! Top verified suppliers revealed.",
        );
      } else {
        alert(data.error || "Research execution failed");
      }
    } catch (err) {
      console.error(err);
      alert("Error executing research");
    } finally {
      setIsLoading(false);
    }
  }

  // Action 4: Reveal More Candidates (+5)
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
        triggerToast(
          `Revealed ${data.revealed_count} of ${suppliers.length} suppliers.`,
        );
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }

  // Action 5: JSON Export with toast confirmation (F14)
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
      "Structured JSON output exported successfully. Remember to re-validate registry listings prior to commercial contracts.",
    );
  }

  const suppliers = output?.supplier_candidates ?? [];
  const visibleSuppliers = suppliers.slice(0, revealedCount);

  // Entitlement gate: deny standard or unauthenticated users from viewing or manipulating consultant drafts
  if (
    !sessionLoading &&
    (!userSession ||
      (userSession.tier !== "consultant" && userSession.tier !== "admin"))
  ) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 p-8 flex items-center justify-center font-sans">
        <a href="#main-content" className="sr-only focus:not-sr-only">
          Skip to main content
        </a>
        <main
          id="main-content"
          tabIndex={-1}
          className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-xl p-6 text-center space-y-4 shadow-2xl"
        >
          <div className="text-amber-400 font-bold uppercase text-xs tracking-wider">
            Access Restricted
          </div>
          <h1 className="text-xl font-bold text-white">
            Consultant Access Required
          </h1>
          <p className="text-sm text-slate-400">
            Consultant-tier research workflow requires consultant tier
            entitlement. Standard and unauthenticated users cannot access
            consultant workflows or drafts.
          </p>
          <div className="pt-2 flex flex-col gap-2">
            <a
              href="/auth/simulator/start?fixture=consultant"
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg transition-colors shadow"
            >
              Sign In as Consultant
            </a>
            <Link
              href="/runs"
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-600"
            >
              &larr; Return to Run Directory
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4 sm:p-8 font-sans">
      <a href="#main-content" className="sr-only focus:not-sr-only">
        Skip to main content
      </a>

      {/* Toast Notification (F14) */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 bg-sky-600 text-white px-5 py-3 rounded-lg shadow-xl border border-sky-400 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-200"
        >
          <svg
            className="w-5 h-5 text-sky-200"
            width={20}
            height={20}
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
              Structured B2B Sourcing Specification &amp; Agentic Intelligence
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              End-to-end 3-section workflow: Multilingual 3-box intake, 3-step
              Human preparation gates, and dual-lane agentic research with
              progressive disclosure.
            </p>
          </div>
          <div className="flex flex-col sm:items-end gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href="/runs"
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
              >
                &larr; Run Directory
              </Link>
              <button
                type="button"
                onClick={handleStartNew}
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg shadow transition-colors"
              >
                + New Consultant Research
              </button>
              <button
                type="button"
                onClick={handleOpenResumeModal}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
              >
                Resume Research
              </button>
            </div>
            {runId && (
              <div className="bg-slate-800/80 p-3 rounded-lg border border-slate-700 text-right w-full sm:w-auto">
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div>
              <h2
                id="section-1-heading"
                className="text-xl font-bold text-white flex items-center gap-2"
              >
                <span
                  aria-hidden="true"
                  className="w-6 h-6 rounded-full bg-sky-600 text-white text-xs flex items-center justify-center font-bold"
                >
                  1
                </span>
                <span>Section 1: Multilingual 3-Box Intake</span>
                {draftStatus === "saving" && (
                  <span className="text-[11px] font-medium text-amber-400 animate-pulse ml-2 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800">
                    Draft saving...
                  </span>
                )}
                {draftStatus === "saved" && (
                  <span className="text-[11px] font-medium text-emerald-400 ml-2 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                    Server Draft Saved
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Enter requirements in any language (Persian, Arabic, English,
                Portuguese). Strict input isolation ensures clean translation.
              </p>
            </div>

            {/* Load demonstration example buttons (F12) */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-400 font-medium">
                Load Example:
              </span>
              <button
                type="button"
                onClick={() => handleLoadExample("poultry")}
                className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded border border-slate-600 transition-colors"
              >
                A: Brazilian Poultry
              </button>
              <button
                type="button"
                onClick={() => handleLoadExample("water_heaters")}
                className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded border border-slate-600 transition-colors"
              >
                B: UAE Water Heaters
              </button>
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
                  Box 1: Product Requirement (Specification, Grade, Dimensions,
                  Form)
                </label>
                <button
                  ref={popoverBtnRef1}
                  type="button"
                  id="help-btn-1"
                  aria-controls="help-popover-1"
                  aria-expanded={showPopover1}
                  onClick={() => setShowPopover1(!showPopover1)}
                  className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 focus:outline-none focus:underline"
                >
                  <svg
                    className="w-4 h-4"
                    width={16}
                    height={16}
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
                <div
                  id="help-popover-1"
                  role="region"
                  aria-labelledby="help-btn-1"
                  className="bg-slate-700 text-slate-200 text-xs p-3 rounded-lg border border-slate-600 mb-2 shadow-lg animate-in fade-in duration-150"
                >
                  <strong>Guidance:</strong> Specify exact product attributes:
                  dimensions, capacity, materials, grades, and packaging
                  configurations. Avoid commercial terms or prices here.
                </div>
              )}

              <textarea
                id="input-box-1"
                rows={3}
                value={productRequirement}
                onChange={(e) => setProductRequirement(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
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
                  Box 2: Technical, Quality &amp; Trade Regulatory Standards
                </label>
                <button
                  ref={popoverBtnRef2}
                  type="button"
                  id="help-btn-2"
                  aria-controls="help-popover-2"
                  aria-expanded={showPopover2}
                  onClick={() => setShowPopover2(!showPopover2)}
                  className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 focus:outline-none focus:underline"
                >
                  <svg
                    className="w-4 h-4"
                    width={16}
                    height={16}
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
                <div
                  id="help-popover-2"
                  role="region"
                  aria-labelledby="help-btn-2"
                  className="bg-slate-700 text-slate-200 text-xs p-3 rounded-lg border border-slate-600 mb-2 shadow-lg animate-in fade-in duration-150"
                >
                  <strong>Guidance:</strong> Specify mandatory regulatory
                  clearances, quality certifications (e.g. CE, SFDA, Halal, ISO,
                  PED), and technical testing regimes.
                </div>
              )}

              <textarea
                id="input-box-2"
                rows={3}
                value={technicalCompliance}
                onChange={(e) => setTechnicalCompliance(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="Enter regulatory, quality, and compliance requirements..."
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
                  Box 3: Order &amp; Commercial Profile (Volume, Terms, Port,
                  Lead Time)
                </label>
                <button
                  ref={popoverBtnRef3}
                  type="button"
                  id="help-btn-3"
                  aria-controls="help-popover-3"
                  aria-expanded={showPopover3}
                  onClick={() => setShowPopover3(!showPopover3)}
                  className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 focus:outline-none focus:underline"
                >
                  <svg
                    className="w-4 h-4"
                    width={16}
                    height={16}
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
                <div
                  id="help-popover-3"
                  role="region"
                  aria-labelledby="help-btn-3"
                  className="bg-slate-700 text-slate-200 text-xs p-3 rounded-lg border border-slate-600 mb-2 shadow-lg animate-in fade-in duration-150"
                >
                  <strong>Guidance:</strong> Specify order volumes (trial vs
                  recurring), Incoterms (CIF, CFR, FOB, DDP), target destination
                  ports, and supplier relationship tier (direct manufacturer vs
                  trader).
                </div>
              )}

              <textarea
                id="input-box-3"
                rows={3}
                value={orderProfile}
                onChange={(e) => setOrderProfile(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="Enter order volume, delivery terms, port, and commercial criteria..."
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
                      width={16}
                      height={16}
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
                <span
                  aria-hidden="true"
                  className="w-6 h-6 rounded-full bg-amber-600 text-white text-xs flex items-center justify-center font-bold"
                >
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
              </div>

              <p className="text-xs text-slate-300 mb-2">
                The intake has been translated and normalized into international
                commercial English. You may edit this interpretation before
                approving (edits will automatically propagate downstream):
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
                    width={16}
                    height={16}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Harmonized Tariff System Classification &amp; Normalized Specs
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
                      Loop 2: Regulatory &amp; Standards
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

                {advisoryContext.sources &&
                  advisoryContext.sources.length > 0 && (
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
                  )}
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
                  Independent Research Stream 1 and Independent Research Stream
                  2:
                </p>

                <textarea
                  id="step3-prompt-input"
                  aria-label="Editable Synthesized Research Prompt"
                  rows={5}
                  value={step3Prompt}
                  onChange={(e) => setStep3Prompt(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-slate-200 font-mono mb-3 focus:ring-2 focus:ring-sky-500"
                />

                {/* Research Launch Summary (F05) */}
                <div className="bg-slate-950/80 rounded-lg p-4 border border-sky-800/60 my-4 text-xs">
                  <div className="flex items-center gap-2 mb-2 font-bold text-sky-300 text-sm">
                    <svg
                      width={16}
                      height={16}
                      className="w-4 h-4 text-sky-400"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Research Launch Summary &amp; Governance Disclosures
                  </div>

                  {/* Explicit Execution Mode Selection */}
                  <div className="mb-4">
                    <div className="text-xs font-semibold text-slate-300 mb-2">
                      Select Autonomous Execution Mode:
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label
                        className={`cursor-pointer p-3 rounded-lg border transition-all ${
                          researchMode === "demonstration"
                            ? "bg-sky-950/70 border-sky-500 shadow-sm"
                            : "bg-slate-900/90 border-slate-700 hover:border-slate-600"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <input
                            type="radio"
                            name="research_mode"
                            value="demonstration"
                            checked={researchMode === "demonstration"}
                            onChange={() => setResearchMode("demonstration")}
                            className="text-sky-500 focus:ring-sky-500"
                          />
                          <span className="font-bold text-xs text-white">
                            Demonstration Research (Zero Spend)
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 pl-5">
                          Under 5 seconds, simulated dual-lane fixture with
                          verified structure. Ideal for UAT qualification and
                          evaluations.
                        </p>
                      </label>
                      <label
                        className={`cursor-pointer p-3 rounded-lg border transition-all ${
                          researchMode === "live"
                            ? "bg-sky-950/70 border-sky-500 shadow-sm"
                            : "bg-slate-900/90 border-slate-700 hover:border-slate-600"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <input
                            type="radio"
                            name="research_mode"
                            value="live"
                            checked={researchMode === "live"}
                            onChange={() => setResearchMode("live")}
                            className="text-sky-500 focus:ring-sky-500"
                          />
                          <span className="font-bold text-xs text-white">
                            Live Web Research (OpenRouter)
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 pl-5">
                          Live dual-lane search via Gemini Flash + GPT-4o.
                          ~$0.50 budget cap, 30&ndash;60s duration.
                        </p>
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-slate-300 mb-3">
                    <div className="bg-slate-900 p-2.5 rounded border border-slate-800">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">
                        Research Mode
                      </div>
                      <div className="font-semibold text-slate-100 text-xs">
                        {researchMode === "demonstration"
                          ? "Demonstration / Fixture"
                          : "Live Web Agentic"}
                      </div>
                    </div>
                    <div className="bg-slate-900 p-2.5 rounded border border-slate-800">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">
                        Target Candidates
                      </div>
                      <div className="font-semibold text-slate-100 text-xs">
                        Up to 20 Verified Suppliers
                      </div>
                    </div>
                    <div className="bg-slate-900 p-2.5 rounded border border-slate-800">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">
                        Verification Loops
                      </div>
                      <div className="font-semibold text-slate-100 text-xs">
                        {researchMode === "demonstration"
                          ? "5 Structure Checks"
                          : "Up to 15 Deep Checks"}
                      </div>
                    </div>
                    <div className="bg-slate-900 p-2.5 rounded border border-slate-800">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">
                        Cost Budget Cap
                      </div>
                      <div className="font-semibold text-emerald-400 text-xs">
                        {researchMode === "demonstration"
                          ? "$0.00 (Zero Spend)"
                          : "$0.50 USD Maximum"}
                      </div>
                    </div>
                  </div>
                  <div className="text-[11px] text-slate-400 leading-relaxed">
                    <strong className="text-slate-300">
                      Truthful Scarcity Policy:
                    </strong>{" "}
                    The autonomous agents search authoritative registries. If
                    market conditions or stringent constraints yield fewer
                    matches, results reflect genuine verifiable market
                    availability without artificial padding or fabricated
                    entities.
                  </div>
                </div>

                {/* Collapsible Technical Details (F11) */}
                <details className="bg-slate-950/60 p-3 rounded border border-slate-800 text-xs text-slate-400 mb-4">
                  <summary className="cursor-pointer font-semibold text-slate-300 hover:text-white">
                    Technical Model &amp; Routing Details
                  </summary>
                  <div className="mt-2 space-y-1 pl-2">
                    <div>
                      &bull; Dual-stream multi-provider execution (Independent
                      Stream 1 &amp; Stream 2)
                    </div>
                    <div>
                      &bull; Four-ID Lineage Tracking: Request Version &bull;
                      Confirmation ID &bull; Run ID &bull; Execution Trace
                    </div>
                    <div>
                      &bull; Confidential Server-Side Key Vault &bull; Zero
                      client-side credential exposure
                    </div>
                  </div>
                </details>

                <div className="flex justify-end">
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
                          width={16}
                          height={16}
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
                      <>
                        Approve Directives &amp; Launch Dual-Lane Research
                        &rarr;
                      </>
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
                  <span
                    aria-hidden="true"
                    className="w-6 h-6 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center font-bold"
                  >
                    3
                  </span>
                  Section 3: Verified Supplier Candidates &amp; Dossiers
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Showing {visibleSuppliers.length} of {suppliers.length}{" "}
                  verified candidate profiles.
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
                    width={16}
                    height={16}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v3.586l-1.293-1.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V8z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Download Landscape PDF
                </a>

                <button
                  type="button"
                  onClick={handleJsonExport}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold rounded-lg border border-slate-600 transition-colors flex items-center gap-2"
                >
                  <svg
                    className="w-4 h-4 text-slate-400"
                    width={16}
                    height={16}
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
                const isIllustrative =
                  output.research_mode === "fixture" ||
                  supp.legal_name.includes("[Illustrative]") ||
                  supp.candidate_id.startsWith("cand-v3-") ||
                  supp.candidate_id.startsWith("cand-demo-");
                const isDirectRoute =
                  !isIllustrative && supp.assessment.rank <= 4;
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
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${
                                isIllustrative
                                  ? "bg-amber-950 text-amber-200 border border-amber-800"
                                  : isDirectRoute
                                    ? "bg-emerald-950 text-emerald-300 border border-emerald-700"
                                    : "bg-amber-950 text-amber-200 border border-amber-800"
                              }`}
                            >
                              {isIllustrative
                                ? "Illustrative Profile"
                                : isDirectRoute
                                  ? "Active Direct Route"
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
                            {isIllustrative
                              ? "Illustrative Score"
                              : supp.assessment.fit_band}
                          </div>
                        </div>
                      </div>

                      {/* Details row */}
                      <div className="text-xs space-y-1 my-3 bg-slate-800/60 p-2.5 rounded border border-slate-700/60">
                        <div className="flex justify-between">
                          <span className="text-slate-400">
                            Country / Origin:
                          </span>
                          <span className="font-mono font-medium text-slate-200">
                            {supp.country_of_registration}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">
                            Capacity &amp; MOQ:
                          </span>
                          <span className="text-slate-200 truncate max-w-[200px]">
                            {supp.commercial.production_capacity ??
                              "Industrial export"}{" "}
                            &bull; {supp.commercial.moq ?? "Standard MOQ"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">
                            {isIllustrative ? "Fixture ID:" : "Website:"}
                          </span>
                          {isIllustrative ? (
                            <span className="font-mono text-slate-300">
                              {supp.candidate_id}
                            </span>
                          ) : (
                            <a
                              href={supp.website}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sky-400 hover:text-sky-300 underline truncate max-w-[200px]"
                            >
                              {supp.primary_domain}
                            </a>
                          )}
                        </div>
                        {isIllustrative && (
                          <div className="flex justify-between">
                            <span className="text-slate-400">
                              Public Website:
                            </span>
                            <span className="italic text-slate-500">
                              Not applicable — illustrative entity
                            </span>
                          </div>
                        )}
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
                    width={16}
                    height={16}
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

      {/* Resume Research Modal */}
      {isResumeModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="resume-modal-title"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsResumeModalOpen(false);
          }}
        >
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-5 text-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2
                  id="resume-modal-title"
                  className="text-lg font-bold text-white"
                >
                  Resume Research Session
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Select a server-persisted draft or an existing workflow
                  session.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsResumeModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-md transition-colors"
                aria-label="Close modal"
              >
                <svg
                  className="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Active Server Draft Section */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-sky-400 mb-2">
                Active Server Draft
              </h3>
              {activeDraftSession ? (
                <div className="bg-slate-800/80 border border-sky-800/60 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span className="font-semibold text-white">
                      Draft {activeDraftSession.draft_id?.slice(-8)}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {activeDraftSession.draft_data?.savedAt
                        ? new Date(
                            activeDraftSession.draft_data.savedAt,
                          ).toLocaleTimeString()
                        : "Recently saved"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 line-clamp-2 bg-slate-950/50 p-2 rounded border border-slate-800">
                    {activeDraftSession.draft_data?.productRequirement ||
                      "(Empty requirements)"}
                  </p>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        handleAbandonDraft(activeDraftSession.draft_id)
                      }
                      className="px-2.5 py-1 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded transition-colors"
                    >
                      Discard Draft
                    </button>
                    <button
                      type="button"
                      onClick={() => handleResumeDraft(activeDraftSession)}
                      className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded shadow transition-colors"
                    >
                      Resume Draft
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-400 bg-slate-800/40 rounded-lg p-3 border border-slate-800 italic">
                  No active server-saved draft found.
                </div>
              )}
            </div>

            {/* Recent Incomplete / Saved Sessions Section */}
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
                Incomplete &amp; Active Research Runs
              </h3>
              {incompleteSessions.length > 0 ? (
                <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                  {incompleteSessions.map((session) => (
                    <div
                      key={session.run_id}
                      className="bg-slate-800/60 hover:bg-slate-800 border border-slate-700 hover:border-slate-600 rounded-lg p-3 flex items-center justify-between transition-colors"
                    >
                      <div>
                        <div className="text-xs font-mono font-bold text-sky-400">
                          {session.run_id.slice(-8)}
                        </div>
                        <div className="text-xs text-slate-300 capitalize">
                          State: {session.state?.replace(/_/g, " ")}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleResumeSession(session.run_id)}
                        className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold rounded border border-slate-600 transition-colors"
                      >
                        Resume Run
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-400 bg-slate-800/40 rounded-lg p-3 border border-slate-800 italic">
                  No incomplete sessions found for this account.
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsResumeModalOpen(false)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-colors border border-slate-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
