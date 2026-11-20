import { useEffect, useState } from "react";
import { typeCacheKey, type CardMeta, type TypeRef } from "@/services/cardfinder";
import { findMeta, metaStore } from "@/lib/cardmetaCache";
import { resolveMissingMetas } from "@/services/cardmeta";

export { typeCacheKey, findMeta };

/**
 * Meta Scryfall per le voci (type_line, mana, layout…), dalla cache
 * persistente condivisa (`@/lib/cardmetaCache`).
 *
 * La risoluzione (bulk esatto `/cards/collection`, poi cascata individuale
 * sui miss) vive in `@/services/cardmeta`: la usano anche la pulizia del
 * board Token e l'export multi-progetto, così ogni carta si risolve una
 * volta sola per tutta l'app.
 */
export function useCardMeta(refs: TypeRef[]): {
  meta: Map<string, CardMeta>;
  loaded: number;
  total: number;
  retry: () => void;
} {
  const [cache, setCache] = useState<Map<string, CardMeta>>(() => new Map(metaStore()));
  const [loaded, setLoaded] = useState(0);
  const [nonce, setNonce] = useState(0);
  // fingerprint stabile a parità di contenuto (array ricreato a ogni render)
  const fingerprint = JSON.stringify(refs.map((r) => [r.name, r.provider, r.providerId, r.setCode]));

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    void (async () => {
      const store = metaStore();
      const uniq = [...new Map(refs.map((r) => [typeCacheKey(r), r])).values()];
      const missing = uniq.filter((r) => !store.has(typeCacheKey(r)));
      setLoaded(refs.length - missing.length);
      setCache(new Map(store));
      await resolveMissingMetas(refs, ctrl.signal, (remaining) => {
        if (cancelled) return;
        setCache(new Map(metaStore()));
        setLoaded(refs.length - remaining);
      });
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // refs letto dal render che ha prodotto fingerprint: riesegue solo al cambio contenuto
  }, [fingerprint, nonce]);

  return { meta: cache, loaded, total: refs.length, retry: () => setNonce((n) => n + 1) };
}

/**
 * Compat: mappe nome→type_line e nome→mana_cost (stessa API di prima,
 * ora sopra useCardMeta).
 */
export function useCardTypes(refs: TypeRef[]): {
  types: Map<string, string>;
  mana: Map<string, string>;
  meta: Map<string, CardMeta>;
  loaded: number;
  total: number;
  retry: () => void;
} {
  const { meta, loaded, total, retry } = useCardMeta(refs);
  const types = new Map<string, string>();
  const mana = new Map<string, string>();
  for (const [k, v] of meta) {
    types.set(k, v.typeLine);
    if (v.manaCost) mana.set(k, v.manaCost);
  }
  return { types, mana, meta, loaded, total, retry };
}
