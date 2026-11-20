import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { CardLang, UpscaleMode } from "@/types";
import { DEFAULT_MPC_SERVER } from "@/lib/constants";
import { NO_EXCLUSIONS, normalizeExclusions, type Exclusions } from "@/lib/exclusions";

interface SettingsState {
  dpi: number;
  upscaleMode: UpscaleMode;
  cacheMb: number;
  /** URL base del server MPC Autofill (vuoto = tab MPC disabilitata). */
  mpcServerUrl: string;
  /** lingua preferita delle stampe: se non esiste si ripiega sull'inglese */
  cardLang: CardLang;
  /** fonti nascoste nel print-picker: drive MPC, tag MPC, set Scryfall */
  excluded: Exclusions;
  loaded: boolean;
  load: () => Promise<void>;
  save: () => Promise<void>;
  set: (p: Partial<Pick<SettingsState, "dpi" | "upscaleMode" | "cacheMb" | "mpcServerUrl" | "cardLang">>) => void;
  setExcluded: (next: Exclusions) => void;
}

export const useSettings = create<SettingsState>()((set, get) => ({
  dpi: 1200,
  upscaleMode: "auto",
  cacheMb: 2048,
  mpcServerUrl: DEFAULT_MPC_SERVER,
  cardLang: "any",
  excluded: NO_EXCLUSIONS,
  loaded: false,

  load: async () => {
    try {
      const v = await invoke<{
        dpi: number;
        upscaleMode: UpscaleMode;
        cacheMb?: number;
        mpcServerUrl?: string;
        cardLang?: CardLang;
        excluded?: unknown;
      }>("get_settings");
      // Solo nullish → default: una stringa vuota salvata resta una scelta esplicita.
      // "always" era il default distribuito → si migra ad "auto" (default attuale).
      const upscaleMode = v.upscaleMode === "always" ? "auto" : v.upscaleMode;
      set({
        dpi: v.dpi,
        upscaleMode,
        cacheMb: v.cacheMb ?? 2048,
        mpcServerUrl: v.mpcServerUrl ?? DEFAULT_MPC_SERVER,
        cardLang: v.cardLang ?? "any",
        excluded: normalizeExclusions(v.excluded),
        loaded: true,
      });
    } catch {
      try {
        const raw = localStorage.getItem("proxxied.settings");
        if (raw) {
          const v = JSON.parse(raw) as Partial<SettingsState>;
          set({
            ...v,
            mpcServerUrl: v.mpcServerUrl ?? DEFAULT_MPC_SERVER,
            excluded: normalizeExclusions(v.excluded),
            loaded: true,
          });
          return;
        }
      } catch {
        /* ignore */
      }
      try {
        const legacy = localStorage.getItem("proxxied.mpcServer");
        if (legacy) {
          set({ mpcServerUrl: legacy, loaded: true });
          return;
        }
      } catch {
        /* ignore */
      }
      set({ loaded: true });
    }
  },

  save: async () => {
    const { dpi, upscaleMode, cacheMb, mpcServerUrl, cardLang, excluded } = get();
    try {
      await invoke("set_settings", {
        value: { dpi, page: "a4", card: "tcg", upscaleMode, cacheMb, mpcServerUrl, cardLang, excluded },
      });
    } catch {
      try {
        localStorage.setItem(
          "proxxied.settings",
          JSON.stringify({ dpi, upscaleMode, cacheMb, mpcServerUrl, cardLang, excluded }),
        );
      } catch {
        /* ignore */
      }
    }
  },

  set: (p) => {
    set(p);
    void get().save();
  },

  setExcluded: (next) => {
    set({ excluded: normalizeExclusions(next) });
    void get().save();
  },
}));
