import { useEffect, useState } from "react";
import { useArtworkSrc } from "@/hooks/useArtwork";

export interface LightboxItem {
  /** riferimento artwork (remoto, asset:// o path locale: come nelle tile) */
  src: string;
  name: string;
  /** riga info: qty, tipo, set, prezzo */
  sub?: string;
}

/**
 * Lightbox tutto-schermo per vedere la stampa "figa": immagine alla massima
 * risoluzione disponibile (stesso pipeline delle tile, max 1024px), zoom
 * −/+/rotella/doppio-click con scorrimento, frecce per sfogliare, Esc chiude.
 */
export function ArtLightbox({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: LightboxItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}): JSX.Element | null {
  const [zoom, setZoom] = useState(1);
  const item = items[index] ?? null;
  const art = useArtworkSrc(item?.src || undefined, { maxPx: 1024 });

  useEffect(() => {
    setZoom(1);
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onIndex((index + 1) % Math.max(1, items.length));
      else if (e.key === "ArrowLeft") onIndex((index - 1 + items.length) % Math.max(1, items.length));
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(3, +(z + 0.5).toFixed(1)));
      else if (e.key === "-") setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onIndex]);

  if (!item || items.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/95"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
      data-testid="art-lightbox"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Ingrandimento di ${item.name}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex shrink-0 items-center gap-2 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-neutral-100">{item.name}</p>
            {item.sub && <p className="truncate text-[11px] text-neutral-400">{item.sub}</p>}
          </div>
          {items.length > 1 && (
            <span className="shrink-0 text-xs text-neutral-500" data-testid="art-lightbox-count">
              {index + 1}/{items.length}
            </span>
          )}
          <div className="panel-2 thin-border flex shrink-0 rounded" role="group" aria-label="Zoom">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
              disabled={zoom <= 1}
              aria-label="Riduci zoom"
              data-testid="art-lightbox-zoom-out"
              className="rounded px-2 py-1 text-sm text-neutral-300 disabled:opacity-40"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              aria-label="Adatta allo schermo"
              title="Adatta allo schermo"
              data-testid="art-lightbox-zoom-fit"
              className="px-2 py-1 text-[11px] text-neutral-400"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(3, +(z + 0.5).toFixed(1)))}
              disabled={zoom >= 3}
              aria-label="Aumenta zoom"
              data-testid="art-lightbox-zoom-in"
              className="rounded px-2 py-1 text-sm text-neutral-300 disabled:opacity-40"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="panel-2 thin-border shrink-0 rounded px-2 py-1 text-xs text-neutral-300"
            aria-label="Chiudi ingrandimento"
            data-testid="art-lightbox-close"
          >
            ✕
          </button>
        </div>

        <div
          className="flex min-h-0 flex-1 overflow-auto"
          data-testid="art-lightbox-scroll"
          onWheel={(e) => {
            if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
            e.preventDefault();
            setZoom((z) =>
              e.deltaY < 0 ? Math.min(3, +(z + 0.5).toFixed(1)) : Math.max(1, +(z - 0.5).toFixed(1)),
            );
          }}
          onDoubleClick={() => setZoom((z) => (z === 1 ? 2 : 1))}
        >
          {art.status === "loading" && (
            <p className="m-auto text-xs text-neutral-400">Caricamento alta risoluzione…</p>
          )}
          {art.status === "ok" && art.src && (
            zoom === 1 ? (
              <img
                src={art.src}
                alt={item.name}
                draggable={false}
                className="m-auto max-h-full w-auto max-w-full rounded"
                data-testid="art-lightbox-img"
              />
            ) : (
              <div className="m-auto shrink-0" style={{ width: `${Math.round(zoom * 100)}%`, maxWidth: 1600 }}>
                <img
                  src={art.src}
                  alt={item.name}
                  draggable={false}
                  className="w-full rounded"
                  data-testid="art-lightbox-img"
                />
              </div>
            )
          )}
          {art.status !== "loading" && (!art.src || art.status === "error") && (
            <p className="m-auto text-xs text-red-400" role="alert">
              {art.detail ?? "Nessuna immagine per questa carta."}
            </p>
          )}
        </div>

        {items.length > 1 && (
          <div className="flex shrink-0 items-center justify-between p-3">
            <button
              type="button"
              onClick={() => onIndex((index - 1 + items.length) % items.length)}
              aria-label="Carta precedente"
              data-testid="art-lightbox-prev"
              className="panel-2 thin-border rounded px-4 py-1.5 text-sm text-neutral-300"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => onIndex((index + 1) % items.length)}
              aria-label="Carta successiva"
              data-testid="art-lightbox-next"
              className="panel-2 thin-border rounded px-4 py-1.5 text-sm text-neutral-300"
            >
              ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
