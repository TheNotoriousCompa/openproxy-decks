import { create } from "zustand";
import type { LegacyPrintFields, PrintSettings } from "@/types";

export const DEFAULT_PRINT: PrintSettings = {
  page: "a4",
  pageWmm: 210,
  pageHmm: 297,
  orientation: "portrait",
  card: "magic",
  cardWmm: 63,
  cardHmm: 88,
  marginTopMm: 3,
  marginRightMm: 3,
  marginBottomMm: 3,
  marginLeftMm: 3,
  spacingRowMm: 0,
  spacingColMm: 0,
  // bleed 1mm fisso di default (rapido 1/8" disponibile per lo standard TCG)
  bleedMm: 1,
  dpi: 1200,
  profile: "maximum",
  // segni d'angolo verdi da 2mm verso l'interno (come proxxied.com),
  // riquadro e linee di pagina spenti: si accendono a parte
  guides: { cropMarks: true, cornerMarks: false, cutLines: false, pageLines: false },
  guideColor: "#00ff00",
  guideWidthPt: 0.75,
  guidePlacement: "inside",
  guideLengthMm: 2,
  guideShape: "inside",
  guideOffsetMm: 0,
  guideStyle: "solid",
  guideCap: "square",
  duplex: "front_only",
  // miglioramento automatico attivo di default (come proxxied.com)
  upscaleMode: "auto",
  /** luminosità stampa: 0 = invariata (stampe casalinghe più scure: +5..+10) */
  brightnessPct: 0,
  /** considering stampate di default (togli per escluderle da fogli e PDF) */
  includeConsidering: true,
};

interface PrintState extends PrintSettings {
  zoom: number;
  hydrate: (p: Partial<PrintSettings> & LegacyPrintFields) => void;
  set: <K extends keyof PrintSettings>(key: K, value: PrintSettings[K]) => void;
  setZoom: (z: number) => void;
  pageDims: () => { w: number; h: number };
}

export const usePrint = create<PrintState>()((set, get) => ({
  ...DEFAULT_PRINT,
  zoom: 0.6,

  hydrate: (p) => {
    // base completa + migrazioni dei default storici. `p` puo' portare anche i
    // campi legacy (marginMm/spacingMm/guideExtent) dei progetti gia' salvati.
    const base: PrintSettings = {
      ...DEFAULT_PRINT,
      ...p,
      guides: { ...DEFAULT_PRINT.guides, ...(p.guides ?? {}) },
    };
    // dati legacy parziali: i campi mancanti tornano ai default (mai undefined)
    base.guideColor = base.guideColor ?? DEFAULT_PRINT.guideColor;
    base.guideWidthPt = base.guideWidthPt ?? DEFAULT_PRINT.guideWidthPt;
    base.guidePlacement = base.guidePlacement ?? DEFAULT_PRINT.guidePlacement;
    base.guideLengthMm = base.guideLengthMm ?? DEFAULT_PRINT.guideLengthMm;
    base.guideShape = base.guideShape ?? DEFAULT_PRINT.guideShape;
    base.guideOffsetMm = base.guideOffsetMm ?? DEFAULT_PRINT.guideOffsetMm;
    base.guideStyle = base.guideStyle ?? DEFAULT_PRINT.guideStyle;
    base.guideCap = base.guideCap ?? DEFAULT_PRINT.guideCap;
    // margini unici → quattro lati; spazio unico → righe/colonne
    if (p.marginMm !== undefined) {
      base.marginTopMm = p.marginMm;
      base.marginRightMm = p.marginMm;
      base.marginBottomMm = p.marginMm;
      base.marginLeftMm = p.marginMm;
    }
    if (p.spacingMm !== undefined) {
      base.spacingRowMm = p.spacingMm;
      base.spacingColMm = p.spacingMm;
    }
    // il vecchio "Pagina intera" accendeva le linee lunghe al posto del riquadro
    if (p.guideExtent === "full") {
      base.guides.pageLines = true;
      base.guides.cutLines = false;
    } else if (p.guideExtent === "corners" && p.guides?.cutLines === false && p.guides?.cropMarks === true) {
      // vecchio default "solo segni": niente riquadro
      base.guides.cutLines = false;
    }
    // i "segni corti" storici diventano segni normali
    if (base.guides.cornerMarks && !base.guides.cropMarks) base.guides.cropMarks = true;
    base.guides.cornerMarks = false;
    // migrazione ai default verdi: scatta solo su un default mai personalizzato
    const legacyRed =
      base.guideColor === "#ff0000" &&
      base.guideWidthPt === 0.4 &&
      base.guidePlacement === "outside" &&
      base.guideStyle === "solid" &&
      base.guideCap === "square";
    const legacyBlackFull =
      base.guideColor === "#000000" &&
      base.guideWidthPt === 0.78 &&
      base.guidePlacement === "center" &&
      base.guideStyle === "solid" &&
      base.guideCap === "square";
    if (legacyRed || legacyBlackFull) {
      base.guideColor = DEFAULT_PRINT.guideColor;
      base.guideWidthPt = DEFAULT_PRINT.guideWidthPt;
      base.guidePlacement = DEFAULT_PRINT.guidePlacement;
      base.guideShape = DEFAULT_PRINT.guideShape;
      base.guideLengthMm = DEFAULT_PRINT.guideLengthMm;
    }
    if (base.card === ("tcg" as PrintSettings["card"])) base.card = "custom";
    // altri giochi rimossi dalla UI: diventano dimensioni manuali (misure intatte)
    if (base.card === "ygo" || base.card === "poker" || base.card === "bridge" || base.card === "tarot") {
      base.card = "custom";
    }
    // bleed: default 1mm — i vecchi default mai toccati erano 0
    if (
      base.bleedMm === 0 &&
      base.marginTopMm === 3 &&
      base.spacingRowMm === 0 &&
      base.spacingColMm === 0
    ) {
      base.bleedMm = 1;
    }
    // miglioramento automatico di default: "always" era il default distribuito
    // (poi migrato a "off"), ora il default è "auto" — si migra solo il valore
    // storico mai scelto esplicitamente, le scelte "off" restano.
    if (base.upscaleMode === "always") base.upscaleMode = "auto";
    // luminosità per i progetti salvati prima del campo
    base.brightnessPct = base.brightnessPct ?? 0;
    // considering incluse per i progetti salvati prima del campo
    base.includeConsidering = base.includeConsidering ?? true;
    // niente dorso finché non lo scegli: azzera anche un valore rimasto in memoria
    base.backImage = base.backImage || undefined;
    set(base);
  },
  set: (key, value) => set({ [key]: value } as Partial<PrintState>),
  setZoom: (zoom) => set({ zoom: Math.min(3, Math.max(0.2, zoom)) }),
  pageDims: () => {
    const s = get();
    return s.orientation === "portrait" ? { w: s.pageWmm, h: s.pageHmm } : { w: s.pageHmm, h: s.pageWmm };
  },
}));
