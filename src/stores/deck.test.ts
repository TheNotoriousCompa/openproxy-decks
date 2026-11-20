import { describe, expect, it } from "vitest";
import { useDeck, visibleDeck, peersOfName, copiesWithPeers } from "@/stores/deck";

function entry(name: string, zone: "main" | "side" = "main") {
  return {
    name, qty: 1, zone, provider: "custom" as const, hasBack: false,
  };
}

describe("undo/redo", () => {
  it("add → undo → redo", () => {
    useDeck.getState().hydrate([]);
    useDeck.getState().add(entry("Bolt"));
    expect(useDeck.getState().deck).toHaveLength(1);
    useDeck.getState().undo();
    expect(useDeck.getState().deck).toHaveLength(0);
    useDeck.getState().redo();
    expect(useDeck.getState().deck).toHaveLength(1);
  });
  it("qty e zone sono annullabili", () => {
    useDeck.getState().hydrate([]);
    useDeck.getState().add(entry("Bolt"));
    const id = useDeck.getState().deck[0]?.id ?? "";
    useDeck.getState().setQty(id, 4);
    expect(useDeck.getState().deck[0]?.qty).toBe(4);
    useDeck.getState().undo();
    expect(useDeck.getState().deck[0]?.qty).toBe(1);
    useDeck.getState().moveZone([id], "side");
    expect(useDeck.getState().deck[0]?.zone).toBe("side");
    useDeck.getState().undo();
    expect(useDeck.getState().deck[0]?.zone).toBe("main");
  });
});

describe("applyPatchesSilent", () => {
  it("applica senza snapshot undo (swap background)", () => {
    useDeck.getState().hydrate([]);
    const id = useDeck.getState().add({ ...entry("Bolt"), imageFront: "https://img/old.jpg" });
    const pastBefore = useDeck.getState().past.length;
    useDeck.getState().applyPatchesSilent([{ id, patch: { imageFront: "C:/x/new.jpg" } }]);
    expect(useDeck.getState().deck[0]?.imageFront).toBe("C:/x/new.jpg");
    expect(useDeck.getState().past.length).toBe(pastBefore);
  });
  it("lista vuota → no-op", () => {
    useDeck.getState().hydrate([]);
    const pastBefore = useDeck.getState().past.length;
    useDeck.getState().applyPatchesSilent([]);
    expect(useDeck.getState().past.length).toBe(pastBefore);
  });
});

describe("splitCopies", () => {
  it("qty=4 → 4 righe qty=1 con artwork ereditato, un solo undo", () => {
    useDeck.getState().hydrate([]);
    const id = useDeck.getState().add({ ...entry("Bolt"), qty: 4, imageFront: "https://img/x.jpg" });
    const pastBefore = useDeck.getState().past.length;
    const ids = useDeck.getState().splitCopies(id);
    expect(ids).toHaveLength(3);
    const deck = useDeck.getState().deck;
    expect(deck).toHaveLength(4);
    expect(deck.every((c) => c.qty === 1)).toBe(true);
    expect(deck.every((c) => c.imageFront === "https://img/x.jpg")).toBe(true);
    expect(deck.reduce((n, c) => n + c.qty, 0)).toBe(4);
    expect(useDeck.getState().past.length).toBe(pastBefore + 1);
    useDeck.getState().undo();
    expect(useDeck.getState().deck).toHaveLength(1);
    expect(useDeck.getState().deck[0]?.qty).toBe(4);
  });
  it("qty=1 → nessun effetto", () => {
    useDeck.getState().hydrate([]);
    const id = useDeck.getState().add(entry("Bolt"));
    expect(useDeck.getState().splitCopies(id)).toEqual([]);
    expect(useDeck.getState().deck).toHaveLength(1);
  });
  it("id sconosciuto → nessun effetto", () => {
    useDeck.getState().hydrate([]);
    expect(useDeck.getState().splitCopies("nope")).toEqual([]);
  });
});

