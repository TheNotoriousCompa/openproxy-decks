import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  fixProjectsTokensBoard,
  fixTokensBoard,
  isTokenBoardFixed,
  markTokenBoardFixed,
} from "@/services/zonefix";
import { putMeta } from "@/lib/cardmetaCache";
import { useDeck } from "@/stores/deck";
import { useProjects } from "@/stores/projects";
import { ensureActiveTokenBoardFixed } from "@/hooks/useTokenBoardFix";
import type { CardEntry, Project, Zone } from "@/types";

function entry(id: string, name: string, zone: Zone, setCode?: string): CardEntry {
  return { id, name, qty: 1, zone, provider: "scryfall", setCode, hasBack: false, sortOrder: 0 };
}

function project(id: string, deck: CardEntry[]): Project {
  const now = new Date().toISOString();
  return {
    id,
    name: id,
    created_at: now,
    updated_at: now,
    manifest: { version: 1, deck, print: {} as Project["manifest"]["print"] },
  };
}

/** Cache "calda" per i nomi usati: nessuna richiesta di rete nei test. */
function prime(names: Record<string, { typeLine: string; layout?: string }>): void {
  for (const [name, meta] of Object.entries(names)) {
    putMeta({ name, provider: "scryfall" }, meta, true);
  }
}

describe("zonefix", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("rete assente nei test");
      }),
    );
    prime({
      "Orc Army": { typeLine: "Token Creature — Orc Army", layout: "token" },
      "The One Ring": { typeLine: "Legendary Artifact", layout: "normal" },
      "Glorious Gale": { typeLine: "Instant", layout: "normal" },
      "Wraith": { typeLine: "Token Creature — Wraith", layout: "token" },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useDeck.getState().hydrate([]);
    useProjects.setState({ activeId: null });
  });

  it("toglie dal board Token solo le carte vere, mai i token", async () => {
    const deck = [
      entry("m1", "Sol Ring", "main"),
      entry("t1", "Orc Army", "tokens", "TLTR"),
      entry("t2", "The One Ring", "tokens", "LTR"),
      entry("t3", "Glorious Gale", "tokens", "LTR"),
      entry("t4", "Wraith", "tokens", "TLTC"),
      entry("t5", "Carta Sconosciuta Al Mondo", "tokens"),
    ];
    const { drop, ok } = await fixTokensBoard(deck, new AbortController().signal);
    expect(drop).toEqual(["t2", "t3"]);
    expect(ok).toBe(true);
  });

  it("senza rete non tocca niente e non marca come fatto", async () => {
    const deck = [
      entry("t1", "Nome Mai Risolto Uno", "tokens"),
      entry("t2", "Nome Mai Risolto Due", "tokens"),
    ];
    const { drop, ok } = await fixTokensBoard(deck, new AbortController().signal);
    expect(drop).toEqual([]);
    expect(ok).toBe(false);
  });

  it("deck senza board Token: niente da fare, subito ok", async () => {
    const { drop, ok } = await fixTokensBoard([entry("m1", "Sol Ring", "main")], new AbortController().signal);
    expect(drop).toEqual([]);
    expect(ok).toBe(true);
  });

  it("flag una volta per progetto", () => {
    expect(isTokenBoardFixed("p1")).toBe(false);
    markTokenBoardFixed("p1");
    expect(isTokenBoardFixed("p1")).toBe(true);
    expect(isTokenBoardFixed("p2")).toBe(false);
  });

  it("progetto attivo: rimozione dal deck live, poi no-op", async () => {
    useProjects.setState({ activeId: "p1" });
    useDeck.getState().hydrate([
      entry("m1", "Sol Ring", "main"),
      entry("t1", "The One Ring", "tokens", "LTR"),
      entry("t2", "Orc Army", "tokens", "TLTR"),
    ]);
    expect(await ensureActiveTokenBoardFixed()).toBe(1);
    expect(useDeck.getState().deck.map((c) => c.id)).toEqual(["m1", "t2"]);
    expect(isTokenBoardFixed("p1")).toBe(true);
    // secondo giro: nessuna ulteriore rimozione
    expect(await ensureActiveTokenBoardFixed()).toBe(0);
  });

  it("undo: la rimozione è un solo passo reversibile", async () => {
    const deck = [entry("m1", "Sol Ring", "main"), entry("t1", "The One Ring", "tokens", "LTR")];
    await fixTokensBoard(deck, new AbortController().signal);
    useDeck.getState().hydrate(deck);
    useDeck.getState().bulkRemove(["t1"]);
    expect(useDeck.getState().deck.map((c) => c.id)).toEqual(["m1"]);
    useDeck.getState().undo();
    expect(useDeck.getState().deck.map((c) => c.id)).toEqual(["m1", "t1"]);
  });

  it("export in blocco: ripulisce gli altri progetti e salta l'attivo", async () => {
    const other = project("p2", [
      entry("m1", "Sol Ring", "main"),
      entry("t1", "Glorious Gale", "tokens", "LTR"),
      entry("t2", "Wraith", "tokens", "TLTC"),
    ]);
    const active = project("p1", [entry("t1", "The One Ring", "tokens", "LTR")]);
    const fixed = await fixProjectsTokensBoard([active, other], "p1");
    expect(fixed[0]).toBe(active);
    expect(fixed[1]?.manifest.deck.map((c) => c.id)).toEqual(["m1", "t2"]);
    expect(isTokenBoardFixed("p2")).toBe(true);
    expect(isTokenBoardFixed("p1")).toBe(false);
    // già fatto: nessuna nuova copia dell'oggetto
    const again = await fixProjectsTokensBoard([active, other], "p1");
    expect(again[1]).toBe(other);
  });
});
