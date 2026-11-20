import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildSearchQuery,
  fuzzyNameOk,
  landsLast,
  metaFromCard,
  resolveCardMeta,
  resolveMetaBulk,
  resolveTypeLine,
  searchCardsAdvanced,
  EMPTY_FILTERS,
  type SearchFilters,
  type SearchHit,
} from "@/services/cardfinder";

describe("buildSearchQuery", () => {
  it("default = solo legali commander", () => {
    expect(buildSearchQuery(EMPTY_FILTERS)).toBe("f:commander");
  });
  it("tipo + colori tutti + cmc + rarità", () => {
    const q = buildSearchQuery({
      ...EMPTY_FILTERS,
      type: "Creature",
      colors: ["G", "R"],
      colorMode: "all",
      mvOp: "<=",
      mv: 3,
      rarity: "rare",
    });
    expect(q).toBe("f:commander t:creature c:g c:r mv<=3 r:rare");
  });
  it("colori any = OR, identità AND", () => {
    const q = buildSearchQuery({
      ...EMPTY_FILTERS,
      colors: ["W", "U"],
      colorMode: "any",
      identity: ["R", "G"],
      identityMode: "all",
    });
    expect(q).toBe("f:commander (c:w OR c:u) id:r id:g");
  });
  it("incolori, set, costo mana, stats, oracolo", () => {
    expect(buildSearchQuery({ ...EMPTY_FILTERS, colors: ["C"], identity: ["C"] })).toBe(
      "f:commander c:colorless id=colorless",
    );
    expect(
      buildSearchQuery({
        ...EMPTY_FILTERS,
        set: "40K",
        manaCost: "{2}{G}{G}",
        powOp: ">=",
        pow: 4,
        touOp: "<=",
        tou: 2,
        loyOp: "=",
        loy: 3,
        oracle: "draw a card",
      }),
    ).toBe("f:commander e:40k mana:{2}{G}{G} pow>=4 tou<=2 loy=3 o:\"draw a card\"");
  });
  it("testo libero in coda, leggendari per comandanti", () => {
    expect(buildSearchQuery({ ...EMPTY_FILTERS, text: "dragon", legendaryOnly: true })).toBe(
      "f:commander t:legendary (dragon)",
    );
  });
});

describe("landsLast", () => {
  const hit = (name: string, typeLine: string): SearchHit => ({
    id: name,
    name,
    setCode: "",
    setName: "",
    collectorNumber: "",
    typeLine,
    colorIdentity: [],
    hasBack: false,
  });
  it("terre in fondo, resto stabile", () => {
    const out = landsLast([
      hit("Forest", "Basic Land — Forest"),
      hit("Bolt", "Instant"),
      hit("Tower", "Artifact Land"),
      hit("Elf", "Creature"),
    ]);
    expect(out.map((h) => h.name)).toEqual(["Bolt", "Elf", "Forest", "Tower"]);
  });
});

describe("searchCardsAdvanced order/dir", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ data: [], total_cards: 0 }) })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("passa order e dir a Scryfall", async () => {
    const ctrl = new AbortController();
    await searchCardsAdvanced("f:commander", { order: "cmc", dir: "asc" }, ctrl.signal);
    const url = (fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0]?.[0] ?? "";
    expect(url).toContain("order=cmc");
    expect(url).toContain("dir=asc");
  });
});

