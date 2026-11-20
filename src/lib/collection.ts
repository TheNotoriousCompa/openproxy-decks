import { invoke } from "@tauri-apps/api/core";
import { backend } from "@/services/backend";
import type { CardEntry } from "@/types";

/**
 * Collezione dei proxy fisici posseduti. Una voce = una STAMPA posseduta
 * (nome + set + numero collezionista): stesso nome in set diversi sono voci
 * distinte, quantità sommate per chiave.
 */

export interface CollectionEntry {
  key: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  qty: number;
  addedAt: string;
}

/** Voce da aggiungere (la chiave si deriva sempre da nome+set+numero). */
export interface CollectionItem {
  name: string;
  setCode?: string;
  collectorNumber?: string;
  qty: number;
}

/** Chiave stabile di una stampa: minuscola, trimmata, parti vuote ammesse. */
export function collectionKey(name: string, setCode?: string, collectorNumber?: string): string {
  const parts = [name, setCode ?? "", collectorNumber ?? ""].map((s) => s.trim().toLowerCase());
  return parts.join("‖");
}

export function itemKey(item: Pick<CollectionItem, "name" | "setCode" | "collectorNumber">): string {
  return collectionKey(item.name, item.setCode, item.collectorNumber);
}

const LS_KEY = "proxxied.collection";

function cleanList(raw: unknown): CollectionEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CollectionEntry[] = [];
  for (const v of raw) {
    if (typeof v !== "object" || v === null) continue;
    const o = v as Record<string, unknown>;
    if (typeof o.key !== "string" || !o.key || typeof o.name !== "string" || !o.name) continue;
    const qty = typeof o.qty === "number" ? Math.min(9999, Math.max(1, Math.floor(o.qty))) : 1;
    out.push({
      key: o.key,
      name: o.name,
      setCode: typeof o.set_code === "string" ? o.set_code : typeof o.setCode === "string" ? o.setCode : "",
      collectorNumber:
        typeof o.collector_number === "string"
          ? o.collector_number
          : typeof o.collectorNumber === "string"
            ? o.collectorNumber
            : "",
      qty,
      addedAt: typeof o.added_at === "string" ? o.added_at : typeof o.addedAt === "string" ? o.addedAt : "",
    });
  }
  return out;
}

function readLocal(): CollectionEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? cleanList(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function writeLocal(list: CollectionEntry[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, 5000)));
  } catch {
    /* quota: ignora */
  }
}

function toBackend(item: CollectionItem): Record<string, unknown> {
  return {
    key: itemKey(item),
    name: item.name.trim(),
    set_code: (item.setCode ?? "").trim().toLowerCase(),
    collector_number: (item.collectorNumber ?? "").trim(),
    qty: Math.min(9999, Math.max(1, Math.floor(item.qty))),
    added_at: new Date().toISOString(),
  };
}

function fromBackend(raw: unknown): CollectionEntry[] {
  if (!Array.isArray(raw)) return [];
  return cleanList(
    raw.map((e) => {
      const o = e as Record<string, unknown>;
      return {
        key: o.key,
        name: o.name,
        setCode: o.set_code,
        collectorNumber: o.collector_number,
        qty: o.qty,
        addedAt: o.added_at,
      };
    }),
  );
}

export async function listCollection(): Promise<CollectionEntry[]> {
  if (!backend.isTauri) return readLocal();
  try {
    return fromBackend(await invoke("collection_list"));
  } catch {
    return readLocal();
  }
}

/** Aggiunge voci sommando sulle chiavi esistenti. Ritorna la lista aggiornata. */
export async function addToCollection(
  current: CollectionEntry[],
  items: CollectionItem[],
): Promise<CollectionEntry[]> {
  const valid = items.filter((i) => i.name.trim() && Math.floor(i.qty) >= 1);
  if (valid.length === 0) return current;
  if (!backend.isTauri) {
    const merged = mergeAdd(current, valid);
    writeLocal(merged.list);
    return merged.list;
  }
  try {
    return fromBackend(await invoke("collection_add", { items: valid.map(toBackend) }));
  } catch {
    const merged = mergeAdd(current, valid);
    writeLocal(merged.list);
    return merged.list;
  }
}

export async function setCollectionQty(
  current: CollectionEntry[],
  key: string,
  qty: number,
): Promise<CollectionEntry[]> {
  const q = Math.floor(qty);
  if (!backend.isTauri) {
    const list =
      q < 1
        ? current.filter((e) => e.key !== key)
        : current.map((e) => (e.key === key ? { ...e, qty: Math.min(9999, Math.max(1, q)) } : e));
    writeLocal(list);
    return list;
  }
  return fromBackend(await invoke("collection_set_qty", { key, qty: q }));
}

export async function removeFromCollection(current: CollectionEntry[], key: string): Promise<CollectionEntry[]> {
  if (!backend.isTauri) {
    const list = current.filter((e) => e.key !== key);
    writeLocal(list);
    return list;
  }
  return fromBackend(await invoke("collection_remove", { key }));
}

export async function clearCollection(): Promise<CollectionEntry[]> {
  if (!backend.isTauri) {
    writeLocal([]);
    return [];
  }
  return fromBackend(await invoke("collection_clear"));
}

/** Consolida voci con stessa chiave sommando le quantità (per i dialoghi). */
export function consolidateItems(items: CollectionItem[]): CollectionItem[] {
  const map = new Map<string, CollectionItem>();
  for (const item of items) {
    const name = item.name.trim();
    const rawQty = Math.floor(item.qty);
    if (!name || rawQty < 1) continue;
    const qty = Math.min(9999, rawQty);
    const setCode = (item.setCode ?? "").trim().toLowerCase();
    const collectorNumber = (item.collectorNumber ?? "").trim();
    const key = collectionKey(name, setCode, collectorNumber);
    const prev = map.get(key);
    if (prev) prev.qty = Math.min(9999, prev.qty + qty);
    else map.set(key, { name, setCode, collectorNumber, qty });
  }
  return [...map.values()];
}

