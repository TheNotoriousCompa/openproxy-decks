import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { StudioView } from "@/features/studio/StudioView";
import { useDeck } from "@/stores/deck";
import { usePrint, DEFAULT_PRINT } from "@/stores/print";
import { useProjects } from "@/stores/projects";
import type { CardEntry, PrintOption } from "@/types";

vi.mock("@/services/backend", () => ({
  backend: {
    isTauri: false,
    listProjects: vi.fn(async () => []),
    listSummaries: vi.fn(async () => ({ total: 0, items: [] })),
    getProject: vi.fn(),
    saveManifest: vi.fn(async () => undefined),
  },
  readManifestBackup: () => null,
  shouldRestoreBackup: () => false,
}));

const PRINTS: PrintOption[] = [
  {
    source: "scryfall", id: "u-blue", name: "Swamp", setCode: "B1", setName: "Set B1",
    collectorNumber: "1", releasedAt: "2024-01-01", thumb: "https://img.test/blue-small.png",
    imageLarge: "https://img.test/blue-large.png", imageFull: "https://img.test/blue-png.png",
    hasBack: false, highres: true,
  },
];

vi.mock("@/services/providers", () => ({
  scryfallProvider: {
    getCardPrintings: vi.fn(async () => PRINTS),
    searchCards: vi.fn(async () => []),
    getCardById: vi.fn(),
    autocomplete: vi.fn(async () => []),
  },
}));

vi.mock("@/services/mpc", () => ({
  MpcError: Error,
  DEFAULT_MPC_SERVER: "",
  configuredServer: () => "https://mpcfill.com",
  searchMpcPrints: vi.fn(async () => []),
  checkMpcHealth: vi.fn(),
  normalizeServer: (s: string) => s,
}));

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function card(id: string, name: string, zone: CardEntry["zone"], qty: number): CardEntry {
  return { id, name, qty, zone, provider: "custom", hasBack: false, sortOrder: 0 };
}

describe("apply-all integration (StudioView)", () => {
  beforeEach(() => {
    useProjects.setState({ projects: [], activeId: "p1" });
    usePrint.getState().hydrate({ ...DEFAULT_PRINT, guides: { ...DEFAULT_PRINT.guides } });
  });

  it("checkbox apply-all aggiorna entrambe le omonime e il DOM del foglio", async () => {
    useDeck.getState().hydrate([card("sw-1", "Swamp", "main", 1), card("sw-2", "Swamp", "side", 1)]);
    render(<StudioView />, { wrapper });

    fireEvent.click(screen.getByTestId("sheet-cell-sw-1"));
    const picker = await screen.findByTestId("print-picker");
    expect(picker).toBeInTheDocument();
    // preset tab = MPC: passa a Scryfall (mockato) per le tile
    fireEvent.click(screen.getByTestId("source-tab-scryfall"));
    const box = await screen.findByTestId("apply-all");
    fireEvent.click(box);
    fireEvent.click(await screen.findByTestId("print-tile"));
    await waitFor(() => expect(screen.queryByTestId("print-picker")).toBeNull());
    const deck = useDeck.getState().deck;
    expect(deck.find((c) => c.id === "sw-1")?.imageFront).toBe("https://img.test/blue-png.png");
    expect(deck.find((c) => c.id === "sw-2")?.imageFront).toBe("https://img.test/blue-png.png");
    // il DOM del foglio riflette il nuovo src (il button testid è fratello dell'img,
    // la cella vera è il div[title] che contiene l'ArtworkImage; scope ai soli fogli;
    // si esclude la banda bleed (8 img specchiate con lo stesso src).
    await waitFor(() =>
      expect(
        document.querySelectorAll(
          '[aria-label="Anteprima fogli di stampa"] div[title="Swamp"] > div:not([data-testid="bleed-bands"]) img[src="https://img.test/blue-png.png"]',
        ).length,
      ).toBe(2),
    );
  });

  it("singola senza flag da cella foglio cambia UNA sola copia (4 Bolt → 3+1)", async () => {
    useDeck.getState().hydrate([card("bolt-1", "Lightning Bolt", "main", 4)]);
    render(<StudioView />, { wrapper });

    // 4 copie = 4 celle con lo stesso entryId: clicca la prima
    const cells = await screen.findAllByTestId("sheet-cell-bolt-1");
    expect(cells).toHaveLength(4);
    fireEvent.click(cells[0] as HTMLElement);
    await screen.findByTestId("print-picker");
    fireEvent.click(screen.getByTestId("source-tab-scryfall"));
    // flag NON spuntato: cambia solo la copia cliccata
    fireEvent.click(await screen.findByTestId("print-tile"));
    await waitFor(() => expect(screen.queryByTestId("print-picker")).toBeNull());
    const deck = useDeck.getState().deck;
    expect(deck.reduce((n, c) => n + c.qty, 0)).toBe(4);
    const patched = deck.filter((c) => c.imageFront === "https://img.test/blue-png.png");
    expect(patched).toHaveLength(1);
    expect(patched[0]?.qty).toBe(1);
    expect(deck.filter((c) => !c.imageFront).reduce((n, c) => n + c.qty, 0)).toBe(3);
  });
});
