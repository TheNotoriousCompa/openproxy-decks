import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePrintBuilder } from "@/features/print/usePrintBuilder";
import { useDeck } from "@/stores/deck";
import { usePrint, DEFAULT_PRINT } from "@/stores/print";
import { useProjects } from "@/stores/projects";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

function seedDuplexDuplex(): void {
  useProjects.setState({ projects: [], activeId: "p1" });
  usePrint.getState().hydrate({
    ...DEFAULT_PRINT,
    guides: { ...DEFAULT_PRINT.guides },
    duplex: "separate",
    guideWidthPt: 1,
    guidePlacement: "inside",
    guideLengthMm: 2,
    guideStyle: "dashed",
    guideCap: "round",
    guideShape: "cross",
    guideOffsetMm: 0.25,
  });
  useDeck.getState().hydrate([
    {
      id: "dfc1", name: "Delver", qty: 2, zone: "main", provider: "custom",
      imageFront: "https://img/f.jpg", imageBack: "https://img/b.jpg",
      hasBack: true, sortOrder: 0,
    },
    {
      id: "s1", name: "Bolt", qty: 1, zone: "main", provider: "custom",
      imageFront: "https://img/bolt.jpg", hasBack: false, sortOrder: 1,
    },
  ]);
}

describe("usePrintBuilder export duplex + retri", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useDeck.getState().hydrate([]);
  });

  it("inventa back_src_path + duplex e riporta i retri nello status", async () => {
    seedDuplexDuplex();
    vi.mocked(invoke)
      .mockResolvedValueOnce("/tmp/exports")
      .mockResolvedValueOnce({
        path: "/tmp/exports/print.pdf", pages: 2, unique_assets: 3,
        total_copies: 3, bytes: 100, skipped: 0, skipped_names: [],
        back_pages: 1, backs_printed: 2, backs_missing: 0,
        upscaled: 0, upscaled_ai: 0,
      })
      .mockResolvedValueOnce({
        pages: 2, images: [], nominal_w_mm: 63, nominal_h_mm: 88,
        tol_pct: 0.5, pass: true, worst_dev_pct: 0, summary: "ok",
      });
    const { result } = renderHook(() => usePrintBuilder());
    await act(async () => {
      await result.current.exportPdf();
    });
    const pdfCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "export_pdf");
    expect(pdfCall).toBeDefined();
    const pdfArgs = (pdfCall?.[1] as { args: Record<string, unknown> }).args;
    expect(pdfArgs["duplex"]).toBe("separate");
    // Parità guide preview→PDF (A2): i valori UI arrivano al backend;
    // taglio sempre nero, crocini col colore scelto (default verde)
    expect(pdfArgs).toMatchObject({
      guide_width_pt: 1,
      guide_placement: "inside",
      guide_length_mm: 2,
      guide_style: "dashed",
      guide_cap: "round",
      guide_shape: "cross",
      guide_offset_mm: 0.25,
      guide_page_lines: false,
      guide_color: "#000000",
      crop_color: "#00ff00",
      brightness_pct: 0,
      margin_top_mm: 3,
      margin_right_mm: 3,
      margin_bottom_mm: 3,
      margin_left_mm: 3,
      spacing_row_mm: 0,
      spacing_col_mm: 0,
    });
    const cards = pdfArgs["cards"] as Record<string, unknown>[];
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      src_path: "https://img/f.jpg",
      qty: 2,
      zone: "main",
      back_src_path: "https://img/b.jpg",
    });
    expect(cards[1]).toMatchObject({ src_path: "https://img/bolt.jpg", qty: 1 });
    expect(cards[1]?.["back_src_path"]).toBeUndefined();
    expect(result.current.status).toContain("retro: 2 copie su 1 pagine");
    expect(result.current.lastPdf?.path).toBe("/tmp/exports/print.pdf");
  });

  it("comandante accorpato al main + flag considering", async () => {
    useProjects.setState({ projects: [], activeId: "p1" });
    usePrint.getState().hydrate({
      ...DEFAULT_PRINT,
      guides: { ...DEFAULT_PRINT.guides },
      includeConsidering: false,
    });
    useDeck.getState().hydrate([
      { id: "m1", name: "Bolt", qty: 1, zone: "main", provider: "custom", imageFront: "https://img/bolt.jpg", hasBack: false, sortOrder: 0 },
      { id: "c1", name: "Sauron", qty: 1, zone: "commander", provider: "custom", imageFront: "https://img/sauron.jpg", hasBack: false, sortOrder: 1 },
      { id: "w1", name: "Cultivate", qty: 1, zone: "considering", provider: "custom", imageFront: "https://img/cult.jpg", hasBack: false, sortOrder: 2 },
    ]);
    const mockRes = {
      path: "/tmp/exports/print.pdf", pages: 1, unique_assets: 2,
      total_copies: 2, bytes: 100, skipped: 0, skipped_names: [],
      back_pages: 0, backs_printed: 0, backs_missing: 0,
      upscaled: 0, upscaled_ai: 0,
    };
    vi.mocked(invoke)
      .mockResolvedValueOnce("/tmp/exports")
      .mockResolvedValueOnce(mockRes)
      .mockResolvedValueOnce({
        pages: 1, images: [], nominal_w_mm: 63, nominal_h_mm: 88,
        tol_pct: 0.5, pass: true, worst_dev_pct: 0, summary: "ok",
      });
    const { result } = renderHook(() => usePrintBuilder());
    // anteprima: flusso continuo (comandante nel main, 2 carte), considering esclusa
    expect(result.current.flow.copies).toHaveLength(2);
    expect(result.current.flow.copies.map((c) => c.zone)).toEqual(["main", "main"]);
    expect(result.current.flow.layout.pages).toBe(1);
    expect(result.current.flow.counts).toEqual([
      { zone: "main", label: "Main Deck", copies: 2, entries: 2 },
    ]);
    await act(async () => {
      await result.current.exportPdf();
    });
    const pdfCall = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "export_pdf");
    const pdfArgs = (pdfCall?.[1] as { args: Record<string, unknown> }).args;
    const cards = pdfArgs["cards"] as Record<string, unknown>[];
    // comandante con zona main, considering assente col flag spento
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ src_path: "https://img/bolt.jpg", zone: "main" });
    expect(cards[1]).toMatchObject({ src_path: "https://img/sauron.jpg", zone: "main" });

    // flag acceso: considering inclusa con la sua zona
    usePrint.getState().hydrate({
      ...DEFAULT_PRINT,
      guides: { ...DEFAULT_PRINT.guides },
      includeConsidering: true,
    });
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke)
      .mockResolvedValueOnce("/tmp/exports")
      .mockResolvedValueOnce({ ...mockRes, pages: 2, total_copies: 3, unique_assets: 3 })
      .mockResolvedValueOnce({
        pages: 2, images: [], nominal_w_mm: 63, nominal_h_mm: 88,
        tol_pct: 0.5, pass: true, worst_dev_pct: 0, summary: "ok",
      });
    const second = renderHook(() => usePrintBuilder());
    await act(async () => {
      await second.result.current.exportPdf();
    });
    const pdfCall2 = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "export_pdf");
    const cards2 = ((pdfCall2?.[1] as { args: Record<string, unknown> }).args["cards"]) as Record<string, unknown>[];
    expect(cards2).toHaveLength(3);
    expect(cards2[2]).toMatchObject({ src_path: "https://img/cult.jpg", zone: "considering" });
  });
});
