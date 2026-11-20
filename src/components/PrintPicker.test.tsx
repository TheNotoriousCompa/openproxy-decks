import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PrintPicker } from "@/components/PrintPicker";
import { useSettings } from "@/stores/settings";
import type { PrintOption } from "@/types";

const { scryfallPrints, mpcPrints, FakeMpcError } = vi.hoisted(() => {
  class FakeMpcError extends Error {
    readonly reason: string;
    constructor(reason: string, detail?: string) {
      super(detail ?? reason);
      this.reason = reason;
    }
  }
  const scryfallPrints: PrintOption[] = [
    {
      source: "scryfall", id: "uuid-ltc", name: "Command Tower",
      setCode: "LTC", setName: "Tales of Middle-earth Commander", collectorNumber: "331",
      releasedAt: "2023-11-03", thumb: "https://img/ct-ltc-small.jpg",
      imageLarge: "https://img/ct-ltc-large.jpg", hasBack: false, highres: true, priceUsd: "0.38",
    },
    {
      source: "scryfall", id: "uuid-m3c", name: "Command Tower",
      setCode: "M3C", setName: "Modern Horizons 3 Commander", collectorNumber: "220",
      releasedAt: "2024-06-14", thumb: "https://img/ct-m3c-small.jpg",
      imageLarge: "https://img/ct-m3c-large.jpg", hasBack: false, highres: true,
    },
  ];
  const mpcPrints: PrintOption[] = [
    {
      source: "mpc", id: "drive-1", name: "Command Tower",
      setCode: "", setName: "", collectorNumber: "",
      thumb: "https://cdn/mpc-thumb.jpg", imageLarge: "https://cdn/mpc-med.jpg",
      imageFull: "https://drive/dl?id=drive-1", hasBack: false, highres: true,
      dpi: 800, sourceLabel: "Test Drive",
    },
  ];
  return { scryfallPrints, mpcPrints, FakeMpcError };
});

vi.mock("@/services/providers", () => ({
  scryfallProvider: {
    getCardPrintings: vi.fn(async () => scryfallPrints),
    searchCards: vi.fn(async () => []),
    getCardById: vi.fn(),
    autocomplete: vi.fn(async () => []),
  },
}));

