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
  // Safe New Draft Modal State (Workstream C - L08-N04)
  const [showNewDraftModal, setShowNewDraftModal] = useState(false);
  const [isSavingNewDraft, setIsSavingNewDraft] = useState(false);
  const [newDraftError, setNewDraftError] = useState<string | null>(null);
  const [incompleteSessions, setIncompleteSessions] = useState<any[]>([]);
  const [activeDraftSession, setActiveDraftSession] = useState<any>(null);
  const [draftId, setDraftId] = useState<string>("");
  const [draftVersion, setDraftVersion] = useState<number>(1);
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
  const [step1Fidelity, setStep1Fidelity] = useState<any>(null);
  const [activeDrafts, setActiveDrafts] = useState<any[]>([]);
  const [conflictEscapeAnnouncement, setConflictEscapeAnnouncement] =
    useState<string>("");
  const [isPdfDownloading, setIsPdfDownloading] = useState<boolean>(false);
  const [isSessionChanged, setIsSessionChanged] = useState<boolean>(false);
  const [showFullLedger, setShowFullLedger] = useState<boolean>(false);
  const [showFullConflictLocal, setShowFullConflictLocal] =
    useState<boolean>(false);
  const initialUserIdRef = useRef<string | null>(null);
  const revalidateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const coherenceSummaryRef = useRef<HTMLDivElement | null>(null);
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isCloningDraftRef = useRef<boolean>(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const conflictModalRef = useRef<HTMLDivElement | null>(null);
  const conflictPrimaryBtnRef = useRef<HTMLButtonElement | null>(null);

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

  // Dynamic Step 1 requirement fidelity revalidation on human edits
  useEffect(() => {
    if (workflowState !== "prep_step1_awaiting_approval" || !step1Translation) {
      return;
    }
    if (revalidateTimeoutRef.current) {
      clearTimeout(revalidateTimeoutRef.current);
    }
    revalidateTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/v1/consultant/workflow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "validate_step1_fidelity",
            intake: {
              product_requirement: productRequirement,
              technical_compliance: technicalCompliance,
              order_profile: orderProfile,
            },
            translation: step1Translation,
          }),
        });
        if (res.ok) {
          const d = await res.json();
          if (d.success && d.fidelity) {
            setStep1Fidelity(d.fidelity);
          }
        }
      } catch (err) {
        console.error("Dynamic fidelity revalidation error:", err);
      }
    }, 400);

    return () => {
      if (revalidateTimeoutRef.current) {
        clearTimeout(revalidateTimeoutRef.current);
      }
    };
  }, [
    step1Translation,
    workflowState,
    productRequirement,
    technicalCompliance,
    orderProfile,
  ]);

  // Check URL params for mode=new, run_id, draft_id or action=resume
  useEffect(() => {
    if (typeof window === "undefined") return;
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

  // Server-side debounced draft auto-save with optimistic concurrency
  useEffect(() => {
    if (
      !userSession ||
      (userSession.tier !== "consultant" && userSession.tier !== "admin")
    )
      return;
    if (hydrationState !== "hydrated") return; // Prevent overwriting before server hydration
    if (runId) return; // Do not overwrite draft once a run is submitted
    if (isCloningDraftRef.current) return; // Freeze autosave during clone transition (N03)
    if (conflictState) return; // Freeze autosave while in conflict state (N03)
    if (!productRequirement && !technicalCompliance && !orderProfile) {
      setDraftStatus("idle");
      return;
    }
    if (!draftId) return;

    setDraftStatus("saving");
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      if (isCloningDraftRef.current || conflictState) return;
      void fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_draft",
          draft_id: draftId,
          draft_version: draftVersion,
          expected_version: draftVersion,
          draft_data: {
            productRequirement,
            technicalCompliance,
            orderProfile,
            savedAt: new Date().toISOString(),
          },
        }),
      })
        .then(async (res) => {
          if (res.status === 409) {
            const errData = await res.json();
            setDraftStatus("idle");
            setConflictState({
              current_version:
                errData.error?.current_version ?? draftVersion + 1,
              submitted_version: draftVersion,
              unsaved_data: {
                productRequirement,
                technicalCompliance,
                orderProfile,
              },
            });
            return;
          }
          if (res.ok) {
            const data = await res.json();
            if (data.draft_version) {
              setDraftVersion(data.draft_version);
            }
            setDraftStatus("saved");
          } else {
            setDraftStatus("idle");
          }
        })
        .catch(() => setDraftStatus("idle"));
    }, 800);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [
    productRequirement,
    technicalCompliance,
    orderProfile,
    runId,
    draftId,
    draftVersion,
    userSession,
    hydrationState,
    conflictState,
  ]);

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
        if (showNewDraftModal) {
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
    if (draft?.draft_data) {
      setProductRequirement(draft.draft_data.productRequirement ?? "");
      setTechnicalCompliance(draft.draft_data.technicalCompliance ?? "");
      setOrderProfile(draft.draft_data.orderProfile ?? "");
      setDraftId(draft.draft_id);
      setDraftVersion(draft.draft_version ?? 1);
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
          setDraftId(data.draft_id);
          setDraftVersion(data.draft_version ?? 1);
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
    setDraftId(fallbackId);
    setDraftVersion(1);
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
          setDraftId(d.draft_id);
          setDraftVersion(d.draft_version ?? 1);
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
          setRunId(s.run_id);
          setWorkflowState(s.state);
          const dId = data.draft?.draft_id ?? s.draft_id;
          const dVer = data.draft?.draft_version ?? s.draft_version ?? 1;
          if (dId) {
            setDraftId(dId);
            setDraftVersion(dVer);
            sessionStorage.setItem("matchbase_active_draft_id", dId);
          }
          if (s.intake) {
            setProductRequirement(s.intake.product_requirement ?? "");
            setTechnicalCompliance(s.intake.technical_compliance ?? "");
            setOrderProfile(s.intake.order_profile ?? "");
          }
          if (s.step1_interpretation) {
            setStep1Translation(
              s.step1_interpretation.english_translation ?? "",
            );
            setStep1Fidelity(
              s.step1_interpretation.fidelity_validation ?? null,
            );
          }
          if (s.step2_advisory) {
            setAdvisoryContext(s.step2_advisory);
          }
          if (s.step3_deep_prompt) {
            setStep3Prompt(
              s.step3_deep_prompt.prompt_text ??
                s.step3_deep_prompt.promptText ??
                "",
            );
          }
          if (s.output) {
            setOutput(s.output);
          }
          if (typeof s.revealed_count === "number") {
            setRevealedCount(s.revealed_count);
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

  async function executeStartNewBlankDraft() {
    sessionStorage.removeItem("matchbase_active_draft_id");
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", "/consultant/workflow?mode=new");
    }
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
    setConflictState(null);
    setStep1Fidelity(null);
    await handleCreateNewDraft();
    triggerToast("Started new blank sourcing workflow.");
  }

  async function handleSaveAndStartNew() {
    setIsSavingNewDraft(true);
    setNewDraftError(null);
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    try {
      const res = await fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_draft",
          draft_id: draftId,
          draft_version: draftVersion,
          expected_version: draftVersion,
          draft_data: {
            productRequirement,
            technicalCompliance,
            orderProfile,
            savedAt: new Date().toISOString(),
          },
        }),
      });

      if (res.status === 409) {
        const errData = await res.json();
        setShowNewDraftModal(false);
        setConflictState({
          current_version: errData.error?.current_version ?? draftVersion + 1,
          submitted_version: draftVersion,
          unsaved_data: {
            productRequirement,
            technicalCompliance,
            orderProfile,
          },
        });
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setNewDraftError(
          errData.error ||
            "Save failed. Your input has been preserved locally.",
        );
        return;
      }

      const data = await res.json();
      if (data.draft_version) {
        setDraftVersion(data.draft_version);
      }
      setDraftStatus("saved");
      setShowNewDraftModal(false);
      await executeStartNewBlankDraft();
    } catch {
      setNewDraftError(
        "Network error while saving draft. Your input is retained.",
      );
    } finally {
      setIsSavingNewDraft(false);
    }
  }

  async function handleDiscardAndStartNew() {
    setShowNewDraftModal(false);
    await executeStartNewBlankDraft();
  }

  async function handleStartNew() {
    const hasUnsavedContent =
      productRequirement.trim().length > 0 ||
      technicalCompliance.trim().length > 0 ||
      orderProfile.trim().length > 0;

    if (hasUnsavedContent) {
      const isDirty =
        draftStatus !== "saved" || autosaveTimerRef.current !== null;
      if (isDirty) {
        setNewDraftError(null);
        setShowNewDraftModal(true);
        return;
      }
    }

    await executeStartNewBlankDraft();
  }

  // Load demonstration examples (F12)
  function handleLoadExample(type: "poultry" | "water_heaters") {
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
    setIsLoading(true);
    setCoherenceError(null);
    try {
      const res = await fetch("/api/v1/consultant/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_intake",
          draft_id: draftId,
          product_requirement: productRequirement,
          technical_compliance: technicalCompliance,
          order_profile: orderProfile,
        }),
      });
      const data = await res.json();
      if (res.status === 422 || data.code === "MB-422-COHERENCE") {
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
        setWorkflowState(data.session.state);
        setStep1Translation(
          data.session.step1_interpretation.english_translation,
        );
        setStep1Fidelity(
          data.session.step1_interpretation.fidelity_validation ?? null,
        );
        setAdvisoryContext(data.session.step2_advisory);
        setDraftStatus("idle");
        setCoherenceError(null);
        const canonicalUrl = draftId
          ? `/consultant/workflow?draft_id=${draftId}&run_id=${data.session.run_id}`
          : `/consultant/workflow?run_id=${data.session.run_id}`;
        window.history.replaceState({}, "", canonicalUrl);
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

  // Action 6: Authenticated PDF Blob Download (Section 8.5)
  async function handlePdfDownload() {
    const targetRunId = runId || output?.research_run_id;
    if (!targetRunId) return;
    setIsPdfDownloading(true);
    try {
      const res = await fetch(`/api/v1/consultant/reports/${targetRunId}/pdf`, {
        method: "GET",
        headers: {
          Accept: "application/pdf",
        },
        credentials: "same-origin",
      });

      if (!res.ok) {
        throw new Error(`PDF request returned HTTP ${res.status}`);
      }

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/pdf")) {
        throw new Error(`Expected application/pdf but received ${contentType}`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition");
      let filename = `MatchBASE_Consultant_Report_${targetRunId}.pdf`;
      if (disposition && disposition.includes("filename=")) {
        const match = disposition.match(/filename="?([^";]+)"?/i);
        if (match?.[1]) filename = match[1];
      }

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

      triggerToast("Full PDF report downloaded successfully.");
    } catch (e: any) {
      console.error("PDF download failed:", e);
      triggerToast(`PDF download failed: ${e?.message || "Unknown error"}`);
    } finally {
      setIsPdfDownloading(false);
    }
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
                      Box 1: Product Requirement (Specification, Grade,
                      Dimensions, Form)
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
                      <strong>Guidance:</strong> Specify exact product
                      attributes: dimensions, capacity, materials, grades, and
                      packaging configurations. Avoid commercial terms or prices
                      here.
                    </div>
                  )}

                  <textarea
                    id="input-box-1"
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
                      clearances, quality certifications (e.g. CE, SFDA, Halal,
                      ISO, PED), and technical testing regimes.
                    </div>
                  )}

                  <textarea
                    id="input-box-2"
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
                      Box 3: Order &amp; Commercial Profile (Volume, Terms,
                      Port, Lead Time)
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
                      recurring), Incoterms (CIF, CFR, FOB, DDP), target
                      destination ports, and supplier relationship tier (direct
                      manufacturer vs trader).
                    </div>
                  )}

                  <textarea
                    id="input-box-3"
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
            );
          })()}
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

              {/* Step 1 Explicit Requirement Fidelity Review (N02 & Phase D) */}
              {step1Fidelity && (
                <div className="space-y-3 mb-3">
                  {/* Fidelity Failure Gating Warning Banner */}
                  {!step1Fidelity.valid && (
                    <div
                      role="alert"
                      className="bg-rose-950/70 border-2 border-rose-500 rounded-lg p-3 text-xs space-y-2 text-rose-200 animate-in fade-in"
                    >
                      <div className="flex items-center gap-2 text-rose-300 font-bold text-sm">
                        <span className="text-lg" aria-hidden="true">
                          🚫
                        </span>
                        <span>
                          Approval Gated: Directional / Qualifier Fidelity
                          Mismatch Detected
                        </span>
                      </div>
                      <p className="text-slate-300 text-[11px]">
                        The English interpretation contains semantic mutations
                        or omissions against the original explicit requirements.
                        Approval is disabled until all mandatory requirements
                        are preserved. Edit the English interpretation above to
                        correct them.
                      </p>

                      {/* Mutated Items Details */}
                      {Array.isArray(step1Fidelity.mutated_items) &&
                        step1Fidelity.mutated_items.length > 0 && (
                          <div className="space-y-1.5 mt-2">
                            <div className="font-semibold text-rose-300 text-[11px] uppercase tracking-wider">
                              Mutated Requirements (
                              {step1Fidelity.mutated_count}):
                            </div>
                            {step1Fidelity.mutated_items.map(
                              (item: any, idx: number) => (
                                <div
                                  key={idx}
                                  className="bg-rose-900/40 border border-rose-700/60 p-2 rounded text-[11px]"
                                >
                                  <div className="font-bold text-rose-200">
                                    ⚠️{" "}
                                    {item.requirement?.label ||
                                      item.requirement?.concept}
                                    : {item.explanation}
                                  </div>
                                  <div className="text-slate-300 text-[10px] mt-0.5">
                                    <strong>Source Span:</strong> "
                                    {item.requirement
                                      ?.source_span_or_reference ||
                                      item.requirement?.source_text}
                                    "
                                  </div>
                                  {item.prohibited_value && (
                                    <div className="text-rose-400 text-[10px]">
                                      <strong>Mutated Value:</strong> "
                                      {item.prohibited_value}"
                                    </div>
                                  )}
                                </div>
                              ),
                            )}
                          </div>
                        )}

                      {/* Omitted Items Details */}
                      {Array.isArray(step1Fidelity.omitted_items) &&
                        step1Fidelity.omitted_items.length > 0 && (
                          <div className="space-y-1.5 mt-2">
                            <div className="font-semibold text-amber-300 text-[11px] uppercase tracking-wider">
                              Omitted Requirements (
                              {step1Fidelity.omitted_count}):
                            </div>
                            {step1Fidelity.omitted_items.map(
                              (item: any, idx: number) => (
                                <div
                                  key={idx}
                                  className="bg-amber-900/30 border border-amber-700/50 p-2 rounded text-[11px]"
                                >
                                  <div className="font-bold text-amber-200">
                                    ⚠️ Omitted: {item.label} ({item.concept})
                                  </div>
                                  <div className="text-slate-300 text-[10px] mt-0.5">
                                    <strong>Source Span:</strong> "
                                    {item.source_span_or_reference ||
                                      item.source_text}
                                    "
                                  </div>
                                </div>
                              ),
                            )}
                          </div>
                        )}
                    </div>
                  )}

                  {/* Fidelity Status Header & Metrics Summary */}
                  <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      {step1Fidelity.valid ? (
                        <span className="font-semibold text-emerald-400 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
                          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                          Requirement Fidelity Verified (All{" "}
                          {step1Fidelity.ledger?.total_explicit_count ??
                            step1Fidelity.preserved_count}{" "}
                          explicit requirements preserved)
                        </span>
                      ) : (
                        <span className="font-semibold text-rose-400 flex items-center gap-1.5 text-[11px] uppercase tracking-wider">
                          <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse"></span>
                          Requirement Fidelity Gated (
                          {step1Fidelity.mutated_count ?? 0} Mutated &bull;{" "}
                          {step1Fidelity.omitted_count ?? 0} Omitted)
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400">
                        Mutations: {step1Fidelity.mutated_count ?? 0} &bull;
                        Omissions: {step1Fidelity.omitted_count ?? 0}
                      </span>
                    </div>

                    {/* Compact Summary Metrics (Section 10.2) */}
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 pt-1">
                      <div className="bg-slate-900/90 p-2 rounded border border-slate-800 text-center">
                        <span className="text-slate-400 text-[10px] block">
                          Explicit
                        </span>
                        <span className="font-bold text-white text-xs">
                          {step1Fidelity.ledger?.total_explicit_count ?? 0}
                        </span>
                      </div>
                      <div className="bg-slate-900/90 p-2 rounded border border-slate-800 text-center">
                        <span className="text-emerald-400 text-[10px] block">
                          Preserved
                        </span>
                        <span className="font-bold text-emerald-300 text-xs">
                          {step1Fidelity.preserved_count ?? 0}
                        </span>
                      </div>
                      <div className="bg-slate-900/90 p-2 rounded border border-slate-800 text-center">
                        <span className="text-sky-400 text-[10px] block">
                          Normalized
                        </span>
                        <span className="font-bold text-sky-300 text-xs">
                          {step1Fidelity.normalized_count ?? 0}
                        </span>
                      </div>
                      <div className="bg-slate-900/90 p-2 rounded border border-slate-800 text-center">
                        <span className="text-slate-400 text-[10px] block">
                          Clarifications
                        </span>
                        <span className="font-bold text-slate-300 text-xs">
                          {step1Fidelity.ambiguities_count ?? 0}
                        </span>
                      </div>
                      <div className="bg-slate-900/90 p-2 rounded border border-slate-800 text-center">
                        <span
                          className={
                            step1Fidelity.omitted_count > 0
                              ? "text-amber-400 font-semibold text-[10px] block"
                              : "text-slate-400 text-[10px] block"
                          }
                        >
                          Omitted
                        </span>
                        <span
                          className={`font-bold text-xs ${step1Fidelity.omitted_count > 0 ? "text-amber-400" : "text-slate-300"}`}
                        >
                          {step1Fidelity.omitted_count ?? 0}
                        </span>
                      </div>
                      <div className="bg-slate-900/90 p-2 rounded border border-slate-800 text-center">
                        <span
                          className={
                            step1Fidelity.mutated_count > 0
                              ? "text-rose-400 font-semibold text-[10px] block"
                              : "text-slate-400 text-[10px] block"
                          }
                        >
                          Mutated
                        </span>
                        <span
                          className={`font-bold text-xs ${step1Fidelity.mutated_count > 0 ? "text-rose-400" : "text-slate-300"}`}
                        >
                          {step1Fidelity.mutated_count ?? 0}
                        </span>
                      </div>
                    </div>

                    {/* Progressive Disclosure Toggle */}
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => setShowFullLedger(!showFullLedger)}
                        className="text-sky-400 hover:text-sky-300 text-[11px] underline font-medium"
                      >
                        {showFullLedger
                          ? "Hide Structured Requirement Ledger"
                          : `View Structured Requirement Ledger (${step1Fidelity.ledger?.requirements?.length ?? 0} clauses)`}
                      </button>

                      {showFullLedger && step1Fidelity.ledger?.requirements && (
                        <div className="max-h-60 overflow-y-auto mt-2 border border-slate-800 rounded bg-slate-900/90 text-[10px]">
                          <table className="w-full text-left">
                            <thead className="bg-slate-800/80 text-slate-300 sticky top-0">
                              <tr>
                                <th className="p-1.5">Requirement</th>
                                <th className="p-1.5">Original Source Span</th>
                                <th className="p-1.5">
                                  Interpreted Normalized
                                </th>
                                <th className="p-1.5">Operator</th>
                                <th className="p-1.5">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                              {step1Fidelity.ledger.requirements.map(
                                (r: any, idx: number) => (
                                  <tr
                                    key={idx}
                                    className="hover:bg-slate-800/40"
                                  >
                                    <td className="p-1.5 font-semibold text-slate-200">
                                      {r.label}
                                    </td>
                                    <td className="p-1.5 text-slate-400 italic">
                                      "
                                      {r.source_span_or_reference ||
                                        r.source_text}
                                      "
                                    </td>
                                    <td className="p-1.5 text-slate-300">
                                      {r.normalized_value}
                                    </td>
                                    <td className="p-1.5 font-mono text-amber-300 font-semibold">
                                      {r.comparison_operator || "—"}
                                    </td>
                                    <td className="p-1.5">
                                      <span
                                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                          r.fidelity_status === "preserved"
                                            ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                                            : r.fidelity_status === "mutated"
                                              ? "bg-rose-950 text-rose-300 border border-rose-800"
                                              : "bg-slate-800 text-slate-300"
                                        }`}
                                      >
                                        {r.fidelity_status}
                                      </span>
                                    </td>
                                  </tr>
                                ),
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Model Suggestions (Kept Separate) */}
                    {Array.isArray(step1Fidelity.model_suggestions) &&
                      step1Fidelity.model_suggestions.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-800/80">
                          <div className="text-amber-300 font-semibold text-[11px] flex items-center gap-1 mb-1">
                            <span>💡</span> Model Suggestions (Separated from
                            Approved Facts):
                          </div>
                          {step1Fidelity.model_suggestions.map(
                            (s: any, idx: number) => (
                              <div
                                key={idx}
                                className="bg-amber-950/20 border border-amber-800/40 rounded p-2 text-amber-200/90 text-[11px]"
                              >
                                <span className="font-bold text-amber-300">
                                  {s.title}:
                                </span>{" "}
                                {s.suggested_value} —{" "}
                                <span className="text-amber-300/80 italic">
                                  {s.reasoning}
                                </span>{" "}
                                <span className="text-slate-400 text-[10px] block mt-0.5">
                                  [Status: Kept as suggestion only; not injected
                                  into mandatory requirements]
                                </span>
                              </div>
                            ),
                          )}
                        </div>
                      )}
                  </div>
                </div>
              )}

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
                    workflowState !== "prep_step1_awaiting_approval" ||
                    step1Fidelity?.valid === false
                  }
                  title={
                    step1Fidelity?.valid === false
                      ? "Approval disabled: mandatory requirements contain mutations or omissions. Edit the English interpretation to correct them."
                      : undefined
                  }
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {workflowState === "prep_step1_awaiting_approval"
                    ? step1Fidelity?.valid === false
                      ? "Approval Gated (Fidelity Issues)"
                      : "Approve Interpretation & Proceed"
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
                <button
                  type="button"
                  onClick={handlePdfDownload}
                  disabled={isPdfDownloading}
                  aria-label="Download Full PDF Report"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                  {isPdfDownloading
                    ? "Generating PDF..."
                    : "Download Full PDF Report"}
                </button>

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
                              href={supp.website ?? undefined}
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

      {/* Safe New Transition Modal (Workstream C - L08-N04) */}
      {showNewDraftModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-draft-modal-title"
          aria-describedby="new-draft-modal-desc"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSavingNewDraft) {
              setShowNewDraftModal(false);
            }
          }}
        >
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4 text-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2
                id="new-draft-modal-title"
                className="text-base font-bold text-white flex items-center gap-2"
              >
                <span>Save Unsaved Changes?</span>
              </h2>
              <button
                type="button"
                onClick={() => setShowNewDraftModal(false)}
                disabled={isSavingNewDraft}
                className="text-slate-400 hover:text-white p-1 rounded-md transition-colors"
                aria-label="Close dialog"
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

            <p
              id="new-draft-modal-desc"
              className="text-xs text-slate-300 leading-relaxed"
            >
              You have active inputs in your current draft that have not yet
              been confirmed on the server. How would you like to proceed?
            </p>

            {newDraftError && (
              <div className="p-2.5 bg-red-950/60 border border-red-800 rounded text-xs text-red-200">
                {newDraftError}
              </div>
            )}

            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                id="save-and-start-new-btn"
                data-testid="save-and-start-new"
                disabled={isSavingNewDraft}
                onClick={handleSaveAndStartNew}
                className="w-full py-2 px-3 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow transition-colors flex items-center justify-center gap-2"
              >
                {isSavingNewDraft ? (
                  <>
                    <svg
                      className="animate-spin h-3.5 w-3.5 text-white"
                      viewBox="0 0 24 24"
                      fill="none"
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
                    Saving on Server...
                  </>
                ) : (
                  "Save & Start New"
                )}
              </button>

              <button
                type="button"
                id="stay-in-draft-btn"
                data-testid="stay-in-draft"
                disabled={isSavingNewDraft}
                onClick={() => setShowNewDraftModal(false)}
                className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
              >
                Stay &amp; Continue Editing
              </button>

              <button
                type="button"
                id="discard-and-start-new-btn"
                data-testid="discard-and-start-new"
                disabled={isSavingNewDraft}
                onClick={handleDiscardAndStartNew}
                className="w-full py-2 px-3 bg-red-950/40 hover:bg-red-900/60 disabled:opacity-50 text-red-300 text-xs font-semibold rounded-lg border border-red-800/60 transition-colors"
              >
                Discard Unsaved Inputs &amp; Start New
              </button>
            </div>
          </div>
        </div>
      )}

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
                      setDraftId(d.draft_id);
                      setDraftVersion(d.draft_version ?? 1);
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
