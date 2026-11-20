import type { ParsedDeckList, Zone } from "@/types";

const ZONE_HEADERS: Record<string, Zone> = {
  mainboard: "main",
  main: "main",
  sideboard: "side",
  side: "side",
  commander: "commander",
  commanders: "commander",
  "extra deck": "extra",
  extradeck: "extra",
  extra: "extra",
  maybeboard: "maybe",
  maybe: "maybe",
  considering: "considering",
  tokens: "tokens",
  token: "tokens",
  custom: "custom",
};

/**
 * Drive ID MPC (min 20 char base64url): `1x Nome [SET] 123 (1Zf7lK...)`,
 * `(mpc:ID)`, `{ID}`. Accettato in coda riga, mai confuso col nome.
 */
const MPC_ID_RE = /[\s([{(](?:mpc:)?([A-Za-z0-9_-]{20,})\s*[)\]}]?\s*$/;

export interface SetInfo {
  name: string;
  setCode?: string;
  collectorNumber?: string;
  /** MPC Art ID trovato in coda riga (se presente) */
  mpcId?: string;
}

/** Separa un eventuale MPC Art ID in coda riga. Puro e testabile. */
export function extractMpcId(rest: string): { body: string; mpcId?: string } {
  const m = rest.match(MPC_ID_RE);
  if (!m || m.index === undefined) return { body: rest };
  const id = m[1] as string;
  // Evita falsi positivi: un puro numero lungo non è un Drive ID
  if (/^\d+$/.test(id)) return { body: rest };
  return { body: rest.slice(0, m.index).trim(), mpcId: id };
}

/**
 * Parser decklist tollerante:
 * - `4 Lightning Bolt`, `4x Lightning Bolt`
 * - set/numero in coda in varie notazioni: `[M11] 123`, `(ltc) 57`, `LTC 57`, `ltc-57`
 * - MPC Art ID in coda: `(mpc:ID)`, `(ID)`, `{ID}` con ID Drive ≥20 char
 * - token `t:Nome` (Moxfield/Archidekt) → zona tokens col nome pulito
 * - sezioni via header (`Sideboard`, `Commander`, ...) o `SB: ...`
 * - commenti `#` e `//` ignorati; righe vuote ignorate
 * - carte non riconosciute (qty assente/invalida) → `unknown`, mai eliminate
 */
export function parseDeckList(text: string): ParsedDeckList {
  const entries: ParsedDeckList["entries"] = [];
  const unknown: string[] = [];
  const warnings: string[] = [];
  let zone: Zone = "main";

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#") || line.startsWith("//")) continue;

    const lower = line.toLowerCase().replace(/:$/, "");
    if (ZONE_HEADERS[lower]) {
      zone = ZONE_HEADERS[lower] as Zone;
      continue;
    }

    let body = line;
    let lineZone = zone;
    if (/^sb\s*:/i.test(body)) {
      lineZone = "side";
      body = body.replace(/^sb\s*:/i, "").trim();
    }

    const m = body.match(/^(\d+)\s*[xX]?\s+(.+)$/);
    if (!m) {
      unknown.push(raw.trim());
      continue;
    }
    const qty = Number.parseInt(m[1] as string, 10);
    let rest = (m[2] as string).trim();
    if (!Number.isFinite(qty) || qty <= 0 || qty > 99 || !rest) {
      unknown.push(raw.trim());
      continue;
    }
    // Prefisso token stile Moxfield/Archidekt (`t:Nome`, dopo la quantità):
    // zona tokens, mai nel nome (Scryfall trova i token per nome).
    if (/^t\s*:/i.test(rest)) {
      lineZone = "tokens";
      rest = rest.replace(/^t\s*:/i, "").trim();
      if (!rest) {
        unknown.push(raw.trim());
        continue;
      }
    }
    // MPC Art ID in coda (se presente) → poi set/numero sul resto
    const { body: noMpc, mpcId } = extractMpcId(rest);
    // Estrae eventuale set/numero finale in varie notazioni (mai nel nome)
    const { name, setCode, collectorNumber } = extractSetInfo(noMpc);
    if (!name) {
      unknown.push(raw.trim());
      continue;
    }
    entries.push({ qty, name, zone: lineZone, setCode, collectorNumber, mpcId });
  }

  // Consolida duplicati (stesso nome+zona+set+mpcId: art diverse non si fondono)
  const map = new Map<string, (typeof entries)[number]>();
  for (const e of entries) {
    const k = `${e.zone}|${e.name.toLowerCase()}|${e.setCode ?? ""}|${e.collectorNumber ?? ""}|${e.mpcId ?? ""}`;
    const prev = map.get(k);
    if (prev) {
      prev.qty += e.qty;
      warnings.push(`Unite ${e.qty}x ${e.name} (duplicato)`);
    } else {
      map.set(k, { ...e });
    }
  }

  return { entries: [...map.values()], unknown, warnings };
}

const NUM_SUFFIX = String.raw`(\d+[a-zA-Z★†]*)?`;

function cutEnd(rest: string, idx: number): string {
  return rest.slice(0, idx).trim();
}

