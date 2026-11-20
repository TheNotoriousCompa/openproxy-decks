import type { GuideShape, PrintSettings } from "@/types";

/** Rettangolo (in mm) usato da layout, guide e anteprima. */
export interface TrimRect {
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
}

/** Segmento di guida in mm (y verso il basso, come il layout). */
export interface Segment {
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
}

type Placement = PrintSettings["guidePlacement"];

/**
 * Rettangolo di taglio (trim) da un rettangolo esterno inchiostrato.
 *
 * L'esterno è carta + bleed per lato; il taglio è sul formato carta,
 * rientrato di `bleedMm` per lato. Con bleed<=0 coincide con l'esterno.
 * Mirror di `pdf::trim_rect` (Rust): le due implementazioni devono restare
 * identiche — anteprima e PDF disegnano le stesse linee.
 */
export function trimRect(
  xMm: number,
  yMm: number,
  wMm: number,
  hMm: number,
  bleedMm: number,
): TrimRect {
  if (!(bleedMm > 0)) return { xMm, yMm, wMm, hMm };
  const b = Math.max(0, bleedMm);
  return {
    xMm: xMm + b,
    yMm: yMm + b,
    wMm: Math.max(0, wMm - 2 * b),
    hMm: Math.max(0, hMm - 2 * b),
  };
}

/** Metà spessore linea in mm (stesso clamp 0.25–3 pt del PDF). */
export function halfWidthMm(widthPt: number): number {
  const w = Math.min(3, Math.max(0.25, widthPt));
  return ((w * 25.4) / 72) / 2;
}

/**
 * Scostamento del CENTRO della linea rispetto al bordo carta, in mm.
 * `inside` appoggia il tratto dentro la carta, `outside` fuori, `center` lo
 * centra sul bordo; `offsetMm` è lo scostamento fine (positivo = dentro).
 */
export function lineCenterOffsetMm(
  widthPt: number,
  placement: Placement,
  offsetMm: number,
): number {
  const half = halfWidthMm(widthPt);
  const byPlacement = placement === "inside" ? half : placement === "outside" ? -half : 0;
  return byPlacement + offsetMm;
}

/**
 * Rettangolo percorso dalla linea di taglio: il trim rientrato di
 * `lineCenterOffsetMm` (il tratto è centrato su questo percorso).
 */
export function lineRect(
  outer: TrimRect,
  bleedMm: number,
  widthPt: number,
  placement: Placement,
  offsetMm: number,
): TrimRect {
  const t = trimRect(outer.xMm, outer.yMm, outer.wMm, outer.hMm, bleedMm);
  const inset = lineCenterOffsetMm(widthPt, placement, offsetMm);
  return {
    xMm: t.xMm + inset,
    yMm: t.yMm + inset,
    wMm: Math.max(0, t.wMm - inset * 2),
    hMm: Math.max(0, t.hMm - inset * 2),
  };
}

/**
 * Segmenti dei segni d'angolo: bracci di lunghezza `lengthMm` su ogni angolo.
 * - inside: bracci verso l'interno della carta
 * - outside: bracci verso l'esterno (nel bleed)
 * - cross: linea continua che attraversa l'angolo (dentro + fuori)
 */
export function cornerSegments(rect: TrimRect, lengthMm: number, shape: GuideShape): Segment[] {
  const l = Math.max(0.1, lengthMm);
  const { xMm: x, yMm: y, wMm: w, hMm: h } = rect;
  // per angolo: [x, y, verso interno x, verso interno y]
  const corners: [number, number, number, number][] = [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ];
  const out: Segment[] = [];
  for (const [cx, cy, ix, iy] of corners) {
    if (shape === "cross") {
      out.push({ x1Mm: cx - ix * l, y1Mm: cy, x2Mm: cx + ix * l, y2Mm: cy });
      out.push({ x1Mm: cx, y1Mm: cy - iy * l, x2Mm: cx, y2Mm: cy + iy * l });
    } else if (shape === "outside") {
      out.push({ x1Mm: cx, y1Mm: cy, x2Mm: cx - ix * l, y2Mm: cy });
      out.push({ x1Mm: cx, y1Mm: cy, x2Mm: cx, y2Mm: cy - iy * l });
    } else {
      out.push({ x1Mm: cx, y1Mm: cy, x2Mm: cx + ix * l, y2Mm: cy });
      out.push({ x1Mm: cx, y1Mm: cy, x2Mm: cx, y2Mm: cy + iy * l });
    }
  }
  return out;
}

/** Bordi unici delle linee a tutta pagina (arrotondati a 1µm per non duplicare). */
export function pageLineEdges(rects: TrimRect[]): { xs: number[]; ys: number[] } {
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const r of rects) {
    xs.add(Math.round(r.xMm * 1000) / 1000);
    xs.add(Math.round((r.xMm + r.wMm) * 1000) / 1000);
    ys.add(Math.round(r.yMm * 1000) / 1000);
    ys.add(Math.round((r.yMm + r.hMm) * 1000) / 1000);
  }
  return { xs: [...xs].sort((a, b) => a - b), ys: [...ys].sort((a, b) => a - b) };
}
