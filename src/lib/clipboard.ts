export type CopyResult = { ok: true; method: "clipboard" | "execCommand" } | { ok: false; error: string };

/**
 * Copia testo negli appunti su 3 livelli:
 * 1. navigator.clipboard (contesti sicuri) · 2. textarea + execCommand (fallback legacy)
 * 3. errore esplicito (mai silenzio).
 */
export async function copyText(text: string): Promise<CopyResult> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return { ok: true, method: "clipboard" };
    }
  } catch (e) {
    // scende al fallback sotto
    void e;
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const done = document.execCommand("copy");
    document.body.removeChild(ta);
    if (done) return { ok: true, method: "execCommand" };
    return { ok: false, error: "comando di copia rifiutato dal browser" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
