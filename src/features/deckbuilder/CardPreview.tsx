import { ArtworkImage } from "@/components/ArtworkImage";
import { GameChangerBadge } from "@/components/GameChangerBadge";
import { useDebounced } from "@/hooks/useDebounced";
import { useCardDetails } from "@/services/carddetails";
import { refOf } from "@/lib/cardmetaCache";
import { prettyManaCost } from "@/lib/scryart";
import type { CardMeta } from "@/services/cardfinder";
import type { CardEntry } from "@/types";

/**
 * Anteprima dell'isola sticky: carta grande quanto una tile della griglia,
 * con nome/tipo/testo oracolo sotto, giustificato (stile Moxfield). Il testo
 * arriva da Scryfall on-demand con debounce, per non martellare passando
 * veloce tra le tile; resta sull'ultima carta vista.
 */
export function CardPreview({
  entry,
  meta,
  zoneLabel,
}: {
  entry: CardEntry | null;
  meta?: CardMeta;
  zoneLabel?: string;
}): JSX.Element {
  const debounced = useDebounced(entry, 140);
  const details = useCardDetails(debounced ? refOf(debounced) : null);

  if (!entry) {
    return (
      <div
        className="panel-2 thin-border flex min-h-[120px] shrink-0 items-center justify-center rounded-xl p-3 text-center text-[11px] text-neutral-500"
        data-testid="db-card-preview"
      >
        Passa il mouse su una carta per vederla qui.
      </div>
    );
  }

  const cost = prettyManaCost(meta?.manaCost);
  const price = meta?.priceUsd ? `$${Number.parseFloat(meta.priceUsd).toFixed(2)}` : "";
  const stats =
    meta?.typeLine?.toLowerCase().includes("creature") && details?.power && details?.toughness
      ? `${details.power}/${details.toughness}`
      : details?.loyalty
        ? `Fedeltà ${details.loyalty}`
        : "";
  const oracle = details?.oracleText;

  return (
    <div className="panel-2 thin-border shrink-0 rounded-xl p-3" data-testid="db-card-preview">
      {/* stessa larghezza di una tile della griglia (6 per fila su 1440) */}
      <div className="relative mx-auto aspect-[63/88] w-[168px] max-w-full overflow-hidden rounded-lg bg-black shadow-[0_10px_26px_rgba(0,0,0,0.55)]">
        <ArtworkImage stored={entry.imageFront} name={entry.name} />
        {meta?.gameChanger && (
          <span className="absolute left-1.5 top-1.5">
            <GameChangerBadge name={entry.name} />
          </span>
        )}
      </div>

      <div className="mt-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="min-w-0 truncate text-sm font-semibold leading-tight" data-testid="db-preview-name">
            {entry.name}
          </h2>
          {cost && (
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-200">
              {cost}
            </span>
          )}
          {stats && <span className="text-[10px] font-medium text-neutral-300">{stats}</span>}
        </div>
        <p className="mt-0.5 text-[11px] leading-4 text-neutral-400" data-testid="db-preview-type">
          {meta?.typeLine ?? "tipo in risoluzione…"}
          {zoneLabel ? ` · ${zoneLabel}` : ""}
        </p>
        <p
          className="mt-2 max-h-28 overflow-auto whitespace-pre-line text-justify text-[11px] leading-4 text-neutral-300"
          data-testid="db-preview-text"
        >
          {oracle ?? (details === undefined ? "…" : "Testo non disponibile (offline).")}
        </p>
        <p className="mt-2 flex flex-wrap gap-x-2 text-[10px] text-neutral-500">
          <span>
            {entry.qty}× {entry.qty === 1 ? "copia" : "copie"}
          </span>
          {(entry.setCode || entry.collectorNumber) && (
            <span>{[entry.setCode?.toUpperCase(), entry.collectorNumber].filter(Boolean).join(" ")}</span>
          )}
          {price && <span>{price}</span>}
        </p>
        {details?.artist && <p className="mt-0.5 text-[10px] text-neutral-500">Ill. {details.artist}</p>}
      </div>
    </div>
  );
}
