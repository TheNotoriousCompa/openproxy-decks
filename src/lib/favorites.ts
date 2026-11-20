import { invoke } from "@tauri-apps/api/core";
import { backend } from "@/services/backend";
import type { PrintOption } from "@/types";

export interface Favorite {
  id: string;
  name: string;
  source: string;
}

const LS_KEY = "proxxied.favorites";

function readLocal(): Favorite[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (f): f is Favorite =>
        typeof f === "object" && f !== null &&
        typeof (f as Favorite).id === "string" &&
        typeof (f as Favorite).name === "string",
    );
  } catch {
    return [];
  }
}

function writeLocal(list: Favorite[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, 500)));
  } catch {
    /* quota: ignora */
  }
}

function toFav(opt: PrintOption): Favorite {
  return { id: opt.id, name: opt.name, source: opt.source };
}

function cleanList(raw: unknown): Favorite[] | null {
  if (!Array.isArray(raw)) return null;
  return (raw as unknown[]).filter(
    (f): f is Favorite =>
      typeof f === "object" && f !== null && typeof (f as Favorite).id === "string",
  );
}

/** Preferiti stampe (cuore nel picker), persistenti cross-progetto. */
export async function listFavorites(): Promise<Favorite[]> {
  if (backend.isTauri) {
    try {
      const clean = cleanList(await invoke<unknown>("list_favorites"));
      if (clean) return clean;
    } catch {
      /* fallback locale sotto */
    }
  }
  return readLocal();
}

export async function toggleFavorite(opt: PrintOption, favs: Favorite[]): Promise<Favorite[]> {
  const exists = favs.some((f) => f.id === opt.id);
  if (backend.isTauri) {
    try {
      const clean = cleanList(
        exists
          ? await invoke<unknown>("remove_favorite", { id: opt.id })
          : await invoke<unknown>("add_favorite", { fav: toFav(opt) }),
      );
      if (clean) return clean;
    } catch {
      /* fallback locale sotto */
    }
  }
  const next = exists ? favs.filter((f) => f.id !== opt.id) : [...favs, toFav(opt)];
  writeLocal(next);
  return next;
}
