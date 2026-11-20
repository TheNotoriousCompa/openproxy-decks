import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectsView } from "@/features/projects/ProjectsView";
import { useProjects } from "@/stores/projects";
import { useDeck } from "@/stores/deck";
import { useUi } from "@/stores/ui";
import { usePrint, DEFAULT_PRINT } from "@/stores/print";
import { invoke } from "@tauri-apps/api/core";
import { putMeta } from "@/lib/cardmetaCache";
import type { Project } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("ProjectsView navigazione (pulsanti veri)", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjects.setState({ projects: [], activeId: null, loading: false, error: null, search: "" });
    useDeck.getState().hydrate([]);
    useUi.getState().setTab("projects");
  });

  it("Crea → va allo Studio", async () => {
    render(<ProjectsView />);
    fireEvent.change(screen.getByLabelText("Nome nuovo progetto"), { target: { value: "Mazzetto" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea" }));
    await waitFor(() => expect(useUi.getState().tab).toBe("studio"));
    expect(useProjects.getState().activeId).not.toBeNull();
  });

  it("Apri → va allo Studio e idrata deck+stampa", async () => {
    render(<ProjectsView />);
    fireEvent.change(screen.getByLabelText("Nome nuovo progetto"), { target: { value: "Uno" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea" }));
    await waitFor(() => expect(useUi.getState().tab).toBe("studio"));
    useUi.getState().setTab("projects");
    const apri = await screen.findAllByRole("button", { name: "Apri" });
    fireEvent.click(apri[0] as HTMLElement);
    await waitFor(() => expect(useUi.getState().tab).toBe("studio"));
    expect(useProjects.getState().activeId).not.toBeNull();
  });

  it("fuori dall'app desktop: niente riga immagini (solo Tauri)", async () => {
    render(<ProjectsView />);
    fireEvent.change(screen.getByLabelText("Nome nuovo progetto"), { target: { value: "Browser" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea" }));
    await waitFor(() => expect(useUi.getState().tab).toBe("studio"));
    useUi.getState().setTab("projects");
    await screen.findAllByRole("button", { name: "Apri" });
    expect(screen.queryByRole("button", { name: "Svuota immagini" })).toBeNull();
  });
});

function batchProject(id: string, name: string, deck: Project["manifest"]["deck"]): Project {
  return {
    id,
    name,
    created_at: "2026-01-01",
    updated_at: "2026-01-02",
    manifest: {
      version: 1,
      deck,
      print: { ...DEFAULT_PRINT, guides: { ...DEFAULT_PRINT.guides } },
    },
  };
}

describe("ProjectsView export in blocco", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockReset();
    // nessuna rete nei test: la pulizia del board Token non risolve nulla
    // (le prove con metadati usano la cache pre-riscaldata)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("rete assente nei test");
      }),
    );
    useProjects.setState({ projects: [], activeId: null, loading: false, error: null, search: "" });
    useDeck.getState().hydrate([]);
    useUi.getState().setTab("projects");
    usePrint.getState().hydrate({ ...DEFAULT_PRINT, guides: { ...DEFAULT_PRINT.guides } });
    localStorage.setItem(
      "proxxied.fallback.projects",
      JSON.stringify([
        batchProject("pa", "Alfa", [
          { id: "a1", name: "Bolt", qty: 2, zone: "main", provider: "scryfall", imageFront: "https://img/bolt.jpg", hasBack: false, sortOrder: 0 },
        ]),
        batchProject("pb", "Beta", [
          { id: "b1", name: "Treasure", qty: 1, zone: "tokens", provider: "scryfall", imageFront: "https://img/treasure.jpg", hasBack: false, sortOrder: 0 },
        ]),
      ]),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("seleziona due progetti → un solo PDF unito, token in fondo", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "export_dir") return "/tmp/exports";
      if (cmd === "export_pdf") {
        return {
          path: "/tmp/exports/unito.pdf", pages: 2, unique_assets: 2,
          total_copies: 3, bytes: 100, skipped: 0, skipped_names: [],
          back_pages: 0, backs_printed: 0, backs_missing: 0,
          upscaled: 0, upscaled_ai: 0,
        };
      }
      if (cmd === "verify_pdf_file") {
        return { pages: 2, images: [], nominal_w_mm: 65, nominal_h_mm: 90, tol_pct: 0.5, pass: true, worst_dev_pct: 0, summary: "ok" };
      }
      throw new Error(`invoke inatteso: ${cmd}`);
    });
    render(<ProjectsView />);
    await screen.findByText("Alfa");
    fireEvent.click(screen.getByLabelText("Seleziona Alfa"));
    fireEvent.click(screen.getByLabelText("Seleziona Beta"));
    expect(screen.getByTestId("batch-count")).toHaveTextContent("2 selezionati");
    fireEvent.click(screen.getByTestId("batch-export"));
    await waitFor(() => expect(screen.getByTestId("batch-status")).toHaveTextContent("PDF unito"));
    const pdfCall = vi.mocked(invoke).mock.calls.find(([c]) => c === "export_pdf");
    expect(pdfCall).toBeDefined();
    const args = (pdfCall?.[1] as { args: Record<string, unknown> }).args;
    const cards = args["cards"] as { zone: string; qty: number }[];
    expect(cards).toHaveLength(2);
    // token dopo il main anche nel payload (il backend ordina comunque uguale)
    expect(cards.map((c) => c.zone)).toEqual(["main", "tokens"]);
    expect(screen.getByTestId("batch-status")).toHaveTextContent("misure OK");
  });

  it("sezione profilo Moxfield visibile nei Progetti", async () => {
    render(<ProjectsView />);
    expect(screen.getByLabelText("Nickname o link profilo Moxfield")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mostra deck" })).toBeInTheDocument();
  });

  it("moltiplicatore copie ×4 e bottone disabilitato senza selezione", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "export_dir") return "/tmp/exports";
      if (cmd === "export_pdf") {
        return {
          path: "/tmp/x.pdf", pages: 1, unique_assets: 1,
          total_copies: 8, bytes: 10, skipped: 0, skipped_names: [],
          back_pages: 0, backs_printed: 0, backs_missing: 0,
          upscaled: 0, upscaled_ai: 0,
        };
      }
      if (cmd === "verify_pdf_file") {
        return { pages: 1, images: [], nominal_w_mm: 65, nominal_h_mm: 90, tol_pct: 0.5, pass: true, worst_dev_pct: 0, summary: "ok" };
      }
      throw new Error(`invoke inatteso: ${cmd}`);
    });
    render(<ProjectsView />);
    await screen.findByText("Alfa");
    expect(screen.getByTestId("batch-export")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Seleziona Alfa"));
    fireEvent.click(screen.getByRole("button", { name: "4 copie per carta" }));
    fireEvent.click(screen.getByTestId("batch-export"));
    await waitFor(() => expect(screen.getByTestId("batch-status")).toHaveTextContent("8 copie"));
    const pdfCall = vi.mocked(invoke).mock.calls.find(([c]) => c === "export_pdf");
    const args = (pdfCall?.[1] as { args: Record<string, unknown> }).args;
    expect((args["cards"] as { qty: number }[])[0]?.qty).toBe(8);
  });

  it("board Token ripulito: le carte vere importate da Moxfield non finiscono nel PDF", async () => {
    // valori reali: nel board Token di Moxfield «The One Ring» è una carta,
    // «Treasure» è un token vero
    putMeta({ name: "The One Ring", provider: "scryfall" }, { typeLine: "Legendary Artifact", layout: "normal" }, true);
    putMeta({ name: "Treasure", provider: "scryfall" }, { typeLine: "Token Artifact — Treasure", layout: "token" }, true);
    localStorage.setItem(
      "proxxied.fallback.projects",
      JSON.stringify([
        batchProject("pa", "Alfa", [
          { id: "a1", name: "Bolt", qty: 1, zone: "main", provider: "scryfall", imageFront: "https://img/bolt.jpg", hasBack: false, sortOrder: 0 },
          { id: "a2", name: "The One Ring", qty: 1, zone: "tokens", provider: "scryfall", imageFront: "https://img/ring.jpg", hasBack: false, sortOrder: 1 },
          { id: "a3", name: "Treasure", qty: 1, zone: "tokens", provider: "scryfall", imageFront: "https://img/treasure.jpg", hasBack: false, sortOrder: 2 },
        ]),
      ]),
    );
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "export_dir") return "/tmp/exports";
      if (cmd === "export_pdf") {
        return {
          path: "/tmp/exports/unito.pdf", pages: 1, unique_assets: 2,
          total_copies: 2, bytes: 100, skipped: 0, skipped_names: [],
          back_pages: 0, backs_printed: 0, backs_missing: 0,
          upscaled: 0, upscaled_ai: 0,
        };
      }
      if (cmd === "verify_pdf_file") {
        return { pages: 1, images: [], nominal_w_mm: 65, nominal_h_mm: 90, tol_pct: 0.5, pass: true, worst_dev_pct: 0, summary: "ok" };
      }
      throw new Error(`invoke inatteso: ${cmd}`);
    });
    render(<ProjectsView />);
    await screen.findByText("Alfa");
    fireEvent.click(screen.getByLabelText("Seleziona Alfa"));
    fireEvent.click(screen.getByTestId("batch-export"));
    await waitFor(() => expect(screen.getByTestId("batch-status")).toHaveTextContent("PDF unito"));
    const pdfCall = vi.mocked(invoke).mock.calls.find(([c]) => c === "export_pdf");
    const args = (pdfCall?.[1] as { args: Record<string, unknown> }).args;
    const cards = args["cards"] as { zone: string; source_hash: string }[];
    expect(cards.map((c) => c.source_hash)).toEqual(["pa:a1", "pa:a3"]);
    expect(cards.map((c) => c.zone)).toEqual(["main", "tokens"]);
  });

  it("Pulisci token: toglie le voci non-token dai progetti selezionati", async () => {
    putMeta({ name: "The One Ring", provider: "scryfall" }, { typeLine: "Legendary Artifact", layout: "normal" }, true);
    putMeta({ name: "Treasure", provider: "scryfall" }, { typeLine: "Token Artifact — Treasure", layout: "token" }, true);
    localStorage.setItem(
      "proxxied.fallback.projects",
      JSON.stringify([
        batchProject("pa", "Alfa", [
          { id: "a1", name: "The One Ring", qty: 1, zone: "tokens", provider: "scryfall", hasBack: false, sortOrder: 0 },
          { id: "a2", name: "Treasure", qty: 1, zone: "tokens", provider: "scryfall", hasBack: false, sortOrder: 1 },
        ]),
      ]),
    );
    render(<ProjectsView />);
    await screen.findByText("Alfa");
    fireEvent.click(screen.getByLabelText("Seleziona Alfa"));
    fireEvent.click(screen.getByTestId("batch-clean-tokens"));
    await waitFor(() =>
      expect(screen.getByTestId("batch-status")).toHaveTextContent("1 carta non-token rimossa in 1 progetto."),
    );
    const stored = JSON.parse(localStorage.getItem("proxxied.fallback.projects") ?? "[]") as Project[];
    expect(stored[0]?.manifest.deck.map((c) => c.name)).toEqual(["Treasure"]);
  });
});
