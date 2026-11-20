import { describe, expect, it, beforeEach } from "vitest";
import { readManifestBackup, shouldRestoreBackup, type ManifestBackup } from "@/services/backend";

const MANIFEST = {
  version: 1 as const,
  deck: [{ id: "c1", name: "Bolt", qty: 4, zone: "main", provider: "scryfall", hasBack: false, sortOrder: 0 }],
  print: {
    page: "a4", pageWmm: 210, pageHmm: 297, orientation: "portrait",
    card: "magic", cardWmm: 63, cardHmm: 88,
    marginTopMm: 5, marginRightMm: 5, marginBottomMm: 5, marginLeftMm: 5,
    spacingRowMm: 2, spacingColMm: 2, bleedMm: 0, dpi: 1200,
    profile: "maximum",
    guides: { cropMarks: true, cornerMarks: false, cutLines: false, pageLines: false },
    guideColor: "#ff0000",
    guideWidthPt: 0.75,
    guidePlacement: "inside" as const,
    guideLengthMm: 2,
    guideShape: "inside" as const,
    guideOffsetMm: 0,
    guideStyle: "solid" as const,
    guideCap: "square" as const,
    duplex: "front_only", upscaleMode: "always",
  },
} as ManifestBackup["manifest"];

describe("manifest rescue", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("null/empty → mai", () => {
    expect(shouldRestoreBackup("2026-01-01", 0, null)).toBe(false);
    expect(shouldRestoreBackup("2026-01-01", 0, { at: "2026-02-01", manifest: { ...MANIFEST, deck: [] } })).toBe(false);
  });

  it("backup più nuovo del DB vince", () => {
    const b: ManifestBackup = { at: "2026-09-05T12:00:00Z", manifest: MANIFEST };
    expect(shouldRestoreBackup("2026-09-01T00:00:00Z", 5, b)).toBe(true);
    expect(shouldRestoreBackup("2026-09-10T00:00:00Z", 5, b)).toBe(false);
  });

  it("legacy senza timestamp solo se DB vuoto (rescue una-tantum)", () => {
    const b: ManifestBackup = { at: "", manifest: MANIFEST };
    expect(shouldRestoreBackup("2026-09-10T00:00:00Z", 0, b)).toBe(true);
    expect(shouldRestoreBackup("2026-09-10T00:00:00Z", 3, b)).toBe(false);
  });

  it("readManifestBackup legge envelope e legacy", () => {
    localStorage.setItem("proxxied.fallback.manifest.p1", JSON.stringify({ at: "2026-09-05", manifest: MANIFEST }));
    expect(readManifestBackup("p1")?.manifest.deck).toHaveLength(1);
    localStorage.setItem("proxxied.fallback.manifest.p2", JSON.stringify(MANIFEST));
    expect(readManifestBackup("p2")).toMatchObject({ at: "" });
    expect(readManifestBackup("px")).toBeNull();
  });
});
