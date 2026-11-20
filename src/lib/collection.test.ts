import { describe, expect, it } from "vitest";
import {
  collectionKey,
  collectionUsage,
  deckEntryToItem,
  entryImageUrl,
  itemKey,
  mergeAdd,
  missingForDeck,
  ownedByKey,
} from "@/lib/collection";

describe("collectionKey", () => {
  it("stessa stampa, maiuscole/spazi diversi → stessa chiave", () => {
    expect(collectionKey("Sol Ring", "LTR", "1")).toBe(collectionKey(" sol ring ", "ltr", "1"));
  });

  it("set diversi → chiavi diverse; senza set → chiave nome", () => {
    expect(collectionKey("Sol Ring", "LTR", "1")).not.toBe(collectionKey("Sol Ring", "M3C", "220"));
    expect(collectionKey("Sol Ring")).toBe("sol ring‖‖");
  });
});

describe("mergeAdd", () => {
  it("somma sulle chiavi esistenti, aggiunge le nuove, ignora le invalide", () => {
    const start = mergeAdd([], [{ name: "Sol Ring", setCode: "LTR", collectorNumber: "1", qty: 2 }]).list;
    const delta = mergeAdd(start, [
      { name: "sol ring", setCode: "ltr", collectorNumber: "1", qty: 3 },
      { name: "Negate", qty: 1 },
      { name: "  ", qty: 5 },
      { name: "Bolt", qty: 0 },
    ]);
    expect(delta.list.find((e) => e.name === "Sol Ring")?.qty).toBe(5);
    expect(delta.updated).toEqual([
      { key: collectionKey("Sol Ring", "LTR", "1"), name: "Sol Ring", added: 3, total: 5 },
    ]);
    expect(delta.added).toEqual([{ key: collectionKey("Negate"), name: "Negate", qty: 1 }]);
    expect(delta.list).toHaveLength(2);
  });

  it("tetto a 9999", () => {
    const start = mergeAdd([], [{ name: "X", qty: 9999 }]).list;
    const delta = mergeAdd(start, [{ name: "X", qty: 10 }]);
    expect(delta.list[0]?.qty).toBe(9999);
  });
});

describe("missingForDeck", () => {
  it("riporta solo le voci non coperte, per stampa", () => {
    const owned = ownedByKey([
      { key: collectionKey("Sol Ring", "LTR", "1"), name: "Sol Ring", setCode: "ltr", collectorNumber: "1", qty: 2, addedAt: "" },
      { key: collectionKey("Bolt"), name: "Bolt", setCode: "", collectorNumber: "", qty: 4, addedAt: "" },
    ]);
    const missing = missingForDeck(
      [
        { name: "Sol Ring", setCode: "LTR", collectorNumber: "1", qty: 4 },
        { name: "Sol Ring", setCode: "M3C", collectorNumber: "220", qty: 1 },
        { name: "Bolt", qty: 4 },
      ],
      owned,
    );
    // Sol Ring LTR: 4−2=2 mancanti; Sol Ring M3C: altra stampa, 1 mancante; Bolt coperto
    expect(missing).toEqual([
      { name: "Sol Ring", setCode: "ltr", collectorNumber: "1", need: 2, have: 2 },
      { name: "Sol Ring", setCode: "m3c", collectorNumber: "220", need: 1, have: 0 },
    ]);
  });
});

describe("deckEntryToItem", () => {
  it("porta nome, set, numero e qty intera", () => {
    expect(deckEntryToItem({ name: "Negate", setCode: "M11", collectorNumber: "??", qty: 2.9 })).toEqual({
      name: "Negate",
      setCode: "m11",
      collectorNumber: "??",
      qty: 2,
    });
    expect(itemKey(deckEntryToItem({ name: "Negate" }))).toBe(collectionKey("Negate"));
  });
});

describe("collectionUsage", () => {
  const deck = [
    { name: "Sol Ring", setCode: "LTR", collectorNumber: "1", qty: 2, zone: "main" },
    { name: "Sauron", setCode: "", collectorNumber: "", qty: 1, zone: "commander" },
    { name: "Negate", setCode: "", collectorNumber: "", qty: 3, zone: "side" },
    { name: "Goblin", setCode: "", collectorNumber: "", qty: 5, zone: "tokens" },
  ] as const;
  const projects = [
    { id: "p1", name: "Krenko", manifest: { deck: [...deck] } },
    { id: "p2", name: "Altro", manifest: { deck: [{ ...deck[0], qty: 1 }] } },
  ];

  it("main + comandante contano, side/token no; copie sommate per mazzo", () => {
    const usage = collectionUsage(projects);
    const sol = usage.get(collectionKey("Sol Ring", "LTR", "1"));
    expect(sol?.totalCopies).toBe(3);
    expect(sol?.decks).toEqual([
      { id: "p1", name: "Krenko", copies: 2 },
      { id: "p2", name: "Altro", copies: 1 },
    ]);
    expect(usage.get(collectionKey("Sauron"))?.decks).toEqual([{ id: "p1", name: "Krenko", copies: 1 }]);
    expect(usage.has(collectionKey("Negate"))).toBe(false);
    expect(usage.has(collectionKey("Goblin"))).toBe(false);
    expect(usage.has(collectionKey("Mai esistita"))).toBe(false);
  });
});

describe("entryImageUrl", () => {
  it("stampa esatta con set+numero, default per nome altrimenti", () => {
    expect(entryImageUrl({ name: "Sol Ring", setCode: "ltr", collectorNumber: "1" })).toBe(
      "https://api.scryfall.com/cards/ltr/1?format=image&version=small",
    );
    expect(entryImageUrl({ name: "Negate", setCode: "", collectorNumber: "" })).toBe(
      "https://api.scryfall.com/cards/named?exact=Negate&format=image&version=small",
    );
  });
});
