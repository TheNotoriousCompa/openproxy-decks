import { useEffect, useState } from "react";
import { useArtworkSrc, fetchBackendThumb, isBackendThumbable } from "@/hooks/useArtwork";

interface ArtworkImageProps {
  stored?: string;
  name: string;
  /** classi per <img> (es. h-full w-full object-cover) */
  imgClassName?: string;
  /** false = remoto diretto anche in app (griglie veloci come il picker) */
  backendThumb?: boolean;
  onClick?: () => void;
  label?: string;
}

/**
 * Box artwork che non è mai nero muto: nome sempre sotto, img sopra,
 * badge diagnostico cliccabile (dettaglio + retry) in caso di errore.
 * Strategia ibrida: diretto prima (veloce), thumb backend al primo fallimento.
 */
export function ArtworkImage({ stored, name, imgClassName, backendThumb, onClick, label }: ArtworkImageProps): JSX.Element {
  const { status, src, detail, retry } = useArtworkSrc(stored, { backendThumb });
  const [imgFailed, setImgFailed] = useState(false);
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  useEffect(() => {
    setImgFailed(false);
    setFallbackSrc(null);
    setFallbackFailed(false);
    setShowDetail(false);
  }, [stored, src]);

  const onImgError = (): void => {
    // Il diretto ha fallito: se non abbiamo ancora provato il backend, fallo ora.
    if (!fallbackSrc && !fallbackFailed && stored && isBackendThumbable(stored)) {
      void fetchBackendThumb(stored)
        .then((dataUrl) => setFallbackSrc(dataUrl))
        .catch(() => setFallbackFailed(true));
      return;
    }
    setImgFailed(true);
  };

  const shownSrc = fallbackSrc ?? src;
  const failed = status === "error" || imgFailed || fallbackFailed;

  const inner = (
    <>
      <div className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-neutral-500">
        <span className="line-clamp-3">{name}</span>
      </div>
      {status === "loading" && !fallbackSrc && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-neutral-400" aria-label="Caricamento immagine">
          …
        </div>
      )}
      {shownSrc && !imgFailed && (
        <img
          src={shownSrc}
          alt={name}
          loading="lazy"
          className={`absolute inset-0 ${imgClassName ?? "h-full w-full object-cover"}`}
          onError={onImgError}
        />
      )}
      {failed && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowDetail((v) => !v);
          }}
          title="Mostra dettaglio errore"
          aria-label={`Immagine non disponibile per ${name}. Tocca per dettagli.${detail ? ` ${detail}` : ""}`}
          aria-expanded={showDetail}
          className="absolute bottom-1 right-1 z-10 rounded bg-red-900 px-1.5 py-0.5 text-[10px] font-bold text-white"
        >
          !
        </button>
      )}
      {failed && showDetail && (
        <div
          role="alert"
          data-testid="artwork-error-detail"
          className="absolute inset-x-0 bottom-0 z-20 max-h-full overflow-auto break-words bg-red-950/95 p-1.5 text-left text-[10px] text-red-100"
        >
          <p className="mb-1 font-bold">Diagnostica:</p>
          <p>{detail ?? "caricamento fallito senza dettaglio"}</p>
          <div className="mt-1 flex gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setImgFailed(false);
                setFallbackFailed(false);
                setFallbackSrc(null);
                setShowDetail(false);
                retry();
                onClick?.();
              }}
              className="rounded bg-neutral-200 px-2 py-0.5 font-bold text-black"
            >
              Riprova
            </button>
            {onClick && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClick();
                }}
                className="rounded bg-neutral-700 px-2 py-0.5 font-bold text-white"
                aria-label={`Scegli un'altra stampa per ${name}`}
              >
                Cambia stampa
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );

  if (onClick && status !== "error" && !imgFailed) {
    return (
      <button type="button" onClick={onClick} aria-label={label ?? `Scegli stampa per ${name}`} title="Scegli stampa" className="relative block h-full w-full">
        {inner}
      </button>
    );
  }
  return <div className="relative h-full w-full">{inner}</div>;
}
