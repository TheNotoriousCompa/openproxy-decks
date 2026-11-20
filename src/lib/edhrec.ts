/**
 * Collegamenti EDHREC (solo link in uscita: EDHREC non espone API pubbliche).
 * Slug: minuscolo, senza accenti, ogni run di non-alfanumerici → un trattino.
 * "Sol Ring" → sol-ring · "Fire // Ice" → fire-ice · "Jodah, the Unifier" →
 * jodah-the-unifier · "Séance" → seance.
 */
export function edhrecSlug(name: string): string {
  // NFD + rimozione segni diacritici (U+0300-U+036F), poi slug con trattini
  const flat = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['‘’]/g, "");
  return flat.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Pagina carta su EDHREC: router ufficiale per nome (sempre esatto,
 * anche con doppie facce e accenti). */
export function edhrecCardUrl(name: string): string {
  return `https://edhrec.com/route/?cc=${encodeURIComponent(name)}`;
}

/** Pagina comandante su EDHREC (top cards, synergy, budget…). */
export function edhrecCommanderUrl(name: string): string {
  return `https://edhrec.com/commanders/${edhrecSlug(name)}`;
}
