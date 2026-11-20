import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SheetsPreview, prefetchCellPrints } from "@/features/print/SheetsPreview";
import { usePrint, DEFAULT_PRINT } from "@/stores/print";
import { useSettings } from "@/stores/settings";
import { DEFAULT_MPC_SERVER } from "@/lib/constants";
import { halfWidthMm, lineCenterOffsetMm } from "@/lib/guides";
import type { PrintFlow } from "@/features/print/printModel";

vi.mock("@/services/providers", () => ({
  scryfallProvider: { getCardPrintings: vi.fn(async () => []) },
}));

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const FLOW: PrintFlow = {
  copies: [{ entryId: "c1", name: "Bolt", zone: "main", hasBack: false, commander: false }],
  layout: {
    cols: 3,
    rows: 3,
    perPage: 9,
    pages: 1,
    placements: [{ index: 0, page: 0, xMm: 5, yMm: 5, wMm: 63, hMm: 88 }],
  },
  counts: [{ zone: "main", label: "Main Deck", copies: 1, entries: 1 }],
};

/** Carta 63x88 con bleed 1: cella 65x90 a partire da (5,5) → trim a (6,6). */
const BLEED_FLOW: PrintFlow = {
  copies: [{ entryId: "c1", name: "Bolt", zone: "main", hasBack: false, commander: false }],
  layout: {
    cols: 3,
    rows: 3,
    perPage: 9,
    pages: 1,
    placements: [{ index: 0, page: 0, xMm: 5, yMm: 5, wMm: 65, hMm: 90 }],
  },
  counts: [{ zone: "main", label: "Main Deck", copies: 1, entries: 1 }],
};

const SCALE = 2.2;

function baseProps() {
  return {
    flow: FLOW,
    sheetError: null,
    pageWmm: 210,
    pageHmm: 297,
    cardWmm: 63,
    cardHmm: 88,
    targetDpi: 1200,
    guides: { crop: true, cut: true, page: false },
    guideColor: "#00ff00",
    guideWidthPt: 1,
    guidePlacement: "outside" as const,
    guideLengthMm: 6,
    guideShape: "inside" as const,
    guideOffsetMm: 0,
    guideStyle: "dashed" as const,
    guideCap: "round" as const,
    onPickCopy: () => undefined,
    onContextMenuCopy: () => undefined,
  };
}

