import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SourceFilterPanel } from "@/components/SourceFilterPanel";
import { useSettings } from "@/stores/settings";

vi.mock("@/services/mpc", () => ({
  getMpcSources: vi.fn(async () => [
    { pk: 1, key: "alt", name: "Altra Fonte" },
    { pk: 10, key: "trix", name: "Trix Are For Scoot" },
  ]),
  getMpcTags: vi.fn(async () => [
    { name: "AI Art", parent: "Custom Art", aliases: ["AI", "Midjourney"] },
    { name: "Pixel Art", parent: "Altered Art", aliases: ["Pixelated"] },
  ]),
}));

vi.mock("@/services/cardfinder", () => ({
  listScryfallSets: vi.fn(async () => [
    {
      code: "ltr",
      name: "The Lord of the Rings",
      setType: "expansion",
      releasedAt: "2023-06-23",
      cardCount: 3,
    },
  ]),
}));

describe("SourceFilterPanel", () => {
  beforeEach(() => {
    useSettings.setState({ excluded: { sources: [], tags: [], sets: [] } });
  });

  it("drive MPC: la casella aggiunge e toglie la fonte", async () => {
    render(<SourceFilterPanel server="https://mpcfill.com" />);
    const row = await screen.findByLabelText("Escludi Trix Are For Scoot");
    fireEvent.click(row);
    await waitFor(() =>
      expect(useSettings.getState().excluded.sources).toEqual(["Trix Are For Scoot"]),
    );
    expect(screen.getByTestId("source-filter-count").textContent).toContain("1 esclusi");

    fireEvent.click(screen.getByLabelText("Escludi Trix Are For Scoot"));
    await waitFor(() => expect(useSettings.getState().excluded.sources).toEqual([]));
  });

  it("tag MPC: il suggerimento AI Art è a un click", async () => {
    render(<SourceFilterPanel server="https://mpcfill.com" />);
    fireEvent.click(await screen.findByTestId("source-filter-tab-tags"));
    fireEvent.click(await screen.findByTestId("source-filter-suggest-ai"));
    await waitFor(() => expect(useSettings.getState().excluded.tags).toEqual(["AI Art"]));
    // escluso il tag, il suggerimento sparisce
    expect(screen.queryByTestId("source-filter-suggest-ai")).toBeNull();
    // e la riga dell'albero risulta spuntata
    expect((await screen.findByLabelText("Escludi AI Art") as HTMLInputElement).checked).toBe(true);
  });

  it("set MTG: codice salvato minuscolo", async () => {
    render(<SourceFilterPanel server="https://mpcfill.com" />);
    fireEvent.click(await screen.findByTestId("source-filter-tab-sets"));
    fireEvent.click(await screen.findByLabelText("Escludi The Lord of the Rings (LTR)"));
    await waitFor(() => expect(useSettings.getState().excluded.sets).toEqual(["ltr"]));
  });

  it("ricerca: filtra la lista per nome", async () => {
    render(<SourceFilterPanel server="https://mpcfill.com" />);
    await screen.findByLabelText("Escludi Trix Are For Scoot");
    fireEvent.change(screen.getByTestId("source-filter-search"), { target: { value: "trix" } });
    expect(screen.queryByLabelText("Escludi Altra Fonte")).toBeNull();
    expect(screen.getByLabelText("Escludi Trix Are For Scoot")).toBeTruthy();
  });

  it("ripristina: svuota solo la lista del tab attivo", async () => {
    useSettings.setState({
      excluded: { sources: ["Trix Are For Scoot"], tags: ["AI Art"], sets: ["ltr"] },
    });
    render(<SourceFilterPanel server="https://mpcfill.com" />);
    await screen.findByLabelText("Escludi Trix Are For Scoot");
    fireEvent.click(screen.getByTestId("source-filter-clear"));
    await waitFor(() => expect(useSettings.getState().excluded).toEqual({ sources: [], tags: ["AI Art"], sets: ["ltr"] }));
  });

  it("server MPC assente: i drive non si possono gestire, i set sì", async () => {
    render(<SourceFilterPanel server="" />);
    // con server vuoto si parte dalla tab set (l'unica utile)
    expect(await screen.findByLabelText("Escludi The Lord of the Rings (LTR)")).toBeTruthy();
    fireEvent.click(screen.getByTestId("source-filter-tab-tags"));
    expect(screen.getByText(/Configura l'URL del server MPC/)).toBeTruthy();
  });
});
