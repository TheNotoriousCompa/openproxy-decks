export type DeckProvider = "moxfield" | "archidekt";

export interface DetectedDeckLink {
  provider: DeckProvider;
  id: string;
}

/**
 * Rileva un link deck Moxfield/Archidekt nella stessa barra di ricerca.
 * Accetta URL completi, con/senza www, con slug finale, query o trailing slash,
 * e anche ID nudi (moxfield base62 / archidekt numerico) quando sono soli.
 *
 * Esempi:
 * - https://www.moxfield.com/decks/abcDEF1234/nome-mazzo
 * - moxfield.com/decks/abcDEF1234
 * - https://archidekt.com/decks/123456
 * - archidekt.com/decks/123456/nome
 */
export function detectDeckLink(input: string): DetectedDeckLink | null {
  const t = input.trim();
  if (!t) return null;

  // ID nudo: solo se l'intero input è un ID plausibile (evita falsi positivi su nomi carte).
  // Moxfield: base62 ~ 6+ char con almeno un mix; Archidekt: solo cifre ma servirebbe contesto URL,
  // quindi per ID nudi accettiamo solo moxfield-like (con lettere) preceduti da prefisso esplicito "moxfield:".
  const bareMox = t.match(/^moxfield:\s*([A-Za-z0-9_-]{4,64})$/i);
  if (bareMox?.[1]) return { provider: "moxfield", id: bareMox[1] };
  const bareArch = t.match(/^archidekt:\s*(\d{1,12})$/i);
  if (bareArch?.[1]) return { provider: "archidekt", id: bareArch[1] };

  // Cerca URL ovunque nella stringa (l'utente può incollare con spazi/testo attorno).
  // Nota: si usa [/] al posto di \/ per la regola eslint no-useless-escape.
  const mox = t.match(
    /(?:https?:[/][/])?(?:www\.)?moxfield\.com[/]decks[/]([A-Za-z0-9_-]{4,64})(?:[/?#\s]|$)/i,
  );
  if (mox?.[1]) return { provider: "moxfield", id: mox[1] };

  const arch = t.match(
    /(?:https?:[/][/])?(?:www\.)?archidekt\.com[/]decks[/](\d{1,12})(?:[/?#\s]|$)/i,
  );
  if (arch?.[1]) return { provider: "archidekt", id: arch[1] };

  // API URL diretti (comodi per debug): api.moxfield.com/v2/decks/all/<id>
  const moxApi = t.match(
    /(?:https?:[/][/])?api\.moxfield\.com[/]v2[/]decks[/]all[/]([A-Za-z0-9_-]{4,64})(?:[/?#\s]|$)/i,
  );
  if (moxApi?.[1]) return { provider: "moxfield", id: moxApi[1] };

  const archApi = t.match(
    /(?:https?:[/][/])?archidekt\.com[/]api[/]decks[/](\d{1,12})(?:[/?#\s]|$)/i,
  );
  if (archApi?.[1]) return { provider: "archidekt", id: archApi[1] };

  return null;
}

/** Etichetta umana per il provider rilevato (usata nella UI). */
export function providerLabel(p: DeckProvider): string {
  return p === "moxfield" ? "Moxfield" : "Archidekt";
}

/**
 * Rileva un profilo Moxfield: nickname nudo (`Necron_fan-99`) oppure link
 * (`https://www.moxfield.com/users/Necron_fan-99`). Ritorna il nickname
 * pulito, null se non sembra un profilo. Il deck-link (`/decks/…`) non
 * matcha qui: resta di competenza di `detectDeckLink`.
 *
 * Esempi:
 * - Necron_fan-99
 * - https://www.moxfield.com/users/Necron_fan-99
 * - moxfield.com/users/Necron_fan-99/
 */
export function detectMoxfieldUser(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  if (t.includes(" ") || t.includes("/decks/")) return null;
  const m = t.match(
    /^(?:https?:[/][/])?(?:www\.)?moxfield\.com[/]users?[/]([A-Za-z0-9_.-]{2,64})[/]?(?:[?#]|$)/i,
  );
  if (m?.[1]) return m[1];
  // nickname nudo (niente punti: "x.com" da solo è un dominio, non un utente)
  if (/^[A-Za-z0-9_-]{2,64}$/.test(t)) return t;
  return null;
}
