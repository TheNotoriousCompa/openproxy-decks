import { useMemo, useState } from "react";
import { ArtworkImage } from "@/components/ArtworkImage";
import { GameChangerBadge } from "@/components/GameChangerBadge";
import { useCardMeta } from "@/hooks/useCardTypes";
import { categoryOf } from "@/lib/cardtype";
import { prettyManaCost } from "@/lib/scryart";
import { isCommander, useDeck } from "@/stores/deck";
import type { CardMeta } from "@/services/cardfinder";
import type { CardEntry } from "@/types";

/** Fisher-Yates su una copia (mai mutare il mazzo). */
function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Copie fisiche della mainboard (il comandante sta nella command zone). */
function mainboardPool(deck: CardEntry[]): CardEntry[] {
  const out: CardEntry[] = [];
  for (const c of deck) {
    if (c.zone !== "main" || isCommander(c)) continue;
    for (let i = 0; i < Math.max(1, Math.floor(c.qty)); i++) out.push(c);
  }
  return out;
}

/** Meta di una voce dalla mappa condivisa (stessa precedenza della cache). */
function metaFor(meta: Map<string, CardMeta>, c: CardEntry): CardMeta | undefined {
  const lower = c.name.trim().toLowerCase();
  const set = (c.setCode ?? "").toLowerCase();
  return (
    (c.provider === "scryfall" && c.providerId ? meta.get(`id:${c.providerId.toLowerCase()}`) : undefined) ??
    meta.get(`n:${lower}|${set}`) ??
    meta.get(`n:${lower}|`)
  );
}

/**
 * Mano di test: 7 carte pescate dalla mainboard, con mulligan londinese
 * semplificato (ogni mulligan toglie una carta alla mano) e pescata singola.
 * Riepilogo di terre e curva della mano; nessuna modifica al mazzo.
 */
export function TestHand({ onClose }: { onClose: () => void }): JSX.Element {
  const deck = useDeck((s) => s.deck);
  const pool = useMemo(() => mainboardPool(deck), [deck]);
  const [mulligans, setMulligans] = useState(0);
  const [hand, setHand] = useState<CardEntry[]>(() => shuffled(pool).slice(0, 7));
  const [library, setLibrary] = useState<CardEntry[]>(() => shuffled(pool).slice(7));

  const meta = useCardMeta(
    useMemo(
      () => hand.map((c) => ({ name: c.name, provider: c.provider, providerId: c.providerId, setCode: c.setCode })),
      [hand],
    ),
  ).meta;

  const metaOf = (c: CardEntry) => metaFor(meta, c);

  const summary = useMemo(() => {
    let lands = 0;
    let cmcSum = 0;
    let nonLands = 0;
    for (const c of hand) {
      const m = metaFor(meta, c);
      if (m && categoryOf(m.typeLine) === "lands") {
        lands += 1;
        continue;
      }
      nonLands += 1;
      if (typeof m?.cmc === "number") cmcSum += m.cmc;
    }
    return { lands, avg: nonLands > 0 ? cmcSum / nonLands : 0, nonLands };
  }, [hand, meta]);

  const draw = (size: number, mull: number): void => {
    const shuffledPool = shuffled(pool);
    setHand(shuffledPool.slice(0, size));
    setLibrary(shuffledPool.slice(size));
    setMulligans(mull);
  };

  const newShuffle = (): void => draw(7, 0);

  const mulligan = (): void => {
    const next = Math.min(6, mulligans + 1);
    draw(Math.max(1, 7 - next), next);
  };

  const drawOne = (): void => {
    if (library.length === 0) return;
    setHand((h) => [...h, library[0] as CardEntry]);
    setLibrary((lib) => lib.slice(1));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Mano di test"
        data-testid="test-hand"
        className="panel thin-border flex max-h-[90vh] w-full max-w-5xl flex-col rounded-lg p-4"
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold">Mano di test</h2>
          <p className="text-xs text-neutral-400" data-testid="test-hand-summary">
            {hand.length} carte · {summary.lands} {summary.lands === 1 ? "terra" : "terre"} · CMC medio{" "}
            {summary.avg.toFixed(1)}
            {mulligans > 0 ? ` · ${mulligans} mulligan` : ""}
          </p>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={newShuffle}
              data-testid="test-hand-shuffle"
              className="panel-2 thin-border rounded px-3 py-1.5 text-xs"
            >
              Rimescola
            </button>
            <button
              type="button"
              onClick={mulligan}
              disabled={mulligans >= 6}
              data-testid="test-hand-mulligan"
              title="Mulligan londinese: rimescoli e peschi una carta in meno"
              className="panel-2 thin-border rounded px-3 py-1.5 text-xs disabled:opacity-40"
            >
              Mulligan
            </button>
            <button
              type="button"
              onClick={drawOne}
              disabled={library.length === 0}
              data-testid="test-hand-draw"
              className="panel-2 thin-border rounded px-3 py-1.5 text-xs disabled:opacity-40"
            >
              Pesca 1
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Chiudi mano di test"
              data-testid="test-hand-close"
              className="panel-2 thin-border rounded px-2 py-1.5 text-xs"
            >
              ✕
            </button>
          </div>
        </div>

        {pool.length === 0 ? (
          <p className="text-sm text-neutral-500">Nessuna carta in mainboard da pescare.</p>
        ) : (
          <div className="min-h-0 overflow-auto">
            <ul className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
              {hand.map((c, i) => {
                const m = metaOf(c);
                const cost = prettyManaCost(m?.manaCost);
                return (
                  <li
                    key={`${c.id}-${i}`}
                    className="overflow-hidden rounded-lg thin-border panel-2"
                    data-testid="test-hand-card"
                  >
                    <div className="relative block aspect-[63/88] w-full bg-black">
                      <ArtworkImage stored={c.imageFront} name={c.name} />
                      {cost && (
                        <span className="absolute right-1 top-1 rounded-[5px] bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold">
                          {cost}
                        </span>
                      )}
                      {m?.gameChanger && (
                        <span className="absolute left-1 top-1">
                          <GameChangerBadge name={c.name} />
                        </span>
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="truncate text-[11px] font-semibold" title={c.name}>
                        {c.name}
                      </p>
                      <p className="truncate text-[10px] text-neutral-400">{m?.typeLine ?? "—"}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <p className="mt-2 text-[11px] text-neutral-500">
          Pesca simulata dalla mainboard (comandante escluso) · nessuna modifica al mazzo.
        </p>
      </div>
    </div>
  );
}
