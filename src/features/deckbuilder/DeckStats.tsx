import { useMemo } from "react";
import { categoryOf } from "@/lib/cardtype";
import { findMeta, useCardMeta } from "@/hooks/useCardTypes";
import { computeBracket, BRACKET_LABEL, type BracketReport } from "@/lib/bracket";
import type { CardEntry } from "@/types";

const COLORS = ["W", "U", "B", "R", "G"] as const;
const COLOR_DOT: Record<string, string> = {
  W: "bg-[#cfc9a8]",
  U: "bg-[#2b5fa1]",
  B: "bg-[#2b2b2b] thin-border",
  R: "bg-[#a13a2a]",
  G: "bg-[#3a7a4a]",
};

/** Riga di sintesi: una frase, niente ripetizioni del titolo. */
function bracketSummary(b: BracketReport): string {
  if (b.massLandDenial.length > 0) return "Mass land denial incluso: consentito solo dal Bracket 4.";
  if (b.gcCount >= 4) return `${b.gcCount} Game Changer: oltre il limite di 3 del Bracket 3.`;
  if (b.gcCount > 0) return `${b.gcCount} Game Changer: entro i 3 consentiti dal Bracket 3.`;
  return "Nessuna Game Changer: il Bracket 2 non ne consente.";
}

/**
 * Statistiche compatte per la rail destra del DeckBuilder: curva, colori,
 * totali e bracket. Gerarchia per peso/spaziatura, nessuna card annidata.
 */
