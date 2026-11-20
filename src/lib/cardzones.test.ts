import { describe, expect, it } from "vitest";
import { hasMeta, isMisplacedInTokens, isTokenMeta, misplacedTokenIds } from "@/lib/cardzones";
import type { Zone } from "@/types";

describe("isTokenMeta", () => {
  it("layout Scryfall = token / fronte-retro / emblema", () => {
    expect(isTokenMeta({ layout: "token", typeLine: "Token Creature — Orc Army" })).toBe(true);
    expect(isTokenMeta({ layout: "double_faced_token", typeLine: "Emblem // Card" })).toBe(true);
    expect(isTokenMeta({ layout: "emblem", typeLine: "Emblem — Chandra" })).toBe(true);
    expect(isTokenMeta({ layout: "normal", typeLine: "Legendary Artifact" })).toBe(false);
  });

  it("senza layout decide la type_line (supertipo Token/Emblem)", () => {
    expect(isTokenMeta({ typeLine: "Token Artifact — Treasure" })).toBe(true);
    expect(isTokenMeta({ typeLine: "Token Legendary Creature — Smaug" })).toBe(true);
    expect(isTokenMeta({ typeLine: "Emblem // Card" })).toBe(true);
    expect(isTokenMeta({ typeLine: "Instant" })).toBe(false);
    expect(isTokenMeta({ typeLine: "Artifact Creature — Shapeshifter" })).toBe(false);
    expect(isTokenMeta({ typeLine: "Enchantment" })).toBe(false);
  });

  it("set_type=token copre i token con dati incoerenti (Poison Counter)", () => {
    // Scryfall: set=tecc, layout=normal, type_line="Card" — ma è un token vero
    expect(isTokenMeta({ typeLine: "Card", layout: "normal", setType: "token" })).toBe(true);
    // i Role token hanno layout "flip" ma type_line con «Token»
    expect(
      isTokenMeta({ layout: "flip", setType: "token", typeLine: "Token Enchantment — Aura Role" }),
    ).toBe(true);
    // un set normale resta normale
    expect(isTokenMeta({ typeLine: "Instant", layout: "normal", setType: "expansion" })).toBe(false);
  });

  it("mai token senza dati", () => {
    expect(isTokenMeta(undefined)).toBe(false);
    expect(isTokenMeta(null)).toBe(false);
    expect(isTokenMeta({})).toBe(false);
  });
});

describe("hasMeta", () => {
  it("vero solo con tipo o layout noti", () => {
    expect(hasMeta({ typeLine: "Instant" })).toBe(true);
    expect(hasMeta({ layout: "token" })).toBe(true);
    expect(hasMeta({ typeLine: "" })).toBe(false);
    expect(hasMeta({})).toBe(false);
    expect(hasMeta(null)).toBe(false);
  });
});

describe("isMisplacedInTokens", () => {
  it("solo nel board Token, solo con tipo noto, solo non-token", () => {
    // il caso reale: Moxfield aggancia i token-copia come carte vere
    expect(isMisplacedInTokens("tokens", { typeLine: "Legendary Artifact", layout: "normal" })).toBe(true);
    expect(isMisplacedInTokens("tokens", { typeLine: "Instant" })).toBe(true);
    expect(isMisplacedInTokens("tokens", { typeLine: "Token Creature — Wraith" })).toBe(false);
    expect(isMisplacedInTokens("tokens", { layout: "token" })).toBe(false);
    // tipo ignoto: non si tocca (meglio un token in più che una carta persa)
    expect(isMisplacedInTokens("tokens", undefined)).toBe(false);
    expect(isMisplacedInTokens("tokens", {})).toBe(false);
    // fuori dal board Token non si decide nulla
    expect(isMisplacedInTokens("main", { typeLine: "Instant" })).toBe(false);
    expect(isMisplacedInTokens("maybe", { typeLine: "Instant" })).toBe(false);
  });
});

describe("misplacedTokenIds", () => {
  interface Entry {
    id: string;
    zone: Zone;
    typeLine?: string;
    layout?: string;
  }
  const deck: Entry[] = [
    { id: "a", zone: "tokens", typeLine: "Token Creature — Orc Army", layout: "token" },
    { id: "b", zone: "tokens", typeLine: "Legendary Artifact", layout: "normal" },
    { id: "c", zone: "tokens", typeLine: "Instant" },
    { id: "d", zone: "tokens" },
    { id: "e", zone: "main", typeLine: "Instant" },
    { id: "f", zone: "commander", typeLine: "Legendary Creature" },
  ];

  it("toglie solo le carte vere finite nel board Token", () => {
    expect(misplacedTokenIds(deck, (e) => ({ typeLine: e.typeLine, layout: e.layout }))).toEqual(["b", "c"]);
  });

  it("tipo ignoto e board vuoto non cambiano nulla", () => {
    expect(misplacedTokenIds(deck.slice(3), (e) => ({ typeLine: e.typeLine, layout: e.layout }))).toEqual([]);
    expect(misplacedTokenIds([], () => undefined)).toEqual([]);
  });
});
