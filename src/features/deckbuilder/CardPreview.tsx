import { ArtworkImage } from "@/components/ArtworkImage";
import { GameChangerBadge } from "@/components/GameChangerBadge";
import { useDebounced } from "@/hooks/useDebounced";
import { useCardDetails } from "@/services/carddetails";
import { refOf } from "@/lib/cardmetaCache";
import { prettyManaCost } from "@/lib/scryart";
import type { CardMeta } from "@/services/cardfinder";
import type { CardEntry } from "@/types";

/**
 * Anteprima grande della carta in alto (stile Moxfield): mostra l'artwork e il
 * testo oracolo della carta sotto il mouse, con debounce per non martellare
 * Scryfall passando veloce tra le tile. Resta sull'ultima carta vista.
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
      <div className="panel-2 thin-border flex min-h-[120px] shrink-0 items-center justify-center rounded-xl p-3 text-center text-[11px] text-neutral-500" data-testid="db-card-preview">
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
    <div className="panel-2 thin-border flex shrink-0 gap-3 rounded-xl p-3" data-testid="db-card-preview">
      <div className="relative h-[168px] w-[120px] shrink-0 overflow-hidden rounded-lg bg-black shadow-[0_8px_20px_rgba(0,0,0,0.55)]">
        <ArtworkImage stored={entry.imageFront} name={entry.name} />
        {meta?.gameChanger && (
          <span className="absolute left-1.5 top-1.5">
            <GameChangerBadge name={entry.name} />
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="min-w-0 truncate text-sm font-semibold leading-tight" data-testid="db-preview-name">
            {entry.name}
          </h2>
          {cost && (
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-200">
              {cost}
            </span>
          )}
          {stats && <span className="text-[11px] font-medium text-neutral-300">{stats}</span>}
          {zoneLabel && <span className="text-[11px] text-neutral-500">{zoneLabel}</span>}
        </div>
        <p className="mt-0.5 truncate text-xs text-neutral-400" data-testid="db-preview-type">
          {meta?.typeLine ?? "tipo in risoluzione…"}
        </p>
        <p
          className="mt-1.5 min-h-0 max-h-16 flex-1 overflow-auto whitespace-pre-line text-[11px] leading-4 text-neutral-300"
          data-testid="db-preview-text"
        >
          {oracle ?? (details === undefined ? "…" : "Testo non disponibile (offline).")}
        </p>
        <p className="mt-1.5 flex flex-wrap gap-x-2 text-[10px] text-neutral-500">
          <span>
            {entry.qty}× {entry.qty === 1 ? "copia" : "copie"}
          </span>
          {(entry.setCode || entry.collectorNumber) && (
            <span>
              {[entry.setCode?.toUpperCase(), entry.collectorNumber].filter(Boolean).join(" ")}
            </span>
          )}
          {price && <span>{price}</span>}
          {details?.artist && <span>Ill. {details.artist}</span>}
        </p>
      </div>
    </div>
  );
}
