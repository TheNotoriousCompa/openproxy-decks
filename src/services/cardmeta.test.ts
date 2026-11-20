import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolveMissingMetas } from "@/services/cardmeta";
import { cachedMeta, putMeta } from "@/lib/cardmetaCache";

describe("resolveMissingMetas", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/cards/collection")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: "uuid-orc-army",
                  name: "Orc Army",
                  set: "tltr",
                  type_line: "Token Creature — Orc Army",
                  layout: "token",
                },
              ],
              not_found: [{ name: "Farlocca" }],
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("bulk esatto + cascata sui miss, cache scritta e progresso riportato", async () => {
    const progress: number[] = [];
    await resolveMissingMetas(
      [
        { name: "Orc Army", setCode: "TLTR" },
        { name: "Farlocca" },
      ],
      new AbortController().signal,
      (remaining) => progress.push(remaining),
    );
    expect(cachedMeta({ name: "Orc Army", setCode: "TLTR" })?.layout).toBe("token");
    // l'alias per nome copre le voci senza set noto
    expect(cachedMeta({ name: "orc army" })?.typeLine).toBe("Token Creature — Orc Army");
    expect(cachedMeta({ name: "Farlocca" })).toBeUndefined();
    expect(progress[0]).toBe(2);
    expect(progress[progress.length - 1]).toBe(0);
  });

  it("abortito: nessuna richiesta, nessuna eccezione", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      resolveMissingMetas([{ name: "Carta Mai Vista Prima" }], ctrl.signal),
    ).resolves.toBeUndefined();
    expect(cachedMeta({ name: "Carta Mai Vista Prima" })).toBeUndefined();
  });

  it("tutto già in cache: zero richieste", async () => {
    putMeta({ name: "Wraith", setCode: "TLTC" }, { typeLine: "Token Creature — Wraith", layout: "token" }, true);
    await resolveMissingMetas([{ name: "Wraith", setCode: "TLTC" }], new AbortController().signal);
    expect(cachedMeta({ name: "Wraith", setCode: "TLTC" })?.layout).toBe("token");
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });
});
