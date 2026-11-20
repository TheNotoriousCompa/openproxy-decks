import { useUpdater } from "@/stores/updater";

/**
 * Striscia discreta sotto la TopBar: compare solo quando c'è qualcosa da fare
 * (update disponibile, download, riavvio). Niente modali all'avvio.
 */
export function UpdateBanner(): JSX.Element | null {
  const { status, version, progress, error, dismissed, install, relaunch, dismiss } = useUpdater();
  if (dismissed) return null;
  if (status !== "available" && status !== "downloading" && status !== "ready" && status !== "error") return null;

  const pct = progress !== null ? Math.round(progress * 100) : null;

  return (
    <div
      data-testid="update-banner"
      role="status"
      aria-live="polite"
      className="flex shrink-0 flex-wrap items-center gap-2 border-b thin-border bg-neutral-900 px-3 py-1.5 text-xs"
    >
      {status === "available" && (
        <>
          <span className="font-semibold text-neutral-100">Aggiornamento {version} disponibile</span>
          <span className="text-neutral-400">Nuova versione di OpenProxy &amp; Decks.</span>
        </>
      )}
      {status === "downloading" && (
        <>
          <span className="font-semibold text-neutral-100">Scarico {version}…</span>
          <span className="text-neutral-400 tabular-nums">{pct !== null ? `${pct}%` : "in corso"}</span>
          <span className="ml-2 h-1 w-40 overflow-hidden rounded-full bg-neutral-800" aria-hidden="true">
            <span
              className="block h-full rounded-full bg-neutral-200 transition-[width] duration-300"
              style={{ width: `${pct ?? 0}%` }}
            />
          </span>
        </>
      )}
      {status === "ready" && (
        <span className="font-semibold text-neutral-100">Aggiornamento installato: riavvia per completare.</span>
      )}
      {status === "error" && (
        <span className="text-red-300">Aggiornamento non riuscito: {error}</span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {status === "available" && (
          <button
            type="button"
            onClick={() => void install()}
            data-testid="update-install"
            className="rounded bg-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-black"
          >
            Aggiorna
          </button>
        )}
        {status === "error" && (
          <button
            type="button"
            onClick={() => void install()}
            data-testid="update-retry"
            className="rounded bg-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-black"
          >
            Riprova
          </button>
        )}
        {status === "ready" && (
          <button
            type="button"
            onClick={() => void relaunch()}
            data-testid="update-relaunch"
            className="rounded bg-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-black"
          >
            Riavvia
          </button>
        )}
        {status !== "downloading" && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Chiudi avviso aggiornamento"
            data-testid="update-dismiss"
            className="text-[11px] text-neutral-400 hover:text-neutral-100"
          >
            Più tardi
          </button>
        )}
      </div>
    </div>
  );
}
