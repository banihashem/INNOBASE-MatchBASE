import type { StandardRequestDetailV1 } from "../v1/standard-projection.js";
import type { StructuredStandardRequestV2 } from "./structured-request.js";

export const STANDARD_REQUEST_DETAIL_V2_SCHEMA_VERSION =
  "standard-request-detail.v2" as const;

export interface StandardRequestDetailV2 extends Omit<
  StandardRequestDetailV1,
  "schema_version" | "canonical"
> {
  schema_version: typeof STANDARD_REQUEST_DETAIL_V2_SCHEMA_VERSION;
  canonical: StructuredStandardRequestV2;
}
