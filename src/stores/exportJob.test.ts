import { describe, expect, it, beforeEach } from "vitest";
import { phaseOf, useExportJob } from "@/stores/exportJob";

describe("exportJob store", () => {
  beforeEach(() => {
    useExportJob.setState({ job: null, collectItems: null });
  });

  it("begin → running; progress aggiorna; finish → done con path", () => {
    const s = useExportJob.getState();
    s.begin("single", "PDF · Test");
    expect(useExportJob.getState().job).toMatchObject({
      kind: "single",
      title: "PDF · Test",
      state: "running",
      frac: 0,
      phase: "Preparazione…",
    });
    s.progress(0.4, "Elaborazione immagini…");
    expect(useExportJob.getState().job?.frac).toBe(0.4);
    s.finish({ detail: "2 pagine", pdfPath: "/tmp/a.pdf", dir: "/tmp" });
    expect(useExportJob.getState().job).toMatchObject({
      state: "done",
      frac: 1,
      phase: "Completato",
      detail: "2 pagine",
      pdfPath: "/tmp/a.pdf",
      dir: "/tmp",
    });
  });

  it("fail → error; dismiss azzera", () => {
    const s = useExportJob.getState();
    s.begin("batch", "PDF unito · 3 progetti");
    s.fail("sorgente scaduta");
    expect(useExportJob.getState().job).toMatchObject({ state: "error", error: "sorgente scaduta" });
    s.dismiss();
    expect(useExportJob.getState().job).toBeNull();
  });

  it("progress ignorato se il job non è running", () => {
    const s = useExportJob.getState();
    s.progress(0.9, "Impaginazione…");
    expect(useExportJob.getState().job).toBeNull();
    s.begin("single", "X");
    s.finish({});
    s.progress(0.5, "Impaginazione…");
    expect(useExportJob.getState().job?.frac).toBe(1);
  });

  it("begin azzera il prompt collezione precedente", () => {
    useExportJob.setState({
      collectItems: [{ name: "Bolt", qty: 1 }],
    });
    useExportJob.getState().begin("single", "X");
    expect(useExportJob.getState().collectItems).toBeNull();
  });

  it("fasi backend → italiano", () => {
    expect(phaseOf("processing")).toBe("Elaborazione immagini…");
    expect(phaseOf("layout")).toBe("Impaginazione…");
    expect(phaseOf("done")).toBe("Scrittura PDF…");
  });
});
