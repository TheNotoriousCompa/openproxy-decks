import { PixelSpinner } from "@/components/PixelSpinner";
import type { ExportProgress } from "@/features/print/usePrintBuilder";

/** Box di attesa centrata durante la creazione del PDF (solo app desktop).
 * Barra simil-vera: parte da una stima (copie × pixel), insegue l'avanzamento
 * reale del backend con ETA live e si chiude solo alla fine vera.
 * Spinner pixel-art 3×3 (CSS puro). Tutto in italiano.
 */
export function PdfProgressModal({
  progress,
  status,
  detail,
}: {
  progress: number | null;
  status: string;
  detail?: ExportProgress | null;
}): JSX.Element | null {
  if (progress === null) return null;
  const pct = Math.max(0, Math.min(100, (detail?.frac ?? progress) * 100));
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      role="alertdialog"
      aria-label="Preparazione PDF in corso"
      aria-live="polite"
      data-testid="pdf-progress"
    >
      <div className="panel-2 thin-border flex min-w-64 flex-col items-center gap-3 rounded-lg px-8 py-6">
        <PixelSpinner />
        <p className="text-sm font-bold tracking-wide">Preparazione PDF…</p>
        {detail && (
          <p className="text-xs text-neutral-300" data-testid="pdf-progress-phase">
            {detail.phase}
          </p>
        )}
        {detail ? (
          <div className="w-full" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Avanzamento export PDF">
            <div className="px-bar">
              <div className="px-bar-fill-det" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-center text-[11px] tabular-nums text-neutral-400" data-testid="pdf-progress-stats">
              {detail.done}/{detail.total} copie · ~{detail.estMb} MB
              {detail.etaSecs !== null && detail.etaSecs > 0 ? ` · ~${detail.etaSecs}s rimasti` : ""}
            </p>
          </div>
        ) : (
          <div className="px-bar" aria-hidden="true">
            <div className="px-bar-fill" />
          </div>
        )}
        {status && (
          <p className="max-w-72 break-words text-center text-[11px] text-neutral-500">{status}</p>
        )}
      </div>
    </div>
  );
}
