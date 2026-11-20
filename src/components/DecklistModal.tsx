import { useMemo, useState } from "react";
import { useDeck } from "@/stores/deck";
import { serializeDeckList } from "@/lib/decklist";
import { copyText } from "@/lib/clipboard";

/** Modale lista testuale corrente (qty + nome + set), con copia e download .txt. */
export function DecklistModal({ onClose }: { onClose: () => void }): JSX.Element {
  const deck = useDeck((s) => s.deck);
  const [copyState, setCopyState] = useState<"idle" | "done" | "error">("idle");
  const [copyError, setCopyError] = useState("");
  const [withMpcIds, setWithMpcIds] = useState(false);
  const hasMpcIds = deck.some((c) => c.provider === "mpc" && c.providerId);

  const text = useMemo(
    () =>
      serializeDeckList(
        deck.map((c) => ({
          qty: c.qty,
          name: c.name,
          zone: c.zone,
          setCode: c.setCode,
          collectorNumber: c.collectorNumber,
          mpcId: c.provider === "mpc" ? c.providerId : undefined,
        })),
        { withMpcIds },
      ),
    [deck, withMpcIds],
  );

  const copy = async (): Promise<void> => {
    const r = await copyText(text);
    if (r.ok) {
      setCopyState("done");
      setCopyError("");
    } else {
      setCopyState("error");
      setCopyError(r.error);
    }
  };

  const download = (): void => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "decklist.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Decklist corrente"
        data-testid="decklist-modal"
        className="panel thin-border flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-lg p-3"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Decklist ({deck.length} voci)</h2>
          <div className="flex flex-wrap items-center gap-2">
            {hasMpcIds && (
              <label className="flex items-center gap-1 text-xs text-neutral-400" title="Aggiungi gli MPC Art ID in coda riga (come proxxied.com)">
                <input
                  type="checkbox"
                  checked={withMpcIds}
                  onChange={(e) => setWithMpcIds(e.target.checked)}
                />
                con MPC IDs
              </label>
            )}
            <button
              onClick={() => void copy()}
              className="rounded bg-neutral-200 px-3 py-1 text-xs font-semibold text-black"
              aria-live="polite"
            >
              {copyState === "done" ? "Copiata!" : copyState === "error" ? "Riprova copia" : "Copia"}
            </button>
            <button
              onClick={download}
              className="panel-2 thin-border rounded px-3 py-1 text-xs"
              aria-label="Scarica decklist come file di testo"
            >
              Scarica .txt
            </button>
            <button onClick={onClose} className="panel-2 thin-border rounded px-3 py-1 text-xs" aria-label="Chiudi decklist">
              ✕
            </button>
          </div>
        </div>
        <pre className="panel-2 thin-border min-h-0 flex-1 overflow-auto rounded p-3 font-mono text-xs whitespace-pre-wrap">
          {text}
        </pre>
        {copyState === "error" && (
          <p className="mt-2 text-xs text-red-400" role="alert">
            Copia fallita: {copyError || "appunti non disponibili"}. Seleziona il testo a mano (Ctrl+A, Ctrl+C).
          </p>
        )}
      </div>
    </div>
  );
}
