import type { PrintOption, PrintSource } from "@/types";

/**
 * Fonti escluse dal print-picker (preferenza persistente, vale per tutte le carte).
 *
 * Tre liste, una per tipo di fonte:
 * - `sources`: nomi dei drive MPC Autofill (es. «Trix Are For Scoot»). Il nome è
 *   la chiave stabile che vediamo anche nella tile (`setName` delle stampe MPC);
 *   il `pk` si ricava dall'elenco sorgenti al momento della richiesta.
 * - `tags`: tag MPC (es. «AI Art»). Le carte portano la catena completa
 *   (`["AI Art","Art","Custom Art"]`), quindi escludere un tag padre vale anche
 *   per i figli; l'API li filtra nativamente con `excludesTags`.
 * - `sets`: codici set Scryfall (minuscoli, es. `ltr`) per le stampe ufficiali.
 *
 * Confronti sempre case-insensitive: sono nomi scritti a mano dall'utente.
 */
export interface Exclusions {
  sources: string[];
  tags: string[];
  sets: string[];
}

export const NO_EXCLUSIONS: Exclusions = { sources: [], tags: [], sets: [] };

/** Suggerimento in evidenza nel pannello: l'arte generata è la lamentela tipica. */
export const AI_TAG = "AI Art";
export const AI_TAG_HINT = "arte generata (alias: AI, Midjourney, GenAI)";

function cleanNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/** Normalizza valori non fidati (settings vecchie, localStorage, backup). */
export function normalizeExclusions(v: unknown): Exclusions {
  const o = (v ?? {}) as Partial<Record<keyof Exclusions, unknown>>;
  return {
    sources: cleanNames(o.sources),
    tags: cleanNames(o.tags),
    sets: cleanNames(o.sets).map((s) => s.toLowerCase()),
  };
}

export function exclusionCount(ex: Exclusions): number {
  return ex.sources.length + ex.tags.length + ex.sets.length;
}

export function isEmptyExclusions(ex: Exclusions): boolean {
  return exclusionCount(ex) === 0;
}

/** Chiave stabile per la query cache (`null` = nessuna esclusione: «mostra escluse»). */
export function exclusionsKey(ex: Exclusions | null): string {
  if (!ex) return "all";
  const parts = [ex.sources, ex.tags, ex.sets].map((l) =>
    l.map((s) => s.toLowerCase()).sort().join(","),
  );
  return parts.join("|");
}

function toggle(list: string[], value: string, lower = false): string[] {
  const v = lower ? value.trim().toLowerCase() : value.trim();
  if (!v) return list;
  const has = list.some((x) => x.toLowerCase() === v.toLowerCase());
  return has ? list.filter((x) => x.toLowerCase() !== v.toLowerCase()) : [...list, v];
}

export function toggleSource(ex: Exclusions, name: string): Exclusions {
  return { ...ex, sources: toggle(ex.sources, name) };
}

export function toggleTag(ex: Exclusions, tag: string): Exclusions {
  return { ...ex, tags: toggle(ex.tags, tag) };
}

export function toggleSet(ex: Exclusions, code: string): Exclusions {
  return { ...ex, sets: toggle(ex.sets, code, true) };
}

/** Vista minima di una stampa serve a decidere se è esclusa. */
export interface ExcludablePrint {
  source: PrintSource;
  setCode?: string;
  setName?: string;
  sourceLabel?: string;
  /** tag della stampa MPC (catena completa dal server) */
  mpcTags?: string[];
}

/** Esclusioni pronte al confronto: set minuscoli, O(1) per stampa. */
export interface CompiledExclusions {
  sources: Set<string>;
  tags: Set<string>;
  sets: Set<string>;
}

const EMPTY: CompiledExclusions = { sources: new Set(), tags: new Set(), sets: new Set() };

export function compileExclusions(ex: Exclusions | null): CompiledExclusions {
  if (!ex) return EMPTY;
  return {
    sources: new Set((ex.sources ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean)),
    tags: new Set((ex.tags ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean)),
    sets: new Set((ex.sets ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean)),
  };
}

export function hasCompiledExclusions(c: CompiledExclusions): boolean {
  return c.sources.size > 0 || c.tags.size > 0 || c.sets.size > 0;
}

/** Nome del drive MPC di una stampa (per le stampe MPC `setName` è il drive). */
export function printSourceName(opt: ExcludablePrint): string {
  return (opt.setName || opt.sourceLabel || "").trim();
}

export function isPrintExcluded(opt: ExcludablePrint, c: CompiledExclusions): boolean {
  if (c.sets.size > 0 && opt.setCode && c.sets.has(opt.setCode.trim().toLowerCase())) return true;
  if (opt.source !== "mpc") return false;
  if (c.sources.size > 0) {
    const drive = printSourceName(opt);
    if (drive && c.sources.has(drive.toLowerCase())) return true;
  }
  return (opt.mpcTags ?? []).some((t) => c.tags.has(t.trim().toLowerCase()));
}

/** Filtra le stampe secondo le esclusioni (già compilate). Ordine preservato. */
export function filterPrints<T extends ExcludablePrint>(opts: T[], c: CompiledExclusions): T[] {
  if (!hasCompiledExclusions(c)) return opts;
  return opts.filter((o) => !isPrintExcluded(o, c));
}

/** Riga di sintesi pronta per l'interfaccia: «3 drive · 1 tag · 2 set». */
export function exclusionsSummary(ex: Exclusions): string {
  const parts: string[] = [];
  if (ex.sources.length) parts.push(`${ex.sources.length} drive`);
  if (ex.tags.length) parts.push(`${ex.tags.length} tag`);
  if (ex.sets.length) parts.push(`${ex.sets.length} set`);
  return parts.join(" · ");
}

/** Chip da mostrare nel picker (raggruppati per tipo: drive, tag, set). */
export function exclusionChips(
  ex: Exclusions,
): { kind: "source" | "tag" | "set"; value: string; label: string }[] {
  return [
    ...ex.sources.map((v) => ({ kind: "source" as const, value: v, label: v })),
    ...ex.tags.map((v) => ({ kind: "tag" as const, value: v, label: v })),
    ...ex.sets.map((v) => ({ kind: "set" as const, value: v, label: v.toUpperCase() })),
  ];
}

/** Rimosso un chip: riattiva quella fonte. */
export function removeExclusion(ex: Exclusions, kind: "source" | "tag" | "set", value: string): Exclusions {
  if (kind === "source") return toggleSource(ex, value);
  if (kind === "tag") return toggleTag(ex, value);
  return toggleSet(ex, value);
}

/** Etichetta breve dell'oggetto escluso da una stampa (per il toast «escluso …»). */
export function excludedLabelOf(opt: PrintOption): { kind: "source" | "set"; value: string } | null {
  if (opt.source === "mpc") {
    const drive = printSourceName(opt);
    return drive ? { kind: "source", value: drive } : null;
  }
  return opt.setCode ? { kind: "set", value: opt.setCode.toLowerCase() } : null;
}