vi.mock("@/services/mpc", () => ({
  MpcError: FakeMpcError,
  DEFAULT_MPC_SERVER: "https://mpcfill.com",
  configuredServer: () => "https://mpcfill.com",
  searchMpcPrints: vi.fn(async () => mpcPrints),
  checkMpcHealth: vi.fn(),
  normalizeServer: (s: string) => s,
  getMpcSources: vi.fn(async () => [{ pk: 10, key: "trix", name: "Trix Are For Scoot" }]),
  getMpcTags: vi.fn(async () => [{ name: "AI Art", parent: "Custom Art", aliases: ["AI"] }]),
}));

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("PrintPicker", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // le fonti escluse sono una preferenza globale: ogni test parte pulito
    useSettings.setState({ excluded: { sources: [], tags: [], sets: [] } });
    // ripristina l'implementazione default (clearAllMocks non tocca mockRejectedValue)
    const { searchMpcPrints } = await import("@/services/mpc");
    vi.mocked(searchMpcPrints).mockImplementation(async () => mpcPrints);
  });

  it("default: tab MPC full-art quando il server è configurato", async () => {
    render(<PrintPicker cardName="Command Tower" onSelect={() => undefined} onClose={() => undefined} />, { wrapper });
    expect(screen.getByTestId("source-tab-mpc")).toHaveAttribute("aria-pressed", "true");
    const tiles = await screen.findAllByTestId("print-tile");
    expect(tiles).toHaveLength(1);
    expect(screen.getByText("800 DPI")).toBeInTheDocument();
  });

  /** Helper: apre il picker e passa alla tab Scryfall (il default ora è MPC). */
  async function openScryfall(props?: { cardName?: string; currentProviderId?: string; totalCopies?: number; onSelect?: (o: PrintOption, a: boolean) => void; onSelectFace?: (o: PrintOption, f: "front" | "back", a: boolean) => void }): Promise<void> {
    render(
      <PrintPicker
        cardName={props?.cardName ?? "Command Tower"}
        currentProviderId={props?.currentProviderId}
        totalCopies={props?.totalCopies}
        onSelect={props?.onSelect ?? (() => undefined)}
        onSelectFace={props?.onSelectFace}
        onClose={() => undefined}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByTestId("source-tab-scryfall"));
    await screen.findAllByTestId("print-tile");
  }

  it("mostra dialog, griglia stampe, contatore e badge", async () => {
    await openScryfall();
    expect(screen.getByTestId("print-picker")).toBeInTheDocument();
    expect(screen.getAllByTestId("print-tile")).toHaveLength(2);
    expect(screen.getByTestId("prints-count")).toHaveTextContent("2");
    expect(screen.getByText("$0.38")).toBeInTheDocument();
    expect(screen.getByText("LTC")).toBeInTheDocument();
  });

  it("evidenzia la stampa in uso", async () => {
    await openScryfall({ currentProviderId: "uuid-m3c" });
    const tiles = screen.getAllByTestId("print-tile");
    const current = tiles.find((t) => t.getAttribute("aria-current") === "true");
    expect(current).toBeDefined();
    expect(within(current as HTMLElement).getByText("In uso")).toBeInTheDocument();
  });

  it("filtro set restringe la griglia", async () => {
    await openScryfall();
    fireEvent.change(screen.getByTestId("prints-set-filter"), { target: { value: "M3C" } });
    expect(screen.getAllByTestId("print-tile")).toHaveLength(1);
    expect(screen.getByTestId("prints-count")).toHaveTextContent("1");
  });

  it("tab MPC mostra stampe community con DPI reali", async () => {
    render(<PrintPicker cardName="Command Tower" onSelect={() => undefined} onClose={() => undefined} />, { wrapper });
    const tiles = await screen.findAllByTestId("print-tile");
    expect(tiles).toHaveLength(1);
    expect(screen.getByText("800 DPI")).toBeInTheDocument();
    expect(screen.getByText("Test Drive")).toBeInTheDocument();
  });

  it("click su stampa chiama onSelect", async () => {
    const onSelect = vi.fn();
    await openScryfall({ onSelect });
    const tiles = screen.getAllByTestId("print-tile");
    fireEvent.click(tiles[0] as HTMLElement);
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    // sort default: data rilascio desc → M3C (2024) prima di LTC (2023)
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: "uuid-m3c", setCode: "M3C" });
    // senza copie multiple: applyAll=false
    expect(onSelect.mock.calls[0]?.[1]).toBe(false);
  });

  it("Apply to all nascosta con una sola copia", async () => {
    render(<PrintPicker cardName="Swamp" totalCopies={1} onSelect={() => undefined} onClose={() => undefined} />, { wrapper });
    await screen.findAllByTestId("print-tile");
    expect(screen.queryByTestId("apply-all")).toBeNull();
  });

  it("Apply to all con copie multiple: flag passato a onSelect", async () => {
    const onSelect = vi.fn();
    await openScryfall({ cardName: "Swamp", totalCopies: 7, onSelect });
    const box = await screen.findByTestId("apply-all");
    expect(screen.getByText(/Apply to all "Swamp" \(7\)/)).toBeInTheDocument();
    // default OFF: scelta senza spunta → applyAll=false
    fireEvent.click(screen.getAllByTestId("print-tile")[0] as HTMLElement);
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls[0]?.[1]).toBe(false);
    // spunta → applyAll=true
    fireEvent.click(box);
    fireEvent.click(screen.getAllByTestId("print-tile")[1] as HTMLElement);
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(2));
    expect(onSelect.mock.calls[1]?.[1]).toBe(true);
  });

  it("cap tile: prime 24 + mostra altre, poi espande", async () => {
    const { scryfallProvider } = await import("@/services/providers");
    const many: PrintOption[] = Array.from({ length: 30 }, (_, i) => ({
      source: "scryfall" as const, id: `uuid-${i}`, name: "Swamp", setCode: `S${i}`,
      setName: `Set ${i}`, collectorNumber: `${i}`, releasedAt: "2024-01-01",
      thumb: `https://img/${i}.jpg`, imageLarge: `https://img/${i}-l.jpg`,
      hasBack: false, highres: true,
    }));
    vi.mocked(scryfallProvider.getCardPrintings!).mockResolvedValueOnce(many);
    await openScryfall({ cardName: "Swamp" });
    expect(screen.getAllByTestId("print-tile")).toHaveLength(24);
    const more = await screen.findByTestId("prints-more");
    expect(more).toHaveTextContent("6 rimanenti");
    fireEvent.click(more);
    await waitFor(() => expect(screen.getAllByTestId("print-tile")).toHaveLength(30));
    expect(screen.queryByTestId("prints-more")).toBeNull();
  });

  it("dialog largo ~80% della finestra", async () => {
    render(<PrintPicker cardName="Command Tower" onSelect={() => undefined} onClose={() => undefined} />, { wrapper });
    const dialog = await screen.findByTestId("print-picker");
    expect(dialog.className).toContain("w-[80vw]");
    expect(dialog.className).toContain("h-[85vh]");
  });

  it("ricerca alternativa ricarica", async () => {
    const { scryfallProvider } = await import("@/services/providers");
    await openScryfall();
    fireEvent.change(screen.getByTestId("prints-search"), { target: { value: "Sol Ring" } });
    fireEvent.click(screen.getByTestId("prints-search-go"));
    await waitFor(() =>
      expect(vi.mocked(scryfallProvider.getCardPrintings!)).toHaveBeenCalledWith(
        "Sol Ring",
        expect.anything(),
        undefined,
        expect.anything(),
      ),
    );
  });

  it("filtro lingua IT/EN passato a getCardPrintings", async () => {
    const { scryfallProvider } = await import("@/services/providers");
    await openScryfall();
    const sel = screen.getByTestId("prints-lang") as HTMLSelectElement;
    expect(sel.querySelectorAll("option")).toHaveLength(3); // Qualsiasi + IT + EN
    fireEvent.change(sel, { target: { value: "it" } });
    await waitFor(() =>
      expect(vi.mocked(scryfallProvider.getCardPrintings!)).toHaveBeenCalledWith(
        "Command Tower",
        expect.anything(),
        "it",
        expect.anything(),
      ),
    );
  });

  it("cuore preferiti + filtro solo preferiti", async () => {
    localStorage.clear();
    await openScryfall();
    // prima tile = M3C (sort data desc)
    const hearts = await screen.findAllByTestId("fav-toggle");
    fireEvent.click(hearts[0] as HTMLElement);
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("proxxied.favorites") ?? "[]")).toHaveLength(1),
    );
    expect(screen.getByTestId("prints-fav-only")).toHaveTextContent("★ 1");
    fireEvent.click(screen.getByTestId("prints-fav-only"));
    await waitFor(() => expect(screen.getAllByTestId("print-tile")).toHaveLength(1));
    // toggle off → torna tutto
    fireEvent.click(screen.getByTestId("prints-fav-only"));
    await waitFor(() => expect(screen.getAllByTestId("print-tile")).toHaveLength(2));
    localStorage.clear();
  });

  it("DFC: bottoni fronte/retro chiamano onSelectFace", async () => {
    const { scryfallProvider } = await import("@/services/providers");
    const dfc: PrintOption = {
      source: "scryfall", id: "uuid-dfc", name: "Delver", setCode: "MID",
      setName: "Innistrad", collectorNumber: "1", releasedAt: "2024-01-01",
      thumb: "https://img/d.jpg", imageLarge: "https://img/dl.jpg",
      imageBack: "https://img/db.jpg", hasBack: true, highres: true,
    };
    vi.mocked(scryfallProvider.getCardPrintings!).mockResolvedValueOnce([dfc]);
    const onSelectFace = vi.fn();
    await openScryfall({ cardName: "Delver", onSelectFace });
    fireEvent.click(await screen.findByTestId("print-face-back"));
    await waitFor(() => expect(onSelectFace).toHaveBeenCalledTimes(1));
    expect(onSelectFace.mock.calls[0]?.[0]).toMatchObject({ id: "uuid-dfc" });
    expect(onSelectFace.mock.calls[0]?.[1]).toBe("back");
    expect(onSelectFace.mock.calls[0]?.[2]).toBe(false);
  });

  it("DFC: senza onSelectFace niente bottoni faccia", async () => {
    const { scryfallProvider } = await import("@/services/providers");
    const dfc: PrintOption = {
      source: "scryfall", id: "uuid-dfc", name: "Delver", setCode: "MID",
      setName: "Innistrad", collectorNumber: "1", releasedAt: "2024-01-01",
      thumb: "https://img/d.jpg", imageLarge: "https://img/dl.jpg",
      imageBack: "https://img/db.jpg", hasBack: true, highres: true,
    };
    vi.mocked(scryfallProvider.getCardPrintings!).mockResolvedValueOnce([dfc]);
    await openScryfall({ cardName: "Delver" });
    expect(screen.queryByTestId("print-face-front")).toBeNull();
    expect(screen.queryByTestId("print-face-back")).toBeNull();
  });

  it("tab MPC: tag passati a searchMpcPrints", async () => {
    const { searchMpcPrints } = await import("@/services/mpc");
    render(<PrintPicker cardName="Command Tower" onSelect={() => undefined} onClose={() => undefined} />, { wrapper });
    await screen.findAllByTestId("print-tile");
    fireEvent.click(screen.getByTestId("source-tab-mpc"));
    const tagInput = await screen.findByTestId("prints-mpc-tags");
    fireEvent.change(tagInput, { target: { value: "extended, fullart" } });
    await waitFor(() =>
      expect(vi.mocked(searchMpcPrints)).toHaveBeenCalledWith(
        "Command Tower",
        expect.anything(),
        {
          tags: ["extended", "fullart"],
          // nessun filtro lingua: la preferenza di default è "qualsiasi"
          languages: [],
          // nessuna fonte esclusa di default
          excludeTags: [],
          excludedSourceNames: [],
        },
      ),
    );
  });

  it("errore 523: messaggio dedicato, un retry, Riprova e passaggio a Scryfall", async () => {
    const { searchMpcPrints } = await import("@/services/mpc");
    const { scryfallProvider } = await import("@/services/providers");
    // sempre in errore: il primo tentativo + il retry automatico (unreachable)
    vi.mocked(searchMpcPrints).mockRejectedValue(
      new FakeMpcError(
        "unreachable",
        "mpcfill.com è momentaneamente irraggiungibile (Cloudflare 523: server d'origine non raggiungibile). Riprova tra qualche minuto o usa la sorgente Scryfall.",
      ),
    );
    render(<PrintPicker cardName="Sol Ring" onSelect={() => undefined} onClose={() => undefined} />, { wrapper });
    const alert = await screen.findByTestId("prints-error", undefined, { timeout: 4000 });
    expect(alert).toHaveTextContent("Cloudflare 523");
    expect(vi.mocked(searchMpcPrints)).toHaveBeenCalledTimes(2); // 1 + 1 retry
    expect(screen.getByTestId("prints-retry")).toBeInTheDocument();
    // "Usa Scryfall" cambia sorgente e carica le stampe Scryfall
    fireEvent.click(screen.getByTestId("prints-use-scryfall"));
    await waitFor(() => expect(scryfallProvider.getCardPrintings).toHaveBeenCalled());
    expect(screen.queryByTestId("prints-error")).toBeNull();
    // nessun'altra chiamata MPC dopo il cambio sorgente
    expect(vi.mocked(searchMpcPrints)).toHaveBeenCalledTimes(2);
  });

  it("escludi la fonte di una tile: chip, lista nascosta, riattivabile", async () => {
    useSettings.setState({
      excluded: { sources: [], tags: [], sets: [] },
      mpcServerUrl: "https://mpcfill.com",
    });
    const mpc: PrintOption = {
      source: "mpc",
      id: "drive-a",
      name: "Sol Ring",
      setCode: "",
      setName: "Trix Are For Scoot",
      collectorNumber: "",
      thumb: "https://img/s.jpg",
      imageLarge: "https://img/sl.jpg",
      hasBack: false,
      highres: true,
      dpi: 810,
    };
    const { searchMpcPrints } = await import("@/services/mpc");
    vi.mocked(searchMpcPrints).mockResolvedValue([mpc]);
    render(<PrintPicker cardName="Sol Ring" onSelect={() => undefined} onClose={() => undefined} />, { wrapper });
    fireEvent.click(screen.getByTestId("source-tab-mpc"));
    await screen.findAllByTestId("print-tile");

    fireEvent.click((await screen.findAllByTestId("print-exclude-source"))[0]!);

    await waitFor(() =>
      expect(useSettings.getState().excluded.sources).toEqual(["Trix Are For Scoot"]),
    );
    // il chip compare e la richiesta successiva porta il drive escluso
    expect(await screen.findByTestId("prints-excluded-chips")).toBeTruthy();
    await waitFor(() =>
      expect(vi.mocked(searchMpcPrints)).toHaveBeenLastCalledWith(
        "Sol Ring",
        expect.anything(),
        expect.objectContaining({ excludedSourceNames: ["Trix Are For Scoot"] }),
      ),
    );

    // ✕ sul chip riattiva la fonte
    fireEvent.click(screen.getByTestId("prints-excluded-source-Trix Are For Scoot"));
    await waitFor(() => expect(useSettings.getState().excluded.sources).toEqual([]));
  });
});
