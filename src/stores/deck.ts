import { create } from "zustand";
import type { CardEntry, Zone } from "@/types";
import { extractSetInfo } from "@/lib/decklist";

export type DeckView = "grid" | "list" | "compact" | "stack" | "print";

interface Snapshot {
  deck: CardEntry[];
}

interface DeckState {
  deck: CardEntry[];
  past: Snapshot[];
  future: Snapshot[];
  view: DeckView;
  zoneFilter: Zone | "all";
  sortBy: "order" | "name" | "zone" | "qty";

  /** Sostituisce l'intero deck (es. cambio progetto) senza intasare undo. */
  hydrate: (deck: CardEntry[]) => void;
  push: (fn: (deck: CardEntry[]) => CardEntry[]) => void;

  add: (entry: Omit<CardEntry, "id" | "sortOrder">) => string;
  remove: (id: string) => void;
  setQty: (id: string, qty: number) => void;
  moveZone: (ids: string[], zone: Zone) => void;
  /** Tag Comandante on/off (solo visivo: non sposta di zona, non tocca export). */
  setCommander: (ids: string[], value: boolean) => void;
  reorder: (fromIndex: number, toIndex: number) => void;
  setArtwork: (id: string, imageFront?: string, imageBack?: string) => void;
  patchCard: (id: string, patch: Partial<Omit<CardEntry, "id">>) => void;
  /** Applica più patch in UN solo snapshot undo (import/backfill bulk). */
  applyPatches: (patches: { id: string; patch: Partial<Omit<CardEntry, "id">> }[]) => void;
  /**
   * Come applyPatches ma SENZA snapshot undo: per lo swap silenzioso
   * post-selezione (download background) che non deve creare un passo undo
   * separato dalla scelta ottimistica.
   */
  applyPatchesSilent: (patches: { id: string; patch: Partial<Omit<CardEntry, "id">> }[]) => void;
  /**
   * Separa una voce qty=N in N voci qty=1 (cloni con artwork ereditato),
   * per stampe diverse per copia. Un solo snapshot undo. Ritorna nuovi id.
   */
  splitCopies: (id: string) => string[];
  /**
   * Stacca UNA sola copia fisica da una voce e applica la patch solo a quella:
   * qty>1 → voce qty-1 + clone qty=1 patchato; qty=1 → patch in place.
   * Un solo snapshot undo. Ritorna l'id della voce patchata, null se assente.
   */
  applyPrintToSingleCopy: (id: string, patch: Partial<Omit<CardEntry, "id">>) => string | null;
  /** Sposta `(set) num` dal nome nei campi set/collector. Ritorna voci cambiate. */
  normalizeNames: () => number;
  bulkRemove: (ids: string[]) => void;
  clear: () => void;

