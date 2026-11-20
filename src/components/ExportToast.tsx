import { open } from "@tauri-apps/plugin-shell";
import { useExportJob } from "@/stores/exportJob";

/**
 * Finestrella sticky in basso a sinistra: l'export PDF continua anche cambiando
 * tab/vista. Mostra fase e percentuale reali, poi apre PDF/cartella o l'errore.
 */
export function ExportToast(): JSX.Element | null {
  const job = useExportJob((s) => s.job);
  const dismiss = useExportJob((s) => s.dismiss);
  if (!job) return null;

  const pct = Math.round(job.frac * 100);
  const openPath = (p?: string): void => {
    if (p) void open(p).catch(() => undefined);
  };

  return (
    <div
      className="panel-2 thin-border fixed bottom-4 left-4 z-[60] w-[330px] rounded-xl p-3 shadow-[0_12px_32px_rgba(0,0,0,0.6)]"
      role="status"
      aria-live="polite"
      data-testid="export-toast"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-neutral-100" title={job.title}>
            {job.title}
          </p>
          <p className="mt-0.5 text-[11px] text-neutral-400" data-testid="export-toast-phase">
            {job.state === "running" && `${job.phase} · ${pct}%`}
            {job.state === "done" && "Completato"}
            {job.state === "error" && "Export non riuscito"}
          </p>
        </div>
        {job.state !== "running" && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Chiudi avviso export"
            data-testid="export-toast-close"
            className="shrink-0 rounded px-1 text-xs text-neutral-400 hover:text-neutral-100"
          >
            ✕
          </button>
        )}
      </div>

      {job.state === "running" && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800" data-testid="export-toast-bar">
          <div
            className="h-full rounded-full bg-neutral-200 transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {job.state === "done" && job.detail && (
        <p className="mt-1.5 break-words text-[11px] leading-4 text-neutral-400" data-testid="export-toast-detail">
          {job.detail}
        </p>
      )}
      {job.state === "error" && (
        <p className="mt-1.5 break-words text-[11px] leading-4 text-red-300" data-testid="export-toast-error">
          {job.error}
        </p>
      )}

      {job.state === "done" && (job.pdfPath || job.dir) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {job.pdfPath && (
            <button
              type="button"
              onClick={() => openPath(job.pdfPath)}
              data-testid="export-toast-open-pdf"
              className="rounded bg-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-black"
            >
              Apri PDF
            </button>
          )}
          {job.dir && (
            <button
              type="button"
              onClick={() => openPath(job.dir)}
              data-testid="export-toast-open-dir"
              className="panel thin-border rounded px-2.5 py-1 text-[11px]"
            >
              Apri cartella
            </button>
          )}
        </div>
      )}
    </div>
  );
}
