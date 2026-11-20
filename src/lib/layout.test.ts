import { describe, expect, it } from "vitest";
import { computeLayout, layoutInputFrom } from "@/lib/layout";

describe("layout engine", () => {
  it("A4 + TCG 63x88 → 2x3, 6/pag", () => {
    const out = computeLayout(layoutInputFrom({
      pageWmm: 210, pageHmm: 297, cardWmm: 63, cardHmm: 88,
      marginMm: 10, spacingMm: 2, bleedMm: 0, }, 10));
    expect(out.cols).toBe(2);
    expect(out.rows).toBe(3);
    expect(out.perPage).toBe(6);
    expect(out.pages).toBe(2);
    expect(out.placements).toHaveLength(10);
  });
  it("default Studio edge-to-edge (A4, 63x88, margini 3, spacing 0) → 3x3", () => {
    const out = computeLayout(layoutInputFrom({
      pageWmm: 210, pageHmm: 297, cardWmm: 63, cardHmm: 88,
      marginMm: 3, spacingMm: 0, bleedMm: 0, }, 27));
    expect(out.cols).toBe(3);
    expect(out.rows).toBe(3);
    expect(out.perPage).toBe(9);
    expect(out.pages).toBe(3);
    // celle attaccate: niente gap tra adiacenti
    const [a, b] = [out.placements[0], out.placements[1]].map((p) => p as { xMm: number; wMm: number });
    expect(a && b ? b.xMm - (a.xMm + a.wMm) : NaN).toBe(0);
  });
  it("default Studio (A4, 63x88, margini 5) → 3x3", () => {    const out = computeLayout(layoutInputFrom({
      pageWmm: 210, pageHmm: 297, cardWmm: 63, cardHmm: 88,
      marginMm: 5, spacingMm: 2, bleedMm: 0, }, 27));
    expect(out.cols).toBe(3);
    expect(out.rows).toBe(3);
    expect(out.perPage).toBe(9);
    expect(out.pages).toBe(3);
  });
  it("bleed riduce la capienza", () => {
    const noBleed = computeLayout(layoutInputFrom({
      pageWmm: 210, pageHmm: 297, cardWmm: 63, cardHmm: 88,
      marginMm: 10, spacingMm: 2, bleedMm: 0, }, 1));
    const bleed = computeLayout(layoutInputFrom({
      pageWmm: 210, pageHmm: 297, cardWmm: 63, cardHmm: 88,
      marginMm: 10, spacingMm: 2, bleedMm: 3, }, 1));
    expect(bleed.perPage).toBeLessThanOrEqual(noBleed.perPage);
    expect(bleed.placements[0]?.wMm).toBeCloseTo(69);
  });
  it("overflow → errore", () => {
    expect(() =>
      computeLayout(layoutInputFrom({
        pageWmm: 50, pageHmm: 50, cardWmm: 63, cardHmm: 88,
        marginMm: 5, spacingMm: 2, bleedMm: 0, }, 1)),
    ).toThrow(/overflow/);
  });
  it("coordinate dentro i margini", () => {
    const out = computeLayout(layoutInputFrom({
      pageWmm: 210, pageHmm: 297, cardWmm: 63, cardHmm: 88,
      marginMm: 10, spacingMm: 2, bleedMm: 0, }, 6));
    for (const p of out.placements) {
      expect(p.xMm).toBeGreaterThanOrEqual(10);
      expect(p.yMm).toBeGreaterThanOrEqual(10);
      expect(p.xMm + p.wMm).toBeLessThanOrEqual(200.01);
    }
  });
  it("griglia centrata come proxxied.com (A4, 65x90, margini 3)", () => {
    const out = computeLayout(layoutInputFrom({
      pageWmm: 210, pageHmm: 297, cardWmm: 63, cardHmm: 88,
      marginMm: 3, spacingMm: 0, bleedMm: 1, }, 9));
    expect(out.cols).toBe(3);
    expect(out.rows).toBe(3);
    // (210-195)/2 = 7.5 · (297-270)/2 = 13.5
    expect(out.placements[0]?.xMm).toBeCloseTo(7.5, 9);
    expect(out.placements[0]?.yMm).toBeCloseTo(13.5, 9);
    const last = out.placements[8] as { xMm: number; wMm: number };
    expect(210 - (last.xMm + last.wMm)).toBeCloseTo(out.placements[0]?.xMm ?? NaN, 9);
  });
});
