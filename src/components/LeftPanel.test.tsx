import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { LeftPanel } from "@/components/LeftPanel";
import { useDeck } from "@/stores/deck";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

vi.mock("@/services/backend", () => ({
  backend: { isTauri: true },
}));

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const CARD_JSON = {
  id: "uuid-bolt",
  name: "Lightning Bolt",
  set: "lea",
  set_name: "Limited Edition Alpha",
  collector_number: "161",
  image_uris: {
    small: "https://img/bolt-small.jpg",
    large: "https://img/bolt-large.jpg",
  },
};

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/cards/search")) {
        return { ok: true, status: 200, json: async () => ({ data: [CARD_JSON] }) };
      }
      return { ok: true, status: 200, json: async () => CARD_JSON };
    }),
  );
}

describe("LeftPanel import decklist (pulsanti veri)", () => {
  beforeEach(() => {
    useDeck.getState().hydrate([]);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const openTextTab = (): void => {
    fireEvent.click(screen.getByRole("tab", { name: "Testo" }));
  };

  it("livelli piatti: Testo mostra il form, Cerca lo nasconde", () => {
    render(<LeftPanel />, { wrapper });
    // cinque livelli affiancati, niente menu dentro menu
    for (const name of ["Cerca", "Testo", "File", "MPC XML", "Collegamento"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
    expect(screen.queryByLabelText(/Incolla decklist/i)).toBeNull();
    openTextTab();
    expect(screen.getByLabelText(/Incolla decklist/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Importa$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Cerca" }));
    expect(screen.queryByLabelText(/Incolla decklist/i)).toBeNull();
  });

  it("spiegazione Scarica artwork presente (attivo di default)", () => {
    render(<LeftPanel />, { wrapper });
    openTextTab();
    const box = screen.getByLabelText(/Scarica artwork/i) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.closest("label")?.getAttribute("title") ?? "").toMatch(/immagini di stampa/i);
  });

  it("click Importa aggiunge le voci al deck (senza artwork)", async () => {
    render(<LeftPanel />, { wrapper });
    openTextTab();
    fireEvent.change(screen.getByLabelText(/Incolla decklist/i), {
      target: { value: "4 Lightning Bolt\n2 Counterspell\n" },
    });
    // niente rete: disabilita download artwork
    fireEvent.click(screen.getByLabelText(/Scarica artwork/i));
    fireEvent.click(screen.getByRole("button", { name: /^Importa$/ }));

    await waitFor(() => expect(useDeck.getState().deck).toHaveLength(2));
    const deck = useDeck.getState().deck;
    expect(deck[0]).toMatchObject({ name: "Lightning Bolt", qty: 4 });
    expect(deck[1]).toMatchObject({ name: "Counterspell", qty: 2 });
    expect(await screen.findByText(/Importate 2 righe/)).toBeInTheDocument();
  });

  it("click Importa con artwork allega le immagini (fetch mockata)", async () => {
    stubFetch();
    render(<LeftPanel />, { wrapper });
    openTextTab();
    fireEvent.change(screen.getByLabelText(/Incolla decklist/i), {
      target: { value: "1 Lightning Bolt\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Importa$/ }));

    await waitFor(() => expect(useDeck.getState().deck[0]?.imageFront).toBe("https://img/bolt-large.jpg"));
    expect(await screen.findByText(/artwork trovati per 1\/1/)).toBeInTheDocument();
  });

  it("bottone + aggiunge la carta cercata (mock)", async () => {
    stubFetch();
    render(<LeftPanel />, { wrapper });
    fireEvent.change(screen.getByPlaceholderText(/Lightning Bolt/), { target: { value: "Lightning Bolt" } });
    const addBtn = await screen.findByRole("button", { name: "Aggiungi Lightning Bolt" }, { timeout: 8000 });
    fireEvent.click(addBtn);
    await waitFor(() => expect(useDeck.getState().deck).toHaveLength(1));
    expect(useDeck.getState().deck[0]).toMatchObject({ name: "Lightning Bolt" });
  });
});

describe("LeftPanel import da link (stessa barra)", () => {
  beforeEach(() => {
    useDeck.getState().hydrate([]);
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("link Moxfield nella barra mostra import dedicato (niente ricerca Scryfall)", async () => {
    stubFetch();
    render(<LeftPanel />, { wrapper });
    fireEvent.change(screen.getByPlaceholderText(/Lightning Bolt/), {
      target: { value: "https://www.moxfield.com/decks/abcDEF1234/mazzo-test" },
    });
    expect(await screen.findByTestId("decklink-import")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Importa mazzo da Moxfield/ })).toBeInTheDocument();
    // ricerca Scryfall disattivata in modalità link
    expect(screen.queryByLabelText(/Risultati ricerca/)).toBeNull();
  });

  it("click Importa da Archidekt aggiunge le voci (senza artwork)", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      name: "Mazzo Test",
      provider: "archidekt",
      entries: [
        { qty: 4, name: "Lightning Bolt", zone: "main", set_code: "M11", collector_number: "146" },
        { qty: 1, name: "Atraxa", zone: "commander" },
      ],
      unknown: [],
      warnings: [],
    });
    render(<LeftPanel />, { wrapper });
    fireEvent.change(screen.getByPlaceholderText(/Lightning Bolt/), {
      target: { value: "https://archidekt.com/decks/123456/mazzo" },
    });
    expect(await screen.findByTestId("decklink-import")).toBeInTheDocument();
    // niente rete: disabilita artwork
    fireEvent.click(screen.getByLabelText(/Scarica artwork/i));
    fireEvent.click(screen.getByRole("button", { name: /Importa mazzo da Archidekt/ }));
    await waitFor(() => expect(useDeck.getState().deck).toHaveLength(2));
    expect(useDeck.getState().deck[0]).toMatchObject({ name: "Lightning Bolt", qty: 4, zone: "main" });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("fetch_archidekt_deck", { id: "123456" });
    expect(await screen.findByText(/Mazzo Test.*importate 2 voci/)).toBeInTheDocument();
  });

  it("errore backend mostrato con guida (privato/rete)", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("mazzo privato o accesso negato (rendilo pubblico)"));
    render(<LeftPanel />, { wrapper });
    fireEvent.change(screen.getByPlaceholderText(/Lightning Bolt/), {
      target: { value: "https://www.moxfield.com/decks/abcDEF1234/x" },
    });
    expect(await screen.findByTestId("decklink-import")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Importa mazzo da Moxfield/ }));
    expect(await screen.findByText(/Import fallito.*privato/)).toBeInTheDocument();
    expect(useDeck.getState().deck).toHaveLength(0);
  });
});
