import { describe, expect, it } from "vitest";
import { assertProductionOriginAdmission } from "./origin-admission";
import type { WebConfig } from "./config";

const production = {
  environment: "production",
  originAdmissionKey: Buffer.from(
    "closed-origin-admission-key-material-32-bytes",
  ),
} as WebConfig;

describe("production origin admission", () => {
  it("rejects direct requests without the independently managed header", () => {
    expect(() =>
      assertProductionOriginAdmission(production, new Headers()),
    ).toThrow(/origin admission refused/u);
    expect(() =>
      assertProductionOriginAdmission(
        production,
        new Headers({ "MB-Origin-Admission": "wrong" }),
      ),
    ).toThrow(/origin admission refused/u);
  });

  it("accepts only the exact constant-time header value", () => {
    expect(() =>
      assertProductionOriginAdmission(
        production,
        new Headers({
          "MB-Origin-Admission":
            "closed-origin-admission-key-material-32-bytes",
        }),
      ),
    ).not.toThrow();
  });

  it("does not affect isolated local or test runtimes", () => {
    expect(() =>
      assertProductionOriginAdmission(
        { ...production, environment: "test" },
        new Headers(),
      ),
    ).not.toThrow();
  });
});
