import { describe, expect, it } from "vitest";
import { projectManifestSchema } from "@/lib/schemas";

describe("project format", () => {
  it("manifest valido", () => {
    const r = projectManifestSchema.safeParse({
      version: 1,
      deck: [],
      print: {
        page: "a4", pageWmm: 210, pageHmm: 297, orientation: "portrait",
        card: "tcg", cardWmm: 63, cardHmm: 88,
        marginTopMm: 10, marginRightMm: 10, marginBottomMm: 10, marginLeftMm: 10,
        spacingRowMm: 2, spacingColMm: 2, bleedMm: 0, dpi: 300,
        profile: "balanced",
        guides: { cropMarks: true, cornerMarks: false, cutLines: false, pageLines: false },
        guideColor: "#ff0000",
        guideWidthPt: 0.4, guidePlacement: "outside", guideLengthMm: 3,
        guideShape: "inside", guideOffsetMm: 0,
        guideStyle: "solid", guideCap: "square",
        duplex: "front_only", upscaleMode: "auto",
      },
    });
    expect(r.success).toBe(true);
  });
  it("rifiuta DPI assurdi e bleed negativo", () => {
    const base = {
      page: "a4", pageWmm: 210, pageHmm: 297, orientation: "portrait",
      card: "tcg", cardWmm: 63, cardHmm: 88,
      marginTopMm: 10, marginRightMm: 10, marginBottomMm: 10, marginLeftMm: 10,
      spacingRowMm: 2, spacingColMm: 2, bleedMm: 0, dpi: 300,
      profile: "balanced",
      guides: { cropMarks: true, cornerMarks: false, cutLines: false, pageLines: false },
      guideColor: "#ff0000",
      guideWidthPt: 0.4, guidePlacement: "outside", guideLengthMm: 3,
      guideShape: "inside", guideOffsetMm: 0,
      guideStyle: "solid", guideCap: "square",
      duplex: "front_only", upscaleMode: "auto",
    };
    expect(projectManifestSchema.safeParse({ version: 1, deck: [], print: { ...base, dpi: 5000 } }).success).toBe(false);
    expect(projectManifestSchema.safeParse({ version: 1, deck: [], print: { ...base, bleedMm: -1 } }).success).toBe(false);
    expect(projectManifestSchema.safeParse({ version: 1, deck: [], print: { ...base, brightnessPct: 60 } }).success).toBe(false);
    expect(projectManifestSchema.safeParse({ version: 1, deck: [], print: { ...base, brightnessPct: -60 } }).success).toBe(false);
    // manifest storici senza luminosità: default 0 retrocompatibile
    const legacy = projectManifestSchema.safeParse({ version: 1, deck: [], print: { ...base } });
    expect(legacy.success).toBe(true);
    if (legacy.success) expect(legacy.data.print.brightnessPct).toBe(0);
  });
});
