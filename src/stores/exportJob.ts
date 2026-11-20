import { create } from "zustand";
import { backend } from "@/services/backend";
import type { CollectionItem } from "@/lib/collection";

export type ExportJobKind = "single" | "batch";
export type ExportJobState = "running" | "done" | "error";

export interface ExportJob {
  kind: ExportJobKind;
  title: string;
  state: ExportJobState;
  /** 0..1 */
  frac: number;
  phase: string;
  /** riepilogo a fine export (pagine, copie…) */
  detail?: string;
  pdfPath?: string;
  dir?: string;
  error?: string;
  startedAt: number;
}

/** Fase del job backend → testo UI. */
export function phaseOf(status: string): string {
  if (status.includes("layout")) return "Impaginazione…";
  if (status.includes("done")) return "Scrittura PDF…";
  return "Elaborazione immagini…";
}

interface ExportJobStore {
  /** export attivo/ultimo concluso: vive fuori dalle viste, cambiare tab non lo perde */
  job: ExportJob | null;
  /** voci dell'ultimo export da proporre alla collezione (prompt globale) */
  collectItems: CollectionItem[] | null;
  begin: (kind: ExportJobKind, title: string) => void;
  progress: (frac: number, phase: string) => void;
  finish: (r: { detail?: string; pdfPath?: string; dir?: string }) => void;
  fail: (error: string) => void;
  dismiss: () => void;
  setCollectItems: (items: CollectionItem[] | null) => void;
}

let listening = false;

/** Un solo listener globale per gli eventi di avanzamento del backend. */
function ensureJobListener(): void {
  if (listening || !backend.isTauri) return;
  listening = true;
  void (async () => {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      await listen<{ progress: number; status: string }>("job://progress", (e) => {
        const s = useExportJob.getState();
        if (!s.job || s.job.state !== "running") return;
        s.progress(Math.max(0, Math.min(1, e.payload.progress)), phaseOf(e.payload.status));
      });
    } catch {
      // browser/dev: nessun evento
      listening = false;
    }
  })();
}

export const useExportJob = create<ExportJobStore>()((set) => ({
  job: null,
  collectItems: null,

  begin: (kind, title) => {
    ensureJobListener();
    set({
      job: {
        kind,
        title,
        state: "running",
        frac: 0,
        phase: "Preparazione…",
        startedAt: Date.now(),
      },
      collectItems: null,
    });
  },

  progress: (frac, phase) =>
    set((s) => (s.job && s.job.state === "running" ? { job: { ...s.job, frac, phase } } : {})),

  finish: ({ detail, pdfPath, dir }) =>
    set((s) =>
      s.job
        ? { job: { ...s.job, state: "done", frac: 1, phase: "Completato", detail, pdfPath, dir } }
        : {},
    ),

  fail: (error) =>
    set((s) => (s.job ? { job: { ...s.job, state: "error", error } } : {})),

  dismiss: () => set({ job: null }),

  setCollectItems: (items) => set({ collectItems: items }),
}));

/** L'export è in corso? (per disabilitare i bottoni in tutte le viste) */
export function isExportRunning(): boolean {
  return useExportJob.getState().job?.state === "running";
}