export function DeckStats({ deck }: { deck: CardEntry[] }): JSX.Element {
  const { meta, loaded, total } = useCardMeta(
    deck.map((c) => ({ name: c.name, provider: c.provider, providerId: c.providerId, setCode: c.setCode })),
  );

  const stats = useMemo(() => {
    const curve = new Array<number>(8).fill(0);
    const colors: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    let multi = 0;
    let colorless = 0;
    let lands = 0;
    let nonLands = 0;
    let cmcSum = 0;
    let price = 0;
    let priced = 0;
    let resolved = 0;
    for (const c of deck) {
      const m = findMeta(meta, c);
      if (!m) continue;
      resolved += 1;
      const usd = m.priceUsd !== undefined ? Number.parseFloat(m.priceUsd) : NaN;
      if (Number.isFinite(usd)) {
        price += (usd as number) * c.qty;
        priced += 1;
      }
      const id = m.colorIdentity ?? [];
      if (id.length === 0) colorless += c.qty;
      else {
        if (id.length > 1) multi += c.qty;
        for (const col of id) {
          if (col in colors) colors[col] = (colors[col] ?? 0) + c.qty;
        }
      }
      const cat = categoryOf(m.typeLine);
      if (cat === "lands") {
        lands += c.qty;
        continue;
      }
      nonLands += c.qty;
      if (typeof m.cmc === "number") {
        const b = Math.min(7, Math.max(0, Math.floor(m.cmc)));
        curve[b] = (curve[b] ?? 0) + c.qty;
        cmcSum += m.cmc * c.qty;
      }
    }
    return { curve, colors, multi, colorless, lands, nonLands, cmcSum, price, priced, resolved };
  }, [deck, meta]);

  const bracket = useMemo(
    () =>
      computeBracket(
        deck
          .filter((c) => c.zone === "main" || c.zone === "commander")
          .map((c) => {
            const m = findMeta(meta, c);
            return {
              name: c.name,
              qty: c.qty,
              gameChanger: m?.gameChanger,
              extraTurn: m?.extraTurn,
              massLandDenial: m?.massLandDenial,
            };
          }),
      ),
    [deck, meta],
  );

  const maxCurve = Math.max(1, ...stats.curve);
  const avg = stats.nonLands > 0 ? stats.cmcSum / stats.nonLands : 0;

  return (
    <section className="panel-2 thin-border rounded-xl p-3" data-testid="deck-stats" aria-label="Statistiche mazzo">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400">Statistiche</h3>
        <span className="text-[11px] text-neutral-400" data-testid="deck-stats-summary">
          {loaded < total ? (
            <span data-testid="deck-stats-progress">
              {loaded}/{total}…
            </span>
          ) : (
            <>
              {stats.lands} terre · CMC medio {avg.toFixed(1)}
            </>
          )}
        </span>
      </div>

      <div className="mt-3">
        <div className="flex h-16 items-end gap-1" role="img" aria-label={`Curva di mana, picco ${maxCurve}`}>
          {stats.curve.map((n, i) => (
            <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-0.5">
              <span className="h-3 text-[9px] tabular-nums leading-none text-neutral-400">{n > 0 ? n : ""}</span>
              <div
                className="w-full rounded-t bg-neutral-200"
                style={{ height: `${Math.max(n > 0 ? 4 : 0, (n / maxCurve) * 100)}%` }}
                title={`${i === 7 ? "7+" : i}: ${n}`}
                data-testid={`curve-${i}`}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-8 text-center text-[10px] tabular-nums text-neutral-500">
          {["0", "1", "2", "3", "4", "5", "6", "7+"].map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {COLORS.map((c) => (
          <span key={c} className="flex items-center gap-1" title={c}>
            <span className={`h-2.5 w-2.5 rounded-full ${COLOR_DOT[c] ?? ""}`} />
            <b className="font-semibold text-neutral-100">{stats.colors[c] ?? 0}</b>
          </span>
        ))}
        <span className="text-neutral-400">
          Multi <b className="font-semibold text-neutral-100">{stats.multi}</b>
        </span>
        <span className="text-neutral-400">
          Incolori <b className="font-semibold text-neutral-100">{stats.colorless}</b>
        </span>
      </div>

      <div className="mt-2 flex justify-between gap-2 text-[11px] text-neutral-400">
        <span>
          Terre <b className="font-semibold text-neutral-100">{stats.lands}</b> · Altre{" "}
          <b className="font-semibold text-neutral-100">{stats.nonLands}</b>
        </span>
        <span>
          <b className="font-semibold text-neutral-100">${stats.price.toFixed(2)}</b>{" "}
          <span className="text-neutral-500">
            ({stats.priced}/{stats.resolved} voci)
          </span>
        </span>
      </div>

      <div
        className="mt-3 border-t thin-border pt-2.5"
        data-testid="deck-bracket"
        title={[...bracket.reasons, ...bracket.notes].join(" ")}
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[13px] font-semibold text-neutral-100">
            Bracket {bracket.bracket} · {BRACKET_LABEL[bracket.bracket]}
          </p>
          <span className="shrink-0 text-[11px] text-neutral-400">{bracket.gcCount} Game Changer</span>
        </div>
        <div className="mt-2 flex gap-1" role="img" aria-label={`Posizione calcolata: bracket ${bracket.bracket} di 5`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={`h-1 flex-1 rounded-full ${n === bracket.bracket ? "bg-neutral-100" : "bg-neutral-800"}`}
            />
          ))}
        </div>
        <div className="mt-1 grid grid-cols-5 text-center text-[10px] tabular-nums">
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={n === bracket.bracket ? "font-semibold text-neutral-200" : "text-neutral-500"}>
              {n}
            </span>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-4 text-neutral-300" data-testid="deck-bracket-summary">
          {bracketSummary(bracket)}
        </p>
        {bracket.gameChangers.length > 0 && (
          <p className="mt-1 text-[11px] leading-4 text-neutral-400">
            <span className="text-neutral-500">Game Changer </span>
            {bracket.gameChangers.map((g) => g.name).join(", ")}
          </p>
        )}
        {bracket.massLandDenial.length > 0 && (
          <p className="mt-1 text-[11px] leading-4 text-neutral-400">
            <span className="text-neutral-500">Mass land denial </span>
            {bracket.massLandDenial.map((g) => g.name).join(", ")}
          </p>
        )}
        {bracket.extraTurns.length > 0 && (
          <p className="mt-1 text-[11px] leading-4 text-neutral-400">
            <span className="text-neutral-500">Turni extra </span>
            {bracket.extraTurns.map((g) => g.name).join(", ")}
          </p>
        )}
        <p className="mt-1.5 text-[10px] leading-4 text-neutral-500">
          Mainboard (main + comandante) · B1/B5 dipendono dall'intento · combo a 2 carte non rilevabili.
        </p>
      </div>
    </section>
  );
}
