import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildSearchBody,
  describeMpcError,
  driveDownloadUrl,
  excludedSourcePks,
  flattenMpcTags,
  MpcError,
  parseV2Results,
  searchMpcPrints,
  toPrintOptionFromMpc,
} from "@/services/mpc";
import { DEFAULT_MPC_SERVER } from "@/lib/constants";

/** Contratto verificato live su https://mpcfill.com (health/sources/editorSearch/cards). */
describe("mpc contract", () => {
  it("default server preconfigurato", () => {
    expect(DEFAULT_MPC_SERVER).toBe("https://mpcfill.com");
  });

  it("body v2: cardType MAIUSCOLO + sources [[pk,true]]", () => {
    const { path, body } = buildSearchBody("Command Tower", [
      { pk: 1, key: "a", name: "A" },
      { pk: 279, key: "b", name: "B" },
    ], 2);
    expect(path).toBe("/2/editorSearch/");
    const b = body as {
      searchSettings: { sourceSettings: { sources: [number, boolean][] } };
      queries: { cardType: string; query: string }[];
    };
    // bug reale trovato live: minuscolo → 422; sources [] → zero risultati
    expect(b.queries[0]?.cardType).toBe("CARD");
    expect(b.queries[0]?.query).toBe("Command Tower");
    expect(b.searchSettings.sourceSettings.sources).toEqual([[1, true], [279, true]]);
  });

  it("body v3: mappa q0", () => {
    const { path, body } = buildSearchBody("Bolt", [{ pk: 1, key: "a", name: "A" }], 3);
    expect(path).toBe("/3/editorSearch/");
    const b = body as { queries: Record<string, { cardType: string; query: string }> };
    expect(b.queries["q0"]).toMatchObject({ cardType: "CARD", query: "Bolt" });
  });

  it("tags → includesTags (dedup + trim, default vuoto)", () => {
    const get = (tags?: string[]) =>
      (buildSearchBody("Bolt", [{ pk: 1, key: "a", name: "A" }], 2, { tags }).body as {
        searchSettings: { filterSettings: { includesTags: string[] } };
      }).searchSettings.filterSettings.includesTags;
    expect(get()).toEqual([]);
    expect(get(["extended", " fullart ", "extended", ""])).toEqual(["extended", "fullart"]);
  });

  it("fonti escluse: tag in excludesTags e drive a false", () => {
    const { body } = buildSearchBody(
      "Bolt",
      [
        { pk: 1, key: "a", name: "A" },
        { pk: 10, key: "trix", name: "Trix Are For Scoot" },
        { pk: 11, key: "trix2", name: "Trix Are For Scoot 2" },
      ],
      2,
      { excludeTags: [" AI Art ", "AI Art", ""], excludedSources: new Set([10, 11]) },
    );
    const b = body as {
      searchSettings: {
        filterSettings: { excludesTags: string[] };
        sourceSettings: { sources: [number, boolean][] };
      };
    };
    expect(b.searchSettings.filterSettings.excludesTags).toEqual(["AI Art"]);
    // verificato live: `false` toglie il drive dai risultati
    expect(b.searchSettings.sourceSettings.sources).toEqual([
      [1, true],
      [10, false],
      [11, false],
    ]);
  });

  it("excludedSourcePks: nomi → pk, case-insensitive", () => {
    const sources = [
      { pk: 1, key: "a", name: "A" },
      { pk: 10, key: "trix", name: "Trix Are For Scoot" },
    ];
    expect([...excludedSourcePks(sources, [" trix are for scoot "])]).toEqual([10]);
    expect([...excludedSourcePks(sources, [])]).toEqual([]);
    expect([...excludedSourcePks(sources, ["Sconosciuto"])]).toEqual([]);
  });

  it("flattenMpcTags: albero → nome + padre, alias conservati", () => {
    const tags = flattenMpcTags({
      tags: [
        {
          name: "Art",
          aliases: [],
          parent: null,
          children: [
            {
              name: "Custom Art",
              aliases: ["Alt Art"],
              parent: "Art",
              children: [
                { name: "AI Art", aliases: ["AI", "Midjourney"], parent: "Custom Art", children: [] },
              ],
            },
          ],
        },
      ],
    });
    expect(tags).toEqual([
      { name: "Art", parent: null, aliases: [] },
      { name: "Custom Art", parent: "Art", aliases: ["Alt Art"] },
      { name: "AI Art", parent: "Custom Art", aliases: ["AI", "Midjourney"] },
    ]);
  });

  it("parseV2Results: shape reale {query: {CARD: [...]}}", () => {
    const ids = parseV2Results(
      { results: { "Command Tower": { CARD: ["id1", "id2", "id1"] } } },
      "Command Tower",
    );
    expect(ids).toEqual(["id1", "id2"]);
  });

  it("parseV2Results: fallback prima voce se chiave assente", () => {
    const ids = parseV2Results({ results: { other: { CARD: ["x"] } } }, "Bolt");
    expect(ids).toEqual(["x"]);
  });

  it("mapping Card reale → PrintOption", () => {
    const opt = toPrintOptionFromMpc({
      identifier: "1Zf7lK3VDw-NfSfWq7kg-Pl6SdieTqS5Z",
      name: "Command Tower",
      cardType: "CARD",
      dateCreated: "20th February, 2023",
      dateModified: "26th October, 2021",
      dpi: 1210,
      extension: "png",
      language: "EN",
      mediumThumbnailUrl: "https://drive.google.com/thumbnail?sz=w800-h800&id=X",
      smallThumbnailUrl: "https://drive.google.com/thumbnail?sz=w400-h400&id=X",
      priority: 2,
      searchq: "command tower",
      size: 14649184,
      source: "MrTeferi",
      sourceId: 1,
      sourceName: "MrTeferi",
      sourceVerbose: "MrTeferi",
      tags: [],
      downloadLink: "https://drive.google.com/uc?id=X&export=download",
    });
    expect(opt).toMatchObject({
      source: "mpc",
      id: "1Zf7lK3VDw-NfSfWq7kg-Pl6SdieTqS5Z",
      dpi: 1210,
      highres: true,
      sourceLabel: "MrTeferi",
      imageFull: "https://drive.google.com/uc?id=X&export=download",
    });
    expect(opt?.thumb).toContain("w400");
    expect(opt?.imageLarge).toContain("w800");
    // griglia picker: preview media, mai thumb 146px/400px stirata
    expect(opt?.preview).toContain("w800");
  });

  it("preview senza medium → ripiega su small", () => {
    const opt = toPrintOptionFromMpc({
      identifier: "abc123",
      name: "Bolt",
      dpi: 800,
      smallThumbnailUrl: "https://t/s",
    });
    expect(opt?.preview).toBe("https://t/s");
  });

  it("body default: solo CARD, exact (compatibilità chiamanti esistenti)", () => {
    const { body } = buildSearchBody("Bolt", [{ pk: 1, key: "a", name: "A" }], 2);
    const b = body as { queries: { cardType: string; query: string }[] };
    expect(b.queries).toEqual([{ cardType: "CARD", query: "Bolt" }]);
  });

  it("body multi-tipo + fuzzy per copertura catalogo", () => {
    const { body } = buildSearchBody("Treasure", [{ pk: 1, key: "a", name: "A" }], 2, {
      cardTypes: ["CARD", "TOKEN", "CARDBACK"],
      fuzzy: true,
    });
    const b = body as {
      queries: { cardType: string; query: string }[];
      searchSettings: { searchTypeSettings: { fuzzySearch: boolean } };
    };
    expect(b.queries.map((q) => q.cardType)).toEqual(["CARD", "TOKEN", "CARDBACK"]);
    expect(b.searchSettings.searchTypeSettings.fuzzySearch).toBe(true);
  });

  it("body v3: chiavi q0..qn per tipo", () => {
    const { body } = buildSearchBody("Bolt", [{ pk: 1, key: "a", name: "A" }], 3, {
      cardTypes: ["CARD", "TOKEN"],
    });
    const b = body as { queries: Record<string, { cardType: string; query: string }> };
    expect(b.queries["q0"]).toMatchObject({ cardType: "CARD", query: "Bolt" });
    expect(b.queries["q1"]).toMatchObject({ cardType: "TOKEN", query: "Bolt" });
  });

  it("senza downloadLink → deriva dal Drive ID", () => {
    const opt = toPrintOptionFromMpc({
      identifier: "abc123",
      name: "Bolt",
      cardType: "CARD",
      dateCreated: "x",
      dateModified: "y",
      dpi: 800,
      extension: "png",
      language: "EN",
      mediumThumbnailUrl: "https://t/m",
      smallThumbnailUrl: "https://t/s",
      priority: 1,
      searchq: "bolt",
      size: 10,
      source: "S",
      sourceId: 2,
      sourceName: "S",
      sourceVerbose: "S",
      tags: [],
    });
    expect(opt?.imageFull).toBe(driveDownloadUrl("abc123"));
  });

  it("scarta payload invalidi", () => {
    expect(toPrintOptionFromMpc({ nope: true })).toBeNull();
    expect(() => parseV2Results({ results: 42 }, "x")).toThrow();
  });
});

