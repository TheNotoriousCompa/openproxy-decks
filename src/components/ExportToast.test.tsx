import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExportToast } from "@/components/ExportToast";
import { useExportJob, type ExportJob } from "@/stores/exportJob";

const { openMock } = vi.hoisted(() => ({ openMock: vi.fn(async () => undefined) }));

vi.mock("@tauri-apps/plugin-shell", () => ({ open: openMock }));

function job(over: Partial<ExportJob>): ExportJob {
  return {
    kind: "single",
    title: "PDF · Test",
    state: "running",
    frac: 0.42,
    phase: "Elaborazione immagini…",
    startedAt: 0,
    ...over,
  };
}

describe("ExportToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useExportJob.setState({ job: null, collectItems: null });
  });

  it("running: titolo, fase, percentuale e barra (niente chiusura)", () => {
    useExportJob.setState({ job: job({}) });
    render(<ExportToast />);
    expect(screen.getByTestId("export-toast")).toHaveTextContent("PDF · Test");
    expect(screen.getByTestId("export-toast-phase")).toHaveTextContent("Elaborazione immagini… · 42%");
    expect(screen.getByTestId("export-toast-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("export-toast-close")).toBeNull();
  });

  it("done: dettaglio, Apri PDF/cartella e chiusura", () => {
    useExportJob.setState({
      job: job({
        state: "done",
        frac: 1,
        phase: "Completato",
        detail: "2 pagine · 3 copie",
        pdfPath: "/tmp/a.pdf",
        dir: "/tmp",
      }),
    });
    render(<ExportToast />);
    expect(screen.getByTestId("export-toast-phase")).toHaveTextContent("Completato");
    expect(screen.getByTestId("export-toast-detail")).toHaveTextContent("2 pagine · 3 copie");
    fireEvent.click(screen.getByTestId("export-toast-open-pdf"));
    expect(openMock).toHaveBeenCalledWith("/tmp/a.pdf");
    fireEvent.click(screen.getByTestId("export-toast-open-dir"));
    expect(openMock).toHaveBeenCalledWith("/tmp");
    fireEvent.click(screen.getByTestId("export-toast-close"));
    expect(useExportJob.getState().job).toBeNull();
  });

  it("error: messaggio e chiusura", () => {
    useExportJob.setState({ job: job({ state: "error", error: "sorgente scaduta" }) });
    render(<ExportToast />);
    expect(screen.getByTestId("export-toast-error")).toHaveTextContent("sorgente scaduta");
    fireEvent.click(screen.getByTestId("export-toast-close"));
    expect(useExportJob.getState().job).toBeNull();
  });

  it("nessun job → nessuna finestrella", () => {
    render(<ExportToast />);
    expect(screen.queryByTestId("export-toast")).toBeNull();
  });
});
