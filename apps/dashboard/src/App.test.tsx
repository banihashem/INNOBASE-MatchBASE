import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { fixtureSnapshot } from "./test/fixture";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PM control room", () => {
  it("shows all thirteen read-only views", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fixtureSnapshot())),
    );
    render(<App />);
    await screen.findByText("Local PM dashboard");
    for (const name of [
      "Portfolio",
      "Gates",
      "Backlog",
      "Decisions",
      "Risks",
      "Requirements",
      "Tests",
      "Defects",
      "Deployments",
      "Costs",
      "Agents",
      "Loops",
      "Evidence",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByText("No mutation controls")).toBeInTheDocument();
  });

  it("opens exact source drilldown and closes with Escape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fixtureSnapshot())),
    );
    render(<App />);
    const trigger = await screen.findByRole("button", {
      name: /Inspect 1 source/,
    });
    trigger.focus();
    fireEvent.click(trigger);
    const close = screen.getByRole("button", {
      name: "Close source drilldown",
    });
    expect(close).toHaveFocus();
    expect(document.querySelector("main")).toHaveAttribute("inert");
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();
    expect(
      screen.getByRole("dialog", { name: "Local PM dashboard" }),
    ).toHaveTextContent("ROLE3_IMPLEMENTATION_ORCHESTRATOR_PROMPT_PO_001.md");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
    expect(document.querySelector("main")).not.toHaveAttribute("inert");
  });

  it("renders a visible ERROR state when evidence cannot load", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("offline evidence"),
    );
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "offline evidence",
    );
    expect(screen.getAllByText("ERROR").length).toBeGreaterThan(0);
  });

  it("uses the tracked UNKNOWN bootstrap when no local snapshot exists", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(fixtureSnapshot())));
    render(<App />);
    expect(await screen.findByText("Local PM dashboard")).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("navigates and renders every control view", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fixtureSnapshot())),
    );
    render(<App />);
    await screen.findByText("Local PM dashboard");
    for (const name of [
      "Portfolio",
      "Gates",
      "Backlog",
      "Decisions",
      "Risks",
      "Requirements",
      "Tests",
      "Defects",
      "Deployments",
      "Costs",
      "Agents",
      "Loops",
      "Evidence",
    ]) {
      const navigation = screen.getByRole("button", { name });
      fireEvent.click(navigation);
      expect(
        screen.getByRole("heading", { level: 1, name }),
      ).toBeInTheDocument();
      expect(navigation).toHaveAttribute("aria-current", "page");
    }
  });
});
