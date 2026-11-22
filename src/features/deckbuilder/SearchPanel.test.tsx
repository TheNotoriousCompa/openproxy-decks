import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SearchPanel } from "@/features/deckbuilder/SearchPanel";
import { useDeck } from "@/stores/deck";

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function hit(id: string, name: string, identity: string[] = ["R"], typeLine = "Creature") {
  return {
    id,
    name,
    set: "ltr",
    set_name: "Test",
    collector_number: "1",
    rarity: "rare",
    cmc: 2,
    type_line: typeLine,
    colors: identity,
    color_identity: identity,
    edhrec_rank: 100,
    prices: { usd: "0.50" },
    image_uris: { small: `https://img/${id}.jpg`, large: `https://img/${id}.jpg` },
  };
}

function mockFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/cards/named")) {
        return { status: 200, ok: true, json: async () => ({ color_identity: ["R", "G"] }) };
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({
          data: [
            hit("x1", "Dragon A", ["R"]),
            hit("x2", "Elf B", ["G"]),
            hit("x3", "Zombie C", ["B"]),
            hit("x4", "Plains D", ["W"], "Basic Land — Plains"),
          ],
          total_cards: 4,
          has_more: false,
        }),
      };
    }),
  );
}

function seedCommander(): void {
  useDeck.getState().hydrate([
    {
      id: "cmd-1",
      name: "Sauron, the Dark Lord",
      qty: 1,
      zone: "commander",
      provider: "scryfall",
      hasBack: false,
      sortOrder: 0,
    },
  ]);
}

describe("SearchPanel", () => {
  beforeEach(() => {
    mockFetch();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("consigliati: tab dedicata, filtra per identità, terre in fondo, quick-add", async () => {
    seedCommander();
    render(<SearchPanel />, { wrapper });

    // default: ricerca (non i consigliati)
    expect(screen.queryByText(/Top 100 per/)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Consigliati" }));

    // identità RG: Zombie C (B) escluso; Plains (W) esclusa; terre in fondo
    expect(await screen.findByTestId("hit-x1", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByTestId("hit-x2")).toBeInTheDocument();
    expect(screen.queryByTestId("hit-x3")).toBeNull();
    expect(screen.queryByTestId("hit-x4")).toBeNull();

    fireEvent.click(screen.getByTestId("hit-x1").querySelector("button") as HTMLElement);
    const added = useDeck.getState().deck.find((c) => c.name === "Dragon A");
    expect(added).toBeDefined();
    expect(added?.zone).toBe("main");
    expect(added?.qty).toBe(1);
  });

  it("standalone: tutta la larghezza, 4 colonne e hover per l'anteprima", async () => {
    seedCommander();
    const onHover = vi.fn();
    render(<SearchPanel standalone onHover={onHover} />, { wrapper });
    expect(screen.getByTestId("search-panel").className).toContain("w-full");
    expect(screen.getByTestId("search-panel").className).not.toContain("w-80");

    fireEvent.change(screen.getByTestId("cf-text"), { target: { value: "dragon" } });
    fireEvent.click(screen.getByTestId("cf-search"));
    const tile = await screen.findByTestId("hit-x1", {}, { timeout: 4000 });
    expect(tile.closest(".grid")?.className).toContain("grid-cols-4");
    fireEvent.mouseEnter(tile.querySelector("button") as HTMLElement);
    expect(onHover).toHaveBeenCalledWith(expect.objectContaining({ id: "x1", name: "Dragon A" }));
    // niente preview inline: ci pensa l'isola a destra
    expect(screen.queryByTestId("hit-preview")).toBeNull();
  });

  it("barra rapida: invio cerca e mostra risultati", async () => {
    seedCommander();
    render(<SearchPanel />, { wrapper });

    fireEvent.change(screen.getByTestId("cf-text"), { target: { value: "dragon" } });
    fireEvent.click(screen.getByTestId("cf-search"));
    expect(await screen.findByTestId("hit-x1", {}, { timeout: 4000 })).toBeInTheDocument();
    const calls = (fetch as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0] ?? "");
    const searchCall = calls.find((u) => u.includes("/cards/search")) ?? "";
    expect(searchCall).toContain("f%3Acommander");
    expect(searchCall).toContain("order=edhrec");
  });

  it("modale avanzata: tipo + colori + ordinamento", async () => {
    seedCommander();
    render(<SearchPanel />, { wrapper });

    fireEvent.click(screen.getByText("Ricerca avanzata"));
    expect(screen.getByTestId("adv-modal")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("adv-type"), { target: { value: "creature" } });
    fireEvent.click(screen.getByTestId("adv-color-R"));
    fireEvent.click(screen.getByTestId("adv-color-G"));
    fireEvent.click(screen.getByTestId("adv-search"));

    expect(await screen.findByTestId("hit-x1", {}, { timeout: 4000 })).toBeInTheDocument();
    const calls = (fetch as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0] ?? "");
    const searchCall = calls.filter((u) => u.includes("/cards/search")).pop() ?? "";
    expect(searchCall).toContain("t%3Acreature");
    expect(searchCall).toContain("c%3Ar");
    expect(searchCall).toContain("c%3Ag");
  });
});
