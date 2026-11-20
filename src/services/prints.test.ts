import { describe, expect, it } from "vitest";
import { driveDownloadUrl, normalizeServer } from "@/services/mpc";
import { toPrintOption } from "@/services/providers";

describe("mpc helpers", () => {
  it("normalizeServer", () => {
    expect(normalizeServer("")).toBeNull();
    expect(normalizeServer("notaurl")).toBeNull();
    expect(normalizeServer("https://example.com///")).toBe("https://example.com");
    expect(normalizeServer("  http://h.local:8000/ ")).toBe("http://h.local:8000");
  });
  it("driveDownloadUrl", () => {
    const u = driveDownloadUrl("abc123");
    expect(u).toContain("abc123");
    expect(u.startsWith("https://")).toBe(true);
  });
});

describe("toPrintOption (scryfall)", () => {
  it("mappa stampa normale", () => {
    const opt = toPrintOption({
      id: "uuid-1",
      name: "Command Tower",
      set: "ltc",
      set_name: "Tales of Middle-earth Commander",
      collector_number: "331",
      released_at: "2023-11-03",
      highres_image: true,
      image_uris: {
        small: "https://cards.scryfall.io/small/x.jpg",
        large: "https://cards.scryfall.io/large/x.jpg",
        png: "https://cards.scryfall.io/png/x.png",
      },
    });
    expect(opt).toMatchObject({
      source: "scryfall",
      setCode: "LTC",
      collectorNumber: "331",
      highres: true,
      hasBack: false,
    });
    expect(opt?.thumb).toContain("small");
    expect(opt?.imageFull).toContain("png");
  });
  it("preview a risoluzione media per la griglia (mai small 146px)", () => {
    const opt = toPrintOption({
      id: "uuid-1",
      name: "Command Tower",
      set: "ltc",
      image_uris: {
        small: "https://cards.scryfall.io/small/x.jpg",
        normal: "https://cards.scryfall.io/normal/x.jpg",
        large: "https://cards.scryfall.io/large/x.jpg",
        png: "https://cards.scryfall.io/png/x.png",
      },
    });
    expect(opt?.preview).toContain("normal");
    // senza normal → ripiego su full
    const opt2 = toPrintOption({
      id: "uuid-2",
      name: "Bolt",
      image_uris: { small: "https://s.jpg", large: "https://l.jpg" },
    });
    expect(opt2?.preview).toBe("https://l.jpg");
  });
  it("fronte/retro da card_faces", () => {
    const opt = toPrintOption({
      id: "uuid-2",
      name: "Fire // Ice",
      set: "apc",
      image_uris: undefined,
      card_faces: [
        { image_uris: { large: "https://x/front.jpg", small: "https://x/front-s.jpg" } },
        { image_uris: { large: "https://x/back.jpg" } },
      ],
    });
    expect(opt?.hasBack).toBe(true);
    expect(opt?.imageLarge).toBeTruthy();
    expect(opt?.imageBack).toContain("back.jpg");
  });
  it("scarta senza immagini", () => {
    expect(toPrintOption({ id: "x", name: "No Img" })).toBeNull();
    expect(toPrintOption({ nope: true })).toBeNull();
  });
});
