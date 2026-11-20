import { typeCacheKey, type CardMeta, type TypeRef } from "@/services/cardfinder";

/**
 * Cache persistente dei metadati carta (type_line, mana, layout, prezzo…).
 * Una sola risoluzione per carta: la usano la vista DeckBuilder, le
 * statistiche e la pulizia del board Token.
 *
 * v3: aggiunge `layout` (segnale esatto dei token Scryfall: token,
 * double_faced_token, emblem). La v2 non lo aveva → si riparte puliti.
 *
 * v4: aggiunge i segnali Commander Brackets (`gameChanger`, `extraTurn`,
 * `massLandDenial`). La v3 non li aveva → si riparte puliti una volta.
 */
const LS_KEY = "proxxied.cardmeta.v4";

let store: Map<string, CardMeta> | null = null;

function load(): Map<string, CardMeta> {
  const out = new Map<string, CardMeta>();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return out;
    const obj = JSON.parse(raw) as Record<string, CardMeta>;
    for (const [k, v] of Object.entries(obj)) {
      // accetta solo voci utilizzabili (tipo, layout o set noti)
      if (v && ((typeof v.typeLine === "string" && v.typeLine !== "") || v.layout || v.setType)) {
        out.set(k, v);
      }
    }
  } catch {
    /* cache illeggibile: si riparte vuoti */
  }
  return out;
}

/** Mappa condivisa in memoria (letta una volta per sessione). */
export function metaStore(): Map<string, CardMeta> {
  store ??= load();
  return store;
}

/** Alias per nome (indipendente dal set): copre le voci senza set noto. */
export function aliasKey(name: string): string {
  return `n:${name.trim().toLowerCase()}|`;
}

/** Scrive in cache (chiave esatta + alias opzionale per le omonime). */
export function putMeta(ref: TypeRef, meta: CardMeta, exact: boolean): void {
  const map = metaStore();
  map.set(typeCacheKey(ref), meta);
  if (exact) map.set(aliasKey(ref.name), meta);
}

/** Salva su localStorage la mappa corrente (best effort: quota piena = ignora). */
export function persistMetaCache(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(metaStore())));
  } catch {
    /* quota: ignora */
  }
}

/** Meta di una voce: chiave esatta, poi alias per nome (con e senza set). */
export function findMeta(meta: Map<string, CardMeta>, ref: TypeRef): CardMeta | undefined {
  const lower = ref.name.trim().toLowerCase();
  return (
    meta.get(typeCacheKey(ref)) ??
    meta.get(aliasKey(ref.name)) ??
    meta.get(`n:${lower}|${(ref.setCode ?? "").toLowerCase()}`)
  );
}

/** Tipo di riferimento di una voce del mazzo (per il lookup metadati). */
export function refOf(entry: {
  name: string;
  provider: TypeRef["provider"];
  providerId?: string;
  setCode?: string;
}): TypeRef {
  return {
    name: entry.name,
    provider: entry.provider,
    providerId: entry.providerId,
    setCode: entry.setCode,
  };
}

/** Meta dalla cache condivisa, senza React (per codice puro/export). */
export function cachedMeta(ref: TypeRef): CardMeta | undefined {
  return findMeta(metaStore(), ref);
}