/**
 * Separa `nome` da `set/numero` finali. Accetta (in ordine):
 * 1. `[SET] 123` — 2. `(set) 123` — 3. `SET-123` — 4. `SET 123` (solo codice MAIUSCOLO,
 *    per non confondere nomi come "1996 World Champion").
 * Usata dal parser e dalla migrazione delle voci esistenti con `(set) num` nel nome.
 */
export function extractSetInfo(rest: string): SetInfo {
  const input = rest.trim();

  let m = input.match(new RegExp(`\\[([A-Za-z0-9]{2,6})\\]\\s*${NUM_SUFFIX}\\s*$`));
  if (m) {
    return {
      name: cutEnd(input, m.index ?? input.length),
      setCode: (m[1] as string).toUpperCase(),
      collectorNumber: m[2] as string | undefined,
    };
  }

  m = input.match(new RegExp(`\\(([A-Za-z0-9]{2,6})\\)\\s*${NUM_SUFFIX}\\s*$`));
  if (m) {
    return {
      name: cutEnd(input, m.index ?? input.length),
      setCode: (m[1] as string).toUpperCase(),
      collectorNumber: m[2] as string | undefined,
    };
  }

  m = input.match(new RegExp(`\\b([A-Za-z0-9]{2,6})-(\\d+[a-zA-Z★†]*)\\s*$`));
  if (m) {
    return {
      name: cutEnd(input, m.index ?? input.length),
      setCode: (m[1] as string).toUpperCase(),
      collectorNumber: m[2] as string | undefined,
    };
  }

  // Forma nuda `SET 123`: solo codice maiuscolo per evitare falsi positivi sui nomi.
  m = input.match(new RegExp(`\\b([A-Z0-9]{2,6})\\s+(\\d+[a-zA-Z★†]*)\\s*$`));
  if (m && /[A-Z]/.test(m[1] as string)) {
    return {
      name: cutEnd(input, m.index ?? input.length),
      setCode: m[1] as string,
      collectorNumber: m[2] as string | undefined,
    };
  }

  return { name: input };
}

export function serializeDeckList(
  entries: ParsedDeckList["entries"],
  opts?: { withMpcIds?: boolean },
): string {
  const zones: Zone[] = ["main", "side", "commander", "extra", "maybe", "considering", "tokens", "custom"];
  const byZone = new Map<Zone, typeof entries>();
  for (const e of entries) {
    const arr = byZone.get(e.zone) ?? [];
    arr.push(e);
    byZone.set(e.zone, arr);
  }
  const out: string[] = [];
  for (const z of zones) {
    const arr = byZone.get(z);
    if (!arr?.length) continue;
    if (z !== "main") out.push(z === "side" ? "Sideboard" : z[0]?.toUpperCase() + z.slice(1));
    for (const e of arr) {
      const suffix = e.setCode ? ` [${e.setCode}]${e.collectorNumber ? ` ${e.collectorNumber}` : ""}` : "";
      const mpc = opts?.withMpcIds && e.mpcId ? ` (${e.mpcId})` : "";
      out.push(`${e.qty} ${e.name}${suffix}${mpc}`);
    }
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}

export interface MpcXmlEntry {
  qty: number;
  name: string;
  /** Drive identifier MPC (fronte o retro a seconda della sezione) */
  mpcId: string;
  /** slot MPC dichiarati (per abbinare retro↔fronte) */
  slots: string[];
  back: boolean;
}

export interface ParsedMpcXml {
  fronts: MpcXmlEntry[];
  backs: MpcXmlEntry[];
  unknownCards: number;
}

/**
 * Parser tollerante dell'XML MPC Autofill (`<fronts>/<backs>` con
 * `<card><id>drive-id</id><slots>0,1</slots><name>…</name></card>`).
 * qty = numero di slot. Nessuna dipendenza XML: regex mirate + trim.
 */
export function parseMpcXml(text: string): ParsedMpcXml {
  const tag = (body: string, name: string): string => {
    const t = body.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"));
    return (t?.[1] ?? "").trim();
  };
  let unknownCards = 0;
  const pick = (section: "fronts" | "backs"): MpcXmlEntry[] => {
    const sec = text.match(new RegExp(`<${section}>([\\s\\S]*?)<\\/${section}>`, "i"));
    if (!sec?.[1]) return [];
    const out: MpcXmlEntry[] = [];
    const re = /<card>([\s\S]*?)<\/card>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sec[1])) !== null) {
      const body = m[1] as string;
      const id = tag(body, "id");
      if (!id) {
        unknownCards += 1;
        continue;
      }
      const slots = tag(body, "slots")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "" && Number.isFinite(Number(s)));
      const qty = Math.min(99, Math.max(1, slots.length || 1));
      const name = tag(body, "name") || tag(body, "query") || "Custom";
      out.push({ qty, name, mpcId: id, slots, back: section !== "fronts" });
    }
    return out;
  };
  const fronts = pick("fronts");
  const backs = pick("backs");
  return { fronts, backs, unknownCards };
}
