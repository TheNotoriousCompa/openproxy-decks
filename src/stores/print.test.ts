import { describe, expect, it } from "vitest";
import { usePrint, DEFAULT_PRINT } from "@/stores/print";

describe("print store guide defaults", () => {
  it("default: segni verdi 2mm dentro gli angoli, riquadro e linee pagina spenti", () => {
    usePrint.getState().hydrate({
      ...DEFAULT_PRINT,
      guides: { ...DEFAULT_PRINT.guides },
      guideColor: undefined as never,
      guideWidthPt: undefined as never,
    });
    const s = usePrint.getState();
    expect(s.guides).toEqual({ cropMarks: true, cornerMarks: false, cutLines: false, pageLines: false });
    expect(s.guideColor).toBe("#00ff00");
    expect(s.guideWidthPt).toBe(0.75);
    expect(s.guidePlacement).toBe("inside");
    expect(s.guideLengthMm).toBe(2);
    expect(s.guideShape).toBe("inside");
    expect(s.guideOffsetMm).toBe(0);
    expect(s.guideStyle).toBe("solid");
    expect(s.guideCap).toBe("square");
  });

  it("margini e spazi unici dei progetti vecchi diventano quattro lati + righe/colonne", () => {
    usePrint.getState().hydrate({
      ...DEFAULT_PRINT,
      marginMm: 7,
      spacingMm: 1.5,
      bleedMm: 0,
    });
    const s = usePrint.getState();
    expect([s.marginTopMm, s.marginRightMm, s.marginBottomMm, s.marginLeftMm]).toEqual([7, 7, 7, 7]);
    expect(s.spacingRowMm).toBe(1.5);
    expect(s.spacingColMm).toBe(1.5);
    // bleed 0 con margini personalizzati: rispettato (solo il default 3/0/0 migra a 1)
    expect(s.bleedMm).toBe(0);
  });

  it("bleed dei vecchi default non toccati diventa 1mm", () => {
    usePrint.getState().hydrate({ ...DEFAULT_PRINT, marginMm: 3, spacingMm: 0, bleedMm: 0 });
    expect(usePrint.getState().bleedMm).toBe(1);
  });

  it("il vecchio \"Pagina intera\" accende le linee di pagina", () => {
    usePrint.getState().hydrate({
      ...DEFAULT_PRINT,
      guideExtent: "full",
      guides: { cropMarks: true, cornerMarks: false, cutLines: true, pageLines: false },
    });
    const s = usePrint.getState();
    expect(s.guides.pageLines).toBe(true);
    expect(s.guides.cutLines).toBe(false);
  });

  it("i vecchi segni corti diventano segni normali", () => {
    usePrint.getState().hydrate({
      ...DEFAULT_PRINT,
      guides: { cropMarks: false, cornerMarks: true, cutLines: false, pageLines: false },
    });
    const s = usePrint.getState();
    expect(s.guides.cropMarks).toBe(true);
    expect(s.guides.cornerMarks).toBe(false);
  });

  it("hydrate migra i vecchi default (rossi o neri) verso i segni verdi", () => {
    usePrint.getState().hydrate({
      ...DEFAULT_PRINT,
      guides: { ...DEFAULT_PRINT.guides },
      guideColor: "#ff0000",
      guideWidthPt: 0.4,
      guidePlacement: "outside",
      guideStyle: "solid",
      guideCap: "square",
    });
    const s = usePrint.getState();
    expect(s.guideColor).toBe("#00ff00");
    expect(s.guideWidthPt).toBe(0.75);
    expect(s.guidePlacement).toBe("inside");
    expect(s.guideShape).toBe("inside");
    // scelta personalizzata (guide verdi brillanti) rispettata
    usePrint.getState().hydrate({
      ...DEFAULT_PRINT,
      guides: { ...DEFAULT_PRINT.guides },
      guideColor: "#00ff00",
    });
    expect(usePrint.getState().guideColor).toBe("#00ff00");
  });

  it("hydrate conserva i valori salvati", () => {
    usePrint.getState().hydrate({
      ...DEFAULT_PRINT,
      guides: { ...DEFAULT_PRINT.guides },
      guideColor: "#00aaff",
      guideWidthPt: 1.5,
      guideLengthMm: 4,
      guideShape: "cross",
      guideOffsetMm: -0.5,
      marginTopMm: 12,
      spacingColMm: 3,
      backImage: "C:/assets/dorso.png",
    });
    const s = usePrint.getState();
    expect(s.guideColor).toBe("#00aaff");
    expect(s.guideWidthPt).toBe(1.5);
    expect(s.guideLengthMm).toBe(4);
    expect(s.guideShape).toBe("cross");
    expect(s.guideOffsetMm).toBe(-0.5);
    expect(s.marginTopMm).toBe(12);
    expect(s.marginRightMm).toBe(3);
    expect(s.spacingColMm).toBe(3);
    expect(s.backImage).toBe("C:/assets/dorso.png");
  });

  it("dorso di default assente resta assente (mai automatico)", () => {
    usePrint.getState().hydrate({ ...DEFAULT_PRINT, guides: { ...DEFAULT_PRINT.guides } });
    expect(usePrint.getState().backImage).toBeUndefined();
  });

  it("upscale \"always\" storico diventa automatico (default attuale)", () => {
    usePrint.getState().hydrate({ ...DEFAULT_PRINT, upscaleMode: "always" });
    expect(usePrint.getState().upscaleMode).toBe("auto");
  });

  it("scelta esplicita \"off\" resta spenta", () => {
    usePrint.getState().hydrate({ ...DEFAULT_PRINT, upscaleMode: "off" });
    expect(usePrint.getState().upscaleMode).toBe("off");
  });

  it("carte non-Magic salvate tornano su misura manuale", () => {
    usePrint.getState().hydrate({ ...DEFAULT_PRINT, card: "ygo", cardWmm: 59, cardHmm: 86 });
    const s = usePrint.getState();
    expect(s.card).toBe("custom");
    expect(s.cardWmm).toBe(59);
    expect(s.cardHmm).toBe(86);
  });
});