describe("errori MPC leggibili", () => {
  it("Cloudflare 523 (origin unreachable): messaggio chiaro e retryable", () => {
    const e = describeMpcError(new Error("proxy: HTTP 523 <unknown status code>"), "https://mpcfill.com");
    expect(e.reason).toBe("unreachable");
    expect(e.retryable).toBe(true);
    expect(e.detail).toContain("mpcfill.com");
    expect(e.detail).toContain("Cloudflare 523");
    expect(e.detail).toContain("Scryfall");
  });

  it("429 e 404/4xx: reason e retry coerenti", () => {
    const tooMany = describeMpcError(new Error("proxy: HTTP 429"), "https://mpcfill.com");
    expect(tooMany.reason).toBe("unreachable");
    expect(tooMany.retryable).toBe(true);
    const missing = describeMpcError(new Error("proxy: HTTP 404"), "https://x.test");
    expect(missing.reason).toBe("invalid");
    expect(missing.retryable).toBe(false);
    expect(missing.detail).toContain("404");
  });

  it("JSON non valido → invalid, errore di rete generico → unreachable", () => {
    expect(describeMpcError(new Error("proxy: JSON non valido: EOF")).reason).toBe("invalid");
    const net = describeMpcError(new TypeError("Failed to fetch"), "https://mpcfill.com");
    expect(net.reason).toBe("unreachable");
    expect(net.detail).toContain("Impossibile raggiungere");
  });

  it("MpcError passa invariato", () => {
    const e = describeMpcError(new MpcError("unhealthy", "motore spento"));
    expect(e.reason).toBe("unhealthy");
    expect(e.detail).toBe("motore spento");
    expect(e.retryable).toBe(false);
  });
});

