import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TopBar } from "@/components/TopBar";
import { useUi } from "@/stores/ui";
import { useProjects } from "@/stores/projects";

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => undefined),
}));

describe("TopBar", () => {
  beforeEach(() => {
    useUi.getState().setTab("projects");
  });

  it("mostra le tab e attiva quella corrente", () => {
    render(<TopBar />);
    for (const label of ["Progetti", "Studio", "DeckBuilder", "Collezione", "Impostazioni"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Progetti" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Studio" }));
    expect(useUi.getState().tab).toBe("studio");
  });

  it("menu Visualizza: voci disabilitate senza progetto attivo", () => {
    useProjects.setState({ activeId: null });
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: /Visualizza/ }));
    expect(screen.getByRole("menu", { name: "Cartelle progetto" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Cartella immagini" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Cartella PDF" })).toBeDisabled();
  });

  it("menu Visualizza: voci abilitate con progetto attivo", () => {
    useProjects.setState({ activeId: "p1" });
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: /Visualizza/ }));
    expect(screen.getByRole("menuitem", { name: "Cartella immagini" })).not.toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Cartella PDF" })).not.toBeDisabled();
    useProjects.setState({ activeId: null });
  });
});
