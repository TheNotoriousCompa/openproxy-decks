export interface LayoutInput {
  pageWmm: number;
  pageHmm: number;
  cardWmm: number;
  cardHmm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  spacingRowMm: number;
  spacingColMm: number;
  bleedMm: number;
  totalCards: number;
}

export interface CardPlacement {
  index: number;
  page: number;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
}

export interface LayoutOutput {
  cols: number;
  rows: number;
  perPage: number;
  pages: number;
  placements: CardPlacement[];
}

/** Campi layout accettati: i nuovi, con fallback sui vecchi valori unici. */
export interface LayoutSettingsLike {
  pageWmm: number;
  pageHmm: number;
  cardWmm: number;
  cardHmm: number;
  bleedMm: number;
  marginTopMm?: number;
  marginRightMm?: number;
  marginBottomMm?: number;
  marginLeftMm?: number;
  spacingRowMm?: number;
  spacingColMm?: number;
  /** legacy: margine/spazio unico per tutti i lati */
  marginMm?: number;
  spacingMm?: number;
}

/** Normalizza le impostazioni in input di layout (i lati mancanti cadono sul valore unico). */
export function layoutInputFrom(s: LayoutSettingsLike, totalCards: number): LayoutInput {
  const m = s.marginMm ?? 0;
  const sp = s.spacingMm ?? 0;
  return {
    pageWmm: s.pageWmm,
    pageHmm: s.pageHmm,
    cardWmm: s.cardWmm,
    cardHmm: s.cardHmm,
    marginTopMm: s.marginTopMm ?? m,
    marginRightMm: s.marginRightMm ?? m,
    marginBottomMm: s.marginBottomMm ?? m,
    marginLeftMm: s.marginLeftMm ?? m,
    spacingRowMm: s.spacingRowMm ?? sp,
    spacingColMm: s.spacingColMm ?? sp,
    bleedMm: s.bleedMm,
    totalCards,
  };
}

/** Mirror di processing::compute_layout (Rust). */
export function computeLayout(input: LayoutInput): LayoutOutput {
  if (input.pageWmm <= 0 || input.pageHmm <= 0) throw new Error("pagina non valida");
  if (input.cardWmm <= 0 || input.cardHmm <= 0) throw new Error("carta non valida");
  const cw = input.cardWmm + input.bleedMm * 2;
  const ch = input.cardHmm + input.bleedMm * 2;
  const availW = input.pageWmm - input.marginLeftMm - input.marginRightMm;
  const availH = input.pageHmm - input.marginTopMm - input.marginBottomMm;
  if (availW <= 0 || availH <= 0) throw new Error("margini troppo grandi");
  const cols = Math.floor((availW + input.spacingColMm) / (cw + input.spacingColMm));
  const rows = Math.floor((availH + input.spacingRowMm) / (ch + input.spacingRowMm));
  if (cols === 0 || rows === 0) throw new Error("la carta non entra nella pagina (overflow)");
  const perPage = cols * rows;
  const pages = input.totalCards === 0 ? 0 : Math.ceil(input.totalCards / perPage);
  // Griglia CENTRATA nell'area utile (come proxxied.com): i margini restano
  // minimi garantiti, lo spazio in eccesso si divide equamente ai lati.
  const usedW = cols * cw + (cols - 1) * input.spacingColMm;
  const usedH = rows * ch + (rows - 1) * input.spacingRowMm;
  const startX = input.marginLeftMm + (availW - usedW) / 2;
  const startY = input.marginTopMm + (availH - usedH) / 2;
  const placements: CardPlacement[] = [];
  for (let i = 0; i < input.totalCards; i++) {
    const page = Math.floor(i / perPage);
    const slot = i % perPage;
    const r = Math.floor(slot / cols);
    const c = slot % cols;
    placements.push({
      index: i,
      page,
      xMm: startX + c * (cw + input.spacingColMm),
      yMm: startY + r * (ch + input.spacingRowMm),
      wMm: cw,
      hMm: ch,
    });
  }
  return { cols, rows, perPage, pages, placements };
}
