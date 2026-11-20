import type { Zone } from "@/types";

/**
 * Riconoscimento dei token veri da Scryfall.
 *
 * Il board "Tokens" di Moxfield contiene anche carte normali (i token-copia
 * sono agganciati alla carta: «The One Ring», «Glorious Gale», «Shapeshifter»…).
 * Il segnale esatto è il `layout` Scryfall (`token`, `double_faced_token`,
 * `emblem`); in mancanza si usa la type_line, dove i token hanno il supertipo
 * «Token» (o «Emblem»: es. «Emblem // Card» per The Ring).
 */
export interface TokenMeta {
  typeLine?: string;
  layout?: string;
  setType?: string;
}

const TOKEN_LAYOUTS = new Set(["token", "double_faced_token", "emblem"]);

/** Set di soli token: copre i casi con layout incoerente (es. «Poison Counter»). */
const TOKEN_SET_TYPES = new Set(["token"]);

/** Supertipo dei token/emblemi nella type_line Scryfall. */
const TOKEN_TYPE_RE = /\b(token|emblem)\b/i;

export function isTokenMeta(meta?: TokenMeta | null): boolean {
  if (!meta) return false;
  if (meta.layout && TOKEN_LAYOUTS.has(meta.layout)) return true;
  if (meta.setType && TOKEN_SET_TYPES.has(meta.setType)) return true;
  return typeof meta.typeLine === "string" && TOKEN_TYPE_RE.test(meta.typeLine);
}

/** Meta utilizzabile (tipo, layout o set noti): senza dati non si decide nulla. */
export function hasMeta(meta?: TokenMeta | null): boolean {
  if (!meta) return false;
  return (
    (typeof meta.typeLine === "string" && meta.typeLine !== "") || !!meta.layout || !!meta.setType
  );
}

/**
 * Voce nel board Token ma non token: Moxfield ci mette i token-copia agganciati
 * alla carta, non stampabili come token. Solo con tipo noto (mai a caso).
 */
export function isMisplacedInTokens(zone: Zone, meta?: TokenMeta | null): boolean {
  return zone === "tokens" && hasMeta(meta) && !isTokenMeta(meta);
}

/** Id delle voci del board Token da togliere (tipo noto e non-token). */
export function misplacedTokenIds<T extends { id: string; zone: Zone }>(
  entries: T[],
  metaOf: (entry: T) => TokenMeta | null | undefined,
): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (isMisplacedInTokens(e.zone, metaOf(e))) out.push(e.id);
  }
  return out;
}
