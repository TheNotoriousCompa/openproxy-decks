import { useState } from "react";
import { LeftPanel } from "@/components/LeftPanel";
import { Divider } from "@/components/Divider";
import { PrintPicker } from "@/components/PrintPicker";
import { PrintBusyToast } from "@/components/PrintBusyToast";
import { DecklistModal } from "@/components/DecklistModal";
import { PrintForm } from "@/features/print/PrintForm";
import { SheetsPreview } from "@/features/print/SheetsPreview";
import { usePrintBuilder } from "@/features/print/usePrintBuilder";
import { useChoosePrint } from "@/hooks/useChoosePrint";
import { useUi } from "@/stores/ui";
import { useProjects } from "@/stores/projects";
import { useDeck, totalCopies } from "@/stores/deck";

/** Vista solo-stampa (come proxxied.com/app): import a sinistra, fogli al centro, stampa a destra. */
export function StudioView(): JSX.Element {
  const leftWidth = useUi((s) => s.leftWidth);
  const printWidth = useUi((s) => s.printWidth);
  const setLeftWidth = useUi((s) => s.setLeftWidth);
  const setPrintWidth = useUi((s) => s.setPrintWidth);
  const activeId = useProjects((s) => s.activeId);
  const setTab = useUi((s) => s.setTab);
  const deckCount = useDeck((s) => s.deck.length);

  const pb = usePrintBuilder();
  const { picker, pickerBusy, pendingIds, printJob, openPicker, closePicker, choosePrint, chooseFacePrint } =
    useChoosePrint();
  const [showDecklist, setShowDecklist] = useState(false);
  const openForCopy = (entryId: string): void => {
    const entry = useDeck.getState().deck.find((c) => c.id === entryId);
    // cella foglio = singola copia fisica (scope copy)
    if (entry) openPicker(entry.id, entry.name, entry.providerId, "copy");
  };

  const dims =
    pb.values.orientation === "portrait"
      ? { w: pb.values.pageWmm, h: pb.values.pageHmm }
      : { w: pb.values.pageHmm, h: pb.values.pageWmm };

  return (
    <div className="flex min-h-0 flex-1" role="main" aria-label="Studio">
      <aside className="panel flex min-h-0 w-full shrink-0 flex-col overflow-hidden border-r thin-border" style={{ width: leftWidth, maxWidth: leftWidth }} aria-label="Import">
        <div className="min-h-0 flex-1 overflow-auto">
          {activeId || deckCount > 0 ? (
            <LeftPanel />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-neutral-500">Crea o apri un progetto per iniziare.</p>
              <button
                onClick={() => setTab("projects")}
                className="rounded bg-neutral-200 px-4 py-2 text-sm font-semibold text-black"
              >
                Vai ai Progetti
              </button>
            </div>
          )}
        </div>
        {(activeId || deckCount > 0) && <DeckFooter onShowDecklist={() => setShowDecklist(true)} />}
      </aside>
      <Divider onDrag={(dx) => setLeftWidth(leftWidth + dx)} />
      <div className="min-w-0 flex-1 overflow-auto bg-black" aria-label="Fogli di stampa">
        <SheetsPreview
          flow={pb.flow}
          sheetError={pb.sheetError}
          pageWmm={dims.w}
          pageHmm={dims.h}
          cardWmm={pb.values.cardWmm}
          cardHmm={pb.values.cardHmm}
          targetDpi={pb.values.dpi}
          scale={1.15}
          fitWidth
          guides={{
            crop: pb.values.guides.cropMarks,
            cut: pb.values.guides.cutLines,
            page: pb.values.guides.pageLines,
          }}
          bleedMm={pb.values.bleedMm ?? 0}
          guideColor={pb.values.guideColor ?? "#00ff00"}
          guideWidthPt={pb.values.guideWidthPt ?? 0.75}
          guidePlacement={pb.values.guidePlacement ?? "inside"}
          guideLengthMm={pb.values.guideLengthMm ?? 2}
          guideShape={pb.values.guideShape ?? "inside"}
          guideOffsetMm={pb.values.guideOffsetMm ?? 0}
          guideStyle={pb.values.guideStyle ?? "solid"}
          guideCap={pb.values.guideCap ?? "square"}
          defaultBack={pb.values.backImage}
          pendingEntryIds={pendingIds}
          onPickCopy={openForCopy}
        />
      </div>
      <Divider onDrag={(dx) => setPrintWidth(printWidth - dx)} />
      <aside className="panel min-h-0 shrink-0 overflow-auto border-l thin-border" style={{ width: printWidth }} aria-label="Print builder">
        <PrintForm pb={pb} />
      </aside>
      {picker && (
        <PrintPicker
          cardName={picker.name}
          currentProviderId={picker.providerId}
          totalCopies={picker.totalCopies}
          onSelect={(opt, applyAll) => void choosePrint(opt, applyAll)}
          onSelectFace={(opt, face, applyAll) => void chooseFacePrint(opt, face, applyAll)}
          onClose={closePicker}
        />
      )}
      {pickerBusy && <span className="sr-only" aria-live="polite">Salvataggio stampa…</span>}
      <PrintBusyToast job={printJob} />
      {showDecklist && <DecklistModal onClose={() => setShowDecklist(false)} />}
    </div>
  );
}

/** Riepilogo compatto + azioni lista (niente deck builder: come proxxied.com). */
function DeckFooter({ onShowDecklist }: { onShowDecklist: () => void }): JSX.Element {
  const deck = useDeck((s) => s.deck);
  const copies = totalCopies(deck);
  return (
    <div className="border-t thin-border flex items-center gap-2 p-2 text-xs text-neutral-400" aria-live="polite">
      <span>
        {deck.length} voci · {copies} {copies === 1 ? "copia" : "copie"}
      </span>
      <span className="ml-auto flex gap-1">
        <button
          type="button"
          onClick={onShowDecklist}
          className="panel-2 thin-border rounded px-2 py-1 text-xs"
          aria-label="Visualizza decklist"
        >
          Decklist
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Svuotare il deck? (annullabile con Undo)")) useDeck.getState().clear();
          }}
          disabled={deck.length === 0}
          className="panel-2 thin-border rounded px-2 py-1 text-xs disabled:opacity-50"
          aria-label="Svuota deck"
        >
          Svuota
        </button>
      </span>
    </div>
  );
}
