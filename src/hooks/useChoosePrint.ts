import { useState } from "react";
import { useDeck, peersOfName, copiesWithPeers } from "@/stores/deck";
import { useProjects } from "@/stores/projects";
import {
  persistPrintOption,
  persistPrintFace,
  printFaceToPatch,
  printOptionToPatch,
  type PrintPatch,
} from "@/services/images";
import { perfMark, perfNow } from "@/lib/perf";
import type { PrintJobState } from "@/components/PrintBusyToast";
import type { PrintOption } from "@/types";

export type PickerScope = "entry" | "copy";

export interface PickerTarget {
  id: string;
  name: string;
  providerId?: string;
  /**
   * Origine apertura: "entry" = riga deck (la voce intera),
   * "copy" = cella foglio (una sola copia fisica).
   */
  scope: PickerScope;
  /** voci omonime (tutte le zone) oltre alla carta selezionata */
  peerIds: string[];
  /** copie totali della voce + omonime (per etichetta Apply to all) */
  totalCopies: number;
}

/** Stato picker sollevato (usato da deck e da celle preview). */
export function useChoosePrint(): {
  picker: PickerTarget | null;
  pickerBusy: boolean;
  /** voci in aggiornamento: la cella corrispondente mostra lo spinner */
  pendingIds: string[];
  /** esito del cambio stampa (conferma in basso) */
  printJob: PrintJobState | null;
  openPicker: (id: string, name: string, providerId?: string, scope?: PickerScope) => void;
  closePicker: () => void;
  choosePrint: (opt: PrintOption, applyAll: boolean) => void;
  chooseFacePrint: (opt: PrintOption, face: "front" | "back", applyAll: boolean) => void;
} {
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [printJob, setPrintJob] = useState<PrintJobState | null>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  const openPicker = (id: string, name: string, providerId?: string, scope: PickerScope = "entry"): void => {
    const deck = useDeck.getState().deck;
    setPicker({
      id,
      name,
      providerId,
      scope,
      peerIds: peersOfName(deck, id).map((c) => c.id),
      totalCopies: copiesWithPeers(deck, id),
    });
  };

  /**
   * Instrada una patch pronta: apply-all → voci, copy → una copia, entry → voce.
   * Ritorna gli id effettivamente toccati (per lo swap background).
   */
  const routePatch = (
    target: PickerTarget,
    patch: Partial<PrintPatch>,
    applyAll: boolean,
  ): string[] => {
    if (applyAll) {
      const targets = [target.id, ...target.peerIds];
      // apply-all = UN solo snapshot undo: ripristina tutte le voci insieme
      useDeck.getState().applyPatches(targets.map((id) => ({ id, patch: { ...patch } })));
      return targets;
    }
    if (target.scope === "copy") {
      // cella foglio = UNA copia fisica: stacca qty=1 dalla voce (un solo undo),
      // mai tutta la riga qty=N
      const applied = useDeck.getState().applyPrintToSingleCopy(target.id, { ...patch });
      return applied ? [applied] : [];
    }
    // riga deck = la voce intera (per copie diverse c'è lo split dedicato)
    useDeck.getState().patchCard(target.id, { ...patch });
    return [target.id];
  };

  /**
   * Swap silenzioso post-download: sostituisce gli URL remoti ottimistici con i
   * path locali SENZA nuovo snapshot undo. Salta le voci che nel frattempo sono
   * cambiate (undo dell'utente o altra scelta) confrontando gli URL ottimistici.
   */
  const swapPersisted = (
    ids: string[],
    optimistic: Partial<PrintPatch>,
    persisted: Partial<PrintPatch>,
  ): void => {
    const deck = useDeck.getState().deck;
    const swaps: { id: string; patch: Partial<PrintPatch> }[] = [];
    for (const id of ids) {
      const entry = deck.find((c) => c.id === id);
      if (!entry) continue;
      const patch: Partial<PrintPatch> = {};
      let changed = false;
      for (const key of ["imageFront", "imageBack"] as const) {
        const want = optimistic[key];
        const got = persisted[key];
        if (
          typeof want === "string" &&
          (want.startsWith("http://") || want.startsWith("https://")) &&
          entry[key] === want &&
          typeof got === "string" &&
          got !== want
        ) {
          patch[key] = got;
          changed = true;
        }
      }
      if (changed) swaps.push({ id, patch });
    }
    if (swaps.length > 0) useDeck.getState().applyPatchesSilent(swaps);
  };

  const chooseWith = (
    target: PickerTarget,
    optimistic: Partial<PrintPatch>,
    applyAll: boolean,
    persist: (projectId: string | null) => Promise<Partial<PrintPatch>>,
  ): void => {
    const t0 = perfNow();
    const projectId = useProjects.getState().activeId;
    setPickerBusy(true);
    // Apply ottimistico sincrono: la UI si chiude subito, niente attesa download.
    const ids = routePatch(target, optimistic, applyAll);
    if (ids.length > 0) {
      setPrintJob({ name: target.name, count: ids.length, startedAt: Date.now(), phase: "saving" });
      // spinner SOPRA le carte che si stanno aggiornando (non un overlay a tutto schermo)
      setPendingIds(ids);
    }
    setPicker(null);
    setPickerBusy(false);
    perfMark("choose:close", t0);
    // Download in background + swap silenzioso (nessun undo extra).
    void (async () => {
      try {
        const persisted = await persist(projectId);
        swapPersisted(ids, optimistic, persisted);
      } finally {
        perfMark("choose:persist-done", t0);
        // via lo spinner dalle carte e conferma in basso, che sparisce da sola
        setPendingIds([]);
        setPrintJob((j) => (j ? { ...j, phase: "done" } : j));
        window.setTimeout(() => setPrintJob((j) => (j?.phase === "done" ? null : j)), 1400);
      }
    })();
  };

  const choosePrint = (opt: PrintOption, applyAll: boolean): void => {
    if (!picker || pickerBusy) return;
    chooseWith(picker, printOptionToPatch(opt), applyAll, (projectId) =>
      persistPrintOption(opt, projectId).then((p): Partial<PrintPatch> => p),
    );
  };

  /** Faccia DFC indipendente (mix stampe): patcha solo fronte o solo retro. */
  const chooseFacePrint = (opt: PrintOption, face: "front" | "back", applyAll: boolean): void => {
    if (!picker || pickerBusy) return;
    chooseWith(picker, printFaceToPatch(opt, face), applyAll, (projectId) =>
      persistPrintFace(opt, face, projectId),
    );
  };

  return {
    picker,
    pickerBusy,
    pendingIds,
    printJob,
    openPicker,
    closePicker: () => {
      if (!pickerBusy) setPicker(null);
    },
    choosePrint,
    chooseFacePrint,
  };
}
