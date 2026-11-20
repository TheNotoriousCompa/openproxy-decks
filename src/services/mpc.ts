import {
  mpcCardSchema,
  mpcCardsResponseSchema,
  mpcEditorSearchV2Schema,
  mpcEditorSearchV3Schema,
  mpcHealthSchema,
} from "@/lib/schemas";
import type { PrintOption } from "@/types";
import { useSettings } from "@/stores/settings";
import { invoke } from "@tauri-apps/api/core";
import { backend } from "@/services/backend";
import { DEFAULT_MPC_SERVER } from "@/lib/constants";
import { driveDownloadUrl, driveIdFromUrl, driveThumbUrl } from "@/lib/drive";

/** Re-export per compatibilità con gli import esistenti da questo modulo. */
export { driveDownloadUrl, driveIdFromUrl, driveThumbUrl };

export { DEFAULT_MPC_SERVER };

export type MpcStatus =
  | { ok: true }
  | { ok: false; reason: "not-configured" | "unreachable" | "unhealthy" | "invalid" | "empty"; detail?: string };

export class MpcError extends Error {
  readonly reason: Exclude<MpcStatus, { ok: true }>["reason"];
  constructor(reason: Exclude<MpcStatus, { ok: true }>["reason"], detail?: string) {
    super(detail ?? reason);
    this.reason = reason;
  }
}

/** Status HTTP dentro i messaggi del proxy Rust («proxy: HTTP 523») o errori fetch. */
export function httpStatusOf(e: unknown): number | null {
  const msg = e instanceof Error ? e.message : String(e);
  const m = /HTTP\s+(\d{3})/i.exec(msg);
  if (m) return Number(m[1]);
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : null;
}

/**
 * Traduce errori di rete/proxy in un messaggio utile. I 5xx di Cloudflare
 * (520–527) sono outage del server: 523 = «origin unreachable», frequente
 * quando mpcfill è in manutenzione.
 */
export function describeMpcError(
  e: unknown,
  server?: string,
): { reason: Exclude<MpcStatus, { ok: true }>["reason"]; detail: string; retryable: boolean } {
  if (e instanceof MpcError) {
    return { reason: e.reason, detail: e.message, retryable: e.reason === "unreachable" };
  }
  const host = (() => {
    try {
      return server ? new URL(server).host : "server MPC";
    } catch {
      return "server MPC";
    }
  })();
  const status = httpStatusOf(e);
  if (status !== null) {
    if (status === 429) {
      return {
        reason: "unreachable",
        detail: `Troppe richieste a ${host}: attendi qualche secondo e riprova.`,
        retryable: true,
      };
    }
    if (status >= 500) {
      const cf = status >= 520 && status <= 527 ? ` (Cloudflare ${status}: server d'origine non raggiungibile)` : "";
      return {
        reason: "unreachable",
        detail: `${host} è momentaneamente irraggiungibile${cf}. Riprova tra qualche minuto o usa la sorgente Scryfall.`,
        retryable: true,
      };
    }
    if (status === 404) {
      return {
        reason: "invalid",
        detail: `${host} non espone l'API attesa (404): controlla l'URL nelle Impostazioni.`,
        retryable: false,
      };
    }
    return { reason: "invalid", detail: `${host} ha risposto HTTP ${status}.`, retryable: false };
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/JSON non valido/i.test(msg)) {
    return { reason: "invalid", detail: `${host} ha risposto in un formato non riconosciuto.`, retryable: false };
  }
  return { reason: "unreachable", detail: `Impossibile raggiungere ${host}: ${msg}`, retryable: true };
}

/** Normalizza qualunque errore MPC in MpcError con messaggio leggibile. */
export function mpcErrorFrom(e: unknown, server?: string): MpcError {
  if (e instanceof MpcError) return e;
  const { reason, detail } = describeMpcError(e, server);
  return new MpcError(reason, detail);
}

/** Server default re-esportato per compatibilità (definito in lib/constants, senza cicli). */

