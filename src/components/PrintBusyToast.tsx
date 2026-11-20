import { PixelSpinner } from "@/components/PixelSpinner";

/** Stato del cambio stampa: applicato subito, immagine scaricata in background. */
export interface PrintJobState {
  /** carta scelta */
  name: string;
  /** copie toccate (apply-all o singola) */
  count: number;
  startedAt: number;
  phase: "saving" | "done";
}

/**
 * Conferma del cambio stampa, in basso al centro. Il caricamento vero si vede
 * sulla carta stessa (spinner nella cella del foglio): qui resta solo l'esito.
 */
export function PrintBusyToast({ job }: { job: PrintJobState | null }): JSX.Element | null {
  if (!job || job.phase !== "done") return null;
  return (
    <div
      className="pointer-events-none fixed bottom-2 left-1/2 z-40 -translate-x-1/2"
      role="status"
      aria-live="polite"
      data-testid="print-busy"
    >
      <div className="panel-2 thin-border flex items-center gap-3 rounded-lg px-4 py-2.5">
        <span className="px-done" aria-hidden="true">
          ✓
        </span>
        <div className="min-w-40">
          <p className="text-xs font-bold">Stampa applicata</p>
          <p className="truncate text-[11px] text-neutral-400">
            {job.name}
            {job.count > 1 ? ` · ${job.count} copie` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Spinner mostrato SOPRA la carta in aggiornamento (dentro la cella del foglio). */
export function CellLoadingOverlay({ label }: { label?: string }): JSX.Element {
  return (
    <span
      className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-black/45"
      data-testid="cell-loading"
      title={label ?? "Preparazione stampa…"}
      role="status"
      aria-label={label ?? "Preparazione stampa"}
    >
      <PixelSpinner />
    </span>
  );
}
