import { create } from "zustand";

export type Tab = "projects" | "studio" | "deckbuilder" | "collection" | "settings";

/** Destinazione dopo un import bulk (la lista è condivisa tra Studio e DeckBuilder). */
export type ImportTarget = "studio" | "deckbuilder";

interface UiState {
  tab: Tab;
  leftWidth: number;
  printWidth: number;
  importTarget: ImportTarget;
  setTab: (t: Tab) => void;
  setLeftWidth: (w: number) => void;
  setPrintWidth: (w: number) => void;
  setImportTarget: (t: ImportTarget) => void;
}

function num(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, v: number): void {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    /* ignore */
  }
}

function str(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveStr(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

export const useUi = create<UiState>()((set) => ({
  tab: "studio",
  leftWidth: num("proxxied.leftWidth", 300),
  printWidth: num("proxxied.printWidth", 420),
  importTarget: str("proxxied.importTarget", "studio") === "deckbuilder" ? "deckbuilder" : "studio",
  setTab: (tab) => set({ tab }),
  setImportTarget: (importTarget) => {
    saveStr("proxxied.importTarget", importTarget);
    set({ importTarget });
  },
  setLeftWidth: (w) => {
    const v = Math.min(520, Math.max(200, Math.round(w)));
    save("proxxied.leftWidth", v);
    set({ leftWidth: v });
  },
  setPrintWidth: (w) => {
    const v = Math.min(640, Math.max(300, Math.round(w)));
    save("proxxied.printWidth", v);
    set({ printWidth: v });
  },
}));
