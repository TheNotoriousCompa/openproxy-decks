import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeckStats } from "@/features/deckbuilder/DeckStats";
import type { CardEntry } from "@/types";

function entry(partial: Partial<CardEntry> & { name: string }): CardEntry {
  return {
    id: `s-${partial.name}`,
    qty: 1,
    zone: "main",
    provider: "scryfall",
    hasBack: false,
    sortOrder: 0,
    ...partial,
  } as CardEntry;
}

const META: Record<string, Record<string, unknown>> = {
  "lightning bolt": {
    type_line: "Instant",
    mana_cost: "{R}",
    cmc: 1,
    colors: ["R"],
    color_identity: ["R"],
    prices: { usd: "0.25" },
    rarity: "common",
  },
  forest: {
    type_line: "Basic Land — Forest",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: ["G"],
    prices: { usd: "0.10" },
    rarity: "common",
  },
};

describe("DeckStats", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        status: 200,
        ok: true,
        json: async () => {
          const m = url.match(/exact=([^&]+)/);
          const name = m?.[1] ? decodeURIComponent(m[1]).toLowerCase() : "";
          const meta = META[name];
          if (!meta) return { status: 404 };
          return meta;
        },
      })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("curva, colori, totale prezzo e media", async () => {
    render(
      <DeckStats
        deck={[
          entry({ name: "Lightning Bolt", qty: 4 }),
          entry({ name: "Forest", qty: 2, zone: "main" }),
        ]}
      />,
    );
    // curva: bucket 1 = 4 copie
    const bucket = await screen.findByTestId("curve-1", {}, { timeout: 5000 });
    expect(bucket).toHaveAttribute("title", "1: 4");
    // totale: 4×0.25 + 2×0.10 = $1.20 su 2 voci
    expect(await screen.findByText("$1.20", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(/\(2\/2 voci\)/)).toBeInTheDocument();
    // riepilogo testata: 2 terre · CMC medio 1.0
    expect(screen.getByText(/2 terre/)).toBeInTheDocument();
    expect(screen.getByText(/CMC medio 1\.0/)).toBeInTheDocument();
  });
});