describe("applyPrintToSingleCopy", () => {
  const patch = { imageFront: "https://img/new.jpg", providerId: "uuid-new" };
  it("qty=4 → riga qty=3 invariata + clone qty=1 patchato, un solo undo", () => {
    useDeck.getState().hydrate([]);
    const id = useDeck.getState().add({ ...entry("Bolt"), qty: 4, imageFront: "https://img/old.jpg" });
    const pastBefore = useDeck.getState().past.length;
    const applied = useDeck.getState().applyPrintToSingleCopy(id, patch);
    expect(applied).not.toBeNull();
    expect(applied).not.toBe(id);
    const deck = useDeck.getState().deck;
    expect(deck).toHaveLength(2);
    expect(deck.reduce((n, c) => n + c.qty, 0)).toBe(4);
    const orig = deck.find((c) => c.id === id);
    const clone = deck.find((c) => c.id === applied);
    expect(orig).toMatchObject({ qty: 3, imageFront: "https://img/old.jpg" });
    expect(clone).toMatchObject({ qty: 1, imageFront: "https://img/new.jpg", providerId: "uuid-new" });
    expect(useDeck.getState().past.length).toBe(pastBefore + 1);
    useDeck.getState().undo();
    const back = useDeck.getState().deck;
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id, qty: 4, imageFront: "https://img/old.jpg" });
  });
  it("qty=1 → patch in place senza split", () => {
    useDeck.getState().hydrate([]);
    const id = useDeck.getState().add({ ...entry("Bolt"), qty: 1 });
    const pastBefore = useDeck.getState().past.length;
    expect(useDeck.getState().applyPrintToSingleCopy(id, patch)).toBe(id);
    const deck = useDeck.getState().deck;
    expect(deck).toHaveLength(1);
    expect(deck[0]).toMatchObject({ qty: 1, imageFront: "https://img/new.jpg" });
    expect(useDeck.getState().past.length).toBe(pastBefore + 1);
  });
  it("id sconosciuto → null, nessun snapshot", () => {
    useDeck.getState().hydrate([]);
    const pastBefore = useDeck.getState().past.length;
    expect(useDeck.getState().applyPrintToSingleCopy("nope", patch)).toBeNull();
    expect(useDeck.getState().past.length).toBe(pastBefore);
  });
});

describe("commander in cima (solo ordine default)", () => {
  it("order: commander prima, poi sortOrder", () => {
    useDeck.getState().hydrate([]);
    useDeck.getState().add(entry("Bolt"));
    useDeck.getState().add({ ...entry("Sauron"), zone: "commander" });
    useDeck.getState().add(entry("Forest"));
    const vis = visibleDeck(useDeck.getState().deck, "all", "order");
    expect(vis.map((c) => c.name)).toEqual(["Sauron", "Bolt", "Forest"]);
  });
  it("order: flag commander senza cambio zona", () => {
    useDeck.getState().hydrate([]);
    const idA = useDeck.getState().add(entry("Bolt"));
    useDeck.getState().add(entry("Forest"));
    useDeck.getState().setCommander([idA], true);
    const deck = useDeck.getState().deck;
    expect(deck.find((c) => c.id === idA)?.zone).toBe("main");
    expect(deck.find((c) => c.id === idA)?.commander).toBe(true);
    const vis = visibleDeck(deck, "all", "order");
    expect(vis[0]?.name).toBe("Bolt");
    useDeck.getState().undo();
    expect(useDeck.getState().deck.find((c) => c.id === idA)?.commander).not.toBe(true);
  });
  it("name: nessun trattamento speciale", () => {
    useDeck.getState().hydrate([]);
    useDeck.getState().add(entry("Bolt"));
    useDeck.getState().add({ ...entry("Sauron"), zone: "commander" });
    const vis = visibleDeck(useDeck.getState().deck, "all", "name");
    expect(vis.map((c) => c.name)).toEqual(["Bolt", "Sauron"]);
  });
});

describe("deduplicazione", () => {
  it("stessa carta 10x = 1 voce con qty 10", () => {
    useDeck.getState().hydrate([]);
    useDeck.getState().add({ ...entry("Bolt"), qty: 10 });
    const deck = useDeck.getState().deck;
    expect(deck).toHaveLength(1);
    expect(deck.reduce((n, c) => n + c.qty, 0)).toBe(10);
  });
});

describe("peersOfName / copiesWithPeers (Apply to all)", () => {
  it("match per nome normalizzato, tutte le zone, escluso se stesso", () => {
    useDeck.getState().hydrate([]);
    const a = useDeck.getState().add({ ...entry(" Swamp "), qty: 2 });
    const b = useDeck.getState().add({ ...entry("swamp"), zone: "side", qty: 3 });
    useDeck.getState().add(entry("Forest"));
    const deck = useDeck.getState().deck;
    expect(peersOfName(deck, a).map((c) => c.id)).toEqual([b]);
    expect(copiesWithPeers(deck, a)).toBe(5);
    // id sconosciuto → 0
    expect(copiesWithPeers(deck, "nope")).toBe(0);
    expect(peersOfName(deck, "nope")).toEqual([]);
  });
});
