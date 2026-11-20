/**
 * Commander Brackets (WotC, beta ott 2025 / feb 2026).
 *
 * Regole ufficiali usate qui:
 * - Bracket 1–2: **0 Game Changer**, nessun mass land denial, niente combo a
 *   2 carte; i turni extra solo in basse quantità (in 1 vietati).
 * - Bracket 3: **max 3 Game Changer**, nessun mass land denial, niente combo
 *   early; turni extra pochi e non concatenati.
 * - Bracket 4: nessun limite (Game Changer illimitati, MLD consentito).
 * - Bracket 5: cEDH, dipende dall'intento: non derivabile da una lista.
 *
 * Quindi il numero calcolabile è 2, 3 o 4. Bracket 1 (tema) e 5 (metagame)
 * restano una scelta dichiarata dal giocatore.
 *
 * I segnali `gameChanger` / `extraTurn` / `massLandDenial` arrivano da
 * Scryfall (`game_changer`, oracle text) e stanno in `CardMeta`.
 */

export interface BracketCardInfo {
  name: string;
  qty: number;
  gameChanger?: boolean;
  extraTurn?: boolean;
  massLandDenial?: boolean;
}

export interface BracketNamed {
  name: string;
  qty: number;
}

export interface BracketReport {
  /** bracket derivabile dai dati: 2, 3 o 4 */
  bracket: 2 | 3 | 4;
  gameChangers: BracketNamed[];
  gcCount: number;
  massLandDenial: BracketNamed[];
  extraTurns: BracketNamed[];
  /** spiegazione passo-passo del calcolo */
  reasons: string[];
  /** limiti del calcolo automatico */
  notes: string[];
}

/**
 * Carte che distruggono/esiliano/rimbalzano le terre in massa o le tengono
 * tappate (categoria ufficiale «mass land denial»). Elenco curato: i nomi
 * sono stabili, l'oracle text copre le varianti.
 */
const MLD_NAMES: ReadonlySet<string> = new Set([
  "armageddon",
  "ravages of war",
  "ruination",
  "sunder",
  "cataclysm",
  "jokulhaups",
  "obliterate",
  "decree of annihilation",
  "global ruin",
  "impending disaster",
  "fall of the thran",
  "boom // bust",
  "apocalypse",
  "winter orb",
  "static orb",
  "rising waters",
  "back to basics",
  "blood moon",
  "magus of the moon",
  "stasis",
]);

/** Pattern oracle che identificano negazione di massa delle terre. */
const MLD_PATTERNS: RegExp[] = [
  /destroy all lands/i,
  /destroy all creatures and lands/i,
  /exile all lands/i,
  /each player sacrifices (?:all|half|a third)[^.]*lands/i,
  /lands don't untap/i,
  /players can't untap more than one land/i,
  /nonbasic lands are (?:mountains|islands|swamps|forests|plains)/i,
  /all lands are (?:mountains|islands|swamps|forests|plains)/i,
];

/** «Take an extra turn», «takes an extra turn», «take two extra turns after this one». */
const EXTRA_TURN_RE = /\btakes? [^.]{0,24}extra turn/i;

export function normalizeCardName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function isMassLandDenial(name: string, oracleText?: string): boolean {
  const n = normalizeCardName(name);
  if (MLD_NAMES.has(n)) return true;
  // le carte doppia faccia arrivano come "A // B": prova anche le singole facce
  if (n.includes(" // ")) {
    for (const face of n.split(" // ")) if (MLD_NAMES.has(face.trim())) return true;
  }
  return oracleText ? MLD_PATTERNS.some((re) => re.test(oracleText)) : false;
}

export function isExtraTurn(oracleText?: string): boolean {
  return oracleText ? EXTRA_TURN_RE.test(oracleText) : false;
}

function addNamed(list: BracketNamed[], name: string, qty: number): void {
  const found = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (found) found.qty += qty;
  else list.push({ name, qty });
}

/**
 * Calcola il bracket dai segnali di mainboard (main + comandante).
 * Ordine delle regole: mass land denial → bracket 4; poi Game Changer.
 */
export function computeBracket(cards: BracketCardInfo[]): BracketReport {
  const gameChangers: BracketNamed[] = [];
  const massLandDenial: BracketNamed[] = [];
  const extraTurns: BracketNamed[] = [];

  for (const c of cards) {
    const qty = Math.max(1, Math.floor(c.qty));
    // i Game Changer si contano per CARTA, non per copia (Commander è singleton)
    if (c.gameChanger) addNamed(gameChangers, c.name, 1);
    if (c.massLandDenial) addNamed(massLandDenial, c.name, qty);
    if (c.extraTurn) addNamed(extraTurns, c.name, qty);
  }
  const gcCount = gameChangers.length;

  const reasons: string[] = [];
  let bracket: 2 | 3 | 4;

  if (massLandDenial.length > 0) {
    bracket = 4;
    reasons.push(
      `Mass land denial (${massLandDenial.map((m) => m.name).join(", ")}): vietato nei Bracket 1–3 → Bracket 4.`,
    );
  } else if (gcCount >= 4) {
    bracket = 4;
    reasons.push(`${gcCount} Game Changer: il Bracket 3 ne consente al massimo 3 → Bracket 4.`);
  } else if (gcCount > 0) {
    bracket = 3;
    reasons.push(`${gcCount} Game Changer (max 3 nel Bracket 3) → Bracket 3.`);
  } else {
    bracket = 2;
    reasons.push("0 Game Changer (Bracket 2 ne consente 0) → Bracket 2.");
  }

  if (extraTurns.length > 0) {
    reasons.push(
      `Turni extra: ${extraTurns.reduce((n, x) => n + x.qty, 0)} (${extraTurns
        .map((x) => x.name)
        .join(", ")}). Nei Bracket 1–3 solo pochi e mai concatenati: verifica l'intento.`,
    );
  }

  const notes = [
    "Bracket 1 (Exhibition) e 5 (cEDH) dipendono dal tema/metagame: non calcolabili da una lista.",
    "Le combo infinite a 2 carte non sono rilevabili dai soli metadati Scryfall.",
  ];

  return { bracket, gameChangers, gcCount, massLandDenial, extraTurns, reasons, notes };
}

export const BRACKET_LABEL: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "Exhibition",
  2: "Core",
  3: "Upgraded",
  4: "Optimized",
  5: "cEDH",
};
