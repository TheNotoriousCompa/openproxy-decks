import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useArtworkSrc } from "@/hooks/useArtwork";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

vi.mock("@/services/backend", () => ({
  backend: { isTauri: true },
}));

describe("useArtworkSrc data-url", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });
  it("remoto in app → thumb_data_url e src data:", async () => {
    invokeMock.mockResolvedValueOnce({ data_url: "data:image/jpeg;base64,AAA", width: 100, height: 140 });
    const { result } = renderHook(() => useArtworkSrc("https://img/x.jpg"));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.src).toBe("data:image/jpeg;base64,AAA");
    expect(invokeMock).toHaveBeenCalledWith("thumb_data_url", { url: "https://img/x.jpg", maxPx: 512 });
  });

  it("fallback a remoto diretto se il backend fallisce", async () => {
    invokeMock.mockRejectedValueOnce(new Error("nope"));
    const { result } = renderHook(() => useArtworkSrc("https://img/y.jpg"));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.src).toBe("https://img/y.jpg");
    expect(result.current.detail).toContain("thumb backend fallita");
  });

  it("file locale in app → thumb_data_url (mai asset:// diretto)", async () => {
    invokeMock.mockResolvedValueOnce({ data_url: "data:image/jpeg;base64,BBB", width: 90, height: 126 });
    const { result } = renderHook(() => useArtworkSrc("C:\\x\\asset abc.png"));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.src).toBe("data:image/jpeg;base64,BBB");
    expect(invokeMock).toHaveBeenCalledWith(
      "thumb_data_url",
      expect.objectContaining({ url: "C:\\x\\asset abc.png" }),
    );
  });

  it("blob → errore sessione, data: → ok diretto", async () => {
    const { result: r1 } = renderHook(() => useArtworkSrc("blob:https://x/1"));
    expect(r1.current.status).toBe("error");
    const { result: r2 } = renderHook(() => useArtworkSrc("data:image/png;base64,AAA"));
    expect(r2.current.status).toBe("ok");
    expect(r2.current.src).toBe("data:image/png;base64,AAA");
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
