import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { enrichWithArtwork, fetchArtworkForName } from "@/services/artwork";

vi.mock("@/services/providers", () => ({
  findCardByName: vi.fn(async () => null),
  // il dettaglio non serve: si usa il risultato di ricerca grezzo
  scryfallProvider: { getCardById: vi.fn(async () => { throw new Error("no detail"); }) },
}));

const SEARCH_404 = { status: 404, ok: false, json: async () => ({ object: "error" }) };

const hit = (id: string, name = "Lightning Bolt") => ({
  status: 200,
  ok: true,
  json: async () => ({
    data: [
      {
        id,
        name,
        set: "lea",
        collector_number: "161",
        image_uris: { large: `https://img.test/${id}.jpg` },
      },
    ],
  }),
});

describe("artwork: lingua preferita con ripiego inglese", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prova la lingua preferita e ripiega sull'inglese dichiarandolo", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("lang%3Ait") ? SEARCH_404 : hit("en-print"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const patch = await fetchArtworkForName("Lightning Bolt", new AbortController().signal, 5000, "it");
    expect(patch?.providerId).toBe("en-print");
    expect(patch?.langUsed).toBe("en");
    const urls = fetchMock.mock.calls.map(([u]) => decodeURIComponent(String(u)));
    expect(urls[0]).toContain('!"Lightning Bolt" lang:it');
    expect(urls[1]).toContain('!"Lightning Bolt" lang:en');
  });

  it("stampa italiana disponibile: un solo tentativo, nessun ripiego", async () => {
    const fetchMock = vi.fn(async () => hit("it-print"));
    vi.stubGlobal("fetch", fetchMock);

    const patch = await fetchArtworkForName("Lightning Bolt", new AbortController().signal, 5000, "it");
    expect(patch?.langUsed).toBe("it");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("nessuna lingua disponibile: prova anche i nomi tradotti (fuzzy)", async () => {
    const { findCardByName } = await import("@/services/providers");
    vi.mocked(findCardByName).mockResolvedValueOnce({
      id: "fuzzy-it",
      name: "Lightning Bolt",
      setCode: "TLE",
      setName: "Tales",
      collectorNumber: "32",
      imageFront: "https://img.test/fuzzy.jpg",
      hasBack: false,
    });
    vi.stubGlobal("fetch", vi.fn(async () => SEARCH_404));

    const patch = await fetchArtworkForName("Fulmine", new AbortController().signal, 5000, "it");
    expect(patch?.providerId).toBe("fuzzy-it");
    expect(patch?.langUsed).toBeUndefined();
    expect(findCardByName).toHaveBeenCalledWith("Fulmine", expect.anything(), 5000);
  });

  it("enrichWithArtwork conta i ripieghi di lingua", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("lang%3Ait") ? SEARCH_404 : hit("en-print"),
      ),
    );
    const applied: string[] = [];
    const out = await enrichWithArtwork(
      [
        { name: "Lightning Bolt" },
        { name: "Counterspell" },
      ],
      {
        lang: "it",
        delayMs: 0,
        apply: (item) => {
          applied.push(item.name);
        },
      },
    );
    expect(out.enriched).toBe(2);
    expect(out.fellBack).toBe(2);
    expect(applied).toHaveLength(2);
  });
});
