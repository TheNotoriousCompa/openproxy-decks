import type { CardEntry, Project } from "@/types";
import { backend } from "@/services/backend";
import { refOf, cachedMeta } from "@/lib/cardmetaCache";
import { hasMeta, misplacedTokenIds } from "@/lib/cardzones";
import { resolveMissingMetas } from "@/services/cardmeta";

/**
 * Pulizia del board "Token" importato da Moxfield.
 *
 * Moxfield aggancia al board Token anche i token-copia come carte vere
 * («The One Ring», «Glorious Gale», «Shapeshifter»: nel deck LOTR erano 23 su
 * 31 voci). Il controllo vero è Scryfall: `layout` token/emblem, oppure il
 * supertipo «Token» nella type_line. Quei doppioni non sono stampabili come
 * token: si tolgono dal mazzo (l'utente li vede sparire dalla sezione
 * "Sconosciute"/"Creature" della zona Token).
 *
 * Una volta per progetto (flag locale): dopo la pulizia le scelte manuali
 * dell'utente restano intoccate.
 */
const LS_DONE = "proxxied.tokenboard.v1";

function readFlags(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LS_DONE);
    if (!raw) return {};
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj)) if (typeof v === "number") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function writeFlags(flags: Record<string, number>): void {
  try {
    localStorage.setItem(LS_DONE, JSON.stringify(flags));
  } catch {
    /* quota: ignora */
  }
}

/** true se il board Token del progetto è già stato ripulito (una volta sola). */
export function isTokenBoardFixed(projectId: string): boolean {
  return typeof readFlags()[projectId] === "number";
}

/** Marca il progetto come ripulito: le scelte successive dell'utente restano. */
export function markTokenBoardFixed(projectId: string): void {
  const flags = readFlags();
  flags[projectId] = Date.now();
  writeFlags(flags);
}

export interface TokenBoardFix {
  /** id delle voci non-token da togliere dal mazzo */
  drop: string[];
  /** false se la rete non ha permesso di classificare: si riprova più tardi */
  ok: boolean;
}

/** AbortSignal con scadenza: la rete non blocca mai export o avvio app. */
export function boundedSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => window.clearTimeout(timer) };
}

/**
 * Classifica le voci del board Token del deck e dice quali togliere.
 * Risolve solo le voci del board (non tutto il mazzo) e mai a caso: senza
 * tipo noto la voce resta dov'è.
 */
export async function fixTokensBoard(deck: CardEntry[], signal: AbortSignal): Promise<TokenBoardFix> {
  const board = deck.filter((c) => c.zone === "tokens");
  if (board.length === 0) return { drop: [], ok: true };
  await resolveMissingMetas(board.map(refOf), signal);
  const metaOf = (c: CardEntry) => cachedMeta(refOf(c));
  const drop = misplacedTokenIds(deck, metaOf);
  const known = board.filter((c) => hasMeta(metaOf(c))).length;
  return { drop, ok: !signal.aborted && known > 0 };
}

/**
 * Ripulisce il board Token di più progetti (export in blocco): aggiorna i
 * manifest dei soli progetti cambiati e ritorna la lista progetti aggiornata.
 * Il progetto attivo è già coperto dalla hook di avvio (deck live).
 */
export async function fixProjectsTokensBoard(
  projects: Project[],
  activeId: string | null,
): Promise<Project[]> {
  const out: Project[] = [];
  for (const p of projects) {
    if (p.id === activeId || isTokenBoardFixed(p.id)) {
      out.push(p);
      continue;
    }
    const { signal, cancel } = boundedSignal(8000);
    const { drop, ok } = await fixTokensBoard(p.manifest.deck, signal).finally(cancel);
    if (ok) markTokenBoardFixed(p.id);
    if (drop.length === 0) {
      out.push(p);
      continue;
    }
    const removed = new Set(drop);
    const deck = p.manifest.deck.filter((c) => !removed.has(c.id));
    const next: Project = {
      ...p,
      updated_at: new Date().toISOString(),
      manifest: { ...p.manifest, deck },
    };
    await backend.saveManifest(next);
    out.push(next);
  }
  return out;
}