/** Anteprima dei delta prima di confermare: voci nuove + quantità su esistenti. */
export interface CollectionDelta {
  list: CollectionEntry[];
  /** chiavi del tutto nuove con quantità */
  added: { key: string; name: string; qty: number }[];
  /** chiavi esistenti con quantità aggiunta */
  updated: { key: string; name: string; added: number; total: number }[];
}

/** Somma `items` alla lista (puro, stessa regola del backend). */
export function mergeAdd(list: CollectionEntry[], items: CollectionItem[]): CollectionDelta {
  const out: CollectionEntry[] = list.map((e) => ({ ...e }));
  const added: CollectionDelta["added"] = [];
  const updated: CollectionDelta["updated"] = [];
  const now = new Date().toISOString();
  for (const item of items) {
    const name = item.name.trim();
    const rawQty = Math.floor(item.qty);
    if (!name || rawQty < 1) continue;
    const qty = Math.min(9999, rawQty);
    const key = itemKey(item);
    const existing = out.find((e) => e.key === key);
    if (existing) {
      existing.qty = Math.min(9999, existing.qty + qty);
      updated.push({ key, name: existing.name, added: qty, total: existing.qty });
    } else {
      out.push({
        key,
        name,
        setCode: (item.setCode ?? "").trim().toLowerCase(),
        collectorNumber: (item.collectorNumber ?? "").trim(),
        qty,
        addedAt: now,
      });
      added.push({ key, name, qty });
    }
  }
  return { list: out, added, updated };
}

/**
 * Immagine di ripiego per una voce collezione quando nessun progetto caricato
 * ne ha l'artwork: la stampa ufficiale Scryfall (stampa esatta se set+numero
 * noti, altrimenti la stampa di default per nome). Solo display.
 */
export function entryImageUrl(e: Pick<CollectionEntry, "name" | "setCode" | "collectorNumber">): string {
  const set = (e.setCode ?? "").trim().toLowerCase();
  const num = (e.collectorNumber ?? "").trim();
  if (set && num) {
    return `https://api.scryfall.com/cards/${encodeURIComponent(set)}/${encodeURIComponent(num)}?format=image&version=small`;
  }
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(e.name.trim())}&format=image&version=small`;
}

/** Da una voce deck all'item collezione (stessa stampa, set/numero normalizzati). */
export function deckEntryToItem(
  c: Pick<CardEntry, "name" | "setCode" | "collectorNumber"> & { qty?: number },
): CollectionItem {
  return {
    name: c.name.trim(),
    setCode: (c.setCode ?? "").trim().toLowerCase(),
    collectorNumber: (c.collectorNumber ?? "").trim(),
    qty: Math.max(1, Math.floor(c.qty ?? 1)),
  };
}

/** Possedute per chiave, per i badge del DeckBuilder. */
export function ownedByKey(list: CollectionEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of list) map.set(e.key, e.qty);
  return map;
}

/** Zone che contano come "mainboard": quelle stampate nel flusso main. */
const MAINBOARD_ZONES: ReadonlySet<string> = new Set(["main", "commander"]);

export interface DeckUsageEntry {
  id: string;
  name: string;
  copies: number;
}

export interface DeckUsage {
  decks: DeckUsageEntry[];
  totalCopies: number;
}

type UsageDeck = Pick<CardEntry, "name" | "setCode" | "collectorNumber" | "qty" | "zone">;

/**
 * Uso in mainboard per stampa: in quali mazzi (e in quante copie) ogni chiave
 * collezione è giocata. Sideboard, token e resto non contano: l'idea è sapere
 * cosa è davvero in uso nei 99+ per non ristampare doppioni.
 */
export function collectionUsage(
  projects: { id: string; name: string; manifest: { deck: UsageDeck[] } }[],
): Map<string, DeckUsage> {
  const out = new Map<string, DeckUsage>();
  for (const p of projects) {
    const perKey = new Map<string, number>();
    for (const c of p.manifest.deck) {
      if (!MAINBOARD_ZONES.has(c.zone)) continue;
      const item = deckEntryToItem(c);
      const key = itemKey(item);
      perKey.set(key, (perKey.get(key) ?? 0) + item.qty);
    }
    for (const [key, copies] of perKey) {
      const u = out.get(key) ?? { decks: [], totalCopies: 0 };
      u.decks.push({ id: p.id, name: p.name, copies });
      u.totalCopies += copies;
      out.set(key, u);
    }
  }
  return out;
}

/** Voci di un mazzo non coperte dalla collezione (qty mazzo − possedute). */
export function missingForDeck(
  deck: Pick<CardEntry, "name" | "setCode" | "collectorNumber" | "qty">[],
  owned: Map<string, number>,
): { name: string; setCode: string; collectorNumber: string; need: number; have: number }[] {
  const out: { name: string; setCode: string; collectorNumber: string; need: number; have: number }[] = [];
  for (const c of deck) {
    const item = deckEntryToItem(c);
    const have = owned.get(itemKey(item)) ?? 0;
    if (have < item.qty) {
      out.push({
        name: item.name,
        setCode: item.setCode ?? "",
        collectorNumber: item.collectorNumber ?? "",
        need: item.qty - have,
        have,
      });
    }
  }
  return out;
}
