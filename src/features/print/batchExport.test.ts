import { describe, expect, it } from "vitest";
import { buildExportArgs, buildMergedCards } from "@/features/print/batchExport";
import type { Project } from "@/types";

function proj(id: string, name: string, deck: Project["manifest"]["deck"]): Project {
  return {
    id,
    name,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    manifest: {
      version: 1,
      deck,
      print: {
        page: "a4", pageWmm: 210, pageHmm: 297, orientation: "portrait",
        card: "magic", cardWmm: 63, cardHmm: 88,
        marginTopMm: 3, marginRightMm: 3, marginBottomMm: 3, marginLeftMm: 3,
        spacingRowMm: 0, spacingColMm: 0, bleedMm: 1, dpi: 300,
        profile: "balanced",
        guides: { cropMarks: true, cornerMarks: false, cutLines: false, pageLines: false },
        guideColor: "#00ff00", guideWidthPt: 0.75, guidePlacement: "inside",
        guideLengthMm: 2, guideShape: "inside", guideOffsetMm: 0,
        guideStyle: "solid", guideCap: "square",
        duplex: "front_only", upscaleMode: "auto", brightnessPct: 0,
        includeConsidering: true,
      },
    },
  };
}

const bolt = {
  id: "b1", name: "Bolt", qty: 2, zone: "main" as const, provider: "scryfall" as const,
  imageFront: "https://img/bolt.jpg", hasBack: false, sortOrder: 0,
};
const saur = {
  id: "s1", name: "Sauron", qty: 1, zone: "commander" as const, provider: "scryfall" as const,
  imageFront: "https://img/sauron.jpg", hasBack: false, sortOrder: 1,
};
const tok = {
  id: "t1", name: "Treasure", qty: 3, zone: "tokens" as const, provider: "scryfall" as const,
  imageFront: "https://img/treasure.jpg", hasBack: false, sortOrder: 2,
};
const ghost = {
  id: "g1", name: "Manca", qty: 1, zone: "main" as const, provider: "custom" as const,
  hasBack: false, sortOrder: 3,
};
const maybe = {
  id: "m1", name: "Cultivate", qty: 1, zone: "considering" as const, provider: "scryfall" as const,
  imageFront: "https://img/cult.jpg", hasBack: false, sortOrder: 4,
};

describe("buildMergedCards", () => {
  it("unisce progetti: zone mappate, senza artwork conteggiate", () => {
    const { cards, noArt } = buildMergedCards(
      [proj("p1", "Uno", [bolt, saur]), proj("p2", "Due", [tok, ghost])],
      { includeConsidering: true, copies: 1 },
    );
    expect(cards).toHaveLength(3);
    // comandante accorpato al main (mai pagina a sé)
    expect(cards.find((c) => c.src_path.includes("sauron"))?.zone).toBe("main");
    expect(cards.find((c) => c.src_path.includes("treasure"))?.zone).toBe("tokens");
    expect(noArt).toEqual(["Due: Manca"]);
  });

  it("moltiplicatore copie e flag considering", () => {
    const x4 = buildMergedCards([proj("p1", "Uno", [bolt, maybe])], { includeConsidering: true, copies: 4 });
    expect(x4.cards.find((c) => c.src_path.includes("bolt"))?.qty).toBe(8);
    expect(x4.cards).toHaveLength(2);
    const off = buildMergedCards([proj("p1", "Uno", [bolt, maybe])], { includeConsidering: false, copies: 1 });
    expect(off.cards).toHaveLength(1);
  });
});

describe("buildExportArgs", () => {
  it("stesso shape dello Studio (parità singolo/blocco)", () => {
    const p = proj("p1", "Uno", [bolt]);
    const args = buildExportArgs(p.manifest.print, [{ src_path: "x", qty: 1, source_hash: "s", zone: "main" }], "p1", "/tmp/u.pdf");
    expect(args).toMatchObject({
      project_id: "p1",
      dest_path: "/tmp/u.pdf",
      page_w_mm: 210,
      page_h_mm: 297,
      card_w_mm: 63,
      card_h_mm: 88,
      dpi: 300,
      duplex: "front_only",
      upscale_mode: "auto",
      brightness_pct: 0,
      guide_color: "#000000",
      crop_color: "#00ff00",
    });
    expect(args["cards"]).toHaveLength(1);
  });
});
