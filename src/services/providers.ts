import type { PrintOption, ProviderCard } from "@/types";
import { scryfallCardSchema, scryfallListSchema } from "@/lib/schemas";

export interface CardProvider {
  readonly id: "scryfall" | "local";
  readonly label: string;
  searchCards(query: string, signal: AbortSignal): Promise<ProviderCard[]>;
  getCardById(id: string, signal?: AbortSignal): Promise<ProviderCard>;
  autocomplete(query: string, signal: AbortSignal): Promise<string[]>;
  getCardPrintings?(
    name: string,
    signal: AbortSignal,
    lang?: string,
    onPage?: (batch: PrintOption[]) => void,
  ): Promise<PrintOption[]>;
}

const API = "https://api.scryfall.com";

async function fetchJson<T>(url: string, signal: AbortSignal, timeoutMs = 12000): Promise<T> {
  const ctrl = new AbortController();
  const onAbort = (): void => ctrl.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = window.setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Scryfall ${res.status}`);
    return (await res.json()) as T;
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Come `fetchJson`, ma il 404 di Scryfall ("nessuna carta con questi filtri")
 * vale come risultato vuoto: cercare una lingua non disponibile non è un errore.
 */
async function fetchJsonOrEmpty<T>(url: string, signal: AbortSignal, timeoutMs = 12000): Promise<T | null> {
  try {
    return await fetchJson<T>(url, signal, timeoutMs);
  } catch (e) {
    if (e instanceof Error && e.message === "Scryfall 404") return null;
    throw e;
  }
}

function toProviderCard(raw: unknown): ProviderCard | null {
  const parsed = scryfallCardSchema.safeParse(raw);
  if (!parsed.success) return null;
  const c = parsed.data;
  // risoluzione piena per la stampa: `png` (745×1040) prima di `large` (672×936)
  const front =
    c.image_uris?.png ?? c.image_uris?.large ?? c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.png ?? c.card_faces?.[0]?.image_uris?.large;
  const back = c.card_faces?.[1]?.image_uris?.png ?? c.card_faces?.[1]?.image_uris?.large;
  return {
    id: c.id,
    name: c.name,
    setCode: (c.set ?? "").toUpperCase(),
    setName: c.set_name ?? "",
    collectorNumber: c.collector_number ?? "",
    imageFront: front,
    imageBack: back,
    hasBack: Boolean(back),
  };
}

export const scryfallProvider: CardProvider = {
  id: "scryfall",
  label: "Scryfall (Magic)",

  async searchCards(query: string, signal: AbortSignal): Promise<ProviderCard[]> {
    const q = query.trim();
    if (!q) return [];
    const data = await fetchJson<{ data?: unknown[] }>(
      `${API}/cards/search?q=${encodeURIComponent(q)}&unique=cards&order=name`,
      signal,
    );
    return (data.data ?? []).map(toProviderCard).filter((c): c is ProviderCard => c !== null).slice(0, 24);
  },

  async getCardById(id: string, signal?: AbortSignal): Promise<ProviderCard> {
    const ctrl = signal ?? new AbortController().signal;
    const data = await fetchJson<unknown>(`${API}/cards/${encodeURIComponent(id)}`, ctrl);
    const card = toProviderCard(data);
    if (!card) throw new Error("carta non valida");
    return card;
  },

  async autocomplete(query: string, signal: AbortSignal): Promise<string[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const data = await fetchJson<{ data?: string[] }>(
      `${API}/cards/autocomplete?q=${encodeURIComponent(q)}`,
      signal,
      8000,
    );
    return (data.data ?? []).slice(0, 12);
  },

  /**
   * Tutte le stampe di una carta, ordinate per data di rilascio (paginato, max 4 pagine).
   * `lang` opzionale ("it"|"en", …): filtro lingua Scryfall (`lang:xx`), default tutte.
   * `onPage` (opzionale): chiamato con ogni pagina appena pronta, così la UI
   * mostra le prime stampe senza aspettare le pagine successive.
   */
  async getCardPrintings(
    name: string,
    signal: AbortSignal,
    lang?: string,
    onPage?: (batch: PrintOption[]) => void,
  ): Promise<PrintOption[]> {
    const q = name.trim();
    if (!q) return [];
    const langQ = lang?.trim() ? ` lang:${lang.trim().toLowerCase()}` : "";
    const out: PrintOption[] = [];
    let url: string | null =
      `${API}/cards/search?q=${encodeURIComponent(`!"${q}"${langQ}`)}&unique=prints&order=released`;
    for (let page = 0; page < 4 && url; page++) {
      // 404 = nessuna stampa in quella lingua (non un errore): pagina vuota
      const raw = await fetchJsonOrEmpty<unknown>(url, signal, 15000);
      if (raw === null) break;
      const parsed = scryfallListSchema.safeParse(raw);
      if (!parsed.success) break;
      const batch: PrintOption[] = [];
      for (const item of parsed.data.data) {
        const opt = toPrintOption(item);
        if (opt) {
          out.push(opt);
          batch.push(opt);
        }
      }
      if (batch.length > 0) onPage?.(batch);
      url = parsed.data.has_more ? (parsed.data.next_page ?? null) : null;
    }
    return out;
  },
};

/**
 * Ultima spiaggia per i nomi non inglesi: `/cards/named?fuzzy=<nome>` accetta
 * anche il nome stampato tradotto (es. "Fulmine" → Lightning Bolt).
 * Ritorna null se non trova nulla.
 */
export async function findCardByName(
  name: string,
  signal: AbortSignal,
  timeoutMs = 12000,
): Promise<ProviderCard | null> {
  const clean = name.trim();
  if (!clean) return null;
  try {
    const raw = await fetchJson<unknown>(
      `${API}/cards/named?fuzzy=${encodeURIComponent(clean)}`,
      signal,
      timeoutMs,
    );
    return toProviderCard(raw);
  } catch {
    return null;
  }
}

export function toPrintOption(raw: unknown): PrintOption | null {
  const parsed = scryfallCardSchema.safeParse(raw);
  if (!parsed.success) return null;
  const c = parsed.data;
  const faces = c.card_faces;
  const frontImg =
    c.image_uris?.png ?? c.image_uris?.large ?? c.image_uris?.normal ?? faces?.[0]?.image_uris?.png ?? faces?.[0]?.image_uris?.large;
  if (!frontImg) return null;
  const backImg = faces?.[1]?.image_uris?.png ?? faces?.[1]?.image_uris?.large;
  return {
    source: "scryfall",
    id: c.id,
    name: c.name,
    setCode: (c.set ?? "").toUpperCase(),
    setName: c.set_name ?? "",
    collectorNumber: c.collector_number ?? "",
    releasedAt: c.released_at,
    thumb: c.image_uris?.small ?? faces?.[0]?.image_uris?.small ?? frontImg,
    // griglia picker: `normal` 488px invece di `small` 146px (stirato = pessimo)
    preview: c.image_uris?.normal ?? faces?.[0]?.image_uris?.normal ?? frontImg,
    imageLarge: frontImg,
    imageFull: c.image_uris?.png ?? frontImg,
    imageBack: backImg,
    hasBack: Boolean(backImg),
    highres: c.highres_image ?? false,
    priceUsd: c.prices?.usd ?? undefined,
  };
}

/** Catalogo locale JSON di fallback offline (sempre disponibile). */
const LOCAL_CATALOG: ProviderCard[] = [
  { id: "local-bolt", name: "Lightning Bolt", setCode: "LOCAL", setName: "Catalogo locale", collectorNumber: "1", hasBack: false },
  { id: "local-counter", name: "Counterspell", setCode: "LOCAL", setName: "Catalogo locale", collectorNumber: "2", hasBack: false },
  { id: "local-sol", name: "Sol Ring", setCode: "LOCAL", setName: "Catalogo locale", collectorNumber: "3", hasBack: false },
];

export const localProvider: CardProvider = {
  id: "local",
  label: "Catalogo locale",
  async searchCards(query: string): Promise<ProviderCard[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return LOCAL_CATALOG.filter((c) => c.name.toLowerCase().includes(q));
  },
  async getCardById(id: string): Promise<ProviderCard> {
    const found = LOCAL_CATALOG.find((c) => c.id === id);
    if (!found) throw new Error("non trovata nel catalogo locale");
    return found;
  },
  async autocomplete(query: string): Promise<string[]> {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return LOCAL_CATALOG.map((c) => c.name).filter((n) => n.toLowerCase().includes(q));
  },
};

/** Ricerca con fallback offline: Scryfall → catalogo locale. */
export async function searchWithFallback(query: string, signal: AbortSignal): Promise<{ cards: ProviderCard[]; offline: boolean }> {
  try {
    const cards = await scryfallProvider.searchCards(query, signal);
    return { cards, offline: false };
  } catch (err) {
    if (signal.aborted) throw err;
    const cards = await localProvider.searchCards(query, signal);
    return { cards, offline: true };
  }
}
