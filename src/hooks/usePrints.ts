import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scryfallProvider } from "@/services/providers";
import { MpcError, MPC_LANG_NAMES, searchMpcPrints } from "@/services/mpc";
import { queryClient } from "@/services/queryClient";
import { langAttempts } from "@/lib/cardLang";
import { compileExclusions, exclusionsKey, filterPrints, type Exclusions } from "@/lib/exclusions";
import type { CardLang, PrintOption, PrintSource } from "@/types";

export interface PrintsParams {
  source: PrintSource;
  submitted: string;
  mpcServer: string;
  lang: string;
  tags: string[];
  /**
   * Fonti da nascondere. `null` = nessuna esclusione: la variante «mostra
   * escluse» che permette di rivederle senza toccare le preferenze.
   */
  exclude: Exclusions | null;
}

export const PRINTS_STALE_MS = 10 * 60 * 1000;

export function printsQueryKey(p: PrintsParams): unknown[] {
  // `exclusionsKey` entra nella chiave: cambiare le fonti escluse invalida
  // (e rifetcha) i risultati, senza mostrare liste vecchie.
  return ["prints", p.source, p.submitted, p.mpcServer, p.lang, p.tags, exclusionsKey(p.exclude)];
}

/** Esito della ricerca stampe: array + lingua effettivamente usata. */
export interface PrintsResult {
  options: PrintOption[];
  /** lingua del primo tentativo che ha prodotto risultati (undefined = senza filtro) */
  langUsed: string | undefined;
}

/**
 * Fetch stampe con rendering progressivo e ripiego di lingua: si prova la
 * lingua preferita, poi l'inglese, poi senza filtro — così una carta senza
 * stampa italiana mostra comunque le altre invece di un errore.
 * Per Scryfall ogni pagina API viene pubblicata subito in cache (la griglia
 * mostra le prime tile senza aspettare le pagine successive).
 *
 * Le fonti escluse viaggiano anche nella richiesta MPC (`excludesTags` +
 * sorgenti a `false`: filtro nativo, meno dati in rete) e vengono comunque
 * filtrate a valle per Scryfall, dove il filtro è solo locale.
 */
export async function fetchPrints(p: PrintsParams, signal: AbortSignal): Promise<PrintsResult> {
  const attempts = langAttempts(p.lang as CardLang);
  const key = printsQueryKey(p);
  const compiled = compileExclusions(p.exclude);
  for (const lang of attempts) {
    if (signal.aborted) break;
    if (p.source === "scryfall") {
      const fn = scryfallProvider.getCardPrintings;
      if (!fn) return { options: [], langUsed: lang };
      const acc: PrintOption[] = [];
      const out = await fn.call(scryfallProvider, p.submitted, signal, lang, (batch) => {
        acc.push(...filterPrints(batch, compiled));
        // Pubblica il parziale: la UI renderizza mentre il resto viaggia.
        queryClient.setQueryData<PrintsResult>(key, { options: [...acc], langUsed: lang });
      });
      const visible = filterPrints(out, compiled);
      if (visible.length > 0) return { options: visible, langUsed: lang };
      continue;
    }
    // MPC: filtro lingua nativo sul server, senza filtro come ripiego
    const mpcLang = lang ? MPC_LANG_NAMES[lang] : undefined;
    const out = await searchMpcPrints(p.submitted, signal, {
      tags: p.tags,
      languages: mpcLang ? [mpcLang] : [],
      excludeTags: p.exclude?.tags ?? [],
      excludedSourceNames: p.exclude?.sources ?? [],
    });
    const visible = filterPrints(out, compiled);
    if (visible.length > 0) return { options: visible, langUsed: lang };
  }
  return { options: [], langUsed: attempts[0] };
}

export function usePrints(p: PrintsParams): UseQueryResult<PrintsResult, Error> {
  return useQuery({
    queryKey: printsQueryKey(p),
    queryFn: async ({ signal }): Promise<PrintsResult> => fetchPrints(p, signal),
    enabled: p.submitted.trim().length > 0,
    staleTime: PRINTS_STALE_MS,
    retry: (count, err) =>
      err instanceof MpcError ? err.reason === "unreachable" && count < 1 : count < 1,
    retryDelay: 1200,
  });
}

/**
 * Precarica le stampe (es. su hover della cella foglio) così all'apertura
 * del picker i dati sono spesso già in cache. Mai throw.
 */
export function prefetchPrints(p: PrintsParams): void {
  void queryClient
    .fetchQuery({
      queryKey: printsQueryKey(p),
      queryFn: ({ signal }): Promise<PrintsResult> => fetchPrints(p, signal),
      staleTime: PRINTS_STALE_MS,
    })
    .catch(() => undefined);
}
