import { describe, expect, it } from "vitest";
import {
  aliasKey,
  cachedMeta,
  findMeta,
  metaStore,
  persistMetaCache,
  putMeta,
  refOf,
} from "@/lib/cardmetaCache";
import { typeCacheKey, type CardMeta } from "@/services/cardfinder";

const TOKEN = { typeLine: "Token Creature — Orc Army", layout: "token" };

describe("cardmetaCache", () => {
  it("scrive la chiave esatta + alias per nome (match esatto)", () => {
    const ref = { name: "Orc Army", provider: "scryfall", setCode: "TLTR" };
    putMeta(ref, TOKEN, true);
    expect(cachedMeta(ref)?.layout).toBe("token");
    expect(metaStore().get(typeCacheKey(ref))).toEqual(TOKEN);
    // alias per nome: copre le voci senza set noto (case-insensitive)
    expect(cachedMeta({ name: "orc army" })?.typeLine).toBe("Token Creature — Orc Army");
  });

  it("fuzzy (exact=false) non scrive l'alias per nome", () => {
    const ref = { name: "Palantir", provider: "scryfall", setCode: "LTR" };
    putMeta(ref, { typeLine: "Legendary Artifact" }, false);
    expect(cachedMeta(ref)?.typeLine).toBe("Legendary Artifact");
    expect(metaStore().has(aliasKey("Palantir"))).toBe(false);
  });

  it("findMeta prova chiave esatta, alias e nome+set", () => {
    const meta = new Map<string, CardMeta>([
      ["id:abc", { typeLine: "Sorcery" }],
      ["n:sol ring|", { typeLine: "Artifact" }],
    ]);
    expect(findMeta(meta, { name: "X", provider: "scryfall", providerId: "ABC" })?.typeLine).toBe("Sorcery");
    expect(findMeta(meta, { name: "Sol Ring", setCode: "LEA" })?.typeLine).toBe("Artifact");
    expect(findMeta(meta, { name: "Mai vista" })).toBeUndefined();
  });

  it("persist su localStorage e rilettura", () => {
    putMeta({ name: "Wraith", provider: "scryfall", setCode: "TLTC" }, { typeLine: "Token Creature — Wraith" }, true);
    persistMetaCache();
    const raw = JSON.parse(localStorage.getItem("proxxied.cardmeta.v4") ?? "{}") as Record<string, unknown>;
    expect(raw["n:wraith|tltc"]).toMatchObject({ typeLine: "Token Creature — Wraith" });
  });

  it("refOf porta solo i campi utili dal deck", () => {
    const ref = refOf({
      name: "Treasure",
      provider: "scryfall",
      providerId: "uuid-1",
      setCode: "F17",
    });
    expect(ref).toEqual({
      name: "Treasure",
      provider: "scryfall",
      providerId: "uuid-1",
      setCode: "F17",
    });
  });
});
