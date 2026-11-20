import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { DeckBuilderView } from "@/features/deckbuilder/DeckBuilderView";
import { useDeck } from "@/stores/deck";
import { useProjects } from "@/stores/projects";
import { useCollection } from "@/stores/collection";
import { putMeta } from "@/lib/cardmetaCache";
import type { CardEntry } from "@/types";

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

let n = 0;
function card(partial: Partial<CardEntry> & { name: string; zone: CardEntry["zone"] }): CardEntry {
  n += 1;
  return {
    id: `db-${n}`,
    qty: 1,
    provider: "scryfall",
    hasBack: false,
    sortOrder: n,
    ...partial,
  };
}

function seed(): void {
  n = 0;
  localStorage.clear();
  useProjects.setState({ projects: [], activeId: "test-proj" });
  useCollection.setState({ entries: [], loaded: true, loading: false });
  useDeck.getState().hydrate([
    card({ name: "Lightning Bolt", zone: "main", qty: 4, imageFront: "https://img/bolt.jpg", setCode: "LEA", collectorNumber: "161" }),
    card({ name: "Counterspell", zone: "main", qty: 2, imageFront: "https://img/counter.jpg" }),
    card({ name: "Sauron, the Dark Lord", zone: "commander", qty: 1, imageFront: "https://img/sauron.jpg" }),
    card({ name: "Negate", zone: "side", qty: 1, imageFront: "https://img/negate.jpg" }),
  ]);
}

