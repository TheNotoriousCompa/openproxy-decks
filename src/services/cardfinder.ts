import { z } from "zod";
import { isExtraTurn, isMassLandDenial } from "@/lib/bracket";

/**
 * Ricerca avanzata Scryfall + "Consigliati" stile Moxfield.
 *
 * I consigliati NON usano scraping EDHREC (niente API pubbliche, HTML fragile):
 * Scryfall ordina per `order=edhrec` sul rank EDHREC ufficiale, filtrato
 * sull'identità di colore del comandante → le più giocate nei tuoi colori.
 */

const API = "https://api.scryfall.com";

const searchHitSchema = z.object({
  id: z.string(),
  name: z.string(),
  set: z.string().optional(),
  set_name: z.string().optional(),
  collector_number: z.string().optional(),
  rarity: z.string().optional(),
  cmc: z.number().optional(),
  mana_cost: z.string().optional(),
  game_changer: z.boolean().optional(),
  type_line: z.string().optional(),
  oracle_text: z.string().optional(),
  colors: z.array(z.string()).optional(),
  color_identity: z.array(z.string()).optional(),
  edhrec_rank: z.number().optional(),
  prices: z.object({ usd: z.string().nullable().optional() }).optional(),
  image_uris: z
    .object({
      small: z.string().optional(),
      normal: z.string().optional(),
      large: z.string().optional(),
      png: z.string().optional(),
    })
    .optional(),
  card_faces: z
    .array(
      z.object({
        name: z.string().optional(),
        type_line: z.string().optional(),
        oracle_text: z.string().optional(),
        mana_cost: z.string().optional(),
        colors: z.array(z.string()).optional(),
        image_uris: z
          .object({
            small: z.string().optional(),
            normal: z.string().optional(),
            large: z.string().optional(),
            png: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

export interface SearchHit {
  id: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity?: string;
  cmc?: number;
  manaCost?: string;
  gameChanger?: boolean;
  typeLine: string;
  oracleText?: string;
  colorIdentity: string[];
  edhrecRank?: number;
  priceUsd?: string;
  thumb?: string;
  imageLarge?: string;
  imageFull?: string;
  imageBack?: string;
  hasBack: boolean;
}

function toHit(raw: unknown): SearchHit | null {
  const parsed = searchHitSchema.safeParse(raw);
  if (!parsed.success) return null;
  const c = parsed.data;
  const face0 = c.card_faces?.[0];
  const front = c.image_uris?.png ?? c.image_uris?.large ?? face0?.image_uris?.png ?? face0?.image_uris?.large;
  const backImg = c.card_faces?.[1]?.image_uris?.png ?? c.card_faces?.[1]?.image_uris?.large;
  const identity = c.color_identity ?? face0?.colors ?? [];
  return {
    id: c.id,
    name: c.name,
    setCode: (c.set ?? "").toUpperCase(),
    setName: c.set_name ?? "",
    collectorNumber: c.collector_number ?? "",
    rarity: c.rarity,
    cmc: c.cmc,
    manaCost: c.mana_cost ?? face0?.mana_cost ?? undefined,
    gameChanger: c.game_changer === true ? true : undefined,
    typeLine: c.type_line ?? face0?.type_line ?? "",
    oracleText: c.oracle_text ?? face0?.oracle_text,
    colorIdentity: identity,
    edhrecRank: c.edhrec_rank,
    priceUsd: c.prices?.usd ?? undefined,
    thumb: c.image_uris?.small ?? face0?.image_uris?.small ?? front,
    imageLarge: front,
    imageFull: front,
    imageBack: backImg,
    hasBack: Boolean(backImg),
  };
}

export type FilterOp = "=" | "<=" | ">=";
export type ColorMode = "all" | "any";
export type SearchOrder = "edhrec" | "name" | "cmc" | "usd";
export type SearchDir = "asc" | "desc" | "auto";

export interface SearchFilters {
  /** testo libero (nome o sintassi Scryfall completa per utenti esperti) */
  text: string;
  /** tipo inglese Scryfall (creature, instant, …) o vuoto */
  type: string;
  /** solo leggendari (cerca comandanti) */
  legendaryOnly: boolean;
  /** colori carta (WUBRG + C=incolore) */
  colors: string[];
  /** all = deve averli tutti · any = almeno uno */
  colorMode: ColorMode;
  /** identità di colore (stessi valori dei colori) */
  identity: string[];
  identityMode: ColorMode;
  /** codice set (es. 40k) o vuoto */
  set: string;
  /** testo oracolo contiene */
  oracle: string;
  /** confronto + valore CMC (null = nessun vincolo) */
  mvOp: FilterOp;
  mv: number | null;
  /** costo di mana esatto stile {2}{G}{G} o vuoto */
  manaCost: string;
  powOp: FilterOp;
  pow: number | null;
  touOp: FilterOp;
  tou: number | null;
  loyOp: FilterOp;
  loy: number | null;
  /** rarità o vuoto */
  rarity: string;
  /** solo legali commander */
  commanderLegal: boolean;
  order: SearchOrder;
  dir: SearchDir;
}

export const EMPTY_FILTERS: SearchFilters = {
  text: "",
  type: "",
  legendaryOnly: false,
  colors: [],
  colorMode: "all",
  identity: [],
  identityMode: "all",
  set: "",
  oracle: "",
  mvOp: "=",
  mv: null,
  manaCost: "",
  powOp: "=",
  pow: null,
  touOp: "=",
  tou: null,
  loyOp: "=",
  loy: null,
  rarity: "",
  commanderLegal: true,
  order: "edhrec",
  dir: "auto",
};

/** Termine colore/identità: all → AND di termini, any → OR tra parentesi. */
function colorTerm(prefix: "c" | "id", letters: string[], mode: ColorMode): string | null {
  const onlyColorless = letters.length === 1 && letters[0] === "C";
  if (onlyColorless) return `${prefix}${prefix === "c" ? ":" : "="}colorless`;
  const ls = letters.filter((l) => l !== "C").map((l) => l.toLowerCase());
  if (ls.length === 0) return null;
  if (mode === "all") return ls.map((l) => `${prefix}:${l}`).join(" ");
  return `(${ls.map((l) => `${prefix}:${l}`).join(" OR ")})`;
}

/** Query Scryfall dai filtri (pura e testata). */
export function buildSearchQuery(f: SearchFilters): string {
  const parts: string[] = [];
  if (f.commanderLegal) parts.push("f:commander");
  if (f.legendaryOnly) parts.push("t:legendary");
  if (f.type.trim()) parts.push(`t:${f.type.trim().toLowerCase()}`);
  const ct = colorTerm("c", f.colors, f.colorMode);
  if (ct) parts.push(ct);
  const it = colorTerm("id", f.identity, f.identityMode);
  if (it) parts.push(it);
  if (f.set.trim()) parts.push(`e:${f.set.trim().toLowerCase()}`);
  if (f.mv !== null) parts.push(`mv${f.mvOp}${f.mv}`);
  if (f.manaCost.trim()) parts.push(`mana:${f.manaCost.trim()}`);
  if (f.pow !== null) parts.push(`pow${f.powOp}${f.pow}`);
  if (f.tou !== null) parts.push(`tou${f.touOp}${f.tou}`);
  if (f.loy !== null) parts.push(`loy${f.loyOp}${f.loy}`);
  if (f.rarity) parts.push(`r:${f.rarity}`);
  if (f.oracle.trim()) parts.push(`o:"${f.oracle.trim()}"`);
  if (f.text.trim()) parts.push(`(${f.text.trim()})`);
  return parts.join(" ");
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  hasMore: boolean;
}

async function fetchSearch(url: string, signal: AbortSignal): Promise<SearchResult> {
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (res.status === 404) return { hits: [], total: 0, hasMore: false };
  if (!res.ok) throw new Error(`Scryfall ${res.status}`);
  const json = (await res.json()) as { data?: unknown[]; total_cards?: number; has_more?: boolean };
  return {
    hits: (json.data ?? []).map(toHit).filter((h): h is SearchHit => h !== null),
    total: json.total_cards ?? 0,
    hasMore: json.has_more ?? false,
  };
}

/** Ricerca avanzata (ordine e direzione dal pannello). */
export function searchCardsAdvanced(
  q: string,
  opts: { order: SearchOrder; dir: SearchDir },
  signal: AbortSignal,
): Promise<SearchResult> {
  const url =
    `${API}/cards/search?order=${opts.order}&dir=${opts.dir}&unique=cards&q=${encodeURIComponent(q)}`;
  return fetchSearch(url, signal);
}

/** Identità di colore del comandante (null = carta non trovata su Scryfall). */
export async function fetchCommanderIdentity(
  name: string,
  signal: AbortSignal,
): Promise<string[] | null> {
  const res = await fetch(`${API}/cards/named?exact=${encodeURIComponent(name)}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Scryfall ${res.status}`);
  const json = (await res.json()) as { color_identity?: unknown };
  const parsed = z.array(z.string()).safeParse(json.color_identity);
  return parsed.success ? parsed.data : [];
}

/**
 * Consigliati per un'identità di colore: le più giocate in quei colori
 * (rank EDHREC ufficiale), già filtrate per sottoinsieme identità lato client
 * così il risultato vale anche per comandanti incolori (`id=colorless`
 * verificato live). Terre in fondo, come Moxfield.
 */
export async function fetchRecs(
  identity: string[],
  excludeNames: Set<string>,
  signal: AbortSignal,
  limit = 100,
): Promise<SearchHit[]> {
  const letters = [...identity].sort().join("").toLowerCase();
  const idPart = letters ? `id<=${letters} ` : `id=colorless `;
  const url =
    `${API}/cards/search?order=edhrec&unique=cards&q=` +
    encodeURIComponent(`${idPart}f:commander game:paper`);
  const res = await fetchSearch(url, signal);
  const want = new Set(letters.toUpperCase().split(""));
  const filtered = res.hits.filter((h) => {
    if (excludeNames.has(h.name.trim().toLowerCase())) return false;
    // sottoinsieme dell'identità (sicurezza anche quando il server non filtra)
    return h.colorIdentity.every((c) => want.has(c));
  });
  return landsLast(filtered).slice(0, limit);
}

/** Terre in fondo alla lista (non-lands prima, nell'ordine ricevuto). Pura. */
export function landsLast(hits: SearchHit[]): SearchHit[] {
  const lands: SearchHit[] = [];
  const rest: SearchHit[] = [];
  for (const h of hits) {
    if (h.typeLine.toLowerCase().includes("land")) lands.push(h);
    else rest.push(h);
  }
  return [...rest, ...lands];
}

export interface TypeRef {
  name: string;
  /** Scryfall UUID quando noto (via dritta, mai ambiguo: come fanno i siti) */
  provider?: string;
  providerId?: string;
  /** set noto (disambigua i token omonimi: es. Insect di t40k) */
  setCode?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Chiave cache: UUID quando noto, altrimenti nome+set. */
export function typeCacheKey(ref: TypeRef): string {
  if (ref.provider === "scryfall" && ref.providerId) return `id:${ref.providerId.toLowerCase()}`;
  return `n:${ref.name.trim().toLowerCase()}|${(ref.setCode ?? "").toLowerCase()}`;
}

export interface CardMeta {
  typeLine: string;
  /** layout Scryfall: `token`, `double_faced_token`, `emblem`… (token veri) */
  layout?: string;
  /** tipo set Scryfall: `token` per i set di soli token (es. «Poison Counter») */
  setType?: string;
  manaCost?: string;
  cmc?: number;
  colors?: string[];
  colorIdentity?: string[];
  priceUsd?: string;
  rarity?: string;
  /** Game Changer ufficiale Commander (flag `game_changer` di Scryfall) */
  gameChanger?: boolean;
  /** oracle text con «take … extra turn» */
  extraTurn?: boolean;
  /** mass land denial (nome noto o oracle text) */
  massLandDenial?: boolean;
}

async function fetchMeta(url: string, signal: AbortSignal): Promise<CardMeta | null> {
  try {
    const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return metaFromCard(await res.json());
  } catch {
    return null;
  }
}

/** Estrae CardMeta da un payload carta Scryfall (puro e testabile). */
export function metaFromCard(json: unknown): CardMeta | null {
  const root = json as {
    name?: unknown;
    type_line?: unknown;
    layout?: unknown;
    set_type?: unknown;
    mana_cost?: unknown;
    oracle_text?: unknown;
    game_changer?: unknown;
    cmc?: unknown;
    colors?: unknown;
    color_identity?: unknown;
    prices?: { usd?: unknown };
    rarity?: unknown;
    card_faces?: {
      type_line?: unknown;
      mana_cost?: unknown;
      oracle_text?: unknown;
      colors?: unknown;
    }[];
  };
  if (!root || typeof root !== "object") return null;
  const face = root.card_faces?.[0];
  const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
  const typeLine = str(root.type_line) ?? str(face?.type_line);
  if (!typeLine) return null;
  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
  const strs = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
  const usd = root.prices && typeof root.prices.usd === "string" ? root.prices.usd : undefined;
  const name = str(root.name) ?? "";
  const oracleText =
    str(root.oracle_text) ?? (Array.isArray(root.card_faces) ? root.card_faces.map((f) => str(f?.oracle_text) ?? "").join("\n") : "");
  return {
    typeLine,
    layout: str(root.layout),
    setType: str(root.set_type),
    manaCost: str(root.mana_cost) ?? str(face?.mana_cost),
    cmc: num(root.cmc),
    colors: strs(root.colors) ?? strs(face?.colors),
    colorIdentity: strs(root.color_identity),
    priceUsd: usd,
    rarity: str(root.rarity),
    gameChanger: root.game_changer === true ? true : undefined,
    extraTurn: isExtraTurn(oracleText) || undefined,
    massLandDenial: isMassLandDenial(name, oracleText || undefined) || undefined,
  };
}

/** Normalizza per confronto nomi: minuscolo, senza accenti né punteggiatura. */
function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Il fuzzy di Scryfall restituisce sempre *qualcosa*: si accetta solo se il
 * nome assomiglia davvero (contenimento normalizzato), altrimenti è meglio
 * "Sconosciuta" che la sezione sbagliata.
 */
export function fuzzyNameOk(want: string, got: string): boolean {
  const w = normName(want);
  const g = normName(got);
  return w.length > 0 && g.length > 0 && (g.includes(w) || w.includes(g));
}

async function fetchMetaChecked(
  url: string,
  signal: AbortSignal,
  wantName?: string,
): Promise<CardMeta | null> {
  try {
    const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as { name?: unknown };
    const meta = metaFromCard(json);
    if (!meta) return null;
    if (wantName !== undefined && typeof json.name === "string" && !fuzzyNameOk(wantName, json.name)) {
      return null;
    }
    return meta;
  } catch {
    return null;
  }
}

/** Esito con grado di confidenza: solo gli exact alimentano gli alias per nome. */
export interface ResolvedMeta {
  meta: CardMeta;
  /** true = match esatto (UUID, nome+set, nome); false = fuzzy validato */
  exact: boolean;
}

/** Meta carta (tipo + costo + stats) con cascata dal preciso al tollerante. */
export async function resolveCardMeta(ref: TypeRef, signal: AbortSignal): Promise<ResolvedMeta | null> {
  const name = ref.name.trim();
  if (!name) return null;
  if (ref.provider === "scryfall" && ref.providerId && UUID_RE.test(ref.providerId)) {
    const t = await fetchMeta(`${API}/cards/${ref.providerId}`, signal);
    if (t) return { meta: t, exact: true };
  }
  if (ref.setCode) {
    const t = await fetchMeta(
      `${API}/cards/named?exact=${encodeURIComponent(name)}&set=${encodeURIComponent(ref.setCode.toLowerCase())}`,
      signal,
    );
    if (t) return { meta: t, exact: true };
  }
  const exact = await fetchMeta(`${API}/cards/named?exact=${encodeURIComponent(name)}`, signal);
  if (exact) return { meta: exact, exact: true };
  const fuzzy = await fetchMetaChecked(
    `${API}/cards/named?fuzzy=${encodeURIComponent(name)}`,
    signal,
    name,
  );
  return fuzzy ? { meta: fuzzy, exact: false } : null;
}

/** Chunk bulk Scryfall (/cards/collection accetta max 75 identificatori). */
export const COLLECTION_CHUNK = 75;

export interface BulkResult {
  /** match esatti lato server (ref → meta) */
  found: { ref: TypeRef; meta: CardMeta }[];
  missing: TypeRef[];
}

/**
 * Risoluzione bulk: un POST con {name, set?} per carta (max 75 a botta) —
 * il server fa match esatto, niente roulette fuzzy, niente rate-limit da
 * centinaia di GET. Un commander da 109 carte si risolve in 2 richieste.
 * I token con set noto si disambiguano da soli; i miss vanno in `missing`
 * per la cascata individuale.
 */
export async function resolveMetaBulk(refs: TypeRef[], signal: AbortSignal): Promise<BulkResult> {
  const found: { ref: TypeRef; meta: CardMeta }[] = [];
  const missing: TypeRef[] = [];
  const clean = refs.filter((r) => r.name.trim() !== "");
  missing.push(...refs.filter((r) => r.name.trim() === ""));
  for (let i = 0; i < clean.length; i += COLLECTION_CHUNK) {
    if (signal.aborted) {
      missing.push(...clean.slice(i));
      break;
    }
    const chunk = clean.slice(i, i + COLLECTION_CHUNK);
    try {
      const res = await fetch(`${API}/cards/collection`, {
        method: "POST",
        signal,
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          identifiers: chunk.map((r) => {
            const o: Record<string, string> = { name: r.name.trim() };
            if (r.setCode?.trim()) o["set"] = r.setCode.trim().toLowerCase();
            return o;
          }),
        }),
      });
      if (!res.ok) {
        missing.push(...chunk);
        continue;
      }
      const json = (await res.json()) as { data?: unknown[] };
      const byKey = new Map<string, CardMeta>();
      for (const item of json.data ?? []) {
        const meta = metaFromCard(item);
        if (!meta) continue;
        const c = item as { id?: unknown; name?: unknown; set?: unknown };
        if (typeof c.id === "string" && c.id) byKey.set(`id:${c.id.toLowerCase()}`, meta);
        if (typeof c.name === "string" && c.name) {
          const n = c.name.toLowerCase();
          if (typeof c.set === "string" && c.set) byKey.set(`n:${n}|${c.set.toLowerCase()}`, meta);
          if (!byKey.has(`n:${n}|`)) byKey.set(`n:${n}|`, meta);
        }
      }
      for (const r of chunk) {
        const lower = r.name.trim().toLowerCase();
        const m =
          byKey.get(typeCacheKey(r)) ??
          byKey.get(`n:${lower}|${(r.setCode ?? "").toLowerCase()}`) ??
          byKey.get(`n:${lower}|`);
        if (m) found.push({ ref: r, meta: m });
        else missing.push(r);
      }
    } catch {
      missing.push(...chunk);
    }
    if (i + COLLECTION_CHUNK < clean.length) {
      await new Promise<void>((resolve) => {
        const t = window.setTimeout(resolve, 120);
        signal.addEventListener(
          "abort",
          () => {
            window.clearTimeout(t);
            resolve();
          },
          { once: true },
        );
      });
    }
  }
  return { found, missing };
}

/**
 * Risolve la type_line con cascata dal più preciso al più tollerante
 * (come i deckbuilder veri, che partono dallo Scryfall ID salvato):
 * 1. Scryfall UUID noto → `/cards/<id>` (esatto, anche token e ristampe);
 * 2. nome + set noto → `named?exact&set=` (disambigua token omonimi);
 * 3. nome esatto → `named?exact`;
 * 4. fuzzy validato → `named?fuzzy` solo se il nome assomiglia davvero;
 * 5. null → Sconosciute (meglio che la sezione sbagliata).
 */
export async function resolveTypeLine(ref: TypeRef, signal: AbortSignal): Promise<string | null> {
  const r = await resolveCardMeta(ref, signal);
  return r?.meta.typeLine ?? null;
}

/** Set Scryfall (per l'elenco «set esclusi» del picker). */
export interface ScryfallSet {
  code: string;
  name: string;
  setType: string;
  releasedAt?: string;
  cardCount: number;
}

const SETS_CACHE_KEY = "proxxied.scryfallSets";
const SETS_TTL_MS = 24 * 3600 * 1000;

const setRowSchema = z.object({
  code: z.string(),
  name: z.string(),
  set_type: z.string().optional(),
  released_at: z.string().optional(),
  card_count: z.number().optional(),
});

const setsResponseSchema = z.object({ data: z.array(setRowSchema) });

/**
 * Elenco completo dei set Scryfall, dal più recente. Cache 24h in localStorage:
 * ~1000 voci, una richiesta al giorno al massimo.
 */
export async function listScryfallSets(signal: AbortSignal): Promise<ScryfallSet[]> {
  try {
    const raw = localStorage.getItem(SETS_CACHE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as { at: number; sets: ScryfallSet[] };
      if (Array.isArray(v.sets) && v.sets.length > 0 && Date.now() - v.at < SETS_TTL_MS) return v.sets;
    }
  } catch {
    /* cache illeggibile: rifetch */
  }
  const res = await fetch(`${API}/sets`, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Scryfall set: HTTP ${res.status}`);
  const parsed = setsResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error("Scryfall set: formato non riconosciuto");
  const sets: ScryfallSet[] = parsed.data.data
    .map((s) => ({
      code: s.code.toLowerCase(),
      name: s.name,
      setType: s.set_type ?? "",
      releasedAt: s.released_at,
      cardCount: s.card_count ?? 0,
    }))
    .sort((a, b) => (b.releasedAt ?? "").localeCompare(a.releasedAt ?? ""));
  try {
    localStorage.setItem(SETS_CACHE_KEY, JSON.stringify({ at: Date.now(), sets }));
  } catch {
    /* quota: ignora */
  }
  return sets;
}
