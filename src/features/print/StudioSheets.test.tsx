import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { StudioView } from "@/features/studio/StudioView";
import { useDeck } from "@/stores/deck";
import { usePrint, DEFAULT_PRINT } from "@/stores/print";
import { useProjects } from "@/stores/projects";
import type { CardEntry } from "@/types";

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

let n = 0;
function card(name: string, zone: CardEntry["zone"], qty: number, imageFront?: string): CardEntry {
  n += 1;
  return {
    id: `c-${n}`, name, qty, zone, provider: "scryfall", providerId: `p-${n}`,
    setCode: "LTC", collectorNumber: `${n}`, imageFront, hasBack: false, sortOrder: n,
  };
}

describe("Studio: flusso continuo + chip di zona", () => {
  it("riepilogo zone + 3x3 con artwork + celle cliccabili con stat", async () => {
    useProjects.setState({ projects: [], activeId: "test-proj" });
    useDeck.getState().hydrate([
      ...Array.from({ length: 10 }, (_, i) => card(`Bolt ${i}`, "main", 1, "https://img/bolt.jpg")),
      card("Sauron", "commander", 1, "https://img/sauron.jpg"),
      card("Negate", "side", 2, "https://img/negate.jpg"),
    ]);
    usePrint.getState().hydrate({ ...DEFAULT_PRINT, guides: { ...DEFAULT_PRINT.guides }, bleedMm: 1 });
    render(<StudioView />, { wrapper });

    // flusso continuo: 11 main (comandante accorpato) + 2 side in 2 pagine piene
    expect(screen.getByText("2 pagine · 13 copie")).toBeInTheDocument();
    const breakdown = screen.getByTestId("sheet-zone-breakdown");
    expect(breakdown).toHaveTextContent("11 Main Deck");
    expect(breakdown).toHaveTextContent("2 Sideboard");
    // niente più sezioni per zona: i chip segnano solo l'inizio di ogni gruppo
    expect(screen.queryByTestId("sheet-label-main")).toBeNull();
    expect(screen.getByTestId("sheet-zone-main")).toHaveTextContent("Main Deck");
    expect(screen.getByTestId("sheet-zone-side")).toHaveTextContent("Sideboard");
    expect(screen.queryByTestId("sheet-zone-tokens")).toBeNull();
    // 3x3 reale (bleed 1 = default Studio)
    expect(screen.getByText(/3×3 per pagina/)).toBeInTheDocument();
    // artwork presente nelle celle + chip DPI target (browser: non misurato)
    const imgs = screen.getAllByRole("img", { hidden: true });
    expect(imgs.length).toBeGreaterThan(0);
    // cella cliccabile con stat: apre il picker
    const cell = screen.getByTestId("sheet-cell-c-11");
    expect(cell).toBeInTheDocument();
    expect(cell.getAttribute("aria-label")).toContain("Sauron");
    fireEvent.click(cell);
    expect(await screen.findByTestId("print-picker")).toBeInTheDocument();
  });
});
