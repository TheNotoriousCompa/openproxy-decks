import type { CardLang } from "@/types";

/** Scelte di lingua preferita delle stampe (in Impostazioni e nel print-picker). */
export const CARD_LANG_OPTIONS: { id: CardLang; label: string }[] = [
  { id: "any", label: "Qualsiasi" },
  { id: "it", label: "Italiano (poi inglese)" },
  { id: "en", label: "Inglese" },
];

export const CARD_LANG_LABEL: Record<CardLang, string> = {
  any: "Qualsiasi",
  it: "Italiano",
  en: "Inglese",
};

/**
 * Catena di tentativi per una lingua preferita: la preferita, poi l'inglese,
 * poi senza filtro. "any" non filtra, "en" non ripete l'inglese.
 * L'ultimo tentativo senza filtro copre anche i casi strani (set promozionali).
 */
export function langAttempts(preferred: CardLang | undefined): (string | undefined)[] {
  if (preferred === "it") return ["it", "en", undefined];
  if (preferred === "en") return ["en", undefined];
  return [undefined];
}

/** Nome leggibile della lingua usata da un tentativo. */
export function langName(lang: string | undefined): string {
  if (lang === "it") return "italiano";
  if (lang === "en") return "inglese";
  return "qualsiasi lingua";
}

/** true se la preferita non era disponibile e si è ripiegato su un'altra. */
export function isLangFallback(preferred: CardLang | undefined, used: string | undefined): boolean {
  const chain = langAttempts(preferred);
  const first = chain[0];
  return used !== first && Boolean(preferred) && preferred !== "any";
}
