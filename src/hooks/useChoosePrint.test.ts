import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChoosePrint } from "@/hooks/useChoosePrint";
import { useDeck } from "@/stores/deck";
import { persistPrintOption, persistPrintFace } from "@/services/images";
import type { PrintOption } from "@/types";

vi.mock("@/services/images", () => ({
  printOptionToPatch: (opt: {
    imageFull?: string; imageLarge?: string; thumb?: string; imageBack?: string;
    hasBack: boolean; source: string; id: string; setCode: string; collectorNumber: string;
  }) => ({
    imageFront: opt.imageFull ?? opt.imageLarge ?? opt.thumb,
    imageBack: opt.imageBack,
    hasBack: opt.hasBack,
    provider: opt.source === "mpc" ? "mpc" : "scryfall",
    providerId: opt.id,
    setCode: opt.setCode,
    collectorNumber: opt.collectorNumber,
  }),
  printFaceToPatch: (opt: {
    imageFull?: string; imageLarge?: string; thumb?: string; imageBack?: string;
    source: string; id: string; setCode: string; collectorNumber: string;
  }, face: "front" | "back") =>
    face === "front"
      ? {
          imageFront: opt.imageFull ?? opt.imageLarge ?? opt.thumb,
          provider: opt.source === "mpc" ? "mpc" : "scryfall",
          providerId: opt.id,
          setCode: opt.setCode,
          collectorNumber: opt.collectorNumber,
        }
      : {
          imageBack: opt.imageBack ?? opt.imageFull ?? opt.imageLarge ?? opt.thumb,
          hasBack: true,
          provider: opt.source === "mpc" ? "mpc" : "scryfall",
          providerId: opt.id,
          setCode: opt.setCode,
          collectorNumber: opt.collectorNumber,
        },
  persistPrintOption: vi.fn(async () => ({
    imageFront: "C:/assets/new-print.jpg",
    hasBack: false,
    provider: "scryfall" as const,
    providerId: "uuid-new",
    setCode: "M11",
    collectorNumber: "146",
  })),
  persistPrintFace: vi.fn(async () => ({
    imageBack: "C:/assets/new-back.jpg",
    hasBack: true,
    provider: "scryfall" as const,
    providerId: "uuid-back",
    setCode: "MID",
    collectorNumber: "1",
  })),
}));

vi.mock("@/stores/projects", () => ({
  useProjects: { getState: () => ({ activeId: "p1" }) },
}));

const OPT: PrintOption = {
  source: "scryfall", id: "uuid-new", name: "Swamp", setCode: "M11", setName: "Core",
  collectorNumber: "146", thumb: "https://t", imageLarge: "https://l", hasBack: false, highres: true,
};

function seedDeck(): { a: string; b: string; other: string } {
  useDeck.getState().hydrate([
    { id: "a", name: " Swamp ", qty: 2, zone: "main", provider: "custom", hasBack: false, sortOrder: 0 },
    { id: "b", name: "swamp", qty: 1, zone: "side", provider: "custom", hasBack: false, sortOrder: 1 },
    { id: "other", name: "Forest", qty: 1, zone: "main", provider: "custom", hasBack: false, sortOrder: 2 },
  ]);
  return { a: "a", b: "b", other: "other" };
}

