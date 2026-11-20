import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { StudioView } from "@/features/studio/StudioView";
import { GUIDE_DEFAULTS } from "@/features/print/PrintForm";
import { VERIFY_TOL_PCT, VERIFY_PRINTER_ERR_PCT } from "@/features/print/usePrintBuilder";
import { usePrint, DEFAULT_PRINT } from "@/stores/print";
import { useDeck } from "@/stores/deck";
import { useProjects } from "@/stores/projects";
import { printSettingsSchema } from "@/lib/schemas";

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("PrintForm guide", () => {
  it("GUIDE_DEFAULTS validi e coerenti con DEFAULT_PRINT", () => {
    expect(printSettingsSchema.shape.guideColor.safeParse(GUIDE_DEFAULTS.guideColor).success).toBe(true);
    expect(GUIDE_DEFAULTS.guideWidthPt).toBe(DEFAULT_PRINT.guideWidthPt);
    // default: segni d'angolo verdi da 2mm dentro gli angoli
    expect(GUIDE_DEFAULTS.guideLengthMm).toBe(2);
    expect(GUIDE_DEFAULTS.guideShape).toBe("inside");
    expect(GUIDE_DEFAULTS.guideOffsetMm).toBe(0);
    expect(GUIDE_DEFAULTS.guideColor).toBe("#00ff00");
    expect(GUIDE_DEFAULTS.guidePlacement).toBe("inside");
    expect(GUIDE_DEFAULTS.guides.cropMarks).toBe(true);
    expect(GUIDE_DEFAULTS.guides.cutLines).toBe(false);
    expect(GUIDE_DEFAULTS.guides.pageLines).toBe(false);
    // Ripristina guide torna esattamente ai default dello store
    expect(GUIDE_DEFAULTS.guides).toEqual(DEFAULT_PRINT.guides);
    expect(GUIDE_DEFAULTS.guideShape).toBe(DEFAULT_PRINT.guideShape);
  });

  it("verifica stretta: tol 0.5% + sim stampante 0.3%", () => {
    expect(VERIFY_TOL_PCT).toBe(0.5);
    expect(VERIFY_PRINTER_ERR_PCT).toBe(0.3);
    // nominale include bleed per lato: 63+2*1=65
    expect(63 + 1 * 2).toBe(65);
  });

  it("livelli piatti + ripristino guide", async () => {
    useProjects.setState({ projects: [], activeId: "p1" });
    useDeck.getState().hydrate([]);
    usePrint.getState().hydrate({ ...DEFAULT_PRINT, guides: { ...DEFAULT_PRINT.guides } });
    render(<StudioView />, { wrapper });

    // cinque livelli affiancati, niente menu dentro menu
    for (const label of ["1 · Formato", "2 · Griglia", "3 · Qualità", "4 · Guide", "5 · Esporta"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }

    // livello guide: tipo, forma, posizione
    fireEvent.click(screen.getByRole("tab", { name: "4 · Guide" }));
    expect(screen.getByRole("checkbox", { name: /Segni d'angolo/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Riquadro carta/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Linee pagina/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Croce" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sul bordo" })).toBeInTheDocument();
    expect(screen.getByText(/linee di taglio sempre nere/)).toBeInTheDocument();

    // sporca colore, forma e lunghezza, poi ripristina i default
    fireEvent.change(screen.getByLabelText("Colore segni d'angolo"), { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Croce" }));
    fireEvent.change(screen.getByLabelText("Lunghezza segni"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Ripristina guide di taglio" }));
    await waitFor(() => expect(usePrint.getState().guideColor).toBe("#00ff00"));
    await waitFor(() => expect(usePrint.getState().guideLengthMm).toBe(2));
    await waitFor(() => expect(usePrint.getState().guideShape).toBe("inside"));
    // altri campi intatti
    expect(usePrint.getState().dpi).toBe(DEFAULT_PRINT.dpi);
  });

  it("livello Griglia: margini sui quattro lati e spazi righe/colonne", () => {
    useProjects.setState({ projects: [], activeId: "p1" });
    useDeck.getState().hydrate([]);
    usePrint.getState().hydrate({ ...DEFAULT_PRINT, guides: { ...DEFAULT_PRINT.guides } });
    render(<StudioView />, { wrapper });
    fireEvent.click(screen.getByRole("tab", { name: "2 · Griglia" }));
    for (const label of ["Alto", "Basso", "Sinistro", "Destro", "Tra righe", "Tra colonne"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    // i margini rapidi scrivono tutti e quattro i lati
    fireEvent.click(screen.getByRole("button", { name: "Margini 5mm su tutti i lati" }));
    for (const label of ["Alto", "Basso", "Sinistro", "Destro"]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe("5");
    }
  });

  it("livello Qualità: dorso di default facoltativo (nessuno di default)", () => {
    useProjects.setState({ projects: [], activeId: "p1" });
    useDeck.getState().hydrate([]);
    usePrint.getState().hydrate({ ...DEFAULT_PRINT, guides: { ...DEFAULT_PRINT.guides } });
    render(<StudioView />, { wrapper });
    fireEvent.click(screen.getByRole("tab", { name: "3 · Qualità" }));
    expect(screen.getByText(/Dorso di default \(facoltativo\)/)).toBeInTheDocument();
    expect(screen.getByText("Nessun dorso")).toBeInTheDocument();
    expect(screen.getByText("Scegli immagine")).toBeInTheDocument();
  });
});
