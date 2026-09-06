"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ConsultantWorkflowErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log unexpected errors securely without leaking internals to UI
    console.error(
      "Consultant workflow route error boundary caught an error:",
      error.message,
    );
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 flex items-center justify-center font-sans">
      <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-xl p-6 text-center space-y-4 shadow-2xl">
        <div className="w-12 h-12 rounded-full bg-amber-950/80 text-amber-400 border border-amber-700/60 mx-auto flex items-center justify-center font-bold text-xl">
          !
        </div>
        <h1 className="text-xl font-bold text-white">
          We could not continue this research request.
        </h1>
        <p className="text-sm text-slate-300">Your saved draft is intact.</p>
        <p className="text-xs text-slate-400">
          Retry or return to the request.
        </p>
        <div className="pt-3 flex flex-col sm:flex-row gap-2 justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg transition-colors shadow"
          >
            Retry Request
          </button>
          <Link
            href="/consultant/workflow"
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-600"
          >
            Return to Workflow
          </Link>
          <Link
            href="/runs"
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition-colors border border-slate-700"
          >
            Run Directory
          </Link>
        </div>
      </div>
    </div>
  );
}
