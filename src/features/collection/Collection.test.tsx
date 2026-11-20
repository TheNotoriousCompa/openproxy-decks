import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CollectionView } from "@/features/collection/CollectionView";
import { CollectPrompt } from "@/features/collection/CollectPrompt";
import { useCollection } from "@/stores/collection";
import { useProjects } from "@/stores/projects";
import { putMeta } from "@/lib/cardmetaCache";
import type { Project } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "collection_list") return [];
    if (cmd === "collection_add") return args?.items ?? [];
    if (cmd === "collection_set_qty") return [];
    if (cmd === "collection_remove") return [];
    if (cmd === "collection_clear") return [];
    return [];
  }),
}));

function project(id: string, name: string, deck: Project["manifest"]["deck"]): Project {
  return {
    id,
    name,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    manifest: { version: 1, deck, print: {} as Project["manifest"]["print"] },
  };
}

describe("CollectionView", () => {
  beforeEach(() => {
    localStorage.clear();
    // tipi noti senza rete (stessa cache del DeckBuilder)
    putMeta({ name: "Sol Ring", setCode: "ltr" }, { typeLine: "Artifact" }, true);
    putMeta({ name: "Negate" }, { typeLine: "Instant" }, true);
    useCollection.setState({ entries: [], loaded: true, loading: false });
    useProjects.setState({ projects: [], activeId: null });
  });

  it("totali, ricerca e stepper quantità", async () => {
    useCollection.setState({
      entries: [
        { key: "sol ring‖ltr‖1", name: "Sol Ring", setCode: "ltr", collectorNumber: "1", qty: 3, addedAt: "2026-01-02" },
        { key: "negate‖‖", name: "Negate", setCode: "", collectorNumber: "", qty: 1, addedAt: "2026-01-01" },
      ],
      loaded: true,
      loading: false,
    });
    render(<CollectionView />);
    expect(screen.getByTestId("collection-totals")).toHaveTextContent("2 stampe · 4 proxy");
    fireEvent.change(screen.getByTestId("collection-search"), { target: { value: "sol" } });
    expect(screen.queryByTestId("collection-tile-negate‖‖")).toBeNull();
    expect(screen.getByTestId("collection-tile-sol ring‖ltr‖1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("collection-inc-sol ring‖ltr‖1"));
    await waitFor(() => expect(screen.getByTestId("collection-qty-sol ring‖ltr‖1")).toHaveTextContent("4"));
  });

  it("mancanti per progetto + aggiunta mancanti", async () => {
    useProjects.setState({
      projects: [
        project("p1", "Krenko", [
          { id: "c1", name: "Sol Ring", qty: 4, zone: "main", provider: "custom", setCode: "LTR", collectorNumber: "1", hasBack: false, sortOrder: 0 },
          { id: "c2", name: "Bolt", qty: 2, zone: "main", provider: "custom", hasBack: false, sortOrder: 1 },
        ]),
      ],
    });
    useCollection.setState({
      entries: [
        { key: "sol ring‖ltr‖1", name: "Sol Ring", setCode: "ltr", collectorNumber: "1", qty: 1, addedAt: "" },
      ],
      loaded: true,
      loading: false,
    });
    render(<CollectionView />);
    fireEvent.change(screen.getByTestId("collection-missing-project"), { target: { value: "p1" } });
    expect(screen.getByTestId("collection-missing-list")).toHaveTextContent("hai 1 · servono 4");
    expect(screen.getByTestId("collection-missing-list")).toHaveTextContent("Bolt");
    fireEvent.click(screen.getByTestId("collection-add-missing"));
    await waitFor(() =>
      expect(screen.getByTestId("collection-missing-done")).toHaveTextContent("è completo"),
    );
  });

  it("artwork e tipo per riga (solo display)", async () => {
    useProjects.setState({
      projects: [
        project("p1", "Krenko", [
          { id: "c1", name: "Sol Ring", qty: 4, zone: "main", provider: "custom", setCode: "LTR", collectorNumber: "1", imageFront: "https://img/solring.jpg", hasBack: false, sortOrder: 0 },
        ]),
      ],
    });
    useCollection.setState({
      entries: [
        { key: "sol ring‖ltr‖1", name: "Sol Ring", setCode: "ltr", collectorNumber: "1", qty: 4, addedAt: "" },
        { key: "negate‖‖", name: "Negate", setCode: "", collectorNumber: "", qty: 1, addedAt: "" },
      ],
      loaded: true,
      loading: false,
    });
    const { container } = render(<CollectionView />);
    // tipo risolto dalla cache condivisa col DeckBuilder
    expect(screen.getByTestId("collection-type-sol ring‖ltr‖1")).toHaveTextContent("Artifact");
    expect(screen.getByTestId("collection-type-negate‖‖")).toHaveTextContent("Instant");
    // artwork dal progetto (stessa stampa), mai un picker
    const solImg = container.querySelector('img[alt="Sol Ring"]');
    expect(solImg?.getAttribute("src")).toBe("https://img/solring.jpg");
    // senza match locale: ripiego Scryfall, comunque display
    const negateImg = container.querySelector('img[alt="Negate"]');
    expect(negateImg?.getAttribute("src")).toContain("api.scryfall.com");
    // l'artwork apre la lightbox (zoom), non un picker di cambio stampa
    fireEvent.click(screen.getByTestId("collection-zoom-sol ring‖ltr‖1"));
    expect(screen.getByTestId("art-lightbox")).toBeInTheDocument();
    expect(screen.getByTestId("art-lightbox-count")).toHaveTextContent("1/2");
    fireEvent.click(screen.getByTestId("art-lightbox-next"));
    expect(screen.getByTestId("art-lightbox-count")).toHaveTextContent("2/2");
    fireEvent.click(screen.getByTestId("art-lightbox-zoom-in"));
    expect(screen.getByTestId("art-lightbox-zoom-fit")).toHaveTextContent("150%");
    fireEvent.click(screen.getByTestId("art-lightbox-close"));
    expect(screen.queryByTestId("art-lightbox")).toBeNull();
  });

  it("lightbox: Esc chiude e frecce avvolgono", async () => {
    useCollection.setState({
      entries: [
        { key: "a‖‖", name: "Alpha", setCode: "", collectorNumber: "", qty: 1, addedAt: "" },
        { key: "b‖‖", name: "Beta", setCode: "", collectorNumber: "", qty: 1, addedAt: "" },
      ],
      loaded: true,
      loading: false,
    });
    render(<CollectionView />);
    fireEvent.click(screen.getByTestId("collection-zoom-a‖‖"));
    expect(screen.getByTestId("art-lightbox-count")).toHaveTextContent("1/2");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByTestId("art-lightbox-count")).toHaveTextContent("2/2");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("art-lightbox")).toBeNull());
  });

  it("ordinamento tipo (default), prezzo e costo mana + tile con costo e prezzo", () => {
    putMeta({ name: "Lightning Bolt" }, { typeLine: "Instant", manaCost: "{R}", cmc: 1, priceUsd: "0.50" }, true);
    putMeta({ name: "Sol Ring", setCode: "ltr" }, { typeLine: "Artifact", manaCost: "{1}", cmc: 1, priceUsd: "2.00" }, true);
    putMeta({ name: "Negate" }, { typeLine: "Instant", manaCost: "{1}{U}", cmc: 2, priceUsd: "1.00" }, true);
    useCollection.setState({
      entries: [
        { key: "negate‖‖", name: "Negate", setCode: "", collectorNumber: "", qty: 1, addedAt: "2026-01-03" },
        { key: "lightning bolt‖‖", name: "Lightning Bolt", setCode: "", collectorNumber: "", qty: 4, addedAt: "2026-01-02" },
        { key: "sol ring‖ltr‖1", name: "Sol Ring", setCode: "ltr", collectorNumber: "1", qty: 3, addedAt: "2026-01-01" },
      ],
      loaded: true,
      loading: false,
    });
    const { container } = render(<CollectionView />);
    const order = (): (string | null)[] =>
      [...container.querySelectorAll('[data-testid^="collection-tile-"]')].map((el) =>
        el.getAttribute("data-testid"),
      );
    // default per tipo: Artifact, poi Instant in ordine di nome
    expect(order()).toEqual([
      "collection-tile-sol ring‖ltr‖1",
      "collection-tile-lightning bolt‖‖",
      "collection-tile-negate‖‖",
    ]);
    // prezzo decrescente
    fireEvent.change(screen.getByTestId("collection-sort"), { target: { value: "price" } });
    expect(order()).toEqual([
      "collection-tile-sol ring‖ltr‖1",
      "collection-tile-negate‖‖",
      "collection-tile-lightning bolt‖‖",
    ]);
    // costo mana crescente (a pari cmc vale il nome)
    fireEvent.change(screen.getByTestId("collection-sort"), { target: { value: "cmc" } });
    expect(order()).toEqual([
      "collection-tile-lightning bolt‖‖",
      "collection-tile-sol ring‖ltr‖1",
      "collection-tile-negate‖‖",
    ]);
    // tile: badge costo e prezzo
    const bolt = screen.getByTestId("collection-tile-lightning bolt‖‖");
    expect(bolt).toHaveTextContent("R");
    expect(bolt).toHaveTextContent("$0.50");
  });

  it("utilizzo mainboard: badge e filtro orfane", () => {
    useProjects.setState({
      projects: [
        project("p1", "Krenko", [
          { id: "c1", name: "Sol Ring", qty: 2, zone: "main", provider: "custom", setCode: "LTR", collectorNumber: "1", hasBack: false, sortOrder: 0 },
          { id: "c2", name: "Negate", qty: 3, zone: "side", provider: "custom", hasBack: false, sortOrder: 1 },
        ]),
      ],
    });
    useCollection.setState({
      entries: [
        { key: "sol ring‖ltr‖1", name: "Sol Ring", setCode: "ltr", collectorNumber: "1", qty: 4, addedAt: "" },
        { key: "negate‖‖", name: "Negate", setCode: "", collectorNumber: "", qty: 1, addedAt: "" },
      ],
      loaded: true,
      loading: false,
    });
    render(<CollectionView />);
    // Sol Ring in mainboard → badge coi mazzi; Negate solo in side → orfana
    expect(screen.getByTestId("collection-usage-sol ring‖ltr‖1")).toHaveTextContent("In uso · Krenko ×2");
    expect(screen.getByTestId("collection-usage-negate‖‖")).toHaveTextContent("Orfana");
    expect(screen.getByTestId("collection-filter-used")).toHaveTextContent("In uso (1)");
    expect(screen.getByTestId("collection-filter-orphan")).toHaveTextContent("Orfane (1)");
    // filtro orfane: resta solo Negate
    fireEvent.click(screen.getByTestId("collection-filter-orphan"));
    expect(screen.queryByTestId("collection-tile-sol ring‖ltr‖1")).toBeNull();
    expect(screen.getByTestId("collection-tile-negate‖‖")).toBeInTheDocument();
    // filtro in uso: torna solo Sol Ring
    fireEvent.click(screen.getByTestId("collection-filter-used"));
    expect(screen.getByTestId("collection-tile-sol ring‖ltr‖1")).toBeInTheDocument();
    expect(screen.queryByTestId("collection-tile-negate‖‖")).toBeNull();
  });

  it("vista lista e griglia", () => {
    useCollection.setState({
      entries: [{ key: "negate‖‖", name: "Negate", setCode: "", collectorNumber: "", qty: 1, addedAt: "" }],
      loaded: true,
      loading: false,
    });
    render(<CollectionView />);
    expect(screen.getByTestId("collection-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("collection-list")).toBeNull();
    fireEvent.click(screen.getByTestId("collection-view-list"));
    expect(screen.getByTestId("collection-list")).toBeInTheDocument();
    expect(screen.queryByTestId("collection-grid")).toBeNull();
    expect(screen.getByTestId("collection-row-negate‖‖")).toBeInTheDocument();
  });

  it("rimozione con conferma", async () => {
    useCollection.setState({
      entries: [{ key: "negate‖‖", name: "Negate", setCode: "", collectorNumber: "", qty: 1, addedAt: "" }],
      loaded: true,
      loading: false,
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      render(<CollectionView />);
      fireEvent.click(screen.getByTestId("collection-remove-negate‖‖"));
      await waitFor(() => expect(screen.getByText(/Collezione vuota/)).toBeInTheDocument());
    } finally {
      confirm.mockRestore();
    }
  });
});

describe("CollectPrompt", () => {
  beforeEach(() => {
    localStorage.clear();
    useCollection.setState({ entries: [], loaded: true, loading: false });
  });

  it("riepilogo delta e conferma", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce([
      { key: "sol ring‖ltr‖1", name: "Sol Ring", set_code: "ltr", collector_number: "1", qty: 4, added_at: "x" },
    ]);
    render(
      <CollectPrompt
        title="Vuoi aggiungere questo deck alla tua collezione?"
        items={[{ name: "Sol Ring", setCode: "LTR", collectorNumber: "1", qty: 4 }]}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByTestId("collect-prompt-summary")).toHaveTextContent("1 stampe nuove");
    fireEvent.click(screen.getByTestId("collect-prompt-confirm"));
    await waitFor(() => expect(screen.getByTestId("collect-prompt-close")).toBeInTheDocument());
    expect(useCollection.getState().entries).toHaveLength(1);
  });
});
