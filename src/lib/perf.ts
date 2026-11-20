const FLAG_KEY = "proxxied.perf";

/**
 * Timing diagnostici del picker (apertura/selezione), spenti di default.
 * Attivazione: `localStorage.setItem("proxxied.perf", "1")` + ricarica.
 * Output su console.debug, mai in produzione normale e mai nei test
 * (jsdom ha comunque performance.now, ma il flag resta off).
 */
export function perfEnabled(): boolean {
  try {
    return localStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function perfNow(): number {
  return performance.now();
}

/** Logga `label +Nms` da `start` solo se il flag è attivo. */
export function perfMark(label: string, start?: number): void {
  if (!perfEnabled()) return;
  const suffix = start === undefined ? "" : ` +${Math.max(0, Math.round(performance.now() - start))}ms`;
  // eslint-disable-next-line no-console
  console.debug(`[perf] ${label}${suffix}`);
}