  setView: (v: DeckView) => void;
  setZoneFilter: (z: Zone | "all") => void;
  setSortBy: (s: DeckState["sortBy"]) => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

const LIMIT = 100;

export const useDeck = create<DeckState>()((set, get) => ({
  deck: [],
  past: [],
  future: [],
  view: "grid",
  zoneFilter: "all",
  sortBy: "order",

  hydrate: (deck) => set({ deck, past: [], future: [] }),

  push: (fn) =>
    set((s) => {
      const deck = fn(s.deck);
      const past = [...s.past, { deck: s.deck }].slice(-LIMIT);
      return { deck, past, future: [] };
    }),

  add: (entry) => {
    const id = uid();
    get().push((deck) => [...deck, { ...entry, id, sortOrder: deck.length }]);
    return id;
  },

  remove: (id) => get().push((deck) => deck.filter((c) => c.id !== id)),

  setQty: (id, qty) =>
    get().push((deck) =>
      deck.map((c) => (c.id === id ? { ...c, qty: Math.min(99, Math.max(1, Math.round(qty))) } : c)),
    ),

  moveZone: (ids, zone) =>
    get().push((deck) => deck.map((c) => (ids.includes(c.id) ? { ...c, zone } : c))),

  setCommander: (ids, value) =>
    get().push((deck) => deck.map((c) => (ids.includes(c.id) ? { ...c, commander: value } : c))),

  reorder: (fromIndex, toIndex) =>
    get().push((deck) => {
      if (fromIndex === toIndex) return deck;
      const next = [...deck];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return deck;
      next.splice(toIndex, 0, moved);
      return next.map((c, i) => ({ ...c, sortOrder: i }));
    }),

  setArtwork: (id, imageFront, imageBack) =>
    get().push((deck) =>
      deck.map((c) =>
        c.id === id
          ? { ...c, imageFront: imageFront ?? c.imageFront, imageBack: imageBack ?? c.imageBack }
          : c,
      ),
    ),

  patchCard: (id, patch) => get().push((deck) => deck.map((c) => (c.id === id ? { ...c, ...patch } : c))),

  applyPatches: (patches) => {
    if (patches.length === 0) return;
    const byId = new Map(patches.map((p) => [p.id, p.patch]));
    get().push((deck) => deck.map((c) => {
      const patch = byId.get(c.id);
      return patch ? { ...c, ...patch } : c;
    }));
  },

  applyPatchesSilent: (patches) => {
    if (patches.length === 0) return;
    const byId = new Map(patches.map((p) => [p.id, p.patch]));
    set((s) => ({
      deck: s.deck.map((c) => {
        const patch = byId.get(c.id);
        return patch ? { ...c, ...patch } : c;
      }),
    }));
  },

  splitCopies: (id) => {
    const found = get().deck.find((c) => c.id === id);
    if (!found || found.qty < 2) return [];
    const ids: string[] = [];
    get().push((deck) => {
      const idx = deck.findIndex((c) => c.id === id);
      if (idx < 0) return deck;
      const orig = deck[idx] as CardEntry;
      const clones: CardEntry[] = [];
      for (let i = 1; i < orig.qty; i++) {
        const nid = uid();
        ids.push(nid);
        clones.push({ ...orig, id: nid, qty: 1 });
      }
      const next = [...deck];
      next[idx] = { ...orig, qty: 1 };
      next.splice(idx + 1, 0, ...clones);
      return next.map((c, i) => ({ ...c, sortOrder: i }));
    });
    return ids;
  },

  applyPrintToSingleCopy: (id, patch) => {
    const found = get().deck.find((c) => c.id === id);
    if (!found) return null;
    let applied: string | null = null;
    get().push((deck) => {
      const idx = deck.findIndex((c) => c.id === id);
      if (idx < 0) return deck;
      const orig = deck[idx] as CardEntry;
      const next = [...deck];
      if (orig.qty > 1) {
        const nid = uid();
        applied = nid;
        next[idx] = { ...orig, qty: orig.qty - 1 };
        next.splice(idx + 1, 0, { ...orig, id: nid, qty: 1, ...patch });
      } else {
        applied = id;
        next[idx] = { ...orig, ...patch };
      }
      return next.map((c, i) => ({ ...c, sortOrder: i }));
    });
    return applied;
  },

  normalizeNames: () => {
    let changed = 0;
    get().push((deck) =>
      deck.map((c) => {
        const info = extractSetInfo(c.name);
        if (!info.setCode && !info.collectorNumber) return c;
        if (info.name === c.name && (c.setCode || !info.setCode)) {
          // nome già pulito; completa solo se mancano i campi
          if (c.setCode && c.collectorNumber) return c;
          if (!info.setCode) return c;
        }
        changed += 1;
        return {
          ...c,
          name: info.name || c.name,
          setCode: c.setCode ?? info.setCode,
          collectorNumber: c.collectorNumber ?? info.collectorNumber,
        };
      }),
    );
    return changed;
  },

  bulkRemove: (ids) => get().push((deck) => deck.filter((c) => !ids.includes(c.id))),

  clear: () => get().push(() => []),

  setView: (view) => set({ view }),
  setZoneFilter: (zoneFilter) => set({ zoneFilter }),
  setSortBy: (sortBy) => set({ sortBy }),

  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return {
        deck: prev.deck,
        past: s.past.slice(0, -1),
        future: [{ deck: s.deck }, ...s.future].slice(0, LIMIT),
      };
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return s;
      return {
        deck: next.deck,
        past: [...s.past, { deck: s.deck }].slice(-LIMIT),
        future: s.future.slice(1),
      };
    }),

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));

/** Selettore: totale copie (somma qty). */
export function totalCopies(deck: CardEntry[]): number {
  return deck.reduce((n, c) => n + c.qty, 0);
}

/**
 * Voci con lo stesso nome (trim+lowercase, tutte le zone) di una voce dato l'id,
 * esclusa la voce stessa. Usate per "Apply to all" nel print-picker.
 */
export function peersOfName(deck: CardEntry[], id: string): CardEntry[] {
  const self = deck.find((c) => c.id === id);
  if (!self) return [];
  const key = self.name.trim().toLowerCase();
  return deck.filter((c) => c.id !== id && c.name.trim().toLowerCase() === key);
}

/** Copie totali di una voce + sue omonime (per etichetta "Apply to all (N)"). */
export function copiesWithPeers(deck: CardEntry[], id: string): number {
  const self = deck.find((c) => c.id === id);
  if (!self) return 0;
  return self.qty + peersOfName(deck, id).reduce((n, c) => n + c.qty, 0);
}

/** True se la carta è marcata Comandante (flag o zona commander legacy). Solo app. */
export function isCommander(c: Pick<CardEntry, "commander" | "zone">): boolean {
  return c.commander === true || c.zone === "commander";
}

/** Selettore: deck filtrato + ordinato per la vista. Solo app (mai in export/PDF). */
export function visibleDeck(deck: CardEntry[], zone: Zone | "all", sortBy: DeckState["sortBy"]): CardEntry[] {
  const filtered = zone === "all" ? [...deck] : deck.filter((c) => c.zone === zone);
  switch (sortBy) {
    case "name":
      return filtered.sort((a, b) => a.name.localeCompare(b.name));
    case "zone":
      return filtered.sort((a, b) => a.zone.localeCompare(b.zone) || a.sortOrder - b.sortOrder);
    case "qty":
      return filtered.sort((a, b) => b.qty - a.qty);
    default:
      // ordine default: il comandante sempre in cima, poi sortOrder
      return filtered.sort(
        (a, b) => (isCommander(b) ? 1 : 0) - (isCommander(a) ? 1 : 0) || a.sortOrder - b.sortOrder,
      );
  }
}
