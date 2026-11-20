import { useEffect, useState } from "react";

/** Debounce di un valore (provider search). */
export function useDebounced<T>(value: T, delayMs = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return v;
}
