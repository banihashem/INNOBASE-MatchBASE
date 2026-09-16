import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileEvidenceLibrary } from "./ProfileEvidenceLibrary";

describe("ProfileEvidenceLibrary", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          current_count: 1,
          expired_count: 2,
          fresh_discovery_required: true,
          observations: [
            {
              observation_id: "obs-1",
              claim_kind: "logistics",
              claim_text: "Example Freight provides ocean forwarding.",
              eligible_until: "2026-10-01T00:00:00.000Z",
              category_match: "related",
              classification: {
                scheme: "CPC",
                code: "67910",
                label: "Freight transport agency services",
              },
              source: {
                source_url: "https://supplier.example.org/services",
                publisher: "Supplier",
                retrieved_at: "2026-09-15T00:00:00.000Z",
              },
            },
          ],
        }),
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows profile-only evidence and explains freshness boundaries", async () => {
    render(<ProfileEvidenceLibrary />);
    expect(
      await screen.findByText(/Example Freight provides ocean forwarding/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Related category/)).toBeInTheDocument();
    expect(
      screen.getByText(/fresh discovery and verification/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 current · 2 need refresh/)).toBeInTheDocument();
  });

  it("submits a bounded read-only search and status filter", async () => {
    render(<ProfileEvidenceLibrary />);
    await screen.findByText(/Example Freight provides ocean forwarding/);
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Aqaba freight" },
    });
    fireEvent.change(screen.getByLabelText("Evidence status"), {
      target: { value: "all" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Search saved evidence" }),
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        expect.stringContaining("status=all&query=Aqaba+freight"),
        { cache: "no-store" },
      ),
    );
  });
});
