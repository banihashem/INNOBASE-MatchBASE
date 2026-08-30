import { timingSafeEqual } from "node:crypto";
import type { WebConfig } from "./config";

export const ORIGIN_ADMISSION_HEADER = "mb-origin-admission";

export function assertProductionOriginAdmission(
  config: WebConfig,
  headers: Headers,
): void {
  if (config.environment !== "production") return;
  const expected = config.originAdmissionKey;
  const suppliedText = headers.get(ORIGIN_ADMISSION_HEADER);
  if (!expected || !suppliedText || Buffer.byteLength(suppliedText) > 512) {
    throw new Error("Production origin admission refused.");
  }
  const supplied = Buffer.from(suppliedText, "utf8");
  if (
    supplied.byteLength !== expected.byteLength ||
    !timingSafeEqual(supplied, expected)
  ) {
    throw new Error("Production origin admission refused.");
  }
}