describe("resolveTypeLine", () => {
  const UUID = "12345678-1234-1234-1234-1234567890ab";
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith(`/cards/${UUID}`)) {
          return { ok: true, status: 200, json: async () => ({ type_line: "Sorcery" }) };
        }
        if (url.includes("named?exact=Necron%20Warrior&set=t40k")) {
          return { ok: true, status: 200, json: async () => ({ type_line: "Token Creature — Necron Warrior" }) };
        }
        if (url.includes("named?exact=Lightning%20Bolt")) {
          return { ok: true, status: 200, json: async () => ({ type_line: "Instant" }) };
        }
        if (url.includes("named?exact=Insect")) {
          return { ok: false, status: 404, json: async () => ({}) };
        }
        if (url.includes("named?fuzzy=Insect")) {
          return { ok: true, status: 200, json: async () => ({ type_line: "Token Creature — Insect" }) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("UUID Scryfall: una sola chiamata diretta", async () => {
    const ctrl = new AbortController();
    const t = await resolveTypeLine({ name: "Qualsiasi", provider: "scryfall", providerId: UUID }, ctrl.signal);
    expect(t).toBe("Sorcery");
    expect((fetch as unknown as { mock: { calls: string[][] } }).mock.calls).toHaveLength(1);
  });

  it("nome+set disambigua i token", async () => {
    const ctrl = new AbortController();
    const t = await resolveTypeLine({ name: "Necron Warrior", setCode: "T40K" }, ctrl.signal);
    expect(t).toBe("Token Creature — Necron Warrior");
  });

  it("esatto, poi fuzzy come rete di sicurezza", async () => {
    const ctrl = new AbortController();
    expect(await resolveTypeLine({ name: "Lightning Bolt" }, ctrl.signal)).toBe("Instant");
    // Insect ambiguo: exact 404 → fuzzy risolve
    expect(await resolveTypeLine({ name: "Insect" }, ctrl.signal)).toBe("Token Creature — Insect");
    // tutto fallisce → null
    expect(await resolveTypeLine({ name: "Xyzzy Mai Esistita" }, ctrl.signal)).toBeNull();
  });

  it("fuzzy con nome diverso scartato (meglio unknown che sezione errata)", async () => {
    const ctrl = new AbortController();
    const r = await resolveCardMeta({ name: "Dark Ritual" }, ctrl.signal);
    expect(r).toBeNull();
  });
});

describe("fuzzyNameOk", () => {
  it("contenimento normalizzato", () => {
    expect(fuzzyNameOk("Insect", "Giant Insect")).toBe(true);
    expect(fuzzyNameOk("Palantir", "Palantír of Orthanc")).toBe(true);
    expect(fuzzyNameOk("Fire // Ice", "Fire // Ice")).toBe(true);
    expect(fuzzyNameOk("Sol Ring", "Mana Crypt")).toBe(false);
    expect(fuzzyNameOk("", "Bolt")).toBe(false);
  });
});

describe("metaFromCard", () => {
  it("estrae tipo/costo/cmc/prezzo, facce DFC come fallback", () => {
    expect(
      metaFromCard({ type_line: "Artifact", mana_cost: "{2}", cmc: 2, prices: { usd: "1.5" } }),
    ).toMatchObject({ typeLine: "Artifact", cmc: 2, priceUsd: "1.5" });
    expect(
      metaFromCard({ card_faces: [{ type_line: "Instant", mana_cost: "{U}" }] }),
    ).toMatchObject({ typeLine: "Instant", manaCost: "{U}" });
    expect(metaFromCard({})).toBeNull();
    expect(metaFromCard(null)).toBeNull();
  });

  it("porta il layout (segnale esatto dei token)", () => {
    expect(metaFromCard({ type_line: "Token Creature — Orc Army", layout: "token" })).toMatchObject({
      typeLine: "Token Creature — Orc Army",
      layout: "token",
    });
    expect(metaFromCard({ type_line: "Legendary Artifact", layout: "normal" })?.layout).toBe("normal");
  });

  it("porta il tipo set (set di soli token: «Poison Counter»)", () => {
    expect(metaFromCard({ type_line: "Card", layout: "normal", set_type: "token" })?.setType).toBe("token");
    expect(metaFromCard({ type_line: "Instant", set_type: "expansion" })?.setType).toBe("expansion");
  });

  it("porta i segnali Commander Brackets da Scryfall", () => {
    expect(
      metaFromCard({
        name: "Rhystic Study",
        type_line: "Enchantment",
        game_changer: true,
        oracle_text: "Whenever an opponent casts a spell, ...",
      })?.gameChanger,
    ).toBe(true);
    expect(metaFromCard({ name: "Sol Ring", type_line: "Artifact", game_changer: false })?.gameChanger).toBeUndefined();

    expect(
      metaFromCard({ name: "Time Warp", type_line: "Sorcery", oracle_text: "Take an extra turn after this one." })
        ?.extraTurn,
    ).toBe(true);
    expect(
      metaFromCard({ name: "Armageddon", type_line: "Sorcery", oracle_text: "Destroy all lands." })?.massLandDenial,
    ).toBe(true);
    expect(
      metaFromCard({ name: "Rampant Growth", type_line: "Sorcery", oracle_text: "Search your library for a basic land card." })
        ?.massLandDenial,
    ).toBeUndefined();
  });

  it("segnali anche dalle facce DFC (oracle text di entrambe)", () => {
    expect(
      metaFromCard({
        name: "Boom // Bust",
        card_faces: [
          { type_line: "Sorcery", oracle_text: "Destroy target land." },
          { type_line: "Sorcery", oracle_text: "Destroy all lands." },
        ],
      })?.massLandDenial,
    ).toBe(true);
  });
});

describe("resolveMetaBulk", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("/cards/collection")) {
          const body = JSON.parse(String((init as { body?: string })?.body ?? "{}")) as {
            identifiers?: { name?: string; set?: string }[];
          };
          const data = (body.identifiers ?? [])
            .filter((i) => i.name?.toLowerCase() !== "sconosciuta")
            .map((i) => ({
              id: `uuid-${i.name}`,
              name: i.name,
              set: i.set ?? "lea",
              type_line: i.name === "Swamp" ? "Basic Land — Swamp" : "Instant",
              cmc: 1,
            }));
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data,
              not_found: [{ name: "Sconosciuta" }],
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("match esatti in una botta, miss separati", async () => {
    const ctrl = new AbortController();
    const refs = [
      { name: "Lightning Bolt", setCode: "LEA" },
      { name: "Swamp" },
      { name: "Sconosciuta" },
      { name: "  " },
    ];
    const { found, missing } = await resolveMetaBulk(refs, ctrl.signal);
    expect(found).toHaveLength(2);
    expect(found.find((f) => f.ref.name === "Swamp")?.meta.typeLine).toBe("Basic Land — Swamp");
    expect(missing.map((r) => r.name.trim()).sort()).toEqual(["", "Sconosciuta"]);
    // una sola chiamata POST per 4 ref
    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toContain("/cards/collection");
  });

  it("abort → tutti missing, mai throw", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const { found, missing } = await resolveMetaBulk([{ name: "Bolt" }], ctrl.signal);
    expect(found).toHaveLength(0);
    expect(missing).toHaveLength(1);
  });
});

export type { SearchFilters };
