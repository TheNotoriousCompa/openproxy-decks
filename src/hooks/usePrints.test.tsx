import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { fetchPrints, prefetchPrints, printsQueryKey, usePrints, type PrintsParams } from "@/hooks/usePrints";
import { queryClient } from "@/services/queryClient";
import type { PrintOption } from "@/types";

const mkOpt = (id: string): PrintOption => ({
  source: "scryfall", id, name: "Bolt", setCode: "M11", setName: "Core",
  collectorNumber: "1", thumb: "https://t", imageLarge: "https://l",
  hasBack: false, highres: true,
});

vi.mock("@/services/providers", () => ({
  scryfallProvider: { getCardPrintings: vi.fn() },
}));

vi.mock("@/services/mpc", () => ({
  MpcError: class extends Error {
    reason = "unreachable";
  },
  searchMpcPrints: vi.fn(),
}));

import { scryfallProvider } from "@/services/providers";
import { searchMpcPrints } from "@/services/mpc";

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const base: PrintsParams = { source: "scryfall", submitted: "Bolt", mpcServer: "", lang: "any", tags: [], exclude: null };

describe("usePrints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it("printsQueryKey stabile e completa", () => {
    expect(printsQueryKey(base)).toEqual(["prints", "scryfall", "Bolt", "", "any", [], "all"]);
    expect(printsQueryKey({ ...base, tags: ["a"] })).toEqual(["prints", "scryfall", "Bolt", "", "any", ["a"], "all"]);
    // le esclusioni entrano nella chiave: cambiare la lista rifetcha
    expect(printsQueryKey({ ...base, exclude: { sources: [], tags: ["AI Art"], sets: [] } })).toEqual([
      "prints", "scryfall", "Bolt", "", "any", [], "|ai art|",
    ]);
  });

  it("fetch progressivo: pubblica ogni pagina in cache, ritorna il completo", async () => {
    const p1 = [mkOpt("a"), mkOpt("b")];
    const p2 = [mkOpt("c")];
    vi.mocked(scryfallProvider.getCardPrintings!).mockImplementationOnce(
      async (_n, _s, _l, onPage) => {
        onPage?.(p1);
        onPage?.(p2);
        return [...p1, ...p2];
      },
    );
    const spy = vi.spyOn(queryClient, "setQueryData");
    const out = await fetchPrints(base, new AbortController().signal);
    expect(out.options).toHaveLength(3);
    // due pubblicazioni progressive: [a,b] poi [a,b,c]
    const calls = spy.mock.calls.filter(([k]) => JSON.stringify(k) === JSON.stringify(printsQueryKey(base)));
    expect(calls.length).toBe(2);
    const published = (i: number): string[] =>
      ((calls[i]?.[1] as { options: PrintOption[] }).options).map((p) => p.id);
    expect(published(0)).toEqual(["a", "b"]);
    expect(published(1)).toEqual(["a", "b", "c"]);
    expect(out.langUsed).toBeUndefined();
  });

  it("lingua preferita assente: ripiega sull'inglese e lo dichiara", async () => {
    // italiano senza risultati → inglese con risultati
    vi.mocked(scryfallProvider.getCardPrintings!)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([mkOpt("en-1")]);
    const out = await fetchPrints({ ...base, lang: "it" }, new AbortController().signal);
    expect(out.options.map((o) => o.id)).toEqual(["en-1"]);
    expect(out.langUsed).toBe("en");
    const langs = vi.mocked(scryfallProvider.getCardPrintings!).mock.calls.map((c) => c[2]);
    expect(langs).toEqual(["it", "en"]);
  });

  it("lingua preferita disponibile: nessun ripiego", async () => {
    vi.mocked(scryfallProvider.getCardPrintings!).mockResolvedValueOnce([mkOpt("it-1")]);
    const out = await fetchPrints({ ...base, lang: "it" }, new AbortController().signal);
    expect(out.options.map((o) => o.id)).toEqual(["it-1"]);
    expect(out.langUsed).toBe("it");
    expect(vi.mocked(scryfallProvider.getCardPrintings!)).toHaveBeenCalledTimes(1);
  });

  it("fetch MPC delega con tags e fonti escluse", async () => {
    vi.mocked(searchMpcPrints).mockResolvedValueOnce([mkOpt("m")]);
    const out = await fetchPrints(
      {
        ...base,
        source: "mpc",
        tags: ["fullart"],
        exclude: { sources: ["Trix Are For Scoot"], tags: ["AI Art"], sets: [] },
      },
      new AbortController().signal,
    );
    expect(out.options).toHaveLength(1);
    expect(searchMpcPrints).toHaveBeenCalledWith("Bolt", expect.anything(), {
      tags: ["fullart"],
      languages: [],
      excludeTags: ["AI Art"],
      excludedSourceNames: ["Trix Are For Scoot"],
    });
  });

  it("«mostra escluse» (exclude null): nessun filtro passato al server", async () => {
    vi.mocked(searchMpcPrints).mockResolvedValueOnce([mkOpt("m")]);
    await fetchPrints({ ...base, source: "mpc", exclude: null }, new AbortController().signal);
    expect(searchMpcPrints).toHaveBeenCalledWith("Bolt", expect.anything(), {
      tags: [],
      languages: [],
      excludeTags: [],
      excludedSourceNames: [],
    });
  });

  it("Scryfall: le stampe di set esclusi non entrano nei risultati", async () => {
    const ltr = { ...mkOpt("ltr-1"), setCode: "ltr", setName: "LOTR" };
    const m11 = mkOpt("m11-1");
    vi.mocked(scryfallProvider.getCardPrintings!).mockResolvedValueOnce([ltr, m11]);
    const out = await fetchPrints(
      { ...base, exclude: { sources: [], tags: [], sets: ["LTR"] } },
      new AbortController().signal,
    );
    expect(out.options.map((o) => o.id)).toEqual(["m11-1"]);
  });

  it("Scryfall: se le uniche stampe sono escluse, la lista resta vuota", async () => {
    vi.mocked(scryfallProvider.getCardPrintings!).mockResolvedValue([]);
    const out = await fetchPrints(
      { ...base, exclude: { sources: [], tags: [], sets: ["m11"] } },
      new AbortController().signal,
    );
    expect(out.options).toEqual([]);
  });

  it("prefetch popola la cache e non solleva mai", async () => {
    vi.mocked(scryfallProvider.getCardPrintings!).mockResolvedValueOnce([mkOpt("a")]);
    prefetchPrints(base);
    await waitFor(() => {
      expect(queryClient.getQueryData<{ options: PrintOption[] }>(printsQueryKey(base))?.options).toHaveLength(1);
    });
    vi.mocked(scryfallProvider.getCardPrintings!).mockRejectedValueOnce(new Error("boom"));
    prefetchPrints({ ...base, submitted: "Altro" });
    await new Promise((r) => setTimeout(r, 50));
    expect(queryClient.getQueryData(printsQueryKey({ ...base, submitted: "Altro" }))).toBeUndefined();
  });

  it("usePrints integra la query (dati + loading)", async () => {
    vi.mocked(scryfallProvider.getCardPrintings!).mockResolvedValueOnce([mkOpt("a"), mkOpt("b")]);
    const { result } = renderHook(() => usePrints(base), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.options).toHaveLength(2);
    expect(result.current.data?.langUsed).toBeUndefined();
  });
});
