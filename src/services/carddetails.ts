import { useQuery } from "@tanstack/react-query";
import { typeCacheKey, type TypeRef } from "@/services/cardfinder";

const API = "https://api.scryfall.com";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Dettagli "lunghi" per l'anteprima hover: testo oracolo e stats. */
export interface CardDetails {
  oracleText?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  artist?: string;
}

interface ScryfallCard {
  oracle_text?: unknown;
  power?: unknown;
  toughness?: unknown;
  loyalty?: unknown;
  artist?: unknown;
  card_faces?: {
    oracle_text?: unknown;
    power?: unknown;
    toughness?: unknown;
    loyalty?: unknown;
  }[];
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/**
 * Testo oracolo on-demand (non entra nella cache metadati: sarebbe pesante).
 * Scryfall per UUID se noto, altrimenti nome esatto (+ set).
 */
export async function fetchCardDetails(ref: TypeRef, signal: AbortSignal): Promise<CardDetails | null> {
  const name = ref.name.trim();
  if (!name) return null;
  const url =
    ref.provider === "scryfall" && ref.providerId && UUID_RE.test(ref.providerId)
      ? `${API}/cards/${ref.providerId}`
      : `${API}/cards/named?exact=${encodeURIComponent(name)}${
          ref.setCode ? `&set=${encodeURIComponent(ref.setCode.trim().toLowerCase())}` : ""
        }`;
  try {
    const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const c = (await res.json()) as ScryfallCard;
    const faces = Array.isArray(c.card_faces) ? c.card_faces : [];
    const oracle = [str(c.oracle_text), ...faces.map((f) => str(f?.oracle_text))]
      .filter((t): t is string => Boolean(t))
      .filter((t, i, all) => all.indexOf(t) === i);
    return {
      oracleText: oracle.length > 0 ? oracle.join("\n\n") : undefined,
      power: str(c.power) ?? str(faces[0]?.power),
      toughness: str(c.toughness) ?? str(faces[0]?.toughness),
      loyalty: str(c.loyalty) ?? str(faces[0]?.loyalty),
      artist: str(c.artist),
    };
  } catch {
    return null;
  }
}

/** Dettagli con cache 1h (una richiesta per carta al primo hover). */
export function useCardDetails(ref: TypeRef | null): CardDetails | null | undefined {
  const key = ref ? typeCacheKey(ref) : "";
  const q = useQuery({
    queryKey: ["card-details", key],
    queryFn: ({ signal }) => (ref ? fetchCardDetails(ref, signal) : Promise.resolve(null)),
    enabled: Boolean(ref),
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 0,
  });
  return q.data;
}
