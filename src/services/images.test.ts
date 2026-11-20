import { describe, expect, it, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

vi.mock("@/services/backend", () => ({
  backend: { isTauri: true },
}));

import {
  fetchArtworkViaBackend,
  importFileViaBackend,
  persistPatch,
  persistPrintFace,
  printFaceToPatch,
  printOptionToPatch,
  toDisplaySrc,
} from "@/services/images";
import type { PrintOption } from "@/types";

const OPT: PrintOption = {
  source: "scryfall", id: "uuid-1", name: "Bolt", setCode: "M11", setName: "Core",
  collectorNumber: "146", thumb: "https://t", imageLarge: "https://l", imageFull: "https://f",
  imageBack: "https://b", hasBack: true, highres: true,
};

describe("images backend (chiavi invoke camelCase)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("fetch_artwork usa projectId camelCase", async () => {
    invokeMock.mockResolvedValueOnce({ id: "a", path: "C:\\x\\a.png" });
    await fetchArtworkViaBackend("https://img/x.jpg", "proj-1");
    expect(invokeMock).toHaveBeenCalledWith("fetch_artwork", { projectId: "proj-1", url: "https://img/x.jpg" });
  });

  it("import_asset_bytes usa projectId camelCase", async () => {
    invokeMock.mockResolvedValueOnce({ id: "b", path: "C:\\x\\b.png" });
    const file = new File(["fake"], "carta.png", { type: "image/png" });
    // jsdom: File.arrayBuffer assente in questa versione → polyfill locale
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    await importFileViaBackend(file, "proj-2");
    expect(invokeMock).toHaveBeenCalledWith(
      "import_asset_bytes",
      expect.objectContaining({ projectId: "proj-2", filename: "carta.png" }),
    );
  });

  it("persistPatch sostituisce URL remoto con path locale", async () => {
    invokeMock.mockResolvedValue({ id: "c", path: "C:\\x\\c.png" });
    const out = await persistPatch(
      { imageFront: "https://img/f.jpg", hasBack: false, provider: "scryfall", providerId: "p", setCode: "LTC", collectorNumber: "1" },
      "proj-3",
    );
    expect(out.imageFront).toBe("C:\\x\\c.png");
  });

  it("printOptionToPatch: sincrona, preferisce full > large > thumb", () => {
    expect(printOptionToPatch(OPT)).toMatchObject({
      imageFront: "https://f",
      imageBack: "https://b",
      hasBack: true,
      provider: "scryfall",
      providerId: "uuid-1",
    });
    expect(printOptionToPatch({ ...OPT, imageFull: undefined })).toMatchObject({ imageFront: "https://l" });
    expect(printOptionToPatch({ ...OPT, imageFull: undefined, imageLarge: undefined })).toMatchObject({ imageFront: "https://t" });
    expect(printOptionToPatch({ ...OPT, source: "mpc" }).provider).toBe("mpc");
  });

  it("printFaceToPatch: solo la faccia scelta", () => {
    expect(printFaceToPatch(OPT, "front")).toMatchObject({ imageFront: "https://f" });
    expect(printFaceToPatch(OPT, "front").imageBack).toBeUndefined();
    expect(printFaceToPatch(OPT, "back")).toMatchObject({ imageBack: "https://b", hasBack: true });
    expect(printFaceToPatch(OPT, "back").imageFront).toBeUndefined();
  });

  it("toDisplaySrc converte path locali, lascia URL invariati", () => {
    expect(toDisplaySrc("C:\\x\\a.png")).toBe("asset://localhost/C:\\x\\a.png");
    expect(toDisplaySrc("https://img/x.jpg")).toBe("https://img/x.jpg");
    expect(toDisplaySrc(undefined)).toBeUndefined();
  });

  it("toDisplaySrc mappa i download Drive su thumbnail inline", () => {
    const dl =
      "https://drive.usercontent.google.com/download?id=1N_OuG-pbkB4BBlvToRjVpJo6HyZYEJF1&export=download&confirm=t";
    expect(toDisplaySrc(dl)).toBe(
      "https://drive.google.com/thumbnail?id=1N_OuG-pbkB4BBlvToRjVpJo6HyZYEJF1&sz=w1000",
    );
  });

  it("persistPrintFace fronte: solo fronte persistito, retro intatto", async () => {
    invokeMock.mockResolvedValue({ id: "f", path: "C:\\x\\front.png" });
    const out = await persistPrintFace(
      {
        source: "scryfall", id: "u", name: "Delver", setCode: "MID", setName: "S",
        collectorNumber: "1", thumb: "https://img/t.jpg", imageLarge: "https://img/f.jpg",
        imageBack: "https://img/b.jpg", hasBack: true, highres: true,
      },
      "front",
      "proj-9",
    );
    expect(out.imageFront).toBe("C:\\x\\front.png");
    expect(out.imageBack).toBeUndefined();
    expect(out.providerId).toBe("u");
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("fetch_artwork", { projectId: "proj-9", url: "https://img/f.jpg" });
  });

  it("persistPrintFace retro: solo retro persistito + hasBack", async () => {
    invokeMock.mockResolvedValue({ id: "b", path: "C:\\x\\back.png" });
    const out = await persistPrintFace(
      {
        source: "scryfall", id: "u", name: "Delver", setCode: "MID", setName: "S",
        collectorNumber: "1", thumb: "https://img/t.jpg", imageLarge: "https://img/f.jpg",
        imageBack: "https://img/b.jpg", hasBack: true, highres: true,
      },
      "back",
      "proj-9",
    );
    expect(out.imageBack).toBe("C:\\x\\back.png");
    expect(out.imageFront).toBeUndefined();
    expect(out.hasBack).toBe(true);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("fetch_artwork", { projectId: "proj-9", url: "https://img/b.jpg" });
  });
});
