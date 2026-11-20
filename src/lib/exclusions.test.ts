import { describe, expect, it } from "vitest";
import {
  compileExclusions,
  exclusionChips,
  exclusionCount,
  exclusionsKey,
  exclusionsSummary,
  filterPrints,
  isPrintExcluded,
  normalizeExclusions,
  removeExclusion,
  toggleSet,
  toggleSource,
  toggleTag,
  type Exclusions,
} from "@/lib/exclusions";
import type { PrintOption } from "@/types";

const mpc = (over: Partial<PrintOption> = {}): PrintOption => ({
  source: "mpc",
  id: "drive-1",
  name: "Sol Ring",
  setCode: "",
  setName: "Trix Are For Scoot",
  collectorNumber: "",
  hasBack: false,
  highres: true,
  ...over,
});

const sf = (over: Partial<PrintOption> = {}): PrintOption => ({
  source: "scryfall",
  id: "uuid-1",
  name: "Sol Ring",
  setCode: "ltr",
  setName: "The Lord of the Rings",
  collectorNumber: "1",
  hasBack: false,
  highres: true,
  ...over,
});

const ex = (over: Partial<Exclusions> = {}): Exclusions => ({
  sources: [],
  tags: [],
  sets: [],
  ...over,
});

describe("exclusions: normalizzazione e chiavi", () => {
  it("normalizeExclusions: trim, dedup case-insensitive, set minuscoli", () => {
    const out = normalizeExclusions({
      sources: [" Trix Are For Scoot ", "trix are for scoot", 42 as unknown as string],
      tags: ["AI Art", "ai art", ""],
      sets: ["LTR", " Ltr "],
    });
    expect(out).toEqual({
      sources: ["Trix Are For Scoot"],
      tags: ["AI Art"],
      sets: ["ltr"],
    });
  });

  it("normalizeExclusions: valori assenti o corrotti → liste vuote", () => {
    expect(normalizeExclusions(undefined)).toEqual(ex());
    expect(normalizeExclusions("boh")).toEqual(ex());
    expect(normalizeExclusions({ sources: "x" })).toEqual(ex());
  });

  it("exclusionsKey: null = tutte visibili, altrimenti stabile e ordine-insensibile", () => {
    expect(exclusionsKey(null)).toBe("all");
    const a = exclusionsKey({ sources: ["B", "A"], tags: [], sets: [] });
    const b = exclusionsKey({ sources: ["A", "B"], tags: [], sets: [] });
    expect(a).toBe(b);
    expect(exclusionsKey(ex())).toBe("||");
  });

  it("conteggio e sintesi", () => {
    const e = ex({ sources: ["X", "Y"], tags: ["AI Art"], sets: ["ltr"] });
    expect(exclusionCount(e)).toBe(4);
    expect(exclusionsSummary(e)).toBe("2 drive · 1 tag · 1 set");
    expect(exclusionsSummary(ex())).toBe("");
  });
});

describe("exclusions: toggle", () => {
  it("toggleSource: aggiunge e rimuove case-insensitive", () => {
    const on = toggleSource(ex(), "Trix Are For Scoot");
    expect(on.sources).toEqual(["Trix Are For Scoot"]);
    expect(toggleSource(on, "trix are for scoot").sources).toEqual([]);
  });

  it("toggleTag / toggleSet: il codice set è sempre minuscolo", () => {
    expect(toggleTag(ex(), "AI Art").tags).toEqual(["AI Art"]);
    expect(toggleSet(ex(), "LTR").sets).toEqual(["ltr"]);
    expect(toggleSet(toggleSet(ex(), "LTR"), "ltr").sets).toEqual([]);
  });

  it("removeExclusion: toglie solo il chip indicato", () => {
    const e = ex({ sources: ["A"], tags: ["AI Art"], sets: ["ltr"] });
    expect(removeExclusion(e, "tag", "AI Art")).toEqual(ex({ sources: ["A"], sets: ["ltr"] }));
    expect(removeExclusion(e, "source", "A")).toEqual(ex({ tags: ["AI Art"], sets: ["ltr"] }));
    expect(removeExclusion(e, "set", "LTR")).toEqual(ex({ sources: ["A"], tags: ["AI Art"] }));
  });

  it("chip: drive, tag e set in ordine di lista, set in maiuscolo", () => {
    const chips = exclusionChips(ex({ sources: ["A"], tags: ["AI Art"], sets: ["ltr"] }));
    expect(chips).toEqual([
      { kind: "source", value: "A", label: "A" },
      { kind: "tag", value: "AI Art", label: "AI Art" },
      { kind: "set", value: "ltr", label: "LTR" },
    ]);
  });
});

describe("exclusions: filtro stampe", () => {
  it("drive MPC: confronto case-insensitive sul nome della sorgente", () => {
    const c = compileExclusions(ex({ sources: ["trix are for scoot"] }));
    expect(isPrintExcluded(mpc(), c)).toBe(true);
    expect(isPrintExcluded(mpc({ setName: "Altra Fonte" }), c)).toBe(false);
  });

  it("drive MPC senza nome: non viene escluso per sbaglio", () => {
    const c = compileExclusions(ex({ sources: ["Trix Are For Scoot"] }));
    expect(isPrintExcluded(mpc({ setName: "", sourceLabel: undefined }), c)).toBe(false);
  });

  it("tag MPC: la catena completa del server copre anche i padri", () => {
    // come da API: una carta AI porta ["AI Art","Art","Custom Art"]
    const ai = mpc({ mpcTags: ["AI Art", "Art", "Custom Art"] });
    const plain = mpc({ mpcTags: [] });
    expect(isPrintExcluded(ai, compileExclusions(ex({ tags: ["custom art"] })))).toBe(true);
    expect(isPrintExcluded(ai, compileExclusions(ex({ tags: ["AI Art"] })))).toBe(true);
    expect(isPrintExcluded(plain, compileExclusions(ex({ tags: ["AI Art"] })))).toBe(false);
  });

  it("Scryfall: esclusione per codice set, case-insensitive", () => {
    const c = compileExclusions(ex({ sets: ["LTR"] }));
    expect(isPrintExcluded(sf(), c)).toBe(true);
    expect(isPrintExcluded(sf({ setCode: "m11" }), c)).toBe(false);
  });

  it("un set escluso non nasconde le stampe MPC (e viceversa)", () => {
    expect(isPrintExcluded(mpc(), compileExclusions(ex({ sets: ["ltr"] })))).toBe(false);
    expect(isPrintExcluded(sf(), compileExclusions(ex({ sources: ["Trix Are For Scoot"] })))).toBe(false);
  });

  it("filterPrints: ordine preservato, nessuna esclusione = array identico", () => {
    const list = [sf({ id: "a", setCode: "ltr" }), sf({ id: "b", setCode: "m11" }), mpc({ id: "c" })];
    expect(filterPrints(list, compileExclusions(null))).toBe(list);
    expect(filterPrints(list, compileExclusions(ex({ sets: ["ltr"] }))).map((o) => o.id)).toEqual(["b", "c"]);
  });
});
