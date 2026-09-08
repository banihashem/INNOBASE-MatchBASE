"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  ConsultantResearchOutputV3,
  SupplierEntityV3,
  ApprovedRequestSnapshotV3,
} from "@matchbase/contracts";
import { SupplierDossierModal } from "../../../components/consultant/SupplierDossierModal";

import { ApprovedRequestSummary } from "../../../components/consultant/ApprovedRequestSummary";

import { WorkflowActivity } from "../../../components/consultant/WorkflowActivity";
import { ResearchRoundControl } from "../../../components/consultant/ResearchRoundControl";
import { StopResearchButton } from "../../../components/consultant/StopResearchButton";
import {
  workflowLabel,
  type ActivityStep,
} from "../../../components/consultant/workflow-status";
import { errorMessage } from "../../../components/consultant/workflow-response";
import { useWorkflowPolling } from "../../../components/consultant/useWorkflowPolling";
import { useStep1Fidelity } from "../../../components/consultant/useStep1Fidelity";
import { InterpretationApprovalStep } from "../../../components/consultant/InterpretationApprovalStep";
import { useConsultantReportDownloads } from "../../../components/consultant/useConsultantReportDownloads";
import { ConsultantResultsSection } from "../../../components/consultant/ConsultantResultsSection";
import { NewDraftTransitionModal } from "../../../components/consultant/NewDraftTransitionModal";
import {
  WorkflowStageTabs,
  useWorkflowStage,
} from "../../../components/consultant/WorkflowStageTabs";

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
    "live",
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
  // Safe New Draft Modal State (Workstream C - L08-N04)
  const [showNewDraftModal, setShowNewDraftModal] = useState(false);
  const [isSavingNewDraft, setIsSavingNewDraft] = useState(false);
  const [newDraftError, setNewDraftError] = useState<string | null>(null);
  const [incompleteSessions, setIncompleteSessions] = useState<any[]>([]);
  const [activeDraftSession, setActiveDraftSession] = useState<any>(null);
  const [draftId, setDraftId] = useState<string>("");
  const [, setDraftVersion] = useState<number>(1);
  const draftVersionRef = useRef(1);
  const draftIdRef = useRef("");
  const hydrationStartedRef = useRef(false);
  const draftSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const transitionRef = useRef(false);
  const draftConflictRef = useRef(false);
  const lastSavedDraftRef = useRef<{ id: string; fingerprint: string } | null>(
    null,
  );
  const intakeRef = useRef({
    productRequirement,
    technicalCompliance,
    orderProfile,
  });
  intakeRef.current = { productRequirement, technicalCompliance, orderProfile };
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityStep[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [workflowProgress, setWorkflowProgress] = useState<any>(null);
  const [approvedSnapshot, setApprovedSnapshot] =
    useState<ApprovedRequestSnapshotV3 | null>(null);
  const [retryAction, setRetryAction] = useState<string | null>(null);
  const [promptApproved, setPromptApproved] = useState(false);
  const researchAvailable =
    Boolean(runId) &&
    (promptApproved ||
      Boolean(output) ||
      [
        "prep_step3_prompt_approved",
        "research_dispatching",
        "lane_gemini_running",
        "lane_openai_running",
        "lanes_converged",
        "verification_loop_running",
        "synthesis_running",
        "progressive_reveal_ready",
        "pdf_generating",
        "workflow_complete",
      ].includes(workflowState) ||
      (workflowState === "workflow_failed" && retryAction === "research"));
  const { stage, setStage } = useWorkflowStage(runId, researchAvailable);
  const viewedRoundRef = useRef<{ runId: string; roundId: string } | null>(
    null,
  );

  function updateDraftId(id: string) {
    draftIdRef.current = id;
    setDraftId(id);
  }
  function updateDraftVersion(version: number) {
    draftVersionRef.current = version;
    setDraftVersion(version);
  }
  const activityExecutionRef = useRef<string | null>(null);
  const stoppedExecutionRef = useRef<string | null>(null);
  function acceptProgress(session: any) {
    // A poll dispatched before cancellation must not restore the old running UI.
    if (
      session.execution_id === stoppedExecutionRef.current &&
      session.progress?.phase !== "user_cancelled"
    )
      return;
    if (session.progress?.phase === "user_cancelled")
      stoppedExecutionRef.current = session.execution_id;
    if (
      session.execution_id &&
      session.execution_id !== activityExecutionRef.current
    ) {
      activityExecutionRef.current = session.execution_id;
      setActivity([]);
    }
    setConnectionError(null);
    if (Array.isArray(session.activity)) setActivity(session.activity);
    if (typeof session.draft_version === "number")
      updateDraftVersion(session.draft_version);
    if (typeof session.draft_id === "string") updateDraftId(session.draft_id);
    if (typeof session.step1_interpretation?.english_translation === "string") {
      setStep1Translation(session.step1_interpretation.english_translation);
      if (session.step1_interpretation.fidelity_validation)
        setStep1Fidelity(session.step1_interpretation.fidelity_validation);
    }
    if (session.approved_request_revision?.canonical_snapshot)
      setApprovedSnapshot(session.approved_request_revision.canonical_snapshot);
    if (session.state) setWorkflowState(session.state);
    setWorkflowProgress(session.progress ?? null);
    setWorkflowError(
      session.error
        ? errorMessage(
            { error: session.error },
            "Workflow stopped. Retry the failed stage.",
          )
        : null,
    );
    setRetryAction(session.retry_action ?? null);
    if (session.mode === "live" || session.mode === "demonstration")
      setResearchMode(session.mode);
    if (session.step2_advisory) setAdvisoryContext(session.step2_advisory);
    if (session.step3_deep_prompt?.prompt_text)
      setStep3Prompt(session.step3_deep_prompt.prompt_text);
    if (typeof session.step3_deep_prompt?.is_approved === "boolean")
      setPromptApproved(session.step3_deep_prompt.is_approved);
  }
  const [hydrationState, setHydrationState] = useState<
    | "unresolved"
    | "loading"
    | "hydrated"
    | "not_found"
    | "forbidden"
    | "invalidated"
    | "error"
  >("unresolved");
  const [invalidationDetail, setInvalidationDetail] = useState<{
    runId: string;
    reason: string;
  } | null>(null);
  const activeRunLocked =
    Boolean(runId) &&
    !output &&
    !["progressive_reveal_ready", "workflow_complete", "invalidated"].includes(
      workflowState,
    ) &&
    hydrationState !== "invalidated";
  const [coherenceError, setCoherenceError] = useState<{
    code: string;
    message: string;
    conflicts?: Array<{
      fields: string[];
      product_families: string[];
      primary_product_family?: string;
      conflicting_product_family?: string;
      explanation: string;
    }>;
    recoverable?: boolean;
  } | null>(null);
  const [conflictState, setConflictState] = useState<{
    current_version: number;
    submitted_version: number;
    unsaved_data: {
      productRequirement: string;
      technicalCompliance: string;
      orderProfile: string;
    };
  } | null>(null);
  const [activeDrafts, setActiveDrafts] = useState<any[]>([]);
  const [conflictEscapeAnnouncement, setConflictEscapeAnnouncement] =
    useState<string>("");
  const [isSessionChanged, setIsSessionChanged] = useState<boolean>(false);
  const [showFullLedger, setShowFullLedger] = useState<boolean>(false);
  const [showFullConflictLocal, setShowFullConflictLocal] =
    useState<boolean>(false);
  const initialUserIdRef = useRef<string | null>(null);
  const coherenceSummaryRef = useRef<HTMLDivElement | null>(null);
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isCloningDraftRef = useRef<boolean>(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const conflictModalRef = useRef<HTMLDivElement | null>(null);
  const conflictPrimaryBtnRef = useRef<HTMLButtonElement | null>(null);

  const {
    step1Fidelity,
    setStep1Fidelity,
    isFidelityValidating,
    setIsFidelityValidating,
    setValidationRetry,
  } = useStep1Fidelity({
    workflowState,
    step1Translation,
    productRequirement,
    technicalCompliance,
    orderProfile,
    setWorkflowError,
  });

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
        if (
          initialUserIdRef.current &&
          data.user_id !== initialUserIdRef.current
        ) {
          setIsSessionChanged(true);
          if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        } else {
          initialUserIdRef.current = data.user_id;
        }

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

  // Check URL params once, including React Strict Mode effect replay.
  useEffect(() => {
    if (typeof window === "undefined" || hydrationStartedRef.current) return;
    hydrationStartedRef.current = true;
    const searchParams = new URLSearchParams(window.location.search);
    const mode = searchParams.get("mode");
    const urlRunId = searchParams.get("run_id");
    const urlDraftId = searchParams.get("draft_id");
    const action = searchParams.get("action");

    // N06 (P2): mode=new has absolute precedence over sessionStorage and incomplete runs
    if (mode === "new") {
      sessionStorage.removeItem("matchbase_active_draft_id");
      setProductRequirement("");
      setTechnicalCompliance("");
      setOrderProfile("");
      setRunId(null);
      setWorkflowState("intake_draft");
      setStep1Translation("");
      setStep3Prompt("");
      setAdvisoryContext(null);
      setOutput(null);
      setRevealedCount(5);
      setDraftStatus("idle");
      setCoherenceError(null);
      setConflictState(null);
      setStep1Fidelity(null);
      void handleCreateNewDraft();
      return;
    }

    if (urlRunId) {
      void loadExistingSession(urlRunId);
    } else if (urlDraftId) {
      void loadExistingDraft(urlDraftId);
    } else if (action === "resume") {
      void handleOpenResumeModal();
      setHydrationState("hydrated");
    } else {
      // Check if current tab has an active draft in sessionStorage
      const storedDraftId = sessionStorage.getItem("matchbase_active_draft_id");
      if (storedDraftId) {
        void loadExistingDraft(storedDraftId);
      } else {
        void handleCreateNewDraft();
      }
    }
  }, []);

  function clearAutosaveTimer() {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
  }

  function saveDraftSnapshot(
    snapshot: typeof intakeRef.current,
    id = draftIdRef.current,
  ): Promise<void> {
    const fingerprint = JSON.stringify(snapshot);
    const operation = draftSaveQueueRef.current
      .catch(() => {})
      .then(async () => {
        if (id !== draftIdRef.current) return;
        if (draftConflictRef.current)
          throw new Error("Resolve the draft conflict before saving.");
        if (
          lastSavedDraftRef.current?.id === id &&
          lastSavedDraftRef.current.fingerprint === fingerprint
        )
          return;
        const version = draftVersionRef.current;
        const res = await fetch("/api/v1/consultant/workflow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_draft",
            draft_id: id,
            draft_version: version,
            expected_version: version,
            draft_data: snapshot,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (id !== draftIdRef.current) return;
        if (res.status === 409) {
          draftConflictRef.current = true;
          setConflictState({
            current_version:
              data.current_version ??
              data.error?.current_version ??
              version + 1,
            submitted_version: version,
            unsaved_data: { ...intakeRef.current },
          });
          setShowNewDraftModal(false);
          throw new Error(
            "The server draft changed. Review the conflict before continuing.",
          );
        }
        if (!res.ok || !data.draft_version)
          throw new Error(
            errorMessage(
              data,
              "Draft save failed. Your input is still on this page.",
            ),
          );
        updateDraftVersion(data.draft_version);
        lastSavedDraftRef.current = { id, fingerprint };
        if (JSON.stringify(intakeRef.current) === fingerprint)
          setDraftStatus("saved");
      });
    draftSaveQueueRef.current = operation;
    return operation;
  }

  // Each acknowledged save supplies the next request's expected version.
  useEffect(() => {
    draftConflictRef.current = Boolean(conflictState);
    if (
      !userSession ||
      !["consultant", "admin"].includes(userSession.tier) ||
      hydrationState !== "hydrated" ||
      runId ||
      !draftId ||
      conflictState ||
      isCloningDraftRef.current ||
      showNewDraftModal ||
      isSavingNewDraft
    )
      return;
    const snapshot = { productRequirement, technicalCompliance, orderProfile };
    const fingerprint = JSON.stringify(snapshot);
    if (
      lastSavedDraftRef.current?.id === draftId &&
      lastSavedDraftRef.current.fingerprint === fingerprint
    ) {
      setDraftStatus("saved");
      return;
    }
    if (
      !productRequirement &&
      !technicalCompliance &&
      !orderProfile &&
      !lastSavedDraftRef.current
    )
      return;
    setDraftStatus("saving");
    clearAutosaveTimer();
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      if (
        transitionRef.current ||
        isCloningDraftRef.current ||
        draftConflictRef.current
      )
        return;
      void saveDraftSnapshot(snapshot, draftId).catch((error) => {
        setDraftStatus("idle");
        setWorkflowError(error.message);
      });
    }, 800);
    return clearAutosaveTimer;
  }, [
    productRequirement,
    technicalCompliance,
    orderProfile,
    runId,
    draftId,
    userSession,
    hydrationState,
    conflictState,
    showNewDraftModal,
    isSavingNewDraft,
  ]);

  useWorkflowPolling({
    runId,
    workflowState,
    output,
    acceptProgress,
    setOutput,
    setRevealedCount,
    setConnectionError,
  });

  // N04: Trap initial focus into conflict modal and store previous active element
  useEffect(() => {
    if (conflictState) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      const t = setTimeout(() => {
        conflictPrimaryBtnRef.current?.focus();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [conflictState]);

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
        if (showNewDraftModal && !transitionRef.current) {
          setShowNewDraftModal(false);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    showPopover1,
    showPopover2,
    showPopover3,
    isResumeModalOpen,
    showNewDraftModal,
  ]);

  async function handleOpenResumeModal() {
    if (activeRunLocked || isLoading || isSavingNewDraft) return;
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
        setActiveDrafts(
          Array.isArray(d.drafts) ? d.drafts : d.draft ? [d.draft] : [],
        );
      }
    } catch (e) {
      console.error("Failed to fetch resume options:", e);
    }
  }

  function handleResumeDraft(draft: any) {
    if (activeRunLocked) return;
    if (draft?.current_run_id) {
      setIsResumeModalOpen(false);
      void loadExistingSession(draft.current_run_id);
      return;
    }
    if (draft?.draft_data) {
      setRunId(null);
      setWorkflowState("intake_draft");
      setOutput(null);
      setStep1Translation("");
      setStep3Prompt("");
      setAdvisoryContext(null);
      setStep1Fidelity(null);
      setPromptApproved(false);
      setApprovedSnapshot(null);
      setWorkflowProgress(null);
      setWorkflowError(null);
      setRetryAction(null);
      setProductRequirement(draft.draft_data.productRequirement ?? "");
      setTechnicalCompliance(draft.draft_data.technicalCompliance ?? "");
      setOrderProfile(draft.draft_data.orderProfile ?? "");
      updateDraftId(draft.draft_id);
      updateDraftVersion(draft.draft_version ?? 1);
      if (typeof window !== "undefined") {
        sessionStorage.setItem("matchbase_active_draft_id", draft.draft_id);
        window.history.replaceState(
          {},
          "",
          `/consultant/workflow?draft_id=${draft.draft_id}`,
        );
      }
      setIsResumeModalOpen(false);
      triggerToast("Resumed server-saved draft.");
    }
  }

  async function handleCreateNewDraft() {
    try {
      const res = await fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_draft" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.draft_id) {
          updateDraftId(data.draft_id);
          updateDraftVersion(data.draft_version ?? 1);
          sessionStorage.setItem("matchbase_active_draft_id", data.draft_id);
          window.history.replaceState(
            {},
            "",
            `/consultant/workflow?draft_id=${data.draft_id}`,
          );
          setHydrationState("hydrated");
          return;
        }
      }
    } catch (e) {
      console.error("Failed to create server draft:", e);
    }
    const fallbackId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "draft-" + Date.now();
    updateDraftId(fallbackId);
    updateDraftVersion(1);
    if (typeof window !== "undefined") {
      sessionStorage.setItem("matchbase_active_draft_id", fallbackId);
      window.history.replaceState(
        {},
        "",
        `/consultant/workflow?draft_id=${fallbackId}`,
      );
    }
    setHydrationState("hydrated");
  }

  async function loadExistingDraft(targetDraftId: string) {
    setHydrationState("loading");
    try {
      const res = await fetch(
        `/api/v1/consultant/workflow?draft_id=${encodeURIComponent(targetDraftId)}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const data = await res.json();
        if (data.draft) {
          const d = data.draft;
          if (d.current_run_id) {
            await loadExistingSession(d.current_run_id);
            return;
          }
          updateDraftId(d.draft_id);
          updateDraftVersion(d.draft_version ?? 1);
          if (d.draft_data) {
            setProductRequirement(
              d.draft_data.productRequirement ??
                d.draft_data.product_requirement ??
                "",
            );
            setTechnicalCompliance(
              d.draft_data.technicalCompliance ??
                d.draft_data.technical_compliance ??
                "",
            );
            setOrderProfile(
              d.draft_data.orderProfile ?? d.draft_data.order_profile ?? "",
            );
          }
          sessionStorage.setItem("matchbase_active_draft_id", d.draft_id);
          window.history.replaceState(
            {},
            "",
            `/consultant/workflow?draft_id=${d.draft_id}`,
          );
          setHydrationState("hydrated");
          return;
        }
      }
    } catch (err) {
      console.error("Failed to load draft:", err);
    }
    await handleCreateNewDraft();
    setHydrationState("hydrated");
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
    setHydrationState("loading");
    try {
      const res = await fetch(
        `/api/v1/consultant/workflow?run_id=${encodeURIComponent(targetRunId)}`,
        { cache: "no-store" },
      );
      if (res.status === 410) {
        const data = await res.json();
        setInvalidationDetail({
          runId: targetRunId,
          reason:
            data.details?.invalidation_reason ||
            data.error ||
            "Audit non-compliance",
        });
        setHydrationState("invalidated");
        return;
      }
      if (res.status === 403) {
        setHydrationState("forbidden");
        return;
      }
      if (res.status === 404) {
        setHydrationState("not_found");
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          const s = data.session;
          if (viewedRoundRef.current?.runId !== targetRunId)
            setOutput(s.output ?? null);
          setPromptApproved(s.step3_deep_prompt?.is_approved === true);
          setApprovedSnapshot(
            s.approved_request_revision?.canonical_snapshot ?? null,
          );
          setStep1Translation(
            s.step1_interpretation?.english_translation ?? "",
          );
          setStep1Fidelity(s.step1_interpretation?.fidelity_validation ?? null);
          setStep3Prompt(
            s.step3_deep_prompt?.prompt_text ??
              s.step3_deep_prompt?.promptText ??
              "",
          );
          setAdvisoryContext(s.step2_advisory ?? null);
          if (viewedRoundRef.current?.runId !== targetRunId)
            setRevealedCount(s.revealed_count ?? 5);
          acceptProgress(s);
          setRunId(s.run_id);
          setWorkflowState(s.state);
          const dId = data.draft?.draft_id ?? s.draft_id;
          const dVer = data.draft?.draft_version ?? s.draft_version ?? 1;
          if (dId) {
            updateDraftId(dId);
            updateDraftVersion(dVer);
            sessionStorage.setItem("matchbase_active_draft_id", dId);
          }
          if (s.intake) {
            setProductRequirement(s.intake.product_requirement ?? "");
            setTechnicalCompliance(s.intake.technical_compliance ?? "");
            setOrderProfile(s.intake.order_profile ?? "");
          }
          const canonicalUrl = dId
            ? `/consultant/workflow?draft_id=${dId}&run_id=${s.run_id}`
            : `/consultant/workflow?run_id=${s.run_id}`;
          window.history.replaceState({}, "", canonicalUrl);
          setHydrationState("hydrated");
          triggerToast(
            `Workflow session restored (Run ID: ${s.run_id.slice(-8)})`,
          );
        }
      } else {
        setHydrationState("error");
      }
    } catch (err) {
      console.error("Failed to load session:", err);
      setHydrationState("error");
    } finally {
      setIsLoading(false);
    }
  }

  async function executeStartNewBlankDraft(saveCurrent = false) {
    if (transitionRef.current || isLoading || activeRunLocked) return;
    transitionRef.current = true;
    setIsSavingNewDraft(true);
    setNewDraftError(null);
    clearAutosaveTimer();
    try {
      // A sent autosave must settle before the old identity is replaced.
      await draftSaveQueueRef.current.catch(() => {});
      if (saveCurrent) await saveDraftSnapshot({ ...intakeRef.current });
      if (draftConflictRef.current)
        throw new Error(
          "Resolve the draft conflict before starting another draft.",
        );
      const res = await fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_draft" }),
      });
      const data = await res.json();
      if (!res.ok || !data.draft_id)
        throw new Error(
          errorMessage(
            data,
            "Could not create a new draft. Your current input is preserved.",
          ),
        );
      updateDraftId(data.draft_id);
      updateDraftVersion(data.draft_version ?? 1);
      const blank = {
        productRequirement: "",
        technicalCompliance: "",
        orderProfile: "",
      };
      intakeRef.current = blank;
      lastSavedDraftRef.current = {
        id: data.draft_id,
        fingerprint: JSON.stringify(blank),
      };
      sessionStorage.setItem("matchbase_active_draft_id", data.draft_id);
      window.history.replaceState(
        {},
        "",
        `/consultant/workflow?draft_id=${data.draft_id}`,
      );
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
      setCoherenceError(null);
      setStep1Fidelity(null);
      setPromptApproved(false);
      setWorkflowProgress(null);
      setApprovedSnapshot(null);
      setWorkflowError(null);
      setRetryAction(null);
      setShowNewDraftModal(false);
      setHydrationState("hydrated");
      triggerToast(
        "New blank draft created. Previous saved drafts remain in Resume Research.",
      );
    } catch (error: any) {
      if (!draftConflictRef.current) setShowNewDraftModal(true);
      setNewDraftError(
        error.message || "Transition failed. Your input is preserved.",
      );
    } finally {
      transitionRef.current = false;
      setIsSavingNewDraft(false);
    }
  }
  async function handleSaveAndStartNew() {
    await executeStartNewBlankDraft(true);
  }
  async function handleDiscardAndStartNew() {
    await executeStartNewBlankDraft(false);
  }
  async function handleStartNew() {
    if (transitionRef.current || isLoading || activeRunLocked) return;
    clearAutosaveTimer();
    const snapshot = intakeRef.current;
    const hasContent = Object.values(snapshot).some(
      (value) => value.length > 0,
    );
    const saved =
      lastSavedDraftRef.current?.id === draftId &&
      lastSavedDraftRef.current.fingerprint === JSON.stringify(snapshot);
    if (!runId && (hasContent || lastSavedDraftRef.current) && !saved) {
      setNewDraftError(null);
      setShowNewDraftModal(true);
      return;
    }
    await executeStartNewBlankDraft(false);
  }

  // Load demonstration examples (F12)
  function handleLoadExample(type: "poultry" | "water_heaters") {
    if (runId || isLoading || isSavingNewDraft) return;
    const example = DEMONSTRATION_EXAMPLES[type];
    setProductRequirement(example.product_requirement);
    setTechnicalCompliance(example.technical_compliance);
    setOrderProfile(example.order_profile);
    setCoherenceError(null);
    triggerToast(`Loaded ${example.label}`);
  }

  // Action 1: Submit Intake
  async function handleSubmitIntake(e: React.FormEvent) {
    e.preventDefault();
    if (runId || isLoading || isSavingNewDraft) return;
    setIsLoading(true);
    setCoherenceError(null);
    setWorkflowError(null);
    clearAutosaveTimer();
    try {
      await draftSaveQueueRef.current.catch(() => {});
      await saveDraftSnapshot({ ...intakeRef.current });
      const res = await fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_intake",
          mode: researchMode,
          draft_id: draftId,
          draft_version: draftVersionRef.current,
          product_requirement: productRequirement,
          technical_compliance: technicalCompliance,
          order_profile: orderProfile,
        }),
      });
      const data = await res.json();
      if (typeof data.draft_version === "number")
        updateDraftVersion(data.draft_version);
      if (!data.success && typeof data.run_id === "string") {
        if (res.status === 409) {
          // A competing submission owns this run; restore its accepted intake and state.
          await loadExistingSession(data.run_id);
          setWorkflowError(
            errorMessage(
              data,
              "This draft was already submitted. Its saved run has been restored.",
            ),
          );
          return;
        }
        setRunId(data.run_id);
        setWorkflowState("workflow_failed");
        setRetryAction(data.retry_action ?? null);
        if (typeof data.draft_id === "string") updateDraftId(data.draft_id);
        window.history.replaceState(
          {},
          "",
          `/consultant/workflow?draft_id=${encodeURIComponent(data.draft_id ?? draftId)}&run_id=${encodeURIComponent(data.run_id)}`,
        );
        setWorkflowError(
          errorMessage(
            data,
            "Preparation stopped. Reload this run to inspect its saved state.",
          ),
        );
        return;
      }
      if ((data.code ?? data.error?.code) === "MB-422-COHERENCE") {
        setCoherenceError({
          code: data.code || data.error?.code || "MB-422-COHERENCE",
          message:
            data.message ||
            data.error?.message ||
            "The request contains materially conflicting product requirements.",
          conflicts: data.conflicts || data.error?.conflicts || [],
          recoverable: true,
        });
        setTimeout(() => {
          coherenceSummaryRef.current?.focus();
          coherenceSummaryRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }, 50);
        return;
      }
      if (data.success && data.session) {
        setRunId(data.session.run_id);
        if (typeof data.session.draft_version === "number")
          updateDraftVersion(data.session.draft_version);
        if (typeof data.session.draft_id === "string")
          updateDraftId(data.session.draft_id);
        acceptProgress(data.session);
        setStep1Translation(
          data.session.step1_interpretation?.english_translation ?? "",
        );
        setStep1Fidelity(
          data.session.step1_interpretation?.fidelity_validation ?? null,
        );
        setAdvisoryContext(data.session.step2_advisory);
        setDraftStatus("idle");
        setCoherenceError(null);
        const canonicalUrl = draftId
          ? `/consultant/workflow?draft_id=${draftId}&run_id=${data.session.run_id}`
          : `/consultant/workflow?run_id=${data.session.run_id}`;
        window.history.replaceState({}, "", canonicalUrl);
        triggerToast(
          data.session.state === "prep_step1_awaiting_approval"
            ? "Intake submitted and persisted. Review English Interpretation (Step 1)."
            : "Request submitted. Its saved preparation state is shown in Section 2.",
        );
      } else {
        setWorkflowError(errorMessage(data, "Failed to submit intake"));
      }
    } catch (err) {
      console.error(err);
      setWorkflowError(
        err instanceof Error ? err.message : "Network error submitting intake",
      );
    } finally {
      setIsLoading(false);
    }
  }

  // Action 2: Approve Step 1 Interpretation (Propagates edit downstream - F01)
  async function handleApproveStep1() {
    if (!runId || isFidelityValidating || step1Fidelity?.valid !== true) return;
    setWorkflowError(null);
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
        acceptProgress(data.session);
        if (data.session.step3_deep_prompt) {
          setStep3Prompt(data.session.step3_deep_prompt.prompt_text);
        }
        triggerToast(
          "English interpretation approved. Preparing the three advisory loops and research prompt.",
        );
      } else {
        setWorkflowError(errorMessage(data, "Failed to approve Step 1"));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }

  // Action 3: Approve Step 3 Prompt & Launch Research
  async function handleApproveStep3AndExecute() {
    if (!runId || isLoading) return;
    setIsLoading(true);
    setWorkflowError(null);
    try {
      const approval = await fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve_step3",
          run_id: runId,
          edited_prompt: step3Prompt,
        }),
      });
      const approved = await approval.json();
      if (!approval.ok || !approved.success)
        throw new Error(
          errorMessage(
            approved,
            "Prompt approval failed. Research has not started.",
          ),
        );
      setPromptApproved(true);
      if (approved.session) acceptProgress(approved.session);
      setStage(3);
    } catch (error: any) {
      setWorkflowError(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRetryWorkflow() {
    if (!runId || isLoading) return;
    if (retryAction === "research") {
      setStage(3);
      setWorkflowError(null);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:
            retryAction === "interpretation"
              ? "retry_interpretation"
              : "retry_workflow",
          run_id: runId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(errorMessage(data, "Retry could not start."));
      if (data.session) {
        acceptProgress(data.session);
        if (data.session.step1_interpretation) {
          setStep1Translation(
            data.session.step1_interpretation.english_translation ?? "",
          );
          setStep1Fidelity(
            data.session.step1_interpretation.fidelity_validation ?? null,
          );
        }
      }
    } catch (error: any) {
      setWorkflowError(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  // Action 4: Reveal More Candidates (+5)
  async function handleRevealMore() {
    if (viewedRoundRef.current?.runId === runId) {
      setRevealedCount(Math.min(revealedCount + 5, suppliers.length));
      return;
    }
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

  const { isPdfDownloading, handleJsonExport, handlePdfDownload } =
    useConsultantReportDownloads(output, runId, triggerToast);

  const suppliers = [...(output?.supplier_candidates ?? [])]
    .sort(
      (a, b) =>
        b.assessment.compatibility_score - a.assessment.compatibility_score ||
        a.assessment.rank - b.assessment.rank,
    )
    .slice(0, 20);
  const visibleSuppliers = suppliers.slice(0, revealedCount);

  const workflowFeedback = (
    <>
      {workflowError && (
        <div
          role={
            workflowProgress?.phase === "user_cancelled" ? "status" : "alert"
          }
          className="rounded-lg border border-amber-700 bg-amber-950/50 p-4 text-sm text-amber-100"
        >
          <p>{workflowError}</p>
          {workflowError.includes("HTTP 403") && (
            <p className="mt-2">
              Research access was denied. The API key spending limit or provider
              permissions must be checked before another retry can succeed.
            </p>
          )}
          {runId &&
            workflowState === "workflow_failed" &&
            !step1Translation && (
              <button
                type="button"
                onClick={() => void loadExistingSession(runId)}
                disabled={isLoading}
                className="mt-3 rounded bg-sky-700 px-4 py-2 text-white disabled:opacity-50"
              >
                Reload Current Run
              </button>
            )}
          {retryAction && workflowState === "workflow_failed" && (
            <button
              type="button"
              onClick={handleRetryWorkflow}
              disabled={isLoading}
              className="mt-3 px-4 py-2 rounded bg-sky-700 text-white disabled:opacity-50"
            >
              {workflowProgress?.phase === "user_cancelled"
                ? "Review a new research estimate"
                : retryAction === "interpretation"
                  ? "Retry Interpretation"
                  : retryAction === "research"
                    ? "Review a new research estimate"
                    : "Retry failed preparation stage"}
            </button>
          )}
        </div>
      )}
      {approvedSnapshot && !output && (
        <ApprovedRequestSummary snapshot={approvedSnapshot} />
      )}
    </>
  );

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

  if (hydrationState === "invalidated") {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 p-8 flex items-center justify-center font-sans">
        <a href="#main-content" className="sr-only focus:not-sr-only">
          Skip to main content
        </a>
        <main
          id="main-content"
          tabIndex={-1}
          className="max-w-lg w-full bg-slate-800 border-2 border-rose-600 rounded-xl p-6 text-center space-y-4 shadow-2xl"
        >
          <div className="text-rose-400 font-bold uppercase text-xs tracking-wider">
            Research Run Invalidated (MB-410)
          </div>
          <h1 className="text-xl font-bold text-white">
            Run Invalidated Due to Audit Non-Compliance
          </h1>
          <p className="text-sm text-slate-300">
            {invalidationDetail?.reason ||
              "This research run has been invalidated due to audit non-compliance."}
          </p>
          {invalidationDetail?.runId && (
            <div className="text-xs text-slate-400 font-mono bg-slate-950/60 p-2 rounded border border-slate-700">
              Run ID: {invalidationDetail.runId}
            </div>
          )}
          <div className="pt-3 flex flex-col gap-2">
            <button
              type="button"
              onClick={handleStartNew}
              disabled={isSavingNewDraft || isLoading}
              className="px-5 py-2.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg transition-colors shadow"
            >
              Start New Research Request
            </button>
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

  if (hydrationState === "loading") {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 p-8 flex items-center justify-center font-sans">
        <div className="text-center space-y-3">
          <div className="inline-block w-8 h-8 border-4 border-sky-400 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm text-slate-400">
            Loading and hydrating workflow session...
          </p>
        </div>
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
              CONSULTANT RESEARCH
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Find and verify B2B suppliers
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Describe your needs, approve the research plan, and review
              evidence-backed supplier results.
            </p>
          </div>
          <div className="flex flex-col sm:items-end gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Link href="/" className="px-3 py-1.5 text-sky-300 underline">
                Home
              </Link>
              <Link
                href="/runs"
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
              >
                &larr; Run Directory
              </Link>
              <button
                type="button"
                onClick={handleStartNew}
                disabled={isSavingNewDraft || isLoading || activeRunLocked}
                title={
                  activeRunLocked
                    ? "Complete this research cycle before starting a new request."
                    : undefined
                }
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg shadow transition-colors"
              >
                + New Consultant Research
              </button>
              <button
                type="button"
                onClick={handleOpenResumeModal}
                disabled={isLoading || isSavingNewDraft || activeRunLocked}
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
                <div className="text-[11px] text-slate-200 font-semibold mt-1">
                  {workflowLabel(
                    workflowState,
                    workflowProgress?.phase === "user_cancelled",
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="max-w-6xl mx-auto space-y-10"
      >
        {isSessionChanged && (
          <div
            role="alert"
            className="bg-amber-950/80 border-2 border-amber-600 rounded-xl p-4 text-amber-200 flex items-center justify-between gap-4 shadow-xl animate-in fade-in"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl" aria-hidden="true">
                ⚠️
              </span>
              <div>
                <strong className="text-white block font-bold text-sm">
                  Session Identity Changed
                </strong>
                <p className="text-xs text-amber-300/90 mt-0.5">
                  Your signed-in session changed. Sign in again to continue this
                  draft. Your local inputs are safely preserved in memory.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors whitespace-nowrap"
            >
              Sign In Again
            </button>
          </div>
        )}

        {/* ========================================================= */}
        <WorkflowStageTabs
          stage={stage}
          onChange={setStage}
          submitted={Boolean(runId)}
          researchAvailable={researchAvailable}
        />
        {(runId || isLoading) && (
          <WorkflowActivity
            state={workflowState}
            progress={workflowProgress}
            activity={activity}
            busy={isLoading}
            connectionError={connectionError}
            pdfBusy={isPdfDownloading}
            retryAction={retryAction}
          />
        )}
        {/* SECTION 1: MULTILINGUAL 3-BOX INTAKE                     */}
        {/* ========================================================= */}
        <section
          id="workflow-panel-1"
          role="tabpanel"
          aria-labelledby="workflow-tab-1"
          hidden={stage !== 1}
          tabIndex={0}
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
                Enter requirements in any language. Review the English
                interpretation before approving the three preparation loops.
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
                disabled={isLoading || isSavingNewDraft || Boolean(runId)}
                className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded border border-slate-600 transition-colors"
              >
                A: Brazilian Poultry
              </button>
              <button
                type="button"
                onClick={() => handleLoadExample("water_heaters")}
                disabled={isLoading || isSavingNewDraft || Boolean(runId)}
                className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded border border-slate-600 transition-colors"
              >
                B: UAE Water Heaters
              </button>
            </div>
          </div>

          {!runId && workflowFeedback}
          {runId && (
            <p className="mb-4 text-sm text-amber-200">
              Submitted request locked. Review the original inputs here;
              interpretation and prompt approval are in Section 2.
            </p>
          )}
          {(() => {
            const isBox1Conflicted = coherenceError?.conflicts?.some((c) =>
              c.fields.some((f) => f.includes("product_requirement")),
            );
            const isBox2Conflicted = coherenceError?.conflicts?.some((c) =>
              c.fields.some(
                (f) => f.includes("technical") || f.includes("compliance"),
              ),
            );
            const isBox3Conflicted = coherenceError?.conflicts?.some((c) =>
              c.fields.some(
                (f) => f.includes("order") || f.includes("profile"),
              ),
            );

            return (
              <form onSubmit={handleSubmitIntake} className="space-y-6">
                <label className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
                  Research mode
                  <select
                    aria-label="Research mode"
                    value={researchMode}
                    disabled={Boolean(runId) || isLoading || isSavingNewDraft}
                    onChange={(event) =>
                      setResearchMode(
                        event.target.value as "live" | "demonstration",
                      )
                    }
                    className="bg-slate-950 border border-slate-700 rounded p-2 text-white"
                  >
                    <option value="live">Live web research</option>
                    <option value="demonstration">
                      Demonstration fixtures
                    </option>
                  </select>
                  <span>
                    Preparation starts after submitting. Supplier research
                    starts only after prompt approval.
                  </span>
                </label>
                {coherenceError && (
                  <div
                    id="coherence-error-summary"
                    ref={coherenceSummaryRef}
                    tabIndex={-1}
                    role="alert"
                    aria-live="assertive"
                    className="p-4 rounded-lg bg-rose-950/80 border-2 border-rose-600 text-rose-100 shadow-xl focus:outline-none focus:ring-2 focus:ring-rose-400"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span className="text-rose-400 text-xl font-bold">
                          ⚠️
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-bold text-rose-200">
                              Specification Coherence Conflict (
                              {coherenceError.code})
                            </h3>
                            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-rose-900/80 text-rose-300 border border-rose-700">
                              Action Required
                            </span>
                          </div>
                          <p className="text-xs text-rose-200/90 mt-1">
                            {coherenceError.message}
                          </p>

                          {coherenceError.conflicts &&
                            coherenceError.conflicts.length > 0 && (
                              <div className="mt-3 space-y-2">
                                {coherenceError.conflicts.map(
                                  (conflict, idx) => (
                                    <div
                                      key={idx}
                                      className="bg-rose-900/40 rounded p-2.5 text-xs border border-rose-800/80 space-y-1"
                                    >
                                      <p className="font-semibold text-rose-200">
                                        {conflict.explanation}
                                      </p>
                                      <div className="flex flex-wrap gap-2 text-[11px] text-rose-300/80 pt-1">
                                        <span>
                                          <strong>Conflicting Fields:</strong>{" "}
                                          {conflict.fields
                                            .map((f) => f.replaceAll("_", " "))
                                            .join(", ")}
                                        </span>
                                        {conflict.product_families && (
                                          <span>
                                            &bull;{" "}
                                            <strong>
                                              Detected Categories:
                                            </strong>{" "}
                                            {conflict.product_families
                                              .map((f) =>
                                                f.replaceAll("_", " "),
                                              )
                                              .join(" vs ")}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  ),
                                )}
                              </div>
                            )}

                          <p className="text-[11px] text-rose-300/80 mt-2">
                            Your entered requirements have been preserved.
                            Adjust Box 1 or Box 2 to align technical compliance
                            with the product family before resubmitting.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCoherenceError(null)}
                        className="text-rose-400 hover:text-rose-200 text-xs px-2 py-1 rounded bg-rose-900/60 hover:bg-rose-800 transition"
                        aria-label="Dismiss error summary"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}

                {/* Box 1: Product Requirement */}
                <div className="relative">
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="input-box-1"
                      className="text-sm font-semibold text-slate-200"
                    >
                      Product Requirement
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
                      Describe the exact product, form, grade, dimensions or
                      capacity, material, packaging, shelf life and intended
                      use. Preserve units and distinguish mandatory limits from
                      preferences.
                    </div>
                  )}

                  <textarea
                    id="input-box-1"
                    disabled={isSavingNewDraft || isLoading || Boolean(runId)}
                    dir="auto"
                    rows={3}
                    value={productRequirement}
                    onChange={(e) => {
                      setProductRequirement(e.target.value);
                      if (coherenceError) setCoherenceError(null);
                    }}
                    className={`w-full bg-slate-950 border ${isBox1Conflicted ? "border-rose-500 ring-2 ring-rose-500/40" : "border-slate-700"} rounded-lg p-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500`}
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
                      Technical, Quality &amp; Trade Requirements
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
                      State quality tolerances, operating conditions,
                      certifications, test reports, traceability, labeling,
                      product or plant approvals, and origin or destination
                      trade restrictions. Name acceptable issuing bodies and
                      required supporting documents.
                    </div>
                  )}

                  <textarea
                    id="input-box-2"
                    disabled={isSavingNewDraft || isLoading || Boolean(runId)}
                    dir="auto"
                    rows={3}
                    value={technicalCompliance}
                    onChange={(e) => {
                      setTechnicalCompliance(e.target.value);
                      if (coherenceError) setCoherenceError(null);
                    }}
                    className={`w-full bg-slate-950 border ${isBox2Conflicted ? "border-rose-500 ring-2 ring-rose-500/40" : "border-slate-700"} rounded-lg p-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500`}
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
                      Order &amp; Supplier Profile
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
                      Specify trial and recurring quantities, destination,
                      Incoterm, timing, budget or payment constraints, and
                      acceptable supplier type. Include manufacturer or
                      distributor authorization, capacity, market experience,
                      warranty and local support needs.
                    </div>
                  )}

                  <textarea
                    id="input-box-3"
                    disabled={isSavingNewDraft || isLoading || Boolean(runId)}
                    dir="auto"
                    rows={3}
                    value={orderProfile}
                    onChange={(e) => {
                      setOrderProfile(e.target.value);
                      if (coherenceError) setCoherenceError(null);
                    }}
                    className={`w-full bg-slate-950 border ${isBox3Conflicted ? "border-rose-500 ring-2 ring-rose-500/40" : "border-slate-700"} rounded-lg p-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500`}
                    placeholder="Enter order volume, delivery terms, port, and commercial criteria..."
                    required
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={isLoading || isSavingNewDraft || Boolean(runId)}
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
            );
          })()}
        </section>

        {/* ========================================================= */}
        {/* SECTION 2: THREE PREPARATION STEPS WITH HUMAN GATES      */}
        {/* ========================================================= */}
        {runId && (
          <section
            id="workflow-panel-2"
            role="tabpanel"
            aria-labelledby="workflow-tab-2"
            hidden={stage !== 2}
            tabIndex={0}
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

            {!researchAvailable && workflowFeedback}
            {step1Translation && (
              <InterpretationApprovalStep
                workflowState={workflowState}
                isLoading={isLoading}
                step1Translation={step1Translation}
                step1Fidelity={step1Fidelity}
                isFidelityValidating={isFidelityValidating}
                showFullLedger={showFullLedger}
                setShowFullLedger={setShowFullLedger}
                onTranslationChange={(value) => {
                  setIsFidelityValidating(true);
                  setStep1Translation(value);
                }}
                onRetryValidation={() =>
                  setValidationRetry((value) => value + 1)
                }
                handleApproveStep1={handleApproveStep1}
              />
            )}
            {!step1Translation && workflowState !== "workflow_failed" && (
              <p role="status" className="text-sm text-slate-300">
                Preparing the English interpretation. The submitted request
                remains locked.
              </p>
            )}

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
                    <p className="text-slate-300 leading-relaxed whitespace-pre-line break-words">
                      {advisoryContext.loop1_trade_lane}
                    </p>
                  </div>
                  <div className="bg-slate-800/80 p-3 rounded border border-slate-700">
                    <div className="font-bold text-amber-400 mb-1">
                      Loop 2: Regulatory &amp; Standards
                    </div>
                    <p className="text-slate-300 leading-relaxed whitespace-pre-line break-words">
                      {advisoryContext.loop2_regulatory}
                    </p>
                  </div>
                  <div className="bg-slate-800/80 p-3 rounded border border-slate-700">
                    <div className="font-bold text-emerald-400 mb-1">
                      Loop 3: Supply Concentration
                    </div>
                    <p className="text-slate-300 leading-relaxed whitespace-pre-line break-words">
                      {advisoryContext.loop3_supply_structure}
                    </p>
                  </div>
                </div>

                {advisoryContext.sources &&
                  advisoryContext.sources.length > 0 && (
                    <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-3">
                      <span className="font-bold uppercase text-slate-500">
                        Preparation sources:
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
                      Research Prompt &amp; Approval
                    </h3>
                  </div>
                  <span className="text-xs text-sky-400 font-mono">
                    Target: Up to 20 Assessed Candidates
                  </span>
                </div>

                <p className="text-xs text-slate-300 mb-2">
                  Review and edit the research prompt. Supplier discovery and
                  verification will begin only after you approve this version.
                </p>

                <textarea
                  id="step3-prompt-input"
                  aria-label="Editable Synthesized Research Prompt"
                  rows={5}
                  value={step3Prompt}
                  disabled={
                    isLoading ||
                    ![
                      "prep_step2_advisory_ready",
                      "prep_step3_prompt_awaiting_approval",
                    ].includes(workflowState)
                  }
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
                    Research Summary
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
                            disabled={Boolean(runId)}
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
                          Explicit synthetic fixtures for workflow regression
                          checks. No live supplier evidence.
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
                            disabled={Boolean(runId)}
                            value="live"
                            checked={researchMode === "live"}
                            onChange={() => setResearchMode("live")}
                            className="text-sky-500 focus:ring-sky-500"
                          />
                          <span className="font-bold text-xs text-white">
                            Live Web Research
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 pl-5">
                          Research actual web sources in 5 to 15 verification
                          loops. Duration depends on source availability.
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
                        Up to 20 Assessed Suppliers
                      </div>
                    </div>
                    <div className="bg-slate-900 p-2.5 rounded border border-slate-800">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">
                        Verification Loops
                      </div>
                      <div className="font-semibold text-slate-100 text-xs">
                        {researchMode === "demonstration"
                          ? "5 Structure Checks"
                          : "5 to 15 verification loops"}
                      </div>
                    </div>
                    <div className="bg-slate-900 p-2.5 rounded border border-slate-800">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">
                        Evidence Basis
                      </div>
                      <div className="font-semibold text-emerald-400 text-xs">
                        {researchMode === "demonstration"
                          ? "Synthetic fixtures"
                          : "Live web sources"}
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
                        Submitting approved prompt...
                      </>
                    ) : (
                      <>Approve Prompt &amp; Review Cost &rarr;</>
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
        {researchAvailable && (
          <div
            id="workflow-panel-3"
            role="tabpanel"
            aria-labelledby="workflow-tab-3"
            hidden={stage !== 3}
            tabIndex={0}
            className="space-y-6"
          >
            {!output && (
              <h2 className="text-xl font-bold text-white">
                Section 3: Research &amp; Results
              </h2>
            )}
            {runId &&
              activityExecutionRef.current &&
              [
                "research_dispatching",
                "lane_gemini_running",
                "lane_openai_running",
                "lanes_converged",
                "verification_loop_running",
                "synthesis_running",
              ].includes(workflowState) && (
                <StopResearchButton
                  key={activityExecutionRef.current}
                  runId={runId}
                  executionId={activityExecutionRef.current}
                  onStopped={(session) => {
                    if (session.execution_id === activityExecutionRef.current)
                      acceptProgress(session);
                  }}
                />
              )}
            {runId && (
              <ResearchRoundControl
                runId={runId}
                workflowState={workflowState}
                onStarted={() => {
                  viewedRoundRef.current = null;
                  void loadExistingSession(runId);
                }}
                onPreview={(saved, roundId) => {
                  viewedRoundRef.current = { runId, roundId };
                  setOutput(saved);
                  setRevealedCount(5);
                }}
              />
            )}
            {workflowFeedback}
            {!output && !workflowProgress && !workflowError && (
              <p role="status" className="text-slate-300">
                Review the cost estimate above to start one research round.
              </p>
            )}
            {output?.public_social_checks && (
              <section className="rounded-lg border border-slate-600 p-4">
                <h3 className="font-bold">Public social evidence checks</h3>
                <ul className="mt-3 space-y-3 text-sm">
                  {output.public_social_checks.map((check, i) => (
                    <li key={i}>
                      <strong>
                        {check.supplier_name} ·{" "}
                        {check.status.replaceAll("_", " ")}
                      </strong>
                      {check.profile_url && (
                        <p>
                          <a
                            className="text-sky-300 underline"
                            href={check.profile_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Public source URL
                          </a>
                        </p>
                      )}
                      <p>
                        {check.ownership_basis} {check.limitation}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {output && (
              <ConsultantResultsSection
                output={output}
                suppliers={suppliers}
                visibleSuppliers={visibleSuppliers}
                revealedCount={revealedCount}
                isLoading={isLoading}
                isPdfDownloading={isPdfDownloading}
                handlePdfDownload={handlePdfDownload}
                handleJsonExport={handleJsonExport}
                handleRevealMore={handleRevealMore}
                onSelectSupplier={(supplier) => {
                  setSelectedSupplier(supplier);
                  setIsModalOpen(true);
                }}
              />
            )}
          </div>
        )}
      </main>

      {/* Supplier Dossier Modal / Drawer */}
      <SupplierDossierModal
        supplier={selectedSupplier}
        approvedRequest={output?.approved_request_snapshot}
        evidenceSources={output?.evidence_sources ?? []}
        claims={output?.claims ?? []}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedSupplier(null);
        }}
      />

      <NewDraftTransitionModal
        showNewDraftModal={showNewDraftModal}
        isSavingNewDraft={isSavingNewDraft}
        newDraftError={newDraftError}
        transitionRef={transitionRef}
        onDismiss={() => setShowNewDraftModal(false)}
        handleSaveAndStartNew={handleSaveAndStartNew}
        handleDiscardAndStartNew={handleDiscardAndStartNew}
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
                Active Unsubmitted Drafts (
                {
                  (activeDrafts.length > 0
                    ? activeDrafts
                    : activeDraftSession
                      ? [activeDraftSession]
                      : []
                  ).length
                }
                )
              </h3>
              {(activeDrafts.length > 0
                ? activeDrafts
                : activeDraftSession
                  ? [activeDraftSession]
                  : []
              ).length > 0 ? (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {(activeDrafts.length > 0
                    ? activeDrafts
                    : [activeDraftSession]
                  ).map((draft: any) => (
                    <div
                      key={draft.draft_id}
                      className="bg-slate-800/80 border border-sky-800/60 rounded-lg p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs text-slate-300">
                        <span className="font-semibold text-white">
                          Draft {draft.draft_id?.slice(-8)}{" "}
                          {draft.draft_id === draftId ? "(Current)" : ""}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {draft.draft_data?.savedAt
                            ? new Date(
                                draft.draft_data.savedAt,
                              ).toLocaleTimeString()
                            : draft.updated_at
                              ? new Date(draft.updated_at).toLocaleTimeString()
                              : "Recently saved"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 line-clamp-2 bg-slate-950/50 p-2 rounded border border-slate-800">
                        {draft.draft_data?.productRequirement ||
                          "(Empty requirements)"}
                      </p>
                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleAbandonDraft(draft.draft_id)}
                          className="px-2.5 py-1 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded transition-colors"
                        >
                          Discard Draft
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResumeDraft(draft)}
                          className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded shadow transition-colors"
                        >
                          Resume Draft
                        </button>
                      </div>
                    </div>
                  ))}
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
                  {incompleteSessions.map((session) => {
                    const reqSnippet =
                      session.original_intake?.product_requirement ||
                      session.original_intake?.productRequirement ||
                      session.draft_revision?.english_translation ||
                      "Consultant Sourcing Request";
                    const stateLabel =
                      session.current_state?.replace(/_/g, " ") ??
                      session.state?.replace(/_/g, " ");
                    return (
                      <div
                        key={session.run_id}
                        className="bg-slate-800/60 hover:bg-slate-800 border border-slate-700 hover:border-slate-600 rounded-lg p-3 flex items-center justify-between gap-3 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono font-bold text-sky-400">
                              Run {session.run_id.slice(-8)}
                            </span>
                            <span className="text-[10px] uppercase font-semibold bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                              {stateLabel}
                            </span>
                          </div>
                          <p className="text-xs text-slate-200 line-clamp-1">
                            {reqSnippet}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleResumeSession(session.run_id)}
                          className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded shadow transition-colors whitespace-nowrap"
                        >
                          Resume Run
                        </button>
                      </div>
                    );
                  })}
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

      {/* Draft Concurrency Conflict Modal (Phase D - MB-409-DRAFT-CONFLICT) */}
      {conflictState && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="conflict-dialog-title"
          aria-describedby="conflict-dialog-desc"
          ref={conflictModalRef}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setConflictEscapeAnnouncement(
                "Explicit choice required: Draft conflict cannot be dismissed with Escape. Please select 'Keep my version as a new draft', 'Review latest saved version', or 'Discard my local changes' to protect your inputs.",
              );
              return;
            }

            if (e.key === "Tab" && conflictModalRef.current) {
              const focusable =
                conflictModalRef.current.querySelectorAll<HTMLElement>(
                  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
                );
              if (focusable.length === 0) return;
              const first = focusable[0]!;
              const last = focusable[focusable.length - 1]!;

              if (e.shiftKey) {
                if (document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                }
              } else {
                if (document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
        >
          <div className="bg-slate-900 border-2 border-amber-600 rounded-xl max-w-lg w-full p-6 shadow-2xl text-slate-100">
            <div className="flex items-center gap-3 text-amber-400 mb-3">
              <span className="text-2xl" aria-hidden="true">
                ⚠️
              </span>
              <h2
                id="conflict-dialog-title"
                className="text-lg font-bold text-white"
              >
                Draft Concurrency Conflict (MB-409-DRAFT-CONFLICT)
              </h2>
            </div>
            <p
              id="conflict-dialog-desc"
              className="text-sm text-slate-300 mb-3"
            >
              This draft was updated in another browser tab or session (Version{" "}
              <span className="font-mono text-amber-300 font-bold">
                {conflictState.current_version}
              </span>{" "}
              saved on server vs your local version{" "}
              <span className="font-mono text-slate-400">
                {conflictState.submitted_version}
              </span>
              ). Automatic merge was prevented to protect your inputs.
            </p>

            {conflictEscapeAnnouncement && (
              <div
                role="status"
                aria-live="assertive"
                className="bg-amber-950/80 border border-amber-500/80 text-amber-200 text-xs p-2.5 rounded-lg mb-3 flex items-start gap-2 animate-in fade-in duration-150"
              >
                <span className="text-amber-400 font-bold" aria-hidden="true">
                  ℹ️
                </span>
                <span>{conflictEscapeAnnouncement}</span>
              </div>
            )}

            <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 text-xs mb-4 space-y-2 max-h-60 overflow-y-auto">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  Your Unsaved Local Inputs (Full Content Preserved)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setShowFullConflictLocal(!showFullConflictLocal)
                  }
                  className="text-sky-400 hover:text-sky-300 text-[10px] underline font-medium"
                >
                  {showFullConflictLocal ? "Collapse View" : "Expand All View"}
                </button>
              </div>
              <div className="space-y-2">
                <div>
                  <span className="font-bold text-slate-300 block mb-0.5">
                    Box 1 — Product Requirement:
                  </span>
                  <p
                    className={`text-slate-200 bg-slate-900/90 p-2 rounded border border-slate-800 font-mono text-[11px] whitespace-pre-wrap ${showFullConflictLocal ? "" : "max-h-24 overflow-y-auto"}`}
                  >
                    {conflictState.unsaved_data.productRequirement || "(empty)"}
                  </p>
                </div>
                <div>
                  <span className="font-bold text-slate-300 block mb-0.5">
                    Box 2 — Technical Compliance:
                  </span>
                  <p
                    className={`text-slate-200 bg-slate-900/90 p-2 rounded border border-slate-800 font-mono text-[11px] whitespace-pre-wrap ${showFullConflictLocal ? "" : "max-h-24 overflow-y-auto"}`}
                  >
                    {conflictState.unsaved_data.technicalCompliance ||
                      "(empty)"}
                  </p>
                </div>
                <div>
                  <span className="font-bold text-slate-300 block mb-0.5">
                    Box 3 — Order Profile:
                  </span>
                  <p
                    className={`text-slate-200 bg-slate-900/90 p-2 rounded border border-slate-800 font-mono text-[11px] whitespace-pre-wrap ${showFullConflictLocal ? "" : "max-h-24 overflow-y-auto"}`}
                  >
                    {conflictState.unsaved_data.orderProfile || "(empty)"}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                ref={conflictPrimaryBtnRef}
                type="button"
                onClick={async () => {
                  const unsaved = conflictState.unsaved_data;
                  if (autosaveTimerRef.current) {
                    clearTimeout(autosaveTimerRef.current);
                  }
                  isCloningDraftRef.current = true;
                  setIsLoading(true);
                  try {
                    const res = await fetch("/api/v1/consultant/workflow", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "clone_draft",
                        draft_data: {
                          productRequirement: unsaved.productRequirement,
                          technicalCompliance: unsaved.technicalCompliance,
                          orderProfile: unsaved.orderProfile,
                          savedAt: new Date().toISOString(),
                        },
                      }),
                    });
                    const d = await res.json();
                    if (d.success && d.draft_id) {
                      updateDraftId(d.draft_id);
                      updateDraftVersion(d.draft_version ?? 1);
                      sessionStorage.setItem(
                        "matchbase_active_draft_id",
                        d.draft_id,
                      );
                      window.history.replaceState(
                        {},
                        "",
                        `/consultant/workflow?draft_id=${d.draft_id}`,
                      );
                      setConflictState(null);
                      setConflictEscapeAnnouncement("");
                      setShowFullConflictLocal(false);
                      previousFocusRef.current?.focus();
                      triggerToast(
                        "Saved local inputs as a new independent draft (Version 1).",
                      );
                    }
                  } catch (e) {
                    console.error("Failed to clone draft:", e);
                  } finally {
                    setIsLoading(false);
                    setTimeout(() => {
                      isCloningDraftRef.current = false;
                    }, 300);
                  }
                }}
                className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg text-xs transition shadow focus:ring-2 focus:ring-sky-400 focus:outline-none"
              >
                Keep my version as a new draft
              </button>

              <button
                type="button"
                onClick={async () => {
                  const targetDraftId = draftId;
                  if (autosaveTimerRef.current) {
                    clearTimeout(autosaveTimerRef.current);
                  }
                  setConflictState(null);
                  setConflictEscapeAnnouncement("");
                  setShowFullConflictLocal(false);
                  previousFocusRef.current?.focus();
                  await loadExistingDraft(targetDraftId);
                  triggerToast("Loaded latest version from server.");
                }}
                className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg text-xs border border-slate-700 transition focus:ring-2 focus:ring-slate-400 focus:outline-none"
              >
                Review latest saved version (overwrite local edits)
              </button>

              <button
                type="button"
                onClick={async () => {
                  const targetDraftId = draftId;
                  if (autosaveTimerRef.current) {
                    clearTimeout(autosaveTimerRef.current);
                  }
                  setConflictState(null);
                  setConflictEscapeAnnouncement("");
                  setShowFullConflictLocal(false);
                  previousFocusRef.current?.focus();
                  await loadExistingDraft(targetDraftId);
                  triggerToast("Discarded unsaved local edits.");
                }}
                className="w-full py-2 px-4 bg-transparent hover:bg-rose-950/40 text-rose-400 hover:text-rose-300 text-xs rounded transition focus:ring-2 focus:ring-rose-400 focus:outline-none"
              >
                Discard my local changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
