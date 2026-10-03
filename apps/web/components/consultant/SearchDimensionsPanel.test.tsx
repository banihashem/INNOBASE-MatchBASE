import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSearchDimensionConfiguration } from "@matchbase/contracts";
import { SearchDimensionsPanel } from "./SearchDimensionsPanel";

const saved = vi.fn();
const pending = vi.fn();
const configuration = createSearchDimensionConfiguration({
  profile_ids: ["core", "logistics.ocean"],
});

function openPanel(editable = true) {
  render(
    <SearchDimensionsPanel
      runId="run-1"
      configuration={configuration}
      revision="revision-1"
      editable={editable}
      onPendingChange={pending}
      onSaved={saved}
    />,
  );
  fireEvent.click(screen.getByText("Review dimensions and add priorities"));
}

beforeEach(() => {
  saved.mockClear();
  pending.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      return new Response(
        JSON.stringify({
          success: true,
          session: {
            search_dimensions: body.configuration,
            search_dimension_revision: "revision-2",
            search_dimensions_editable: true,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
});

describe("MB-SEARCH-DIMENSIONS-002 L01 search dimensions", () => {
  it("requires an explicit first save for a new configuration", async () => {
    render(
      <SearchDimensionsPanel
        runId="run-1"
        configuration={configuration}
        revision={null}
        editable
        onPendingChange={pending}
        onSaved={saved}
      />,
    );
    expect(pending).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Save dimensions" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    const request = JSON.parse(String((fetch as any).mock.calls[0][1].body));
    expect(request.expected_revision).toBeNull();
  });

  it("keeps protected checks selected while saving an optional choice with revision authority", async () => {
    openPanel();
    const protectedRow = screen
      .getByText("Legal supplier identity")
      .closest(".search-dimensions-row")!;
    expect(
      within(protectedRow as HTMLElement).getByRole("checkbox"),
    ).toBeDisabled();
    const optionalRow = screen
      .getByText("Backup routing")
      .closest(".search-dimensions-row")!;
    fireEvent.click(within(optionalRow as HTMLElement).getByRole("checkbox"));
    expect(pending).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Save dimensions" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    const request = JSON.parse(String((fetch as any).mock.calls[0][1].body));
    expect(request).toMatchObject({
      action: "save_search_dimensions",
      run_id: "run-1",
      expected_revision: "revision-1",
    });
    expect(
      request.configuration.selections.find(
        (item: any) => item.dimension_id === "logistics.backup_routing",
      ).active,
    ).toBe(false);
    expect(
      request.configuration.selections.find(
        (item: any) => item.dimension_id === "core.identity",
      ).active,
    ).toBe(true);
  });

  it("does not send an unsourced mandatory requirement", async () => {
    openPanel();
    const row = screen
      .getByText("Backup routing")
      .closest(".search-dimensions-row")!;
    fireEvent.change(within(row as HTMLElement).getByLabelText("Priority"), {
      target: { value: "mandatory" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save dimensions" }));
    expect(screen.getByRole("alert")).toHaveTextContent("exact wording");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows saved dimensions read only after approval", () => {
    openPanel(false);
    expect(
      screen.getByText(
        "These dimensions belong to the saved research plan and can no longer be edited.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Save dimensions" }),
    ).not.toBeInTheDocument();
    const row = screen
      .getByText("Backup routing")
      .closest(".search-dimensions-row")!;
    expect(within(row as HTMLElement).getByRole("checkbox")).toBeDisabled();
  });

  it("adds a multilingual custom dimension within the chosen research profile", async () => {
    openPanel();
    fireEvent.click(screen.getByText("Add a custom dimension"));
    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "دمای حمل" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Verify temperature during transport." },
    });
    fireEvent.change(screen.getByLabelText("Research profile"), {
      target: { value: "logistics.ocean" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Add dimension to this request" }),
    );
    expect(screen.getByText("دمای حمل")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save dimensions" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    const request = JSON.parse(String((fetch as any).mock.calls[0][1].body));
    expect(request.configuration.custom_definitions[0]).toMatchObject({
      label: "دمای حمل",
      profile_ids: ["logistics.ocean"],
      kind: "capability",
    });
    expect(request.configuration.custom_definitions[0].id).toMatch(
      /^custom\.d[a-f0-9]{32}$/,
    );
  });
});
