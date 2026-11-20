import { describe, expect, it } from "vitest";
import { toMm, fromMm, effectiveDpi, requiredPixels, recommendDpi, VISIBLE_CARD_PRESETS } from "@/lib/units";

describe("units", () => {
  it("inch/mm roundtrip", () => {
    expect(toMm(1, "in")).toBeCloseTo(25.4);
    expect(fromMm(25.4, "in")).toBeCloseTo(1);
    expect(toMm(1, "cm")).toBe(10);
  });
  it("effectiveDPI = sourcePx / targetInches", () => {
    expect(effectiveDpi(744, 63)).toBeCloseTo(300, 0);
  });
  it("requiredPixels per TCG@300dpi", () => {
    expect(requiredPixels(63, 300)).toBe(744);
    expect(requiredPixels(88, 300)).toBe(1039);
  });
  it("requiredPixels per TCG@1200dpi", () => {
    expect(requiredPixels(63, 1200)).toBe(2976);
    expect(requiredPixels(88, 1200)).toBe(4157);
  });
  it("DPI raccomandato sempre 1200 (max quality)", () => {
    expect(recommendDpi(1.0)).toBe(1200);
    expect(recommendDpi(3.0)).toBe(1200);
  });
  it("solo Magic (metrico e 2.5x3.5 in) + manuale nel selettore", () => {
    expect(VISIBLE_CARD_PRESETS.map(([id]) => id)).toEqual(["magic", "magic_true", "custom"]);
    // metrico = 63x88, "vero formato" = 2.5x3.5 in come proxxied
    expect(VISIBLE_CARD_PRESETS[0]?.[1]).toMatchObject({ w: 63, h: 88 });
    expect(VISIBLE_CARD_PRESETS[1]?.[1]).toMatchObject({ w: 63.5, h: 88.9 });
  });
});
