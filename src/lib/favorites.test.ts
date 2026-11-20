import { describe, expect, it, vi, beforeEach } from "vitest";
import { listFavorites, toggleFavorite } from "@/lib/favorites";
import type { PrintOption } from "@/types";

const { tauriFlag } = vi.hoisted(() => ({ tauriFlag: { value: false } }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/services/backend", () => ({
  get backend() {
    return { isTauri: tauriFlag.value };
  },
}));

import { invoke } from "@tauri-apps/api/core";

const OPT: PrintOption = {
  source: "scryfall", id: "uuid-1", name: "Bolt", setCode: "M11",
  setName: "Core", collectorNumber: "146", thumb: "https://t",
  imageLarge: "https://l", hasBack: false, highres: true,
};

describe("favorites fallback locale (browser)", () => {
  beforeEach(() => {
    tauriFlag.value = false;
    localStorage.clear();
    vi.mocked(invoke).mockReset();
  });

  it("lista vuota, toggle aggiunge e rimuove (persistenza localStorage)", async () => {
    expect(await listFavorites()).toEqual([]);
    const added = await toggleFavorite(OPT, []);
    expect(added).toEqual([{ id: "uuid-1", name: "Bolt", source: "scryfall" }]);
    expect(JSON.parse(localStorage.getItem("proxxied.favorites") ?? "[]")).toHaveLength(1);
    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
    const removed = await toggleFavorite(OPT, added);
    expect(removed).toEqual([]);
  });
});

describe("favorites via backend (desktop)", () => {
  beforeEach(() => {
    tauriFlag.value = true;
    localStorage.clear();
    vi.mocked(invoke).mockReset();
  });

  it("list/add/remove passano per invoke", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    expect(await listFavorites()).toEqual([]);
    expect(invoke).toHaveBeenCalledWith("list_favorites");
    vi.mocked(invoke).mockResolvedValueOnce([{ id: "uuid-1", name: "Bolt", source: "scryfall" }]);
    const added = await toggleFavorite(OPT, []);
    expect(added).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("add_favorite", {
      fav: { id: "uuid-1", name: "Bolt", source: "scryfall" },
    });
    vi.mocked(invoke).mockResolvedValueOnce([]);
    expect(await toggleFavorite(OPT, added)).toEqual([]);
    expect(invoke).toHaveBeenCalledWith("remove_favorite", { id: "uuid-1" });
  });

  it("errore backend → fallback locale senza perdere il toggle", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("boom"));
    const added = await toggleFavorite(OPT, []);
    expect(added).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("proxxied.favorites") ?? "[]")).toHaveLength(1);
  });
});
