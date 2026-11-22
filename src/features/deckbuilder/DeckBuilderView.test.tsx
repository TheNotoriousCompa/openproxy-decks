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
  it("sempre per macro-zone: main (con comandante), sideboard, maybeboard, token", () => {
    seed();
    render(<DeckBuilderView />, { wrapper });

    expect(screen.getByTestId("deckbuilder-view")).toBeInTheDocument();
    // niente filtri zona/tipo: le sezioni sono sempre fisse
    expect(screen.queryByTestId("db-group-zone")).toBeNull();
    expect(screen.queryByTestId("db-group-type")).toBeNull();
    const mainSec = screen.getByTestId("db-zone-main");
    expect(mainSec).toHaveTextContent("Main Deck");
    // comandante accorpato al main: 3 carte, 7 copie
    expect(mainSec.closest("section")).toHaveTextContent("3 carte");
    expect(mainSec.closest("section")).toHaveTextContent("7 copie");
    const sideSec = screen.getByTestId("db-zone-side");
    expect(sideSec).toHaveTextContent("Sideboard");
    expect(sideSec.closest("section")).toHaveTextContent("1 carta");
    expect(screen.queryByTestId("db-zone-commander")).toBeNull();
    expect(screen.queryByTestId("db-zone-tokens")).toBeNull();
    // 6 colonne fisse sulla griglia (layout dashboard)
    const grid = screen.getByTestId("db-zone-main").closest("section")?.querySelector(".grid");
    expect(grid?.className).toContain("grid-cols-6");
    // totali: solo "8 copie" + riepilogo per zona
    const view = screen.getByTestId("deckbuilder-view");
    expect(view).toHaveTextContent("8 copie");
    const breakdown = screen.getByTestId("db-zone-breakdown");
    expect(breakdown).toHaveTextContent("6 Main Deck");
    expect(breakdown).toHaveTextContent("1 Commander");
    expect(breakdown).toHaveTextContent("1 Sideboard");
    // rail sticky con anteprima + statistiche
    expect(screen.getByTestId("db-rail")).toHaveTextContent("Statistiche");
    expect(screen.getByTestId("db-rail")).toContainElement(screen.getByTestId("db-card-preview"));
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
    // la sezione main sparisce dal filtro, resta solo Sideboard
    expect(screen.queryByTestId("db-zone-main")).toBeNull();
    expect(screen.getByTestId("db-zone-side")).toBeInTheDocument();
  });

  it("main deck diviso per tipo di carta (sottosezioni), come prima", () => {
    seed();
    putMeta({ name: "Lightning Bolt" }, { typeLine: "Instant" }, true);
    putMeta({ name: "Counterspell" }, { typeLine: "Instant" }, true);
    putMeta({ name: "Sauron, the Dark Lord" }, { typeLine: "Legendary Creature — Avatar" }, true);
    putMeta({ name: "Negate" }, { typeLine: "Instant" }, true);
    render(<DeckBuilderView />, { wrapper });

    const instants = screen.getByTestId("db-type-main-instants");
    expect(instants).toHaveTextContent("Istantanei");
    expect(instants).toHaveTextContent("2 carte");
    expect(instants).toHaveTextContent("6 copie");
    // il comandante resta nel main ma è sempre in cima, fuori dai tipi
    const commander = screen.getByTestId("db-type-main-commander");
    expect(commander).toHaveTextContent("Comandante");
    expect(commander).toHaveTextContent("Sauron, the Dark Lord");
    expect(screen.queryByTestId("db-type-main-creatures")).toBeNull();
    // sideboard pure per tipo
    expect(screen.getByTestId("db-type-side-instants")).toHaveTextContent("Negate");
    // ordine: comandante in cima, poi i tipi
    const order = [
      ...(screen.getByTestId("db-zone-main").closest("section")?.querySelectorAll('[data-testid^="db-type-main-"]') ?? []),
    ].map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual(["db-type-main-commander", "db-type-main-instants"]);
  });

  it("macro-zone: maybeboard (con considering) e tokens in fondo", () => {
    seed();
    const add = useDeck.getState().add;
    add({ name: "Cultivate", qty: 2, zone: "maybe", provider: "scryfall", hasBack: false });
    add({ name: "Wish", qty: 1, zone: "considering", provider: "scryfall", hasBack: false });
    add({ name: "Insect", qty: 3, zone: "tokens", provider: "scryfall", hasBack: false });
    render(<DeckBuilderView />, { wrapper });
    const maybe = screen.getByTestId("db-zone-maybe");
    expect(maybe).toHaveTextContent("Maybeboard");
    expect(maybe.closest("section")).toHaveTextContent("2 carte");
    expect(maybe.closest("section")).toHaveTextContent("3 copie");
    const tokens = screen.getByTestId("db-zone-tokens");
    expect(tokens).toHaveTextContent("Tokens");
    expect(tokens.closest("section")).toHaveTextContent("3 copie");
    // ordine: main → side → maybe → tokens
    const order = [...document.querySelectorAll('section [data-testid^="db-zone-"]')].map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(order).toEqual(["db-zone-main", "db-zone-side", "db-zone-maybe", "db-zone-tokens"]);
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

  it("solo mazzo di default: anteprima in alto e ricerca in una scheda a sé", () => {
    seed();
    render(<DeckBuilderView />, { wrapper });

    // default: niente pannello ricerca laterale, c'è l'anteprima grande
    expect(screen.queryByTestId("search-panel")).toBeNull();
    expect(screen.getByTestId("db-card-preview")).toBeInTheDocument();
    expect(screen.getByTestId("db-preview-name")).toHaveTextContent("Sauron, the Dark Lord");
    // hover su una tile → anteprima aggiornata (Moxfield-style)
    fireEvent.mouseEnter(screen.getByTestId("db-card-db-1"));
    expect(screen.getByTestId("db-preview-name")).toHaveTextContent("Lightning Bolt");
    expect(screen.getByTestId("db-preview-type").textContent?.trim().length).toBeGreaterThan(0);
  });

  it("tab Cerca: risultati a sinistra, anteprima nell'isola a destra", () => {
    seed();
    render(<DeckBuilderView />, { wrapper });
    expect(screen.getByTestId("db-mode-deck")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("db-mode-search"));
    expect(screen.getByTestId("search-panel").className).toContain("w-full");
    // isola a destra con l'anteprima (vuota finché non passi su un risultato)
    expect(screen.getByTestId("db-search-preview")).toContainElement(
      screen.getByTestId("db-card-preview"),
    );
    expect(screen.queryByTestId("db-card-db-1")).toBeNull();
    fireEvent.click(screen.getByTestId("db-mode-deck"));
    expect(screen.getByTestId("db-card-db-1")).toBeInTheDocument();
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
    // l'isola statistiche mostra il bracket: 1 GC → Bracket 3
    const panel = screen.getByTestId("deck-bracket");
    expect(panel).toHaveTextContent("Bracket 3 · Upgraded");
    expect(panel).toHaveTextContent("1 Game Changer");
    expect(panel).toHaveTextContent("1 Game Changer: entro i 3 consentiti dal Bracket 3.");
    expect(panel).toHaveTextContent("Lightning Bolt");
    expect(panel).toHaveTextContent("Mainboard (main + comandante)");
    expect(panel.querySelectorAll('[role="img"]')).toHaveLength(1);
  });

  it("Del rimuove la carta sotto il mouse (con undo)", () => {
    seed();
    render(<DeckBuilderView />, { wrapper });
    // senza hover non fa nulla
    fireEvent.keyDown(window, { key: "Delete" });
    expect(useDeck.getState().deck.some((c) => c.id === "db-1")).toBe(true);
    // hover su Lightning Bolt → Del la elimina
    fireEvent.mouseEnter(screen.getByTestId("db-card-db-1"));
    fireEvent.keyDown(window, { key: "Delete" });
    expect(useDeck.getState().deck.some((c) => c.id === "db-1")).toBe(false);
    expect(screen.queryByTestId("db-card-db-1")).toBeNull();
    expect(screen.getByTestId("db-remove-toast")).toHaveTextContent("Lightning Bolt rimossa");
    // undo ripristina
    useDeck.getState().undo();
    expect(useDeck.getState().deck.some((c) => c.id === "db-1")).toBe(true);
  });

  it("Del ripetuto: senza muovere il mouse prende la carta scorsa sotto il puntatore", async () => {
    seed();
    render(<DeckBuilderView />, { wrapper });
    fireEvent.mouseMove(window, { clientX: 120, clientY: 90 });
    fireEvent.mouseEnter(screen.getByTestId("db-card-db-1"));
    // dopo la rimozione, il puntatore (fermo) cade sulla tile successiva
    // (jsdom non implementa elementFromPoint: lo definiamo per il test)
    const original = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      writable: true,
      value: () => document.querySelector('[data-testid="db-card-db-2"]'),
    });
    try {
      fireEvent.keyDown(window, { key: "Delete" });
      await waitFor(() =>
        expect(screen.getByTestId("db-preview-name")).toHaveTextContent("Counterspell"),
      );
      // secondo Del senza mousemove: elimina la nuova carta sotto il puntatore
      fireEvent.keyDown(window, { key: "Delete" });
      await waitFor(() => expect(useDeck.getState().deck.some((c) => c.id === "db-2")).toBe(false));
      expect(screen.getByTestId("db-remove-toast")).toHaveTextContent("Counterspell rimossa");
    } finally {
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });

  it("Del non cancella mentre scrivi nel filtro", () => {
    seed();
    render(<DeckBuilderView />, { wrapper });
    fireEvent.mouseEnter(screen.getByTestId("db-card-db-1"));
    const input = screen.getByTestId("db-search") as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: "Delete" });
    expect(useDeck.getState().deck.some((c) => c.id === "db-1")).toBe(true);
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
