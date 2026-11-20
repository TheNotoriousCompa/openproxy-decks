import type { LayoutOutput } from "@/lib/layout";
import { ZONE_LABELS, type CardEntry, type Zone } from "@/types";

export const ZONE_ORDER: { zone: Zone; label: string }[] = (
  Object.keys(ZONE_LABELS) as Zone[]
).map((zone) => ({ zone, label: ZONE_LABELS[zone] }));

export interface ZoneCopy {
  entryId: string;
  name: string;
  /** zona di STAMPA (comandante già accorpato al main) */
  zone: Zone;
  imageFront?: string;
  imageBack?: string;
  hasBack: boolean;
  commander: boolean;
}

/** Riepilogo di una zona nel flusso di stampa: copie fisiche + voci distinte. */
export interface ZoneCount {
  zone: Zone;
  label: string;
  copies: number;
  entries: number;
}

/**
 * Flusso di stampa CONTINUO: tutte le copie in ordine di zona, un solo layout,
 * pagine sempre piene (solo l'ultima può restare incompleta). Le zone non
 * ripartono mai da pagina nuova: i conteggi e i chip di zona sono solo
 * informativi, l'ordine resta main → … → token.
 */
export interface PrintFlow {
  copies: ZoneCopy[];
  layout: LayoutOutput;
  /** zone presenti, in ordine di stampa */
  counts: ZoneCount[];
}

/**
 * Zona di STAMPA di una zona deck: il comandante si accorpa al main
 * (mai una pagina da solo, né in anteprima né nel PDF).
 */
export function printZoneOf(zone: Zone): Zone {
  return zone === "commander" ? "main" : zone;
}

/** Gruppi di stampa in ordine: zone deck mappate, senza duplicati, token per ultimi. */
export function printGroupsInOrder(): Zone[] {
  const order: Zone[] = ["main", "side", "extra", "maybe", "considering", "custom", "tokens"];
  const out: Zone[] = [];
  for (const zone of order) {
    const g = printZoneOf(zone);
    if (!out.includes(g)) out.push(g);
  }
  return out;
}

/**
 * Copie in flusso continuo: per ogni gruppo di stampa (main → … → token),
 * le voci deck nell'ordine di lista, ognuna espansa per la sua quantità.
 * Puro e testabile.
 */
export function flowCopies(deck: CardEntry[], includeConsidering: boolean): ZoneCopy[] {
  const out: ZoneCopy[] = [];
  for (const group of printGroupsInOrder()) {
    for (const c of deck) {
      if (printZoneOf(c.zone) !== group) continue;
      if (!includeConsidering && c.zone === "considering") continue;
      const qty = Math.max(0, Math.floor(c.qty));
      for (let i = 0; i < qty; i++) {
        out.push({
          entryId: c.id,
          name: c.name,
          zone: group,
          imageFront: c.imageFront,
          imageBack: c.imageBack,
          hasBack: c.hasBack,
          commander: c.commander === true || c.zone === "commander",
        });
      }
    }
  }
  return out;
}

/** Conteggi per zona presente nel flusso (ordine di stampa). Puro e testabile. */
export function flowCounts(copies: ZoneCopy[]): ZoneCount[] {
  const out: ZoneCount[] = [];
  for (const group of printGroupsInOrder()) {
    const inGroup = copies.filter((c) => c.zone === group);
    if (inGroup.length === 0) continue;
    out.push({
      zone: group,
      label: ZONE_LABELS[group],
      copies: inGroup.length,
      entries: new Set(inGroup.map((c) => c.entryId)).size,
    });
  }
  return out;
}
