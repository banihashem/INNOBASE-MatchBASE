import { generateConsultantLandscapeHtml } from "./consultant-landscape-report.js";
import type { ConsultantResearchOutputV3 } from "@matchbase/contracts";

export async function generateConsultantPdf(
  output: ConsultantResearchOutputV3,
): Promise<Buffer> {
  const html = generateConsultantLandscapeHtml(output);

  // Dynamic import of @playwright/test chromium for headless PDF printing
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdfUint8 = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: {
        top: "12mm",
        right: "15mm",
        bottom: "15mm",
        left: "15mm",
      },
    });
    return Buffer.from(pdfUint8);
  } finally {
    await browser.close();
  }
}
