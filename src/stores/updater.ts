import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";
import { backend } from "@/services/backend";
import { checkForUpdate, relaunchApp } from "@/lib/updater";

export type UpdateStatus = "idle" | "checking" | "uptodate" | "available" | "downloading" | "ready" | "error";

interface UpdaterState {
  status: UpdateStatus;
  /** versione proposta dall'update */
  version: string | null;
  notes: string | null;
  /** 0..1 durante il download, null se non determinabile */
  progress: number | null;
  error: string | null;
  /** banner chiuso dall'utente per questa sessione */
  dismissed: boolean;
  check: (opts?: { silent?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  relaunch: () => Promise<void>;
  dismiss: () => void;
}

let pending: Update | null = null;

export const useUpdater = create<UpdaterState>()((set, get) => ({
  status: "idle",
  version: null,
  notes: null,
  progress: null,
  error: null,
  dismissed: false,

  check: async (opts) => {
    if (!backend.isTauri) {
      set({ status: "idle" });
      return;
    }
    if (get().status === "checking" || get().status === "downloading") return;
    set({ status: "checking", error: null });
    try {
      const update = await checkForUpdate();
      pending = update;
      if (!update) {
        set({ status: "uptodate", version: null, notes: null });
        return;
      }
      set({
        status: "available",
        version: update.version,
        notes: update.body ?? null,
        progress: null,
        dismissed: false,
      });
    } catch (e) {
      // controllo silenzioso all'avvio: nessun rumore se la rete manca
      if (opts?.silent) {
        set({ status: "idle" });
        return;
      }
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },

  install: async () => {
    if (!pending) return;
    let total = 0;
    let received = 0;
    set({ status: "downloading", progress: 0, error: null });
    try {
      await pending.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          set({ progress: total > 0 ? 0 : null });
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          set({ progress: total > 0 ? Math.min(0.99, received / total) : null });
        } else if (event.event === "Finished") {
          set({ progress: 1 });
        }
      });
      set({ status: "ready", progress: 1 });
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },

  relaunch: async () => {
    await relaunchApp();
  },

  dismiss: () => set({ dismissed: true }),
}));
