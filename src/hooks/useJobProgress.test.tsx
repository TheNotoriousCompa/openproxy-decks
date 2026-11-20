import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { phaseOf, useJobProgress } from "@/hooks/useJobProgress";

const { listenMock } = vi.hoisted(() => ({ listenMock: vi.fn() }));

vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

describe("useJobProgress", () => {
  it("mappa le fasi del backend in italiano", () => {
    expect(phaseOf("processing")).toBe("Elaborazione immagini…");
    expect(phaseOf("layout")).toBe("Impaginazione…");
    expect(phaseOf("done")).toBe("Scrittura PDF…");
  });

  it("start registra l'evento e aggiorna frazione/fase; stop rimuove", async () => {
    const unlisten = vi.fn();
    let handler: ((e: { payload: { progress: number; status: string } }) => void) | undefined;
    listenMock.mockImplementation(async (_evt: string, cb: typeof handler) => {
      handler = cb;
      return unlisten;
    });
    const { result } = renderHook(() => useJobProgress());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.progress).toEqual({ frac: 0, phase: "Preparazione…" });
    act(() => handler?.({ payload: { progress: 0.4, status: "processing" } }));
    expect(result.current.progress).toEqual({ frac: 0.4, phase: "Elaborazione immagini…" });
    act(() => handler?.({ payload: { progress: 0.9, status: "layout" } }));
    expect(result.current.progress).toEqual({ frac: 0.9, phase: "Impaginazione…" });
    act(() => result.current.stop());
    expect(unlisten).toHaveBeenCalled();
  });

  it("in browser (listen fallisce) non solleva", async () => {
    listenMock.mockRejectedValueOnce(new Error("no tauri"));
    const { result } = renderHook(() => useJobProgress());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.progress).toEqual({ frac: 0, phase: "Preparazione…" });
  });
});
