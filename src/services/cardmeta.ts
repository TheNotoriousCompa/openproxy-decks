import { resolveCardMeta, resolveMetaBulk, typeCacheKey, type TypeRef } from "@/services/cardfinder";
import { metaStore, persistMetaCache, putMeta } from "@/lib/cardmetaCache";

export const META_BATCH = 8;
export const META_GAP_MS = 120;

/**
 * Risolve i metadati mancanti e li scrive nella cache condivisa.
 *
 * 1. bulk esatto `/cards/collection` (max 75 per richiesta): un commander in
 *    ~2 POST, match deterministici, token disambiguati dal server;
 * 2. cascata individuale solo per i miss (UUID → nome+set → esatto → fuzzy
 *    validato). L'alias per nome si scrive solo su match esatti.
 *
 * `onProgress(remaining)` viene chiamato a ogni blocco committato (il
 * chiamante calcola quanti ne restano). Abortibile: nessuna eccezione esce.
 */
export async function resolveMissingMetas(
  refs: TypeRef[],
  signal: AbortSignal,
  onProgress?: (remaining: number) => void,
): Promise<void> {
  const store = metaStore();
  const uniq = [...new Map(refs.map((r) => [typeCacheKey(r), r])).values()];
  let missing = uniq.filter((r) => !store.has(typeCacheKey(r)));
  const commit = (): void => {
    persistMetaCache();
    onProgress?.(missing.length);
  };
  onProgress?.(missing.length);
  if (missing.length === 0 || signal.aborted) return;

  // Fase 1: bulk esatto (errori ignorati: i miss vanno in cascata)
  try {
    const bulk = await resolveMetaBulk(missing, signal);
    for (const { ref, meta } of bulk.found) putMeta(ref, meta, true);
    missing = bulk.missing;
    commit();
  } catch {
    /* rete: si prosegue in cascata */
  }

  // Fase 2: cascata individuale per i miss (alias solo su match esatti)
  for (let i = 0; i < missing.length; i += META_BATCH) {
    if (signal.aborted) break;
    const batch = missing.slice(i, i + META_BATCH);
    const results = await Promise.all(batch.map((r) => resolveCardMeta(r, signal)));
    results.forEach((res, j) => {
      const ref = batch[j] as TypeRef;
      if (res) putMeta(ref, res.meta, res.exact);
    });
    const rest = missing.slice(i + META_BATCH);
    missing = rest;
    persistMetaCache();
    onProgress?.(missing.length);
    if (rest.length > 0) {
      await new Promise<void>((resolve) => {
        const t = window.setTimeout(resolve, META_GAP_MS);
        signal.addEventListener(
          "abort",
          () => {
            window.clearTimeout(t);
            resolve();
          },
          { once: true },
        );
      });
    }
  }
}
