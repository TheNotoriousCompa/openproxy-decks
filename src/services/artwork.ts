import { findCardByName, scryfallProvider } from "@/services/providers";
import { langAttempts } from "@/lib/cardLang";
import type { CardEntry, CardLang } from "@/types";

export interface ArtworkPatch {
  imageFront?: string;
  imageBack?: string;
  hasBack: boolean;
  provider: CardEntry["provider"];
  providerId: string;
  setCode: string;
  collectorNumber: string;
  /** lingua della stampa trovata (ripiego compreso): per i report di import */
  langUsed?: string;
}

const SEARCH_API = "https://api.scryfall.com/cards/search";

/**
 * Cerca la carta esatta per nome (`!"Nome"`) con la lingua preferita e ripiego
 * inglese → qualsiasi. Ultima spiaggia: `/cards/named?fuzzy` che accetta anche
 * i nomi tradotti (es. "Fulmine"). Null se non trovata.
 */
export async function fetchArtworkForName(
  name: string,
  signal: AbortSignal,
  timeoutMs = 12000,
  preferred: CardLang = "any",
): Promise<ArtworkPatch | null> {
  const clean = name.trim();
  if (!clean) return null;
  const ctrl = new AbortController();
  const onAbort = (): void => ctrl.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = window.setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
  try {
    for (const lang of langAttempts(preferred)) {
      const langQ = lang ? ` lang:${lang}` : "";
      const url = `${SEARCH_API}?q=${encodeURIComponent(`!"${clean}"${langQ}`)}&unique=cards`;
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (res.status === 404) continue; // lingua non disponibile: si ripiega
      if (!res.ok) throw new Error(`Scryfall ${res.status}`);
      const json = (await res.json()) as { data?: unknown[] };
      const first = json.data?.[0];
      if (!first) continue;
      const patch = await patchFromSearchResult(first, ctrl.signal);
      if (patch) return { ...patch, langUsed: lang };
    }
    // nomi tradotti (liste italiane): fuzzy named, nessun filtro lingua
    const card = await findCardByName(clean, ctrl.signal, timeoutMs);
    if (!card) return null;
    return {
      imageFront: card.imageFront,
      imageBack: card.imageBack,
      hasBack: card.hasBack,
      provider: "scryfall",
      providerId: card.id,
      setCode: card.setCode,
      collectorNumber: card.collectorNumber,
      langUsed: undefined,
    };
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

/** Dettaglio completo (validato) del primo risultato, con fallback al risultato grezzo. */
async function patchFromSearchResult(
  first: unknown,
  signal: AbortSignal,
): Promise<ArtworkPatch | null> {
  // Dettaglio completo via provider (validato con Zod); fallback al risultato search.
  const card = await scryfallProvider
    .getCardById((first as { id?: string }).id ?? "", signal)
    .catch(() => null);
  if (!card) {
    // fallback: usa direttamente il primo risultato senza seconda chiamata
    return mapSearchResult(first);
  }
  return {
    imageFront: card.imageFront,
    imageBack: card.imageBack,
    hasBack: card.hasBack,
    provider: "scryfall",
    providerId: card.id,
    setCode: card.setCode,
    collectorNumber: card.collectorNumber,
  };
}

function mapSearchResult(raw: unknown): ArtworkPatch | null {
  const r = raw as {
    id?: string;
    image_uris?: { png?: string; large?: string; normal?: string };
    card_faces?: { image_uris?: { png?: string; large?: string; normal?: string } }[];
    set?: string;
    collector_number?: string;
  };
  if (!r || typeof r !== "object" || !r.id) return null;
  const front = r.image_uris?.png ?? r.image_uris?.large ?? r.image_uris?.normal ?? r.card_faces?.[0]?.image_uris?.png ?? r.card_faces?.[0]?.image_uris?.large;
  const back = r.card_faces?.[1]?.image_uris?.png ?? r.card_faces?.[1]?.image_uris?.large;
  if (!front) return null;
  return {
    imageFront: front,
    imageBack: back,
    hasBack: Boolean(back),
    provider: "scryfall",
    providerId: r.id,
    setCode: (r.set ?? "").toUpperCase(),
    collectorNumber: r.collector_number ?? "",
  };
}

export interface EnrichProgress {
  done: number;
  total: number;
  current: string;
}

/**
 * Arricchisce righe/voci senza artwork. Rispetta rate-limit Scryfall (~100ms tra chiamate).
 * Non solleva: le voci non trovate restano invariate.
 */
export async function enrichWithArtwork<T extends { name: string; imageFront?: string }>(
  items: T[],
  opts: {
    signal?: AbortSignal;
    delayMs?: number;
    /** lingua preferita delle stampe (ripiego inglese automatico) */
    lang?: CardLang;
    onProgress?: (p: EnrichProgress) => void;
    apply: (item: T, patch: ArtworkPatch) => void | Promise<void>;
  },
): Promise<{ enriched: number; missing: string[]; fellBack: number }> {
  const signal = opts.signal ?? new AbortController().signal;
  const delayMs = opts.delayMs ?? 120;
  let enriched = 0;
  let fellBack = 0;
  const missing: string[] = [];
  let done = 0;
  for (const item of items) {
    if (signal.aborted) break;
    done += 1;
    opts.onProgress?.({ done, total: items.length, current: item.name });
    if (item.imageFront) continue;
    try {
      const patch = await fetchArtworkForName(item.name, signal, undefined, opts.lang ?? "any");
      if (patch) {
        await opts.apply(item, patch);
        enriched += 1;
        if (langFallback(opts.lang, patch.langUsed)) fellBack += 1;
      } else {
        missing.push(item.name);
      }
    } catch (err) {
      if (signal.aborted) break;
      missing.push(item.name);
      void err;
    }
    if (done < items.length) {
      await new Promise<void>((resolve) => {
        const t = window.setTimeout(resolve, delayMs);
        signal.addEventListener("abort", () => {
          window.clearTimeout(t);
          resolve();
        }, { once: true });
      });
    }
  }
  return { enriched, missing, fellBack };
}

/** true se la lingua richiesta non c'era e la stampa arriva dal ripiego. */
function langFallback(preferred: CardLang | undefined, used: string | undefined): boolean {
  if (!preferred || preferred === "any") return false;
  return used !== preferred;
}