describe("searchMpcPrints v2/v3", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function stubFetch(handler: (url: string, init?: RequestInit) => unknown): { v3calls: string[]; calls: string[] } {
    const v3calls: string[] = [];
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/3/editorSearch/")) v3calls.push(url);
      const body = handler(url, init);
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as unknown as typeof fetch;
    return { v3calls, calls };
  }

  const sources = { results: { a: { pk: 1, key: "a", name: "A" } } };

  it("v2 vuota ma valida → fuzzy, niente retry v3", async () => {
    const { v3calls, calls } = stubFetch((url) => {
      if (url.includes("/2/sources/")) return sources;
      if (url.includes("/2/editorSearch/")) return { results: { Bolt: { CARD: [], TOKEN: [], CARDBACK: [] } } };
      throw new Error(`chiamata inattesa: ${url}`);
    });
    const out = await searchMpcPrints("Bolt", new AbortController().signal);
    expect(out).toEqual([]);
    expect(v3calls).toHaveLength(0);
    // exact + fuzzy: due giri v2
    expect(calls.filter((u) => u.includes("/2/editorSearch/"))).toHaveLength(2);
  });

  it("v2 in errore → fallback v3 preservato", async () => {
    const card = {
      identifier: "abc123", name: "Bolt", cardType: "CARD", dateCreated: "x",
      dateModified: "y", dpi: 800, extension: "png", language: "EN",
      mediumThumbnailUrl: "https://t/m", smallThumbnailUrl: "https://t/s",
      priority: 1, searchq: "bolt", size: 10, source: "S", sourceId: 2,
      sourceName: "S", sourceVerbose: "S", tags: [],
    };
    const { v3calls } = stubFetch((url) => {
      if (url.includes("/2/sources/")) return sources;
      if (url.includes("/2/editorSearch/")) throw new Error("HTTP 404 (backend senza v2)");
      if (url.includes("/3/editorSearch/")) return { results: { q0: ["abc123"] } };
      if (url.includes("/2/cards/")) return { results: { abc123: card } };
      throw new Error(`chiamata inattesa: ${url}`);
    });
    const out = await searchMpcPrints("Bolt", new AbortController().signal);
    expect(v3calls).toHaveLength(1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "abc123", dpi: 800 });
  });

  it("exact vuoto → giro fuzzy che recupera (nomi parziali)", async () => {
    const card = {
      identifier: "jodah1", name: "Jodah", cardType: "CARD", dateCreated: "x",
      dateModified: "y", dpi: 900, extension: "png", language: "EN",
      mediumThumbnailUrl: "https://t/m", smallThumbnailUrl: "https://t/s",
      priority: 1, searchq: "jodah", size: 10, source: "S", sourceId: 2,
      sourceName: "S", sourceVerbose: "S", tags: [],
    };
    let searches = 0;
    stubFetch((url, init) => {
      if (url.includes("/2/sources/")) return sources;
      if (url.includes("/2/editorSearch/")) {
        searches += 1;
        const body = JSON.parse(String((init as { body?: string })?.body ?? "{}")) as {
          searchSettings?: { searchTypeSettings?: { fuzzySearch?: boolean } };
        };
        // primo giro exact vuoto, secondo (fuzzy) pieno
        if (body.searchSettings?.searchTypeSettings?.fuzzySearch) {
          return { results: { Jodah: { CARD: ["jodah1"], TOKEN: [], CARDBACK: [] } } };
        }
        return { results: { Jodah: { CARD: [], TOKEN: [], CARDBACK: [] } } };
      }
      if (url.includes("/2/cards/")) return { results: { jodah1: card } };
      throw new Error(`chiamata inattesa: ${url}`);
    });
    const out = await searchMpcPrints("Jodah", new AbortController().signal);
    expect(searches).toBe(2);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "jodah1" });
  });

  it("tipi multipli in una chiamata: token inclusi", async () => {
    const mk = (id: string) => ({
      identifier: id, name: "Treasure", cardType: "TOKEN", dateCreated: "x",
      dateModified: "y", dpi: 800, extension: "png", language: "EN",
      mediumThumbnailUrl: "https://t/m", smallThumbnailUrl: "https://t/s",
      priority: 1, searchq: "treasure", size: 10, source: "S", sourceId: 2,
      sourceName: "S", sourceVerbose: "S", tags: [],
    });
    stubFetch((url, init) => {
      if (url.includes("/2/sources/")) return sources;
      if (url.includes("/2/editorSearch/")) {
        const body = JSON.parse(String((init as { body?: string })?.body ?? "{}")) as {
          queries?: { cardType: string }[];
        };
        // una sola chiamata con tutti i tipi
        expect(body.queries?.map((q) => q.cardType)).toEqual(["CARD", "TOKEN", "CARDBACK"]);
        return { results: { Treasure: { CARD: ["c1"], TOKEN: ["t1", "t2"], CARDBACK: [] } } };
      }
      if (url.includes("/2/cards/")) {
        const body = JSON.parse(String((init as { body?: string })?.body ?? "{}")) as { cardIdentifiers?: string[] };
        const results: Record<string, unknown> = {};
        for (const id of body.cardIdentifiers ?? []) results[id] = mk(id);
        return { results };
      }
      throw new Error(`chiamata inattesa: ${url}`);
    });
    const out = await searchMpcPrints("Treasure", new AbortController().signal);
    expect(out.map((o) => o.id).sort()).toEqual(["c1", "t1", "t2"]);
  });

  it("niente più tetto a 120: 300 id in un batch", async () => {
    const ids = Array.from({ length: 300 }, (_, i) => `id-${i}`);
    const seen: string[][] = [];
    stubFetch((url, init) => {
      if (url.includes("/2/sources/")) return sources;
      if (url.includes("/2/editorSearch/")) {
        return { results: { Bolt: { CARD: ids, TOKEN: [], CARDBACK: [] } } };
      }
      if (url.includes("/2/cards/")) {
        const body = JSON.parse(String((init as { body?: string })?.body ?? "{}")) as { cardIdentifiers?: string[] };
        seen.push(body.cardIdentifiers ?? []);
        const results: Record<string, unknown> = {};
        for (const id of body.cardIdentifiers ?? []) {
          results[id] = {
            identifier: id, name: "Bolt", cardType: "CARD", dateCreated: "x",
            dateModified: "y", dpi: 800, extension: "png", language: "EN",
            mediumThumbnailUrl: "https://t/m", smallThumbnailUrl: "https://t/s",
            priority: 1, searchq: "bolt", size: 10, source: "S", sourceId: 2,
            sourceName: "S", sourceVerbose: "S", tags: [],
          };
        }
        return { results };
      }
      throw new Error(`chiamata inattesa: ${url}`);
    });
    const out = await searchMpcPrints("Bolt", new AbortController().signal);
    // 300 > 120: prima si fermava a 120 in un batch solo
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(300);
    expect(out).toHaveLength(300);
  });
});