describe("DeckBuilder", () => {
  it("sezioni per zona + tile con quantità + EDHREC", () => {
    seed();
    render(<DeckBuilderView />, { wrapper });

    expect(screen.getByTestId("deckbuilder-view")).toBeInTheDocument();
    // default: raggruppo per tipo (comandante sempre separato, senza fetch)
    expect(screen.getByTestId("db-group-type")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("db-cat-commander")).toHaveTextContent(/Comandante/);
    // passo a zone: label + conteggi
    fireEvent.click(screen.getByTestId("db-group-zone"));
    const mainSec = screen.getByTestId("db-zone-main");
    expect(mainSec).toHaveTextContent("Main Deck");
    expect(mainSec.closest("section")).toHaveTextContent("2 carte");
    expect(mainSec.closest("section")).toHaveTextContent("6 copie");
    expect(screen.getByTestId("db-zone-commander")).toHaveTextContent("Commander");
    const sideSec = screen.getByTestId("db-zone-side");
    expect(sideSec).toHaveTextContent("Sideboard");
    expect(sideSec.closest("section")).toHaveTextContent("1 carta");
    expect(screen.queryByTestId("db-zone-tokens")).toBeNull();
    // totali: solo "8 copie" + riepilogo per zona
    const view = screen.getByTestId("deckbuilder-view");
    expect(view).toHaveTextContent("8 copie");
    const breakdown = screen.getByTestId("db-zone-breakdown");
    expect(breakdown).toHaveTextContent("6 Main Deck");
    expect(breakdown).toHaveTextContent("1 Commander");
    expect(breakdown).toHaveTextContent("1 Sideboard");
    // comandante + link EDHREC comandante
    expect(screen.getByTestId("edhrec-commander")).toHaveAttribute(
      "aria-label",
      "Apri Sauron, the Dark Lord su EDHREC",
    );
    // tile con quantità nello stepper
    const bolt = screen.getByTestId("db-card-db-1");
    expect(bolt).toHaveTextContent("Lightning Bolt");
    expect(screen.getByTestId("db-qty-db-1")).toHaveTextContent("4");
    // link EDHREC per carta (vista lista)
    fireEvent.click(screen.getByTestId("db-view-list"));
    expect(screen.getByTestId("db-edhrec-db-1")).toHaveAttribute(
      "aria-label",
      "Apri Lightning Bolt su EDHREC",
    );
  });

  it("stepper quantità e filtro nome", () => {
    seed();
    render(<DeckBuilderView />, { wrapper });

    fireEvent.click(screen.getByTestId("db-inc-db-2"));
    expect(screen.getByTestId("db-qty-db-2")).toHaveTextContent("3");

    fireEvent.change(screen.getByTestId("db-search"), { target: { value: "negate" } });
    expect(screen.queryByTestId("db-card-db-1")).toBeNull();
    expect(screen.getByTestId("db-card-db-4")).toBeInTheDocument();
  });

  it("raggruppa per tipo: istantanei, creature, terre", async () => {
    const types: Record<string, string> = {
      "lightning bolt": "Instant",
      counterspell: "Instant",
      "sauron, the dark lord": "Legendary Creature — Avatar",
      negate: "Instant",
      swamp: "Basic Land — Swamp",
      cultivate: "Sorcery",
      insect: "Token Creature — Insect",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        // bulk collection: risponde con data + not_found come Scryfall
        if (String(url).includes("/cards/collection")) {
          const body = JSON.parse(String((init as { body?: string })?.body ?? "{}")) as {
            identifiers?: { name?: string; set?: string }[];
          };
          const data = (body.identifiers ?? []).map((i) => ({
            id: `uuid-${i.name}`,
            name: i.name,
            set: (i.set ?? "lea").toLowerCase(),
            type_line: types[(i.name ?? "").toLowerCase()] ?? null,
          }));
          return { status: 200, ok: true, json: async () => ({ data, not_found: [] }) };
        }
        return {
          status: 200,
          ok: true,
          json: async () => {
            const m = String(url).match(/exact=([^&]+)/);
            const name = m?.[1] ? decodeURIComponent(m[1]).toLowerCase() : "";
            return { type_line: types[name] ?? null };
          },
        };
      }),
    );
    try {
      seed();
      // una terra + una maybe per coprire Terre e Maybeboard
      const add = useDeck.getState().add;
      add({ name: "Swamp", qty: 1, zone: "main", provider: "scryfall", hasBack: false });
      add({ name: "Cultivate", qty: 2, zone: "maybe", provider: "scryfall", hasBack: false });
      add({ name: "Insect", qty: 3, zone: "tokens", provider: "scryfall", hasBack: false });
      render(<DeckBuilderView />, { wrapper });
      fireEvent.click(screen.getByTestId("db-group-type"));
      const instants = await screen.findByTestId("db-cat-instants", {}, { timeout: 5000 });
      expect(instants).toHaveTextContent("Istantanei");
      expect(instants.closest("section")).toHaveTextContent("3 carte");
      const lands = screen.getByTestId("db-cat-lands");
      expect(lands).toHaveTextContent("Terre");
      expect(lands.closest("section")).toHaveTextContent("1 carta");
      // comandante in sezione propria, non tra le creature
      const cmd = screen.getByTestId("db-cat-commander");
      expect(cmd).toHaveTextContent("Comandante");
      expect(cmd.closest("section")).toHaveTextContent("1 carta");
      expect(screen.queryByTestId("db-cat-creatures")).toBeNull();
      // maybeboard tutta insieme, non sparpagliata per tipo
      const maybe = screen.getByTestId("db-cat-maybeboard");
      expect(maybe).toHaveTextContent("Maybeboard");
      expect(maybe.closest("section")).toHaveTextContent("2 copie");
      expect(screen.queryByTestId("db-cat-sorceries")).toBeNull();
      // token in fondo in sezione propria, anche se creatura
      const tokens = screen.getByTestId("db-cat-tokens");
      expect(tokens).toHaveTextContent("Token");
      expect(tokens.closest("section")).toHaveTextContent("3 copie");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stato vuoto con CTA verso lo Studio", () => {
    useProjects.setState({ projects: [], activeId: "test-proj" });
    useDeck.getState().hydrate([]);
    render(<DeckBuilderView />, { wrapper });
    expect(screen.getByText(/Nessuna carta nella lista/)).toBeInTheDocument();
  });

  it("tasto destro: sposta zona, comandante, rimuovi", () => {
    seed();
    render(<DeckBuilderView />, { wrapper });

    fireEvent.contextMenu(screen.getByTestId("db-card-db-1"));
    expect(screen.getByTestId("db-menu")).toBeInTheDocument();

    // sposta in Maybeboard
    fireEvent.click(screen.getByTestId("db-menu-zone-maybe"));
    expect(useDeck.getState().deck.find((c) => c.id === "db-1")?.zone).toBe("maybe");
    expect(screen.queryByTestId("db-menu")).toBeNull();

    // segna comandante
    fireEvent.contextMenu(screen.getByTestId("db-card-db-2"));
    fireEvent.click(screen.getByTestId("db-menu-commander"));
    expect(useDeck.getState().deck.find((c) => c.id === "db-2")?.commander).toBe(true);

    // rimuovi (conferma mockata)
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.contextMenu(screen.getByTestId("db-card-db-4"));
    fireEvent.click(screen.getByTestId("db-menu-remove"));
    expect(useDeck.getState().deck.find((c) => c.id === "db-4")).toBeUndefined();
    confirm.mockRestore();
  });

  it("menu zoom: ingrandimento ad alta risoluzione e chiusura", () => {
    seed();
    render(<DeckBuilderView />, { wrapper });

    fireEvent.contextMenu(screen.getByTestId("db-card-db-1"));
    fireEvent.click(screen.getByTestId("db-menu-zoom"));
    // menu chiuso, zoom aperto sulla carta
    expect(screen.queryByTestId("db-menu")).toBeNull();
    expect(screen.getByTestId("card-zoom")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Ingrandimento di Lightning Bolt" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("card-zoom-close"));
    expect(screen.queryByTestId("card-zoom")).toBeNull();
  });

  it("menu contestuale scrollabile: le voci in fondo restano raggiungibili", () => {
    seed();
    render(<DeckBuilderView />, { wrapper });

    // aperto in basso (y oltre metà viewport): il menu deve stare dentro e scrollare
    fireEvent.contextMenu(screen.getByTestId("db-card-db-1"), { clientX: 40, clientY: window.innerHeight - 4 });
    const menu = screen.getByTestId("db-menu");
    expect(menu).toHaveClass("overflow-y-auto");
    expect(menu.className).toContain("overscroll-contain");
    expect((menu as HTMLElement).style.maxHeight).toBe("calc(100vh - 16px)");
    // il vecchio limite interno (max-h-44) creava uno scroll annidato: rimosso
    expect(menu.querySelector(".max-h-44")).toBeNull();
    // l'azione distruttiva è presente nel DOM
    expect(screen.getByTestId("db-menu-remove")).toBeInTheDocument();
  });

  it("collezione: dal menu sulla carta e badge possedute", async () => {
    seed();
    render(<DeckBuilderView />, { wrapper });

    // dal menu: Lightning Bolt (LEA 161, qty 4) finisce in collezione
    fireEvent.contextMenu(screen.getByTestId("db-card-db-1"));
    fireEvent.click(screen.getByTestId("db-menu-collect"));
    expect(await screen.findByTestId("db-owned-db-1")).toHaveTextContent("✓ collezione");
    expect(useCollection.getState().entries).toEqual([
      expect.objectContaining({ name: "Lightning Bolt", setCode: "lea", collectorNumber: "161", qty: 4 }),
    ]);

    // badge parziale su Counterspell (qty 2, posseduta 1)
    useCollection.setState({
      entries: [
        ...useCollection.getState().entries,
        { key: "counterspell‖‖", name: "Counterspell", setCode: "", collectorNumber: "", qty: 1, addedAt: "" },
      ],
      loaded: true,
      loading: false,
    });
    expect(await screen.findByTestId("db-owned-db-2")).toHaveTextContent("1/2");
  });

  it("mano di test: pesca dalla mainboard, mulligan e pescata", () => {
    n = 0;
    localStorage.clear();
    useProjects.setState({ projects: [], activeId: "test-proj" });
    useCollection.setState({ entries: [], loaded: true, loading: false });
    useDeck.getState().hydrate([
      ...Array.from({ length: 10 }, (_, i) => card({ name: `Main ${i}`, zone: "main" })),
      card({ name: "Sauron, the Dark Lord", zone: "commander" }),
      card({ name: "Negate", zone: "side" }),
    ]);
    render(<DeckBuilderView />, { wrapper });
    fireEvent.click(screen.getByTestId("db-test-hand"));
    expect(screen.getByTestId("test-hand")).toBeInTheDocument();
    // 10 carte in main (comandante e side esclusi) → mano piena di 7
    expect(screen.getAllByTestId("test-hand-card")).toHaveLength(7);
    expect(screen.getByTestId("test-hand-summary")).toHaveTextContent("7 carte");
    // mulligan londinese → 6
    fireEvent.click(screen.getByTestId("test-hand-mulligan"));
    expect(screen.getAllByTestId("test-hand-card")).toHaveLength(6);
    expect(screen.getByTestId("test-hand-summary")).toHaveTextContent("1 mulligan");
    // pescata singola → 7
    fireEvent.click(screen.getByTestId("test-hand-draw"));
    expect(screen.getAllByTestId("test-hand-card")).toHaveLength(7);
    // rimescola → di nuovo 7 e zero mulligan
    fireEvent.click(screen.getByTestId("test-hand-shuffle"));
    expect(screen.getAllByTestId("test-hand-card")).toHaveLength(7);
    expect(screen.getByTestId("test-hand-summary")).not.toHaveTextContent("mulligan");
    fireEvent.click(screen.getByTestId("test-hand-close"));
    expect(screen.queryByTestId("test-hand")).toBeNull();
  });

  it("badge Game Changer sulle carte e bracket calcolato", () => {
    seed();
    putMeta(
      { name: "Lightning Bolt", provider: "scryfall", setCode: "LEA" },
      { typeLine: "Instant", gameChanger: true },
      true,
    );
    putMeta({ name: "Sauron, the Dark Lord" }, { typeLine: "Legendary Creature — Avatar" }, true);
    render(<DeckBuilderView />, { wrapper });
    // il badge (!) compare sulla tile della Game Changer
    expect(screen.getAllByTestId("game-changer-badge").length).toBeGreaterThan(0);
    // chip bracket nell'header statistiche: 1 GC → Bracket 3
    expect(screen.getByTestId("deck-bracket-chip")).toHaveTextContent("B3 Upgraded · 1 GC");
    // pannello: scala 1–5, sintesi in una frase, nomi GC
    const panel = screen.getByTestId("deck-bracket");
    expect(panel).toHaveTextContent("Bracket 3 · Upgraded");
    expect(panel).toHaveTextContent("1 Game Changer: entro i 3 consentiti dal Bracket 3.");
    expect(panel).toHaveTextContent("Lightning Bolt");
    expect(panel).toHaveTextContent("Calcolato sulla mainboard");
    expect(panel.querySelectorAll('[role="img"]')).toHaveLength(1);
  });

  it("collezione: bottone mazzo con dialogo di conferma", async () => {
    seed();
    render(<DeckBuilderView />, { wrapper });

    fireEvent.click(screen.getByTestId("db-collect-deck"));
    expect(screen.getByTestId("db-collect-dialog")).toBeInTheDocument();
    // 8 copie, 4 stampe nuove (Bolt, Counterspell, Sauron, Negate)
    expect(screen.getByTestId("db-collect-summary")).toHaveTextContent("8 copie");
    expect(screen.getByTestId("db-collect-summary")).toHaveTextContent("4 stampe nuove");
    fireEvent.click(screen.getByTestId("db-collect-confirm"));
    await waitFor(() => expect(useCollection.getState().entries).toHaveLength(4));
    expect(screen.queryByTestId("db-collect-dialog")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("4 stampe nuove");
  });
});
