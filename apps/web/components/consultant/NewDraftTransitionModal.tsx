import { useEffect, useRef, type RefObject } from "react";

interface NewDraftTransitionModalProps {
  showNewDraftModal: boolean;
  isSavingNewDraft: boolean;
  newDraftError: string | null;
  transitionRef: RefObject<boolean>;
  onDismiss: () => void;
  handleSaveAndStartNew: () => Promise<void>;
  handleDiscardAndStartNew: () => Promise<void>;
}

export function NewDraftTransitionModal({
  showNewDraftModal,
  isSavingNewDraft,
  newDraftError,
  transitionRef,
  onDismiss,
  handleSaveAndStartNew,
  handleDiscardAndStartNew,
}: NewDraftTransitionModalProps) {
  const newDraftModalRef = useRef<HTMLDivElement | null>(null);
  const newDraftPreviousFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!showNewDraftModal) return;
    newDraftPreviousFocusRef.current = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    newDraftModalRef.current
      ?.querySelector<HTMLButtonElement>("#stay-in-draft-btn")
      ?.focus();
    function keepFocus(event: FocusEvent) {
      if (!newDraftModalRef.current?.contains(event.target as Node))
        newDraftModalRef.current?.focus();
    }
    document.addEventListener("focusin", keepFocus);
    return () => {
      document.removeEventListener("focusin", keepFocus);
      document.body.style.overflow = previousOverflow;
      newDraftPreviousFocusRef.current?.focus();
    };
  }, [showNewDraftModal]);

  return (
    <>
      {showNewDraftModal && (
        <div
          role="dialog"
          ref={newDraftModalRef}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              if (!transitionRef.current) onDismiss();
            }
            if (event.key !== "Tab") return;
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
              ),
            );
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (!first || !last) {
              event.preventDefault();
              event.currentTarget.focus();
              return;
            }
            if (
              event.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === event.currentTarget)
            ) {
              event.preventDefault();
              last.focus();
            } else if (
              !event.shiftKey &&
              (document.activeElement === last ||
                document.activeElement === event.currentTarget)
            ) {
              event.preventDefault();
              first.focus();
            }
          }}
          aria-modal="true"
          aria-labelledby="new-draft-modal-title"
          aria-describedby="new-draft-modal-desc"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSavingNewDraft) {
              onDismiss();
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
                onClick={() => onDismiss()}
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
                onClick={() => onDismiss()}
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
    </>
  );
}
