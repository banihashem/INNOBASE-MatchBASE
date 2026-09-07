import { useState } from "react";
import type { ConsultantResearchOutputV3 } from "@matchbase/contracts";

export function useConsultantReportDownloads(
  output: ConsultantResearchOutputV3 | null,
  runId: string | null,
  triggerToast: (message: string) => void,
) {
  const [isPdfDownloading, setIsPdfDownloading] = useState(false);
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

      triggerToast("PDF prepared and handed to your browser for saving.");
    } catch (e: any) {
      console.error("PDF download failed:", e);
      triggerToast(`PDF download failed: ${e?.message || "Unknown error"}`);
    } finally {
      setIsPdfDownloading(false);
    }
  }

  return { isPdfDownloading, handleJsonExport, handlePdfDownload };
}
