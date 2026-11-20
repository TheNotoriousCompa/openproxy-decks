import { describe, expect, it } from "vitest";
import {
  trimRect,
  halfWidthMm,
  lineCenterOffsetMm,
  lineRect,
  cornerSegments,
  pageLineEdges,
  type TrimRect,
} from "@/lib/guides";

describe("guides: rettangoli di taglio", () => {
  it("rientra di bleed per lato", () => {
    // esterno 65×90 con bleed 1 → taglio 63×88
    expect(trimRect(10, 10, 65, 90, 1)).toEqual({ xMm: 11, yMm: 11, wMm: 63, hMm: 88 });
  });

  it("bleed 0 = identità (back-compat)", () => {
    expect(trimRect(10, 10, 63, 88, 0)).toEqual({ xMm: 10, yMm: 10, wMm: 63, hMm: 88 });
  });

  it("bleed eccessivo: mai dimensioni negative", () => {
    expect(trimRect(0, 0, 2, 2, 5)).toEqual({ xMm: 5, yMm: 5, wMm: 0, hMm: 0 });
  });

  it("metà spessore in mm (clamp 0.25–3 pt come il PDF)", () => {
    expect(halfWidthMm(0.75)).toBeCloseTo(((0.75 * 25.4) / 72) / 2, 9);
    expect(halfWidthMm(99)).toBe(halfWidthMm(3));
    expect(halfWidthMm(0)).toBe(halfWidthMm(0.25));
  });

  it("placement compensa lo spessore; offset sposta di mm", () => {
    // dentro: mezzo spessore verso l'interno; fuori: negativo; sul bordo: zero
    expect(lineCenterOffsetMm(0.75, "inside", 0)).toBeCloseTo(halfWidthMm(0.75), 9);
    expect(lineCenterOffsetMm(0.75, "outside", 0)).toBeCloseTo(-halfWidthMm(0.75), 9);
    expect(lineCenterOffsetMm(0.75, "center", 0)).toBe(0);
    expect(lineCenterOffsetMm(0.75, "center", 1.5)).toBe(1.5);
  });

  it("lineRect: tratto centrato sul percorso, mai dimensioni negative", () => {
    const r = lineRect({ xMm: 10, yMm: 10, wMm: 65, hMm: 90 }, 1, 0.75, "inside", 0);
    const h = halfWidthMm(0.75);
    expect(r).toEqual({ xMm: 11 + h, yMm: 11 + h, wMm: 63 - h * 2, hMm: 88 - h * 2 });
    // scostamento enorme: dimensioni a zero, mai negative
    const flat = lineRect({ xMm: 0, yMm: 0, wMm: 4, hMm: 4 }, 0, 0.75, "inside", 5);
    expect(flat.wMm).toBe(0);
    expect(flat.hMm).toBe(0);
  });
});

describe("guides: segni d'angolo", () => {
  const rect: TrimRect = { xMm: 10, yMm: 20, wMm: 63, hMm: 88 };

  it("dentro: due bracci per angolo verso l'interno", () => {
    const segs = cornerSegments(rect, 2, "inside");
    expect(segs).toHaveLength(8);
    // angolo alto-sx: braccio orizzontale verso destra e verticale verso il basso
    expect(segs[0]).toEqual({ x1Mm: 10, y1Mm: 20, x2Mm: 12, y2Mm: 20 });
    expect(segs[1]).toEqual({ x1Mm: 10, y1Mm: 20, x2Mm: 10, y2Mm: 22 });
    // angolo basso-dx: verso sinistra e verso l'alto
    const last = segs.slice(-2);
    expect(last[0]).toEqual({ x1Mm: 73, y1Mm: 108, x2Mm: 71, y2Mm: 108 });
    expect(last[1]).toEqual({ x1Mm: 73, y1Mm: 108, x2Mm: 73, y2Mm: 106 });
  });

  it("fuori: bracci verso il bleed (speculari)", () => {
    const segs = cornerSegments(rect, 2, "outside");
    expect(segs[0]).toEqual({ x1Mm: 10, y1Mm: 20, x2Mm: 8, y2Mm: 20 });
    expect(segs[1]).toEqual({ x1Mm: 10, y1Mm: 20, x2Mm: 10, y2Mm: 18 });
  });

  it("croce: una linea continua che attraversa l'angolo", () => {
    const segs = cornerSegments(rect, 2, "cross");
    expect(segs).toHaveLength(8);
    expect(segs[0]).toEqual({ x1Mm: 8, y1Mm: 20, x2Mm: 12, y2Mm: 20 });
    expect(segs[1]).toEqual({ x1Mm: 10, y1Mm: 18, x2Mm: 10, y2Mm: 22 });
  });

  it("lunghezza a zero/negativa: clamp a un braccio minimo", () => {
    expect(cornerSegments(rect, 0, "inside")[0]).toEqual({ x1Mm: 10, y1Mm: 20, x2Mm: 10.1, y2Mm: 20 });
  });
});

describe("guides: bordi di pagina", () => {
  it("bordi unici e ordinati (arrotondati a 1µm)", () => {
    const { xs, ys } = pageLineEdges([
      { xMm: 4, yMm: 4, wMm: 63, hMm: 88 },
      { xMm: 67, yMm: 4, wMm: 63, hMm: 88 },
    ]);
    expect(xs).toEqual([4, 67, 130]);
    expect(ys).toEqual([4, 92]);
    // stesso rettangolo due volte → un solo bordo
    const dup = pageLineEdges([
      { xMm: 4, yMm: 4, wMm: 63, hMm: 88 },
      { xMm: 4, yMm: 4, wMm: 63, hMm: 88 },
    ]);
    expect(dup.xs).toEqual([4, 67]);
  });
});