const SOURCES_CACHE_KEY = "proxxied.mpcSources";
const SOURCES_TTL_MS = 24 * 3600 * 1000;
const TAGS_CACHE_KEY = "proxxied.mpcTags";

export interface MpcSource {
  pk: number;
  key: string;
  name: string;
}

/** Normalizza l'URL server (niente slash finali, solo http/https). */
export function normalizeServer(input: string): string | null {
  const t = input.trim().replace(/\/+$/, "");
  if (!t) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function configuredServer(): string | null {
  return normalizeServer(useSettings.getState().mpcServerUrl);
}

async function fetchDirect(url: string, init: RequestInit, signal: AbortSignal, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const onAbort = (): void => ctrl.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = window.setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) } });
    if (!res.ok) {
      const err = new Error(`MPC ${res.status}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return (await res.json()) as unknown;
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Chiamata API al server MPC.
 * Nell'app desktop passa dal proxy Rust (niente CORS); nel browser usa fetch diretto.
 * Lo `signal` abortisce il fetch diretto; per il proxy vale il timeout backend (25s).
 */
async function apiCall(
  server: string,
  path: string,
  opts: { method: "GET" | "POST"; body?: Record<string, unknown> },
  signal: AbortSignal,
  timeoutMs: number,
): Promise<unknown> {
  try {
    if (backend.isTauri) {
      return await invoke("mpc_proxy", { server, path, method: opts.method, body: opts.body ?? null });
    }
    const url = `${server}${path}`;
    const init: RequestInit =
      opts.method === "GET" ? { method: "GET" } : { method: "POST", body: JSON.stringify(opts.body ?? {}) };
    return await fetchDirect(url, init, signal, timeoutMs);
  } catch (e) {
    if (signal.aborted) throw e;
    // 5xx Cloudflare (es. 523 origin unreachable), 429, timeout: messaggio utile
    throw mpcErrorFrom(e, server);
  }
}
export async function checkMpcHealth(server: string, signal: AbortSignal): Promise<MpcStatus> {
  const base = normalizeServer(server);
  if (!base) return { ok: false, reason: "not-configured" };
  try {
    const raw = await apiCall(base, "/2/searchEngineHealth/", { method: "GET" }, signal, 10000);
    const parsed = mpcHealthSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "invalid", detail: "risposta health non valida" };
    return parsed.data.online ? { ok: true } : { ok: false, reason: "unhealthy", detail: "motore di ricerca spento" };
  } catch (e) {
    if (signal.aborted) return { ok: false, reason: "empty" };
    return { ok: false, reason: "unreachable", detail: e instanceof Error ? e.message : String(e) };
  }
}

export interface MpcSearchBody {
  path: "/2/editorSearch/" | "/3/editorSearch/";
  body: Record<string, unknown>;
}

/**
 * Costruisce il body di ricerca (puro, testabile).
 * Verificato live: cardType MAIUSCOLO e sources=[[pk,true]...], altrimenti zero risultati.
 * `tags` → includesTags dell'API (filtro tag nativo); client filtra il resto.
 * `cardTypes`: di default tutti e tre (CARD+TOKEN+CARDBACK) — cercare solo CARD
 * perde i token (es. "Treasure" ha 227 hit TOKEN) e i dorsi.
 * `fuzzy`: ripiego per nomi parziali ("Jodah" → 0 con exact, 65 con fuzzy).
 */
/** Nomi lingua come li usa il server MPC Autofill (enum lato loro). */
export const MPC_LANG_NAMES: Record<string, string> = { it: "Italian", en: "English" };

/** Tipi carta interrogati in editorSearch (tutti = nessuna stampa persa). */
export const MPC_CARD_TYPES = ["CARD", "TOKEN", "CARDBACK"] as const;
export type MpcCardType = (typeof MPC_CARD_TYPES)[number];

/** Parametri di una ricerca MPC (tutti opzionali: i default sono quelli "pieni"). */
export interface MpcSearchOptions {
  /** tag richiesti (`includesTags`) */
  tags?: string[];
  /** tag esclusi (`excludesTags`): filtro nativo, es. «AI Art» */
  excludeTags?: string[];
  /** lingue accettate, con i nomi enum del server (es. "Italian") */
  languages?: string[];
  /** tipi carta da interrogare (default: solo CARD) */
  cardTypes?: MpcCardType[];
  /** ricerca parziale sui nomi */
  fuzzy?: boolean;
  /** pk dei drive da escludere: entrano in richiesta con `false` */
  excludedSources?: ReadonlySet<number>;
}

/**
 * pk dei drive scelti dall'utente, dai loro nomi (case-insensitive).
 * Il nome è la chiave stabile: le stampe riportano `sourceName`, non il pk.
 */
export function excludedSourcePks(sources: MpcSource[], names: string[]): Set<number> {
  const wanted = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const out = new Set<number>();
  if (wanted.size === 0) return out;
  for (const s of sources) if (wanted.has(s.name.trim().toLowerCase())) out.add(s.pk);
  return out;
}

export function buildSearchBody(
  query: string,
  sources: MpcSource[],
  version: 2 | 3,
  opts: MpcSearchOptions = {},
): MpcSearchBody {
  const clean = (list: string[]): string[] => [
    ...new Set(list.map((t) => t.trim()).filter((t) => t.length > 0)),
  ];
  const cardTypes = opts.cardTypes ?? ["CARD"];
  const searchSettings = {
    filterSettings: {
      excludesTags: clean(opts.excludeTags ?? []),
      includesTags: clean(opts.tags ?? []),
      languages: clean(opts.languages ?? []),
      maximumDPI: 1500,
      maximumSize: 30,
      minimumDPI: 0,
    },
    searchTypeSettings: { filterCardbacks: false, fuzzySearch: opts.fuzzy ?? false },
    sourceSettings: {
      // `false` = drive escluso dall'utente (verificato live: non torna nei risultati)
      sources: sources.map((s) => [s.pk, !opts.excludedSources?.has(s.pk)]),
    },
  };
  if (version === 3) {
    const queries: Record<string, { cardType: string; query: string }> = {};
    cardTypes.forEach((t, i) => {
      queries[`q${i}`] = { cardType: t, query };
    });
    return { path: "/3/editorSearch/", body: { searchSettings, queries } };
  }
  return {
    path: "/2/editorSearch/",
    body: { searchSettings, queries: cardTypes.map((t) => ({ cardType: t, query })) },
  };
}

/** Estrae gli identifier dalla risposta v2 cercando la chiave della query (fallback: prima voce). */
export function parseV2Results(raw: unknown, query: string): string[] {
  const parsed = mpcEditorSearchV2Schema.safeParse(raw);
  if (!parsed.success) throw new MpcError("invalid", "formato risultati non riconosciuto");
  const out: string[] = [];
  const root = parsed.data.results[query];
  const scopes = root ? [root] : Object.values(parsed.data.results);
  for (const perType of scopes) {
    for (const arr of Object.values(perType)) out.push(...arr);
  }
  return [...new Set(out)];
}

function readSourcesCache(server: string): MpcSource[] | null {
  try {
    const raw = localStorage.getItem(SOURCES_CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at: number; server: string; sources: MpcSource[] };
    if (v.server !== server || Date.now() - v.at > SOURCES_TTL_MS) return null;
    if (!Array.isArray(v.sources) || v.sources.length === 0) return null;
    return v.sources;
  } catch {
    return null;
  }
}

/** Elenco drive del server (279 su mpcfill), con cache 24h. */
export async function getMpcSources(server: string, signal: AbortSignal): Promise<MpcSource[]> {
  const cached = readSourcesCache(server);
  if (cached) return cached;
  const raw = await apiCall(server, "/2/sources/", { method: "GET" }, signal, 15000);
  const results = (raw as { results?: Record<string, { pk?: unknown; key?: unknown; name?: unknown }> }).results;
  if (!results || typeof results !== "object") throw new MpcError("invalid", "elenco sorgenti non valido");
  const out: MpcSource[] = [];
  for (const item of Object.values(results)) {
    if (typeof item.pk === "number" && typeof item.key === "string" && typeof item.name === "string") {
      out.push({ pk: item.pk, key: item.key, name: item.name });
    }
  }
  if (out.length === 0) throw new MpcError("invalid", "nessuna sorgente dal server");
  try {
    localStorage.setItem(SOURCES_CACHE_KEY, JSON.stringify({ at: Date.now(), server, sources: out }));
  } catch {
    /* quota: ignora, rifarà fetch */
  }
  return out;
}

export interface MpcTag {
  name: string;
  parent: string | null;
  aliases: string[];
}

/** Appiattisce l'albero dei tag del server (nome + padre + alias, ordine di visita). */
export function flattenMpcTags(raw: unknown): MpcTag[] {
  const root = (raw as { tags?: unknown } | null)?.tags;
  const out: MpcTag[] = [];
  const walk = (nodes: unknown, parent: string | null): void => {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      const o = n as { name?: unknown; aliases?: unknown; parent?: unknown; children?: unknown };
      if (typeof o.name !== "string") continue;
      out.push({
        name: o.name,
        parent: typeof o.parent === "string" ? o.parent : parent,
        aliases: Array.isArray(o.aliases)
          ? o.aliases.filter((a): a is string => typeof a === "string")
          : [],
      });
      walk(o.children, o.name);
    }
  };
  walk(root, null);
  return out;
}

function readTagsCache(server: string): MpcTag[] | null {
  try {
    const raw = localStorage.getItem(TAGS_CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at: number; server: string; tags: MpcTag[] };
    if (v.server !== server || Date.now() - v.at > SOURCES_TTL_MS) return null;
    return Array.isArray(v.tags) && v.tags.length > 0 ? v.tags : null;
  } catch {
    return null;
  }
}

/** Tag del server MPC (es. «AI Art», «Pixel Art»), con cache 24h. */
export async function getMpcTags(server: string, signal: AbortSignal): Promise<MpcTag[]> {
  const cached = readTagsCache(server);
  if (cached) return cached;
  const raw = await apiCall(server, "/2/tags/", { method: "GET" }, signal, 15000);
  const tags = flattenMpcTags(raw);
  if (tags.length === 0) throw new MpcError("invalid", "nessun tag dal server");
  try {
    localStorage.setItem(TAGS_CACHE_KEY, JSON.stringify({ at: Date.now(), server, tags }));
  } catch {
    /* quota: ignora, rifarà fetch */
  }
  return tags;
}

async function identifiersFor(
  server: string,
  name: string,
  sources: MpcSource[],
  signal: AbortSignal,
  opts: MpcSearchOptions = {},
): Promise<string[]> {
  // v2 per prima (default mpcfill; v3 → 404 lì). v3 SOLO su errore v2
  // (endpoint diverso/rotto), mai su zero risultati: una risposta valida
  // e vuota non deve costare un secondo round-trip.
  // Tipi CARD+TOKEN+CARDBACK in UNA sola chiamata; se l'exact è vuoto,
  // un giro fuzzy (nomi parziali digitati nel picker).
  const base: MpcSearchOptions = { ...opts, cardTypes: [...MPC_CARD_TYPES], fuzzy: false };
  const exact = buildSearchBody(name, sources, 2, base);
  try {
    const raw = await apiCall(server, exact.path, { method: "POST", body: exact.body }, signal, 20000);
    const ids = parseV2Results(raw, name);
    if (ids.length > 0) return ids;
  } catch (e) {
    if (signal.aborted) throw e;
    // errore v2 → prova v3 sotto
    const v3 = buildSearchBody(name, sources, 3, base);
    const raw3 = await apiCall(server, v3.path, { method: "POST", body: v3.body }, signal, 20000);
    const parsed3 = mpcEditorSearchV3Schema.safeParse(raw3);
    if (!parsed3.success) throw new MpcError("invalid", "formato risultati non riconosciuto");
    return [...new Set(Object.values(parsed3.data.results).flat())];
  }
  const fuzzy = buildSearchBody(name, sources, 2, { ...base, fuzzy: true });
  const rawFuzzy = await apiCall(server, fuzzy.path, { method: "POST", body: fuzzy.body }, signal, 20000);
  return parseV2Results(rawFuzzy, name);
}

/** Mappa una Card MPC (validata) in PrintOption. Puro e testabile. */
export function toPrintOptionFromMpc(raw: unknown): PrintOption | null {
  const c = mpcCardSchema.safeParse(raw);
  if (!c.success) return null;
  const d = c.data;
  const full = d.downloadLink ?? driveDownloadUrl(d.identifier);
  return {
    source: "mpc",
    id: d.identifier,
    name: d.name,
    setCode: "",
    setName: d.sourceName ?? "",
    collectorNumber: "",
    releasedAt: d.dateCreated,
    thumb: d.smallThumbnailUrl,
    // griglia picker: `medium` w800 invece di `small` w400
    preview: d.mediumThumbnailUrl ?? d.smallThumbnailUrl,
    imageLarge: d.mediumThumbnailUrl ?? d.smallThumbnailUrl,
    imageFull: full,
    hasBack: false,
    highres: d.dpi >= 600,
    dpi: d.dpi,
    sourceLabel: d.sourceVerbose ?? d.sourceName,
    mpcTags: d.tags && d.tags.length > 0 ? d.tags : undefined,
  };
}

/** Chunk per /2/cards/: il server digerisce 720 id in una botta (~0.5s live),
 *  ma oltre si va in parallelo per non gonfiare un singolo payload. */
const CARDS_BATCH = 500;
/** Tetto difensivo: oltre è quasi sempre una query troppo lasca. */
const MAX_IDENTIFIERS = 2000;

export interface MpcSearchRequest {
  /** server alternativo (default: quello configurato) */
  server?: string;
  /** tag richiesti (`includesTags`) */
  tags?: string[];
  /** tag esclusi (`excludesTags`) */
  excludeTags?: string[];
  /** lingue accettate (nomi enum del server) */
  languages?: string[];
  /** nomi dei drive da escludere (risolti in pk sull'elenco sorgenti) */
  excludedSourceNames?: string[];
}

/** Stampe MPC (community renders) per nome carta. Richiede server configurato e sano. */
export async function searchMpcPrints(
  name: string,
  signal: AbortSignal,
  req: MpcSearchRequest = {},
): Promise<PrintOption[]> {
  const server = req.server ? normalizeServer(req.server) : configuredServer();
  if (!server) throw new MpcError("not-configured", "configura l'URL del server MPC nelle Impostazioni");
  const q = name.trim();
  if (!q) return [];
  const sources = await getMpcSources(server, signal);
  const ids = await identifiersFor(server, q, sources, signal, {
    tags: req.tags,
    excludeTags: req.excludeTags,
    languages: req.languages,
    excludedSources: excludedSourcePks(sources, req.excludedSourceNames ?? []),
  });
  if (ids.length === 0) return [];
  // NIENTE slice(0,120): Sol Ring ha 720 hit e il server li regge in ~0.5s.
  // Solo chunk paralleli + tetto difensivo.
  const capped = [...new Set(ids)].slice(0, MAX_IDENTIFIERS);
  const chunks: string[][] = [];
  for (let i = 0; i < capped.length; i += CARDS_BATCH) chunks.push(capped.slice(i, i + CARDS_BATCH));
  const raws = await Promise.all(
    chunks.map((cardIdentifiers) =>
      apiCall(server, "/2/cards/", { method: "POST", body: { cardIdentifiers } }, signal, 20000),
    ),
  );
  const out: PrintOption[] = [];
  for (const raw of raws) {
    const parsed = mpcCardsResponseSchema.safeParse(raw);
    if (!parsed.success) throw new MpcError("invalid", "dettagli carte non validi");
    for (const item of Object.values(parsed.data.results)) {
      const opt = toPrintOptionFromMpc(item);
      if (opt) out.push(opt);
    }
  }
  return out.sort((a, b) => (b.dpi ?? 0) - (a.dpi ?? 0));
}