describe("useChoosePrint apply-all", () => {
  beforeEach(() => {
    vi.mocked(persistPrintOption).mockClear();
    vi.mocked(persistPrintFace).mockClear();
    useDeck.getState().hydrate([]);
  });

  it("picker riporta peerIds e totalCopies (3 = 2+1, tutte le zone)", () => {
    seedDeck();
    const { result } = renderHook(() => useChoosePrint());
    act(() => result.current.openPicker("a", " Swamp "));
    expect(result.current.picker).toMatchObject({ id: "a", peerIds: ["b"], totalCopies: 3 });
  });

  it("scope entry + applyAll=false patcha la voce intera (qty invariato, niente split)", async () => {
    seedDeck();
    const { result } = renderHook(() => useChoosePrint());
    act(() => result.current.openPicker("a", " Swamp ", undefined, "entry"));
    await act(async () => {
      await result.current.choosePrint(OPT, false);
    });
    const deck = useDeck.getState().deck;
    expect(deck).toHaveLength(3);
    expect(deck.find((c) => c.id === "a")).toMatchObject({ qty: 2, imageFront: "C:/assets/new-print.jpg" });
    expect(deck.find((c) => c.id === "b")?.imageFront).toBeUndefined();
    expect(deck.find((c) => c.id === "other")?.imageFront).toBeUndefined();
  });

  it("scope copy + applyAll=false stacca UNA sola copia (il bug: prima cambiavano tutte)", async () => {
    seedDeck();
    const { result } = renderHook(() => useChoosePrint());
    const pastBefore = useDeck.getState().past.length;
    act(() => result.current.openPicker("a", " Swamp ", undefined, "copy"));
    await act(async () => {
      await result.current.choosePrint(OPT, false);
    });
    const deck = useDeck.getState().deck;
    // 4 copie totali: a qty 2→1 invariata + clone qty 1 con la nuova stampa
    expect(deck.reduce((n, c) => n + c.qty, 0)).toBe(4);
    expect(deck.find((c) => c.id === "a")?.qty).toBe(1);
    expect(deck.find((c) => c.id === "a")?.imageFront).toBeUndefined();
    const patched = deck.filter((c) => c.imageFront === "C:/assets/new-print.jpg");
    expect(patched).toHaveLength(1);
    expect(patched[0]?.qty).toBe(1);
    expect(deck.find((c) => c.id === "b")?.imageFront).toBeUndefined();
    expect(useDeck.getState().past.length).toBe(pastBefore + 1);
    useDeck.getState().undo();
    expect(useDeck.getState().deck.find((c) => c.id === "a")).toMatchObject({ qty: 2 });
  });

  it("scope copy + applyAll=false su qty=1 patcha in place senza split", async () => {
    seedDeck();
    const { result } = renderHook(() => useChoosePrint());
    act(() => result.current.openPicker("b", "swamp", undefined, "copy"));
    await act(async () => {
      await result.current.choosePrint(OPT, false);
    });
    const deck = useDeck.getState().deck;
    expect(deck).toHaveLength(3);
    expect(deck.find((c) => c.id === "b")?.imageFront).toBe("C:/assets/new-print.jpg");
    expect(deck.find((c) => c.id === "a")?.imageFront).toBeUndefined();
  });

  it("chooseFacePrint retro tocca solo il retro (fronte intatto)", async () => {
    useDeck.getState().hydrate([
      { id: "d", name: "Delver", qty: 1, zone: "main", provider: "custom", imageFront: "https://img/old-f.jpg", hasBack: false, sortOrder: 0 },
    ]);
    const { result } = renderHook(() => useChoosePrint());
    act(() => result.current.openPicker("d", "Delver", undefined, "entry"));
    await act(async () => {
      await result.current.chooseFacePrint(OPT, "back", false);
    });
    const card = useDeck.getState().deck.find((c) => c.id === "d");
    expect(card?.imageBack).toBe("C:/assets/new-back.jpg");
    expect(card?.imageFront).toBe("https://img/old-f.jpg");
    // providerId/metadata già corretti dall'apply ottimistico (== opt.id reale)
    expect(card?.providerId).toBe("uuid-new");
  });

  it("chooseFacePrint rispetta scope copy (split) e applyAll", async () => {
    seedDeck();
    const { result } = renderHook(() => useChoosePrint());
    act(() => result.current.openPicker("a", " Swamp ", undefined, "copy"));
    await act(async () => {
      await result.current.chooseFacePrint(OPT, "back", false);
    });
    const deck = useDeck.getState().deck;
    // a qty2 → staccata una copia col retro nuovo, l'altra intatta
    expect(deck.reduce((n, c) => n + c.qty, 0)).toBe(4);
    expect(deck.filter((c) => c.imageBack === "C:/assets/new-back.jpg")).toHaveLength(1);
  });

  it("chiusura sincrona + swap background senza undo extra", async () => {
    seedDeck();
    let resolvePersist!: (v: unknown) => void;
    vi.mocked(persistPrintOption).mockImplementationOnce(
      () => new Promise((res) => { resolvePersist = res as (v: unknown) => void; }),
    );
    const { result } = renderHook(() => useChoosePrint());
    act(() => result.current.openPicker("b", "swamp", undefined, "entry"));
    const pastBefore = useDeck.getState().past.length;
    // choose chiude SUBITO, senza aspettare il download
    act(() => {
      result.current.choosePrint(OPT, false);
    });
    expect(result.current.picker).toBeNull();
    // patch ottimistica (URL remoto) già applicata
    expect(useDeck.getState().deck.find((c) => c.id === "b")?.imageFront).toBe("https://l");
    expect(useDeck.getState().past.length).toBe(pastBefore + 1);
    // la cella mostra lo spinner finché il download non è finito
    expect(result.current.pendingIds).toEqual(["b"]);
    // il download finisce dopo: swap silenzioso al path locale, nessun undo extra
    await act(async () => {
      resolvePersist({
        imageFront: "C:/assets/new-print.jpg",
        hasBack: false,
        provider: "scryfall",
        providerId: "uuid-new",
        setCode: "M11",
        collectorNumber: "146",
      });
    });
    expect(useDeck.getState().deck.find((c) => c.id === "b")?.imageFront).toBe("C:/assets/new-print.jpg");
    expect(useDeck.getState().past.length).toBe(pastBefore + 1);
    // spinner via e conferma pronta
    expect(result.current.pendingIds).toEqual([]);
    expect(result.current.printJob?.phase).toBe("done");
  });

  it("undo prima del download: lo swap viene saltato", async () => {
    seedDeck();
    let resolvePersist!: (v: unknown) => void;
    vi.mocked(persistPrintOption).mockImplementationOnce(
      () => new Promise((res) => { resolvePersist = res as (v: unknown) => void; }),
    );
    const { result } = renderHook(() => useChoosePrint());
    act(() => result.current.openPicker("b", "swamp", undefined, "entry"));
    act(() => {
      result.current.choosePrint(OPT, false);
    });
    expect(useDeck.getState().deck.find((c) => c.id === "b")?.imageFront).toBe("https://l");
    act(() => useDeck.getState().undo());
    expect(useDeck.getState().deck.find((c) => c.id === "b")?.imageFront).toBeUndefined();
    await act(async () => {
      resolvePersist({
        imageFront: "C:/assets/new-print.jpg",
        hasBack: false,
        provider: "scryfall",
        providerId: "uuid-new",
        setCode: "M11",
        collectorNumber: "146",
      });
    });
    // niente re-applicazione dopo undo
    expect(useDeck.getState().deck.find((c) => c.id === "b")?.imageFront).toBeUndefined();
  });

  it("applyAll=true aggiorna tutte le omonime con UN solo undo", async () => {
    seedDeck();
    const { result } = renderHook(() => useChoosePrint());
    const pastBefore = useDeck.getState().past.length;
    act(() => result.current.openPicker("a", " Swamp "));
    await act(async () => {
      await result.current.choosePrint(OPT, true);
    });
    const deck = useDeck.getState().deck;
    expect(deck.find((c) => c.id === "a")?.imageFront).toBe("C:/assets/new-print.jpg");
    expect(deck.find((c) => c.id === "b")?.imageFront).toBe("C:/assets/new-print.jpg");
    expect(deck.find((c) => c.id === "other")?.imageFront).toBeUndefined();
    // un solo snapshot
    expect(useDeck.getState().past.length).toBe(pastBefore + 1);
    // un undo ripristina entrambe
    act(() => useDeck.getState().undo());
    expect(useDeck.getState().deck.find((c) => c.id === "a")?.imageFront).toBeUndefined();
    expect(useDeck.getState().deck.find((c) => c.id === "b")?.imageFront).toBeUndefined();
    await waitFor(() => expect(result.current.pickerBusy).toBe(false));
  });
});
