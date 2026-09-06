import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateConsultantLandscapeHtml } from "./consultant-landscape-report.js";
import type { ConsultantResearchOutputV3 } from "@matchbase/contracts";

export class ConsultantPdfRendererUnavailableError extends Error {
  readonly code = "MB-503-PDF-RENDERER-UNAVAILABLE";
  readonly status = 503;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ConsultantPdfRendererUnavailableError";
    if (cause) {
      this.cause = cause;
    }
  }
}

export class ConsultantPdfRenderer {
  private static instance: ConsultantPdfRenderer | null = null;
  private browserInstance: any = null;
  private browserPromise: Promise<any> | null = null;

  static getInstance(): ConsultantPdfRenderer {
    if (!ConsultantPdfRenderer.instance) {
      ConsultantPdfRenderer.instance = new ConsultantPdfRenderer();
    }
    return ConsultantPdfRenderer.instance;
  }

  private async getBrowser(): Promise<any> {
    if (this.browserInstance && this.browserInstance.isConnected?.()) {
      return this.browserInstance;
    }
    if (this.browserPromise) {
      return this.browserPromise;
    }

    this.browserPromise = (async () => {
      const { chromium } = await import("@playwright/test");
      const browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });
      this.browserInstance = browser;
      browser.on("disconnected", () => {
        this.browserInstance = null;
        this.browserPromise = null;
      });
      return browser;
    })();

    try {
      return await this.browserPromise;
    } catch (err) {
      this.browserPromise = null;
      this.browserInstance = null;
      throw err;
    }
  }

  private getCacheDir(): string {
    const candidates = [
      path.resolve(
        "C:/INNOBASE/MatchBASE/03_Implementation/INNOBASE-MatchBASE/.artifacts/consultant-pdf",
      ),
      path.resolve(process.cwd(), ".artifacts/consultant-pdf"),
      path.resolve(process.cwd(), "../.artifacts/consultant-pdf"),
    ];
    for (const c of candidates) {
      const parent = path.dirname(c);
      if (fs.existsSync(/*turbopackIgnore: true*/ parent)) {
        if (!fs.existsSync(/*turbopackIgnore: true*/ c)) {
          try {
            fs.mkdirSync(c, { recursive: true });
          } catch {}
        }
        return c;
      }
    }
    const defaultDir = path.resolve(process.cwd(), ".artifacts/consultant-pdf");
    if (!fs.existsSync(defaultDir)) {
      try {
        fs.mkdirSync(defaultDir, { recursive: true });
      } catch {}
    }
    return defaultDir;
  }

  async preflight(): Promise<boolean> {
    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      await page.setContent(
        "<html><body>MatchBASE PDF Preflight OK</body></html>",
      );
      await page.close();
      return true;
    } catch (err) {
      console.warn("ConsultantPdfRenderer preflight check failed:", err);
      return false;
    }
  }

  async renderPdf(output: ConsultantResearchOutputV3): Promise<Buffer> {
    const runId = output.research_run_id || "unknown";
    const html = generateConsultantLandscapeHtml(output);
    const contentHash = createHash("sha256")
      .update(html)
      .digest("hex")
      .slice(0, 16);
    const cacheDir = this.getCacheDir();
    const cacheFilePath = path.join(cacheDir, `${runId}_${contentHash}.pdf`);

    // 1. Return cached PDF if available and valid
    try {
      if (fs.existsSync(cacheFilePath)) {
        const cachedBuf = fs.readFileSync(cacheFilePath);
        if (this.isValidPdf(cachedBuf)) {
          return cachedBuf;
        }
      }
    } catch (cacheReadErr) {
      console.warn("Could not read from PDF cache:", cacheReadErr);
    }

    // 2. Render with bounded retry
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const browser = await this.getBrowser();
        const page = await browser.newPage();
        try {
          await page.setContent(html, { waitUntil: "load", timeout: 25000 });
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
            timeout: 30000,
          });
          const pdfBuf = Buffer.from(pdfUint8);
          if (!this.isValidPdf(pdfBuf)) {
            throw new Error(
              `Rendered PDF failed validity check: bytes=${pdfBuf.length}`,
            );
          }
          // Save to cache
          try {
            fs.writeFileSync(cacheFilePath, pdfBuf);
          } catch (cacheWriteErr) {
            console.warn("Failed to write PDF cache file:", cacheWriteErr);
          }
          return pdfBuf;
        } finally {
          await page.close().catch(() => {});
        }
      } catch (renderErr) {
        lastError = renderErr;
        console.warn(`PDF render attempt ${attempt} failed:`, renderErr);
        if (this.browserInstance) {
          try {
            await this.browserInstance.close();
          } catch {}
          this.browserInstance = null;
          this.browserPromise = null;
        }
      }
    }

    throw new ConsultantPdfRendererUnavailableError(
      "Consultant PDF renderer is currently unavailable. Please retry shortly.",
      lastError,
    );
  }

  private isValidPdf(buf: Buffer): boolean {
    return (
      buf.length > 10240 && buf.subarray(0, 5).toString("utf-8") === "%PDF-"
    );
  }
}

export async function preflightConsultantPdfRenderer(): Promise<boolean> {
  return ConsultantPdfRenderer.getInstance().preflight();
}

export async function generateConsultantPdf(
  output: ConsultantResearchOutputV3,
): Promise<Buffer> {
  return ConsultantPdfRenderer.getInstance().renderPdf(output);
}
