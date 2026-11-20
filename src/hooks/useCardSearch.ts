import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebounced } from "@/hooks/useDebounced";
import { searchWithFallback } from "@/services/providers";

/** Ricerca carte con debounce + AbortController + cache TanStack + retry + fallback offline. */
export function useCardSearch(query: string) {
  const debounced = useDebounced(query.trim(), 350);

  const result = useQuery({
    queryKey: ["cards", "search", debounced],
    queryFn: async ({ signal }) => searchWithFallback(debounced, signal),
    enabled: debounced.length >= 2,
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    // Annulla la query precedente quando la query cambia (AbortController via TanStack).
    return () => {
      // no-op: TanStack abortisce automaticamente tramite signal
    };
  }, [debounced]);

  return result;
}
