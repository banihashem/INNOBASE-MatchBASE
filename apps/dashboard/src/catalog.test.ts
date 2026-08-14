import { describe, expect, it } from "vitest";
import { freshnessState, normalizeSnapshot } from "./catalog";
import { fixtureSnapshot } from "./test/fixture";

describe("dashboard snapshot contract", () => {
  it("accepts a complete read-only snapshot", () => {
    expect(
      normalizeSnapshot(fixtureSnapshot()).views.portfolio.records,
    ).toHaveLength(1);
  });

  it("rejects snapshots that could imply mutation", () => {
    expect(() =>
      normalizeSnapshot({ ...fixtureSnapshot(), mode: "WRITE" }),
    ).toThrow(/READ_ONLY/);
  });

  it("rejects missing views so the loader renders a visible schema ERROR", () => {
    const snapshot = fixtureSnapshot() as unknown as {
      views: Record<string, unknown>;
    };
    delete snapshot.views.costs;
    expect(() => normalizeSnapshot(snapshot)).toThrow(/view costs/i);
  });

  it("marks snapshots older than 24 hours as STALE", () => {
    expect(
      freshnessState(
        "2026-08-12T00:00:00.000Z",
        Date.parse("2026-08-14T00:00:01.000Z"),
      ),
    ).toBe("STALE");
  });

  it("marks a recent snapshot ACTIVE rather than inferring PASS", () => {
    expect(
      freshnessState(
        "2026-08-14T00:00:00.000Z",
        Date.parse("2026-08-14T00:00:01.000Z"),
      ),
    ).toBe("ACTIVE");
  });

  it("rejects unrecognized evidence states", () => {
    const snapshot = fixtureSnapshot();
    snapshot.views.portfolio.records[0]!.status = "BROKEN" as never;
    expect(() => normalizeSnapshot(snapshot)).toThrow(/status is invalid/i);
  });

  it("rejects weak or relative source references", () => {
    const snapshot = fixtureSnapshot();
    snapshot.views.portfolio.records[0]!.sourceRefs[0]!.path = "relative.md";
    expect(() => normalizeSnapshot(snapshot)).toThrow(/source reference/i);
  });
});
