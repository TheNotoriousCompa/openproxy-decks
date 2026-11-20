import type { LengthUnit } from "@/types";

/** Unità canonica interna: mm. Mirror di src-tauri/src/processing. */
export const MM_PER_INCH = 25.4;

export function toMm(value: number, unit: LengthUnit): number {
  switch (unit) {
    case "mm":
      return value;
    case "cm":
      return value * 10;
    case "in":
      return value * MM_PER_INCH;
  }
}

export function fromMm(mm: number, unit: LengthUnit): number {
  switch (unit) {
    case "mm":
      return mm;
    case "cm":
      return mm / 10;
    case "in":
      return mm / MM_PER_INCH;
  }
}

/** effectiveDPI = sourcePixels / targetInches */
export function effectiveDpi(sourcePx: number, targetMm: number): number {
  if (targetMm <= 0) return 0;
  return sourcePx / (targetMm / MM_PER_INCH);
}

export function requiredPixels(targetMm: number, dpi: number): number {
  return Math.round((targetMm / MM_PER_INCH) * dpi);
}

export const CARD_PRESETS_MM: Record<string, { w: number; h: number; label: string }> = {
  // Solo Magic: gli altri giochi (tcg/ygo/poker/bridge/tarot) restano validi
  // per back-compat con progetti salvati, ma non sono più selezionabili.
  tcg: { w: 63, h: 88, label: "Standard TCG — 63 × 88 mm" },
  ygo: { w: 59, h: 86, label: "Yu-Gi-Oh — 59 × 86 mm" },
  poker: { w: 63.5, h: 88.9, label: "Poker — 63.5 × 88.9 mm" },
  bridge: { w: 57, h: 89, label: "Bridge — 57 × 89 mm" },
  tarot: { w: 70, h: 120, label: "Tarot — 70 × 120 mm" },
  magic: { w: 63, h: 88, label: "Magic: The Gathering — 63 × 88 mm" },
  // dimensione "vera" della carta Magic: 2.5 × 3.5 pollici (come proxxied)
  magic_true: { w: 63.5, h: 88.9, label: "Magic (2.5×3.5 in) — 63.5 × 88.9 mm" },
  custom: { w: 63, h: 88, label: "Personalizzata" },
};

/** Voci mostrabili nel selettore formato carta: solo Magic + manuale. */
export const VISIBLE_CARD_PRESETS: [string, { w: number; h: number; label: string }][] =
  Object.entries(CARD_PRESETS_MM).filter(([id]) => id === "magic" || id === "magic_true" || id === "custom");

export const PAGE_PRESETS_MM: Record<string, { w: number; h: number; label: string }> = {
  a3: { w: 297, h: 420, label: "A3" },
  a4: { w: 210, h: 297, label: "A4" },
  a5: { w: 148, h: 210, label: "A5" },
  a6: { w: 105, h: 148, label: "A6" },
  letter: { w: 215.9, h: 279.4, label: "Letter" },
  legal: { w: 215.9, h: 355.6, label: "Legal" },
  tabloid: { w: 279.4, h: 431.8, label: "Tabloid" },
  custom: { w: 210, h: 297, label: "Custom" },
};

export const DPI_PRESETS = [150, 300, 450, 600, 900, 1200] as const;

/** DPI di lavoro: sempre 1200 (scelta utente: max quality + upscale sempre). */
export const DEFAULT_DPI = 1200;

/** Consiglia il DPI in base alla scala necessaria (configurato: sempre 1200). */
export function recommendDpi(_scaleNeeded: number): number {
  return DEFAULT_DPI;
}
