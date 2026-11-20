import { useDeck, totalCopies } from "@/stores/deck";
import { usePrint } from "@/stores/print";
import { computeLayout, layoutInputFrom } from "@/lib/layout";
import { analyzeQuality } from "@/lib/quality";
import { useProjects } from "@/stores/projects";

export function RightPanel(): JSX.Element {
  const deck = useDeck((s) => s.deck);
  const pastLen = useDeck((s) => s.past.length);
  const futureLen = useDeck((s) => s.future.length);
  const print = usePrint();
  const active = useProjects((s) => s.projects.find((p) => p.id === s.activeId));

  const copies = totalCopies(deck);
  let layoutInfo = "";
  try {
    const { w, h } = print.pageDims();
    const l = computeLayout(
      layoutInputFrom(
        {
          pageWmm: w,
          pageHmm: h,
          cardWmm: print.cardWmm,
          cardHmm: print.cardHmm,
          marginTopMm: print.marginTopMm,
          marginRightMm: print.marginRightMm,
          marginBottomMm: print.marginBottomMm,
          marginLeftMm: print.marginLeftMm,
          spacingRowMm: print.spacingRowMm,
          spacingColMm: print.spacingColMm,
          bleedMm: print.bleedMm,
        },
        copies,
      ),
    );
    layoutInfo = `${l.cols}×${l.rows} per pagina · ${l.perPage}/pag · ${l.pages} pagine`;
  } catch (e) {
    layoutInfo = e instanceof Error ? e.message : "layout non valido";
  }

  const green = deck.filter(() => analyzeQuality(744, 1039, print.cardWmm, print.cardHmm, print.dpi).status === "green").length;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3" role="complementary" aria-label="Statistiche e cronologia">
      <section aria-label="Progetto attivo">
        <h2 className="mb-1 text-xs font-semibold uppercase text-neutral-500">Progetto</h2>
        <p className="text-sm">{active?.name ?? "—"}</p>
      </section>
      <section aria-label="Statistiche">
        <h2 className="mb-1 text-xs font-semibold uppercase text-neutral-500">Stats</h2>
        <ul className="text-xs text-neutral-300">
          <li>Voci: {deck.length}</li>
          <li>Copie totali: {copies}</li>
          <li>Qualità OK (stima): {green}/{deck.length}</li>
          <li>Layout: {layoutInfo}</li>
          <li>DPI: {print.dpi}</li>
        </ul>
      </section>
      <section aria-label="Cronologia azioni">
        <h2 className="mb-1 text-xs font-semibold uppercase text-neutral-500">History</h2>
        <p className="text-xs text-neutral-400">
          {pastLen} azioni annullabili · {futureLen} da ripetere
        </p>
        <div className="mt-1 flex gap-1">
          <button onClick={() => useDeck.getState().undo()} disabled={pastLen === 0}
            className="panel-2 thin-border rounded px-2 py-1 text-xs disabled:opacity-40">↩ Undo</button>
          <button onClick={() => useDeck.getState().redo()} disabled={futureLen === 0}
            className="panel-2 thin-border rounded px-2 py-1 text-xs disabled:opacity-40">↪ Redo</button>
        </div>
      </section>
      <section aria-label="Impostazioni stampa rapide">
        <h2 className="mb-1 text-xs font-semibold uppercase text-neutral-500">Stampa rapida</h2>
        <label className="mb-1 block text-xs text-neutral-400" htmlFor="quick-dpi">DPI</label>
        <select
          id="quick-dpi"
          value={print.dpi}
          onChange={(e) => print.set("dpi", Number(e.target.value))}
          className="panel-2 thin-border w-full rounded px-2 py-1 text-xs"
        >
          {[150, 300, 450, 600, 900, 1200].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </section>
    </div>
  );
}
