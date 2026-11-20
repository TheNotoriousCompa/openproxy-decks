export type Zone = "main" | "side" | "commander" | "extra" | "maybe" | "considering" | "tokens" | "custom";

export const ZONE_LABELS: Record<Zone, string> = {
  main: "Main Deck",
  side: "Sideboard",
  commander: "Commander",
  extra: "Extra Deck",
  maybe: "Maybeboard",
  considering: "Considering",
  tokens: "Tokens",
  custom: "Custom",
};

export type ProviderId = "scryfall" | "mpc" | "custom" | "local";

export interface CardEntry {
  id: string;
  name: string;
  qty: number;
  zone: Zone;
  provider: ProviderId;
  providerId?: string;
  setCode?: string;
  collectorNumber?: string;
  imageFront?: string;
  imageBack?: string;
  hasBack: boolean;
  /** tag visivo Comandante (solo app: non sposta la carta di zona, non tocca export) */
  commander?: boolean;
  sortOrder: number;
}

export interface ProjectManifest {
  version: number;
  deck: CardEntry[];
  print: PrintSettings;
}

export interface Project {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  manifest: ProjectManifest;
}

/** Riga leggera per liste con molti progetti (senza manifest). */
export interface ProjectSummary {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  deck_count: number;
}

export interface SummaryPage {
  total: number;
  items: ProjectSummary[];
}

export type PageSizeId = "a3" | "a4" | "a5" | "a6" | "letter" | "legal" | "tabloid" | "custom";
export type CardSizeId = "tcg" | "ygo" | "poker" | "bridge" | "tarot" | "magic" | "magic_true" | "custom";
export type LengthUnit = "mm" | "cm" | "in";
export type DuplexMode = "front_only" | "back_only" | "separate" | "duplex_long" | "duplex_short";
export type CompressionProfile = "minimum" | "balanced" | "high" | "maximum";
export type UpscaleMode = "off" | "ask" | "auto" | "always";

/** Lingua preferita delle stampe: "any" non filtra, le altre ripiegano sull'inglese. */
export type CardLang = "any" | "it" | "en";

/** Campi dei progetti salvati con versioni precedenti: letti per migrare, mai riscritti. */
export interface LegacyPrintFields {
  marginMm?: number;
  spacingMm?: number;
  guideExtent?: "corners" | "full";
}

/** Forma dei segni d'angolo: croce (dentro + fuori), solo dentro o solo fuori la carta. */
export type GuideShape = "cross" | "inside" | "outside";

export interface PrintSettings {
  page: PageSizeId;
  pageWmm: number;
  pageHmm: number;
  orientation: "portrait" | "landscape";
  card: CardSizeId;
  cardWmm: number;
  cardHmm: number;
  /** margini indipendenti per lato in mm (area utile = pagina − i quattro lati) */
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  /** spazio tra carte in mm: righe e colonne indipendenti */
  spacingRowMm: number;
  spacingColMm: number;
  bleedMm: number;
  dpi: number;
  profile: CompressionProfile;
  guides: {
    /** segni agli angoli (taglio a forbice/taglierina) */
    cropMarks: boolean;
    /** segni corti legacy: migrati in cropMarks, mai riscritti */
    cornerMarks: boolean;
    /** riquadro di taglio su ogni carta */
    cutLines: boolean;
    /** linee di taglio a tutta pagina (guide per la taglierina) */
    pageLines: boolean;
  };
  /** colore dei segni d'angolo (le linee di taglio restano nere) */
  guideColor: string;
  /** spessore linea guide in pt (0.25–3, default 0.75) */
  guideWidthPt: number;
  /** posizione della linea rispetto al bordo carta: outside | inside | center */
  guidePlacement: "outside" | "inside" | "center";
  /** lunghezza segni d'angolo in mm (1–10, default 2) */
  guideLengthMm: number;
  /** forma dei segni d'angolo */
  guideShape: GuideShape;
  /** scostamento fine della linea in mm: positivo = verso l'interno della carta */
  guideOffsetMm: number;
  /** tratto: solid | dashed */
  guideStyle: "solid" | "dashed";
  /** terminazioni: square | round */
  guideCap: "square" | "round";
  duplex: DuplexMode;
  upscaleMode: UpscaleMode;
  /** se false, le carte in zona Considering sono escluse da fogli e PDF */
  includeConsidering: boolean;
  /** luminosità in punti percentuale (-50..+50, 0 = invariata): le stampe
   * casalinghe escono più scure dello schermo */
  brightnessPct: number;
  /** dorso applicato solo alle carte senza retro; vuoto = nessun dorso (mai automatico) */
  backImage?: string;
}

export type QualityStatus = "green" | "blue" | "yellow" | "orange" | "red";

export interface QualityReport {
  srcW: number;
  srcH: number;
  reqW: number;
  reqH: number;
  effDpi: number;
  targetDpi: number;
  scaleNeeded: number;
  status: QualityStatus;
}

export interface ProviderCard {
  id: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  imageFront?: string;
  imageBack?: string;
  hasBack: boolean;
}

/** Sorgente di una stampa nel print-picker. */
export type PrintSource = "scryfall" | "mpc";

export interface PrintOption {
  source: PrintSource;
  /** id provider (scryfall uuid) oppure drive identifier (mpc) */
  id: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  releasedAt?: string;
  thumb?: string;
  /**
   * preview a risoluzione media per le tile della griglia (mai `thumb` da
   * 146px stirato): Scryfall `normal` 488px, MPC `medium` w800. Il download
   * full-res resta su `imageFull`.
   */
  preview?: string;
  imageLarge?: string;
  imageFull?: string;
  imageBack?: string;
  hasBack: boolean;
  /** true se scansione ad alta risoluzione (stima grezza se dpi assente) */
  highres: boolean;
  /** DPI reali quando noti (MPC li fornisce; Scryfall dopo analisi file) */
  dpi?: number;
  /** etichetta sorgente per MPC (nome drive / autore) */
  sourceLabel?: string;
  /** prezzo USD da Scryfall quando fornito; mai inventato */
  priceUsd?: string;
  /**
   * Tag della stampa MPC così come li manda il server (catena completa, es.
   * `["AI Art","Art","Custom Art"]`). Servono al filtro «fonti escluse».
   */
  mpcTags?: string[];
}

export interface DeckListLine {
  qty: number;
  name: string;
  zone: Zone;
  setCode?: string;
  collectorNumber?: string;
  /** MPC Art ID (Drive identifier) quando la riga lo riporta: niente ricerca, URL diretto */
  mpcId?: string;
}

export interface ParsedDeckList {
  entries: DeckListLine[];
  unknown: string[];
  warnings: string[];
}
