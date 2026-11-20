import { describe, expect, it } from "vitest";
import { analyzeQuality } from "@/lib/quality";

describe("quality analysis", () => {
  it("sufficiente → green", () => {
    expect(analyzeQuality(1488, 2079, 63, 88, 300).status).toBe("green");
  });
  it("piccolo delta → blue", () => {
    expect(analyzeQuality(650, 900, 63, 88, 300).status).toBe("blue");
  });
  it("moderato → yellow", () => {
    expect(analyzeQuality(450, 630, 63, 88, 300).status).toBe("yellow");
  });
  it("sorgente minuscola → red", () => {
    expect(analyzeQuality(200, 280, 63, 88, 300).status).toBe("red");
  });
  it("report contiene DPI effettivi e target px", () => {
    const r = analyzeQuality(744, 1039, 63, 88, 300);
    expect(r.reqW).toBe(744);
    expect(r.effDpi).toBeCloseTo(300, 0);
  });
});
