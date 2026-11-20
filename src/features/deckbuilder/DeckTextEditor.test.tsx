import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeckTextEditor } from "@/features/deckbuilder/DeckTextEditor";
import { useDeck } from "@/stores/deck";
import type { CardEntry } from "@/types";

const MPC_A = `1${"A".repeat(32)}`;
const MPC_B = `1${"B".repeat(32)}`;

function seed(): void {
  useDeck.getState().hydrate([
    {
      id: "e-bolt",
      name: "Lightning Bolt",
      qty: 2,
      zone: "main",
      provider: "custom",
      hasBack: false,
      sortOrder: 0,
    } as CardEntry,
    {
      id: "e-neg",
      name: "Negate",
      qty: 1,
      zone: "side",
      provider: "custom",
      hasBack: false,
      sortOrder: 1,
    } as CardEntry,
  ]);
}

describe("DeckTextEditor", () => {
  beforeEach(() => {
    // niente rete: artwork mai trovato, enrich immediato
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 404, ok: false, json: async () => ({}) })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unisci: aggiorna omonime con MPC ID e aggiunge le nuove", () => {
    seed();
    render(<DeckTextEditor />);

    fireEvent.change(screen.getByTestId("deck-text-area"), {
      target: { value: `4 Lightning Bolt (mpc:${MPC_A})\n1 Sol Ring (mpc:${MPC_B})\n` },
    });
    fireEvent.click(screen.getByTestId("deck-text-apply"));

    expect(screen.getByTestId("deck-text-report")).toHaveTextContent("1 aggiornate, 1 nuove");
    const deck = useDeck.getState().deck;
    // Negate resta, Bolt aggiornata, Sol Ring aggiunta
    expect(deck).toHaveLength(3);
    const bolt = deck.find((c) => c.name === "Lightning Bolt");
    expect(bolt?.qty).toBe(4);
    expect(bolt?.provider).toBe("mpc");
    expect(bolt?.providerId).toBe(MPC_A);
    expect(bolt?.imageFront).toContain("drive");
    const ring = deck.find((c) => c.name === "Sol Ring");
    expect(ring?.provider).toBe("mpc");
    expect(ring?.zone).toBe("main");
  });

  it("sostituisci: rimpiazza l'intera lista", () => {
    seed();
    render(<DeckTextEditor />);

    fireEvent.click(screen.getByRole("button", { name: "Sostituisci" }));
    fireEvent.change(screen.getByTestId("deck-text-area"), {
      target: { value: `Sideboard\n2 Negate\n` },
    });
    fireEvent.click(screen.getByTestId("deck-text-apply"));

    // Negate senza MPC → enrich in background (fetch reale): report intermedio
    expect(screen.getByTestId("deck-text-report")).toHaveTextContent("Lista sostituita: 1 voci");
    const deck = useDeck.getState().deck;
    expect(deck).toHaveLength(1);
    expect(deck[0]?.name).toBe("Negate");
    expect(deck[0]?.zone).toBe("side");
    expect(deck[0]?.qty).toBe(2);
  });
});
