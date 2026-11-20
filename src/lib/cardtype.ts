/**
 * Categorie di carte stile Archidekt/Moxfield dalla type_line Scryfall
 * (inglese). Priorità: Terra > Creatura > Planeswalker > Battaglia >
 * Istantaneo > Stregoneria > Artefatto > Incantesimo > Altro.
 * (un Artefatto Creatura va tra le Creature, come nei deckbuilder comuni).
 */

export type CardCategory =
  | "lands"
  | "creatures"
  | "artifacts"
  | "enchantments"
  | "instants"
  | "sorceries"
  | "planeswalkers"
  | "battles"
  | "other"
  | "unknown";

export const CATEGORY_ORDER: CardCategory[] = [
  "creatures",
  "artifacts",
  "enchantments",
  "instants",
  "sorceries",
  "planeswalkers",
  "battles",
  "lands",
  "other",
  "unknown",
];

export const CATEGORY_LABELS: Record<CardCategory, string> = {
  creatures: "Creature",
  artifacts: "Artefatti",
  enchantments: "Incantesimi",
  instants: "Istantanei",
  sorceries: "Stregonerie",
  planeswalkers: "Planeswalker",
  battles: "Battaglie",
  lands: "Terre",
  other: "Altre",
  unknown: "Sconosciute",
};

export function categoryOf(typeLine: string | undefined): CardCategory {
  if (!typeLine) return "unknown";
  const t = typeLine.toLowerCase();
  if (t.includes("land")) return "lands";
  if (t.includes("creature")) return "creatures";
  if (t.includes("planeswalker")) return "planeswalkers";
  if (t.includes("battle")) return "battles";
  if (t.includes("instant")) return "instants";
  if (t.includes("sorcery") || t.includes("sorceries")) return "sorceries";
  if (t.includes("artifact")) return "artifacts";
  if (t.includes("enchantment")) return "enchantments";
  if (t.includes("tribal") || t.includes("conspiracy") || t.includes("phenomenon") || t.includes("plane") || t.includes("scheme") || t.includes("vanguard")) {
    return "other";
  }
  return t.trim() ? "other" : "unknown";
}
