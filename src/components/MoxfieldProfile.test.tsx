import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MoxfieldProfileImport } from "@/components/LeftPanel";
import { backend } from "@/services/backend";
import { invoke } from "@tauri-apps/api/core";
import type { Project } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

const savedManifests: Project[] = [];

vi.mock("@/services/backend", () => ({
  backend: {
    isTauri: true,
    createProject: vi.fn(async (name: string) => ({
      id: `p-${name}`,
      name,
      created_at: "",
      updated_at: "",
      manifest: { version: 1, deck: [], print: {} },
    })),
    saveManifest: vi.fn(async (p: Project) => {
      const i = savedManifests.findIndex((x) => x.id === p.id);
      if (i >= 0) savedManifests[i] = p;
      else savedManifests.push(p);
    }),
  },
}));

// backend reale: in jsdom isTauri=false → localStorage (progetti veri, niente rete)
const DECKS = {
  user: "NecroFan",
  total: 2,
  decks: [
    { public_id: "aaa111", name: "Necron", format: "commander", main_count: 99, total_count: 109 },
    { public_id: "bbb222", name: "Draft", format: "limited", main_count: 40, total_count: 40 },
  ],
};

const DECK_A = {
  name: "Necron",
  provider: "moxfield",
  entries: [
    { qty: 1, name: "Imotekh the Stormlord", zone: "commander", set_code: "40K", collector_number: "1" },
    { qty: 26, name: "Swamp", zone: "main", set_code: "UNF", collector_number: "242" },
  ],
  unknown: [],
  warnings: [],
};

describe("MoxfieldProfileImport", () => {
  beforeEach(() => {
    localStorage.clear();
    savedManifests.length = 0;
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "fetch_moxfield_user_decks") return DECKS;
      if (cmd === "fetch_moxfield_deck") return DECK_A;
      throw new Error(`invoke inatteso: ${cmd}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("nickname → lista deck → un progetto per deck (senza artwork)", async () => {
    render(<MoxfieldProfileImport />);
    fireEvent.change(screen.getByLabelText(/Nickname o link profilo/), {
      target: { value: "NecroFan" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mostra deck" }));
    await waitFor(() => expect(screen.getByText("Necron")).toBeInTheDocument());
    expect(screen.getByText("Draft")).toBeInTheDocument();
    // artwork spento: niente rete, solo nomi
    fireEvent.click(screen.getByLabelText("Scarica artwork"));
    expect(screen.getByRole("button", { name: "Importa selezionati (2)" })).toBeInTheDocument();
    // deseleziona Draft → importa solo Necron
    fireEvent.click(screen.getByLabelText("Seleziona deck Draft"));
    fireEvent.click(screen.getByRole("button", { name: "Importa selezionati (1)" }));
    await waitFor(() =>
      expect(screen.getByTestId("mox-profile-status")).toHaveTextContent("Importati 1 progetto"),
    );
    expect(backend.createProject).toHaveBeenCalledWith("Necron");
    expect(savedManifests).toHaveLength(1);
    const deck = savedManifests[0]?.manifest.deck ?? [];
    expect(deck).toHaveLength(2);
    expect(deck.find((c) => c.name === "Swamp")).toMatchObject({ qty: 26, zone: "main" });
    expect(deck.find((c) => c.name === "Imotekh the Stormlord")?.zone).toBe("commander");
  });

  it("link profilo accettato, errore utente mostrato", async () => {
    render(<MoxfieldProfileImport />);
    fireEvent.change(screen.getByLabelText(/Nickname o link profilo/), {
      target: { value: "https://www.moxfield.com/users/NecroFan/" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mostra deck" }));
    await waitFor(() => expect(screen.getByText("Necron")).toBeInTheDocument());

    vi.mocked(invoke).mockRejectedValueOnce(new Error("utente non trovato"));
    fireEvent.change(screen.getByLabelText(/Nickname o link profilo/), {
      target: { value: "inesistente_xyz" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mostra deck" }));
    await waitFor(() =>
      expect(screen.getByTestId("mox-profile-status")).toHaveTextContent("utente non trovato"),
    );
  });
});