describe("SheetsPreview guide + zoom", () => {
  beforeEach(() => {
    usePrint.getState().hydrate({ ...DEFAULT_PRINT, guides: { ...DEFAULT_PRINT.guides } });
  });

  it("segni verdi tratteggiati + riquadro nero", () => {
    const { container } = render(<SheetsPreview {...baseProps()} />, { wrapper });
    const html = container.innerHTML;
    // tratteggio via gradient sui segni d'angolo
    expect(html).toContain("repeating-linear-gradient");
    expect(html).toContain("#00ff00");
    // riquadro di taglio nero, tratteggiato
    expect(html).toContain("#000000");
    expect(html).toContain("dashed");
  });

  it("zoom cambia la larghezza pagina", () => {
    const { container } = render(<SheetsPreview {...baseProps()} />, { wrapper });
    const slider = screen.getByLabelText("Zoom anteprima fogli") as HTMLInputElement;
    const before = (container.querySelector(".relative.border") as HTMLElement | null)?.style.width;
    fireEvent.change(slider, { target: { value: "2" } });
    const after = (container.querySelector(".relative.border") as HTMLElement | null)?.style.width;
    expect(before).not.toBe(after);
    // scala base 2.2 × zoom 2 = 440%
    expect(screen.getByText("440%")).toBeInTheDocument();
  });

  it("toggle Fronte/Retro solo con carte DFC", async () => {
    const dfc: PrintFlow = {
      copies: [{
        entryId: "d1",
        name: "Delver",
        zone: "main",
        imageFront: "https://img/front.jpg",
        imageBack: "https://img/back.jpg",
        hasBack: true,
        commander: false,
      }],
      layout: {
        cols: 3,
        rows: 3,
        perPage: 9,
        pages: 1,
        placements: [{ index: 0, page: 0, xMm: 5, yMm: 5, wMm: 63, hMm: 88 }],
      },
      counts: [{ zone: "main", label: "Main Deck", copies: 1, entries: 1 }],
    };
    const { container } = render(<SheetsPreview {...baseProps()} flow={dfc} />, { wrapper });
    expect(screen.getByRole("group", { name: "Lato anteprima" })).toBeInTheDocument();
    const img = (): Element | null => container.querySelector('div[title="Delver"] img');
    await waitFor(() => expect(img()?.getAttribute("src")).toBe("https://img/front.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "Retro" }));
    await waitFor(() => expect(img()?.getAttribute("src")).toBe("https://img/back.jpg"));
    fireEvent.click(screen.getByRole("button", { name: "Fronte" }));
    await waitFor(() => expect(img()?.getAttribute("src")).toBe("https://img/front.jpg"));
  });

  it("niente toggle lato senza retri", () => {
    render(<SheetsPreview {...baseProps()} />, { wrapper });
    expect(screen.queryByRole("group", { name: "Lato anteprima" })).toBeNull();
  });

  it("dorso di default: attiva il toggle e si vede nel retro", async () => {
    const { container } = render(
      <SheetsPreview {...baseProps()} defaultBack="https://img/dorso.jpg" />,
      { wrapper },
    );
    expect(screen.getByRole("group", { name: "Lato anteprima" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retro" }));
    await waitFor(() =>
      expect(container.querySelector('div[title="Bolt"] img')?.getAttribute("src")).toBe("https://img/dorso.jpg"),
    );
  });

  it("hover cella → prefetch stampe (Scryfall se MPC non configurato)", async () => {
    const { scryfallProvider } = await import("@/services/providers");
    useSettings.setState({ mpcServerUrl: "" });
    try {
      const { container } = render(<SheetsPreview {...baseProps()} />, { wrapper });
      const btn = container.querySelector('[data-testid="sheet-cell-c1"]') as HTMLElement;
      fireEvent.mouseEnter(btn);
      await waitFor(() =>
        expect(vi.mocked(scryfallProvider.getCardPrintings!)).toHaveBeenCalledWith(
          "Bolt",
          expect.anything(),
          undefined,
          expect.anything(),
        ),
      );
      // helper diretto: niente throw, niente doppia chiave diversa
      prefetchCellPrints("  ");
      expect(vi.mocked(scryfallProvider.getCardPrintings!)).toHaveBeenCalledTimes(1);
    } finally {
      useSettings.setState({ mpcServerUrl: DEFAULT_MPC_SERVER });
    }
  });

  it("spinner sulla cella mentre l'immagine si scarica (e assente a riposo)", () => {
    const { container, rerender } = render(<SheetsPreview {...baseProps()} />, { wrapper });
    expect(container.querySelector('[data-testid="cell-loading"]')).toBeNull();
    rerender(<SheetsPreview {...baseProps()} pendingEntryIds={["c1"]} />);
    const overlay = container.querySelector('[data-testid="cell-loading"]');
    expect(overlay).not.toBeNull();
    // sta SOPRA la cella (stesso contenitore dell'artwork) e non blocca i click
    expect(overlay?.className).toContain("pointer-events-none");
    expect(overlay?.querySelectorAll(".px-spinner > span")).toHaveLength(9);
    // voci non in aggiornamento: nessuno spinner
    rerender(<SheetsPreview {...baseProps()} pendingEntryIds={["altra"]} />);
    expect(container.querySelector('[data-testid="cell-loading"]')).toBeNull();
  });

  it("posizione: dentro / sul bordo / fuori spostano il tratto di mezzo spessore", () => {
    const solid = {
      ...baseProps(),
      flow: BLEED_FLOW,
      bleedMm: 1,
      guides: { crop: true, cut: false, page: false },
      guideStyle: "solid" as const,
    };
    const { container, rerender } = render(<SheetsPreview {...solid} />, { wrapper });
    // il primo segmento orizzontale verde parte dal bordo sinistro della cella
    // bracci orizzontali: i verticali hanno lo stesso asse ma partono mezzo
    // spessore piu' a sinistra, qui interessa l'ancoraggio del braccio
    const firstGreenLeft = (): number => {
      const els = [...container.querySelectorAll("div")].filter((d) => {
        const st = (d as HTMLElement).style;
        return st.backgroundColor === "rgb(0, 255, 0)" && parseFloat(st.width) > parseFloat(st.height);
      });
      const lefts = els.map((e) => parseFloat((e as HTMLElement).style.left)).sort((a, b) => a - b);
      return lefts[0] as number;
    };
    const half = halfWidthMm(1);
    // outside: percorso mezzo spessore fuori dal trim (cella x=5 + bleed 1 = 6mm)
    expect(firstGreenLeft()).toBeCloseTo((6 - half) * SCALE, 6);
    rerender(<SheetsPreview {...solid} guidePlacement="inside" />);
    expect(firstGreenLeft()).toBeCloseTo((6 + half) * SCALE, 6);
    rerender(<SheetsPreview {...solid} guidePlacement="center" />);
    expect(firstGreenLeft()).toBeCloseTo(6 * SCALE, 6);
  });

  it("scostamento positivo porta il tratto dentro la carta", () => {
    const { container } = render(
      <SheetsPreview
        {...baseProps()}
        flow={BLEED_FLOW}
        bleedMm={1}
        guides={{ crop: true, cut: false, page: false }}
        guideStyle="solid"
        guideOffsetMm={2}
      />,
      { wrapper },
    );
    const els = [...container.querySelectorAll("div")].filter((d) => {
      const st = (d as HTMLElement).style;
      return st.backgroundColor === "rgb(0, 255, 0)" && parseFloat(st.width) > parseFloat(st.height);
    });
    const lefts = els.map((e) => parseFloat((e as HTMLElement).style.left)).sort((a, b) => a - b);
    const expected = (6 - halfWidthMm(1) + 2) * SCALE;
    expect(lefts[0]).toBeCloseTo(expected, 6);
  });

  it("riquadro carta sul trim (non sul bordo bleed)", () => {    const { container } = render(
      <SheetsPreview {...baseProps()} flow={BLEED_FLOW} bleedMm={1} guides={{ crop: false, cut: true, page: false }} />,
      { wrapper },
    );
    const outline = container.querySelector('div[style*="outline"]') as HTMLElement | null;
    expect(outline).not.toBeNull();
    // inset negativo (fuori): il percorso va verso il bleed, il riquadro e' centrato su di esso
    const inset = lineCenterOffsetMm(1, "outside", 0);
    expect(parseFloat(outline?.style.left ?? "")).toBeCloseTo((6 + inset) * SCALE, 6);
    expect(parseFloat(outline?.style.top ?? "")).toBeCloseTo((6 + inset) * SCALE, 6);
    expect(parseFloat(outline?.style.width ?? "")).toBeCloseTo((63 - inset * 2) * SCALE, 6);
    expect(parseFloat(outline?.style.height ?? "")).toBeCloseTo((88 - inset * 2) * SCALE, 6);
  });

  it("linee pagina: i bordi di taglio proseguono a tutta pagina", () => {
    const { container } = render(
      <SheetsPreview
        {...baseProps()}
        flow={BLEED_FLOW}
        bleedMm={1}
        guides={{ crop: false, cut: false, page: true }}
      />,
      { wrapper },
    );
    const inset = lineCenterOffsetMm(1, "outside", 0);
    // il tratto in preview non scende sotto 1px (clamp del componente)
    const thicknessPx = Math.max(1, 1 * (25.4 / 72) * SCALE);
    const vlines = [...container.querySelectorAll("div.top-0")].map(
      (el) => parseFloat((el as HTMLElement).style.left),
    );
    const hlines = [...container.querySelectorAll("div.left-0")].map(
      (el) => parseFloat((el as HTMLElement).style.top),
    );
    expect(vlines).toHaveLength(2);
    expect(hlines).toHaveLength(2);
    // il div e' centrato sul bordo: left = bordo − mezzo spessore
    const edgePx = (mm: number): number => (Math.round(mm * 1000) / 1000) * SCALE;
    const sorted = [...vlines].sort((a, b) => a - b);
    expect(sorted[0]).toBeCloseTo(edgePx(6 + inset) - thicknessPx / 2, 6);
    expect(sorted[1]).toBeCloseTo(edgePx(6 + inset + (63 - inset * 2)) - thicknessPx / 2, 6);
    expect([...hlines].sort((a, b) => a - b)[0]).toBeCloseTo(edgePx(6 + inset) - thicknessPx / 2, 6);
  });

  it("banda bleed: carta a misura sul trim + 8 strisce specchiate (niente col bleed 0)", () => {
    const withArt: PrintFlow = {
      copies: [{ entryId: "c1", name: "Bolt", zone: "main", imageFront: "https://img/bolt.jpg", hasBack: false, commander: false }],
      layout: {
        cols: 3,
        rows: 3,
        perPage: 9,
        pages: 1,
        placements: [{ index: 0, page: 0, xMm: 5, yMm: 5, wMm: 65, hMm: 90 }],
      },
      counts: [{ zone: "main", label: "Main Deck", copies: 1, entries: 1 }],
    };
    const props = {
      ...baseProps(),
      flow: withArt,
      bleedMm: 1,
      guides: { crop: false, cut: false, page: false },
    };
    const { container, rerender } = render(<SheetsPreview {...props} />, { wrapper });
    const bands = container.querySelector('[data-testid="bleed-bands"]') as HTMLElement | null;
    expect(bands).not.toBeNull();
    // 4 lati + 4 angoli, tutti con img specchiata
    const imgs = bands?.querySelectorAll("img") ?? [];
    expect(imgs.length).toBe(8);
    const left = imgs[0] as HTMLElement;
    expect(left.style.transform).toBe("scaleX(-1)");
    expect(left.style.right).toBe("0px");
    // la carta sta sul trim: 1mm dal bordo cella, 63x88mm (non tutta la cella)
    const cell = container.querySelector('div[title="Bolt"]') as HTMLElement | null;
    const trimBox = [...(cell?.querySelectorAll(":scope > div") ?? [])].find(
      (d) => (d as HTMLElement).style.width !== "" && !(d as HTMLElement).hasAttribute("data-testid"),
    ) as HTMLElement | undefined;
    expect(parseFloat(trimBox?.style.left ?? "")).toBeCloseTo(1 * SCALE, 6);
    expect(parseFloat(trimBox?.style.top ?? "")).toBeCloseTo(1 * SCALE, 6);
    expect(parseFloat(trimBox?.style.width ?? "")).toBeCloseTo(63 * SCALE, 6);
    expect(parseFloat(trimBox?.style.height ?? "")).toBeCloseTo(88 * SCALE, 6);
    // bleed 0: niente banda, carta tutta cella (comportamento invariato)
    rerender(<SheetsPreview {...props} bleedMm={0} />);
    expect(container.querySelector('[data-testid="bleed-bands"]')).toBeNull();
  });
});
