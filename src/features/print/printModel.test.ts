import { describe, expect, it } from "vitest";
import { flowCopies, flowCounts, printGroupsInOrder, printZoneOf } from "@/features/print/printModel";
import type { CardEntry } from "@/types";

function entry(over: Partial<CardEntry> & { id: string; name: string }): CardEntry {
  return {
    qty: 1, zone: "main", provider: "custom", hasBack: false, sortOrder: 0, ...over,
  };
}

describe("printModel", () => {
  it("comandante accorpato al main", () => {
    expect(printZoneOf("commander")).toBe("main");
    expect(printZoneOf("tokens")).toBe("tokens");
  });

  it("gruppi senza duplicati, token per ultimi", () => {
    const groups = printGroupsInOrder();
    expect(groups).toEqual(["main", "side", "extra", "maybe", "considering", "custom", "tokens"]);
    expect(new Set(groups).size).toBe(groups.length);
    expect(groups[groups.length - 1]).toBe("tokens");
  });

  it("flowCopies: flusso continuo in ordine di zona, quantità espanse", () => {
    const deck = [
      entry({ id: "s1", name: "Negate", zone: "side", qty: 2, sortOrder: 0 }),
      entry({ id: "m1", name: "Bolt", zone: "main", qty: 1, sortOrder: 1 }),
      entry({ id: "t1", name: "Goblin", zone: "tokens", qty: 3, sortOrder: 2 }),
      entry({ id: "c1", name: "Sauron", zone: "commander", qty: 1, sortOrder: 3 }),
    ];
    const copies = flowCopies(deck, true);
    // main (comandante accorpato) → side → token, ognuno nell'ordine di lista
    expect(copies.map((c) => c.entryId)).toEqual(["m1", "c1", "s1", "s1", "t1", "t1", "t1"]);
    expect(copies.map((c) => c.zone)).toEqual(["main", "main", "side", "side", "tokens", "tokens", "tokens"]);
    expect(copies.find((c) => c.entryId === "c1")?.commander).toBe(true);
  });

  it("flowCopies: considering solo col flag", () => {
    const deck = [entry({ id: "w1", name: "Cultivate", zone: "considering", qty: 1 })];
    expect(flowCopies(deck, false)).toEqual([]);
    expect(flowCopies(deck, true)).toHaveLength(1);
  });

  it("flowCounts: copie e voci per zona presente, in ordine di stampa", () => {
    const deck = [
      entry({ id: "m1", name: "Bolt", zone: "main", qty: 2 }),
      entry({ id: "s1", name: "Negate", zone: "side", qty: 1 }),
    ];
    expect(flowCounts(flowCopies(deck, true))).toEqual([
      { zone: "main", label: "Main Deck", copies: 2, entries: 1 },
      { zone: "side", label: "Sideboard", copies: 1, entries: 1 },
    ]);
    expect(flowCounts([])).toEqual([]);
  });
});
