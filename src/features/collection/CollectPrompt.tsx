import { useMemo, useState } from "react";
import { useCollection } from "@/stores/collection";
import { mergeAdd, type CollectionItem } from "@/lib/collection";

/**
 * "Vuoi aggiungere questo deck alla tua collezione?" — dialogo post-export
 * (singolo e unito) con anteprima dei delta. Mai aggiunte silenziose:
 * riesportare lo stesso PDF mostra "+N su esistenti" e decidi tu.
 */
export function CollectPrompt({
  title,
  items,
  onClose,
}: {
  title: string;
  items: CollectionItem[];
  onClose: () => void;
}): JSX.Element {
  const entries = useCollection((s) => s.entries);
  const add = useCollection((s) => s.add);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const delta = useMemo(() => mergeAdd(entries, items), [entries, items]);
  const totalQty = items.reduce((n, i) => n + Math.max(1, Math.floor(i.qty)), 0);
  const shown = [...delta.added, ...delta.updated.map((u) => ({ key: u.key, name: u.name, qty: u.added }))].slice(0, 30);
  const hidden = delta.added.length + delta.updated.length - shown.length;

  const confirm = async (): Promise<void> => {
    setBusy(true);
    try {
      await add(items);
      setDone(true);
    } finally {
      setBusy(false);
    }
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
        aria-label="Aggiungi alla collezione"
        data-testid="collect-prompt"
        className="panel thin-border w-full max-w-md rounded-lg p-4"
      >
        {!done ? (
          <>
            <h2 className="mb-1 text-sm font-bold">{title}</h2>
            <p className="mb-3 text-xs text-neutral-400" data-testid="collect-prompt-summary">
              {totalQty} copie ·{" "}
              {delta.added.length === 0 && delta.updated.length === 0
                ? "niente da aggiungere"
                : `${delta.added.length} stampe nuove · +${delta.updated.reduce((n, u) => n + u.added, 0)} copie su esistenti`}
            </p>
            {shown.length > 0 && (
              <ul className="mb-3 max-h-56 space-y-1 overflow-auto text-xs">
                {shown.map((s) => (
                  <li key={s.key} className="flex justify-between gap-2">
                    <span className="truncate">{s.name}</span>
                    <span className="shrink-0 text-neutral-400">+{s.qty}</span>
                  </li>
                ))}
                {hidden > 0 && <li className="text-neutral-500">+ altre {hidden}…</li>}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="panel-2 thin-border rounded px-3 py-1.5 text-xs">
                No, grazie
              </button>
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={busy || (delta.added.length === 0 && delta.updated.length === 0)}
                data-testid="collect-prompt-confirm"
                className="rounded bg-neutral-200 px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
              >
                {busy ? "Aggiungo…" : "Sì, aggiungi"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="mb-1 text-sm font-bold">Collezione aggiornata</h2>
            <p className="mb-3 text-xs text-green-400">
              {delta.added.length} stampe nuove, +{delta.updated.reduce((n, u) => n + u.added, 0)} copie su esistenti.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                data-testid="collect-prompt-close"
                className="rounded bg-neutral-200 px-3 py-1.5 text-xs font-semibold text-black"
              >
                Chiudi
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
