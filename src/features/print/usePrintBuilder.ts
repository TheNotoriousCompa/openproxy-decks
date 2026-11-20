import { useEffect, useMemo, useState } from "react";
import {
  useForm,
  type UseFormHandleSubmit,
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormStateReturn,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { useDeck } from "@/stores/deck";
import { usePrint } from "@/stores/print";
import { useProjects } from "@/stores/projects";
import { printSettingsSchema } from "@/lib/schemas";
import { computeLayout, layoutInputFrom } from "@/lib/layout";
import { requiredPixels } from "@/lib/units";
import { BUILT_IN_PRESETS, deletePreset, listPresets, newPresetId, savePreset, type PrintPreset } from "@/lib/presets";
import type { PrintSettings } from "@/types";
import { printZoneOf, flowCopies, flowCounts, type PrintFlow } from "@/features/print/printModel";
import { buildExportArgs } from "@/features/print/batchExport";
import { ensureActiveTokenBoardFixed } from "@/hooks/useTokenBoardFix";
import { deckEntryToItem, consolidateItems } from "@/lib/collection";
import type { CollectionItem } from "@/lib/collection";

export interface VerifyReport {
  pages: number;
  images: { page: number; name: string; placed_w_mm: number; placed_h_mm: number; scale_pct_w: number; scale_pct_h: number; eff_dpi: number; sim_w_mm: [number, number]; sim_h_mm: [number, number] }[];
  nominal_w_mm: number;
  nominal_h_mm: number;
  tol_pct: number;
  pass: boolean;
  worst_dev_pct: number;
  summary: string;
}

/** Tolleranza stretta scelta: ±0.5% accettazione, ±0.3% errore stampante simulato. */
export const VERIFY_TOL_PCT = 0.5;
export const VERIFY_PRINTER_ERR_PCT = 0.3;

/** Dettaglio avanzamento export: stima iniziale + avanzamento reale dal backend. */
export interface ExportProgress {
  /** frazione mostrata 0..1 (mai oltre 0.97 finché non finisce davvero) */
  frac: number;
  /** fase in italiano */
  phase: string;
  /** copie stimate completate / totali */
  done: number;
  total: number;
  /** secondi rimasti stimati (live) oppure null */
  etaSecs: number | null;
  /** MB finali stimati */
  estMb: number;
}

export interface PrintBuilderApi {
  deck: ReturnType<typeof useDeck.getState>["deck"];
  values: PrintSettings;
  copies: number;
  flow: PrintFlow;
  sheetError: string | null;
  totalPages: number;
  status: string;
  progress: number | null;
  progDetail: ExportProgress | null;
  lastPdf: { path: string; dir: string } | null;
  verify: VerifyReport | null;
  verifyBusy: boolean;
  reverify: () => Promise<void>;
  customPresets: PrintPreset[];
  presetId: string;
  register: UseFormRegister<PrintSettings>;
  handleSubmit: UseFormHandleSubmit<PrintSettings>;
  setValue: UseFormSetValue<PrintSettings>;
  formState: UseFormStateReturn<PrintSettings>;
  apply: (data: PrintSettings) => void;
  applyPreset: (id: string) => void;
  saveCurrentAsPreset: () => Promise<void>;
  removePreset: (id: string) => Promise<void>;
  exportPdf: () => Promise<void>;
  openPath: (p: string) => void;
  /** voci appena esportate in attesa di conferma "aggiungi alla collezione" */
  collectItems: CollectionItem[] | null;
  dismissCollect: () => void;
}

export function usePrintBuilder(): PrintBuilderApi {
  const deck = useDeck((s) => s.deck);
  const print = usePrint();
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [progDetail, setProgDetail] = useState<ExportProgress | null>(null);
  const [lastPdf, setLastPdf] = useState<{ path: string; dir: string } | null>(null);
  const [verify, setVerify] = useState<VerifyReport | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [customPresets, setCustomPresets] = useState<PrintPreset[]>([]);
  const [presetId, setPresetId] = useState<string>(BUILT_IN_PRESETS[0]?.id ?? "");
  const [collectItems, setCollectItems] = useState<CollectionItem[] | null>(null);

  const { register, handleSubmit, setValue, watch, reset, formState } = useForm<PrintSettings>({
    resolver: zodResolver(printSettingsSchema),
    defaultValues: { ...print, guides: { ...print.guides } },
  });

  useEffect(() => {
    void listPresets().then(setCustomPresets).catch(() => undefined);
  }, []);

  const values = watch();

  const applyPreset = (id: string): void => {
    setPresetId(id);
    const found =
      BUILT_IN_PRESETS.find((p) => p.id === id) ?? customPresets.find((p) => p.id === id);
    if (!found) return;
    reset({ ...found.settings, guides: { ...found.settings.guides } });
    print.hydrate(found.settings);
    setStatus(`Preset applicato: ${found.name}.`);
  };

  const saveCurrentAsPreset = async (): Promise<void> => {
    const name = window.prompt("Nome preset", `Preset ${customPresets.length + 1}`);
    if (!name?.trim()) return;
    try {
      const list = await savePreset({ id: newPresetId(), name: name.trim(), settings: values });
      setCustomPresets(list);
      setStatus(`Preset salvato: ${name.trim()}.`);
    } catch (e) {
      setStatus(`Preset non valido: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const removePreset = async (id: string): Promise<void> => {
    const list = await deletePreset(id);
    setCustomPresets(list);
    if (presetId === id) setPresetId(BUILT_IN_PRESETS[0]?.id ?? "");
  };

  /** Flusso di stampa CONTINUO: un solo layout su tutte le copie in ordine di
   * zona (comandante nel main, token per ultimi, considering solo col flag).
   * Stesso flusso del PDF: pagine sempre piene, solo l'ultima può restare corta. */
  const flow = useMemo<PrintFlow | { error: string }>(() => {
    try {
      const dims =
        values.orientation === "portrait"
          ? { w: values.pageWmm, h: values.pageHmm }
          : { w: values.pageHmm, h: values.pageWmm };
      const copies = flowCopies(deck, values.includeConsidering !== false);
      const layout = computeLayout(
        layoutInputFrom({ ...values, pageWmm: dims.w, pageHmm: dims.h }, copies.length),
      );
      return { copies, layout, counts: flowCounts(copies) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [values, deck]);

  const sheetError = "error" in flow ? flow.error : null;
  const printFlow: PrintFlow =
    "error" in flow
      ? { copies: [], layout: { cols: 0, rows: 0, perPage: 0, pages: 0, placements: [] }, counts: [] }
      : flow;
  const totalPages = printFlow.layout.pages;
  /** copie effettivamente stampate (rispetta il flag considering) */
  const printedCopies = printFlow.copies.length;

  const apply = (data: PrintSettings): void => {
    print.hydrate(data);
    setStatus("Impostazioni applicate.");
  };

  const runVerify = async (pdfPath: string, cardW: number, cardH: number, bleed: number): Promise<void> => {
    setVerifyBusy(true);
    try {
      const r = await invoke<VerifyReport>("verify_pdf_file", {
        path: pdfPath,
        exp_w_mm: cardW + bleed * 2,
        exp_h_mm: cardH + bleed * 2,
        tol_pct: VERIFY_TOL_PCT,
        printer_err_pct: VERIFY_PRINTER_ERR_PCT,
      });
      setVerify(r);
    } catch (e) {
      setVerify(null);
      setStatus((s) => `${s} — verifica non disponibile: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setVerifyBusy(false);
    }
  };

  const reverify = async (): Promise<void> => {
    const p = lastPdf?.path;
    if (!p) return;
    await runVerify(p, values.cardWmm, values.cardHmm, values.bleedMm);
  };

  const exportPdf = async (): Promise<void> => {
    setStatus("");
    setProgress(0);
    setProgDetail(null);
    setLastPdf(null);
    setCollectItems(null);
    setVerify(null);
    let timer: number | undefined;
    let unlisten: (() => void) | null = null;
    try {
      // Pulizia one-time del board Token (Moxfield ci infila anche carte vere):
      // fatta qui in modo deterministico, così il PDF non dipende da quando la
      // cache dei tipi è pronta.
      await ensureActiveTokenBoardFixed();
      const currentDeck = useDeck.getState().deck;
      const cards = currentDeck
        .filter((c) => values.includeConsidering !== false || c.zone !== "considering")
        .flatMap((c) =>
        c.imageFront
          ? [{
              src_path: c.imageFront,
              qty: c.qty,
              source_hash: c.id,
              // zona di stampa: comandante accorpato al main (mai pagina a sé)
              zone: printZoneOf(c.zone),
              // Retro: quello della carta, altrimenti il dorso di default (se scelto).
              // Stampato solo nei modi duplex che lo richiedono (front_only lo ignora).
              back_src_path: (c.hasBack && c.imageBack ? c.imageBack : values.backImage) || undefined,
            }]
          : [],
      );
      if (cards.length === 0) {
        setStatus("Nessuna carta con immagine da stampare (aggiungi artwork o carte custom).");
        setProgress(null);
        return;
      }
      // Stima iniziale: copie totali (fronte+retro) e peso da pixel richiesti.
      const total = cards.reduce(
        (n, c) => n + Math.max(1, c.qty) + (c.back_src_path ? Math.max(1, c.qty) : 0),
        0,
      );
      const reqW = requiredPixels(values.cardWmm + values.bleedMm * 2, values.dpi);
      const reqH = requiredPixels(values.cardHmm + values.bleedMm * 2, values.dpi);
      const estMb = Math.max(1, Math.round((total * reqW * reqH * 3 * 0.09) / 1e6));
      const startAt = Date.now();
      let shown = 0;
      let target = 0;
      let live = false;
      let phase = "Preparazione…";
      const push = (): void => {
        const elapsed = (Date.now() - startAt) / 1000;
        const done = Math.min(total, Math.round((Math.min(shown, 0.8) / 0.8) * total));
        const rate = elapsed > 2 && done > 0 ? done / elapsed : null;
        const etaSecs = rate !== null && done < total ? Math.max(1, Math.round((total - done) / rate)) : null;
        setProgress(shown);
        setProgDetail({ frac: shown, phase, done, total, etaSecs, estMb });
      };
      push();
      timer = window.setInterval(() => {
        // insegue il backend senza mai superarlo (tetto 0.97); senza backend
        // avanza da solo con curva mock che rallenta verso il 95%.
        if (live) {
          shown += (Math.min(target, 0.97) - shown) * 0.25;
        } else {
          shown += (0.95 - shown) * 0.06;
          phase = shown < 0.5 ? "Elaborazione immagini…" : shown < 0.85 ? "Impaginazione…" : "Scrittura PDF…";
        }
        push();
      }, 150);
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{ id: string; progress: number; status: string }>(
          "job://progress",
          (e) => {
            live = true;
            target = Math.max(0, Math.min(1, e.payload.progress));
            const st = e.payload.status;
            phase = st.includes("layout")
              ? "Impaginazione…"
              : st.includes("done")
                ? "Scrittura PDF…"
                : "Elaborazione immagini…";
          },
        );
      } catch {
        live = false; // browser/dev: curva mock, il 100% arriva alla fine vera
      }
      const projectId = useProjects.getState().activeId ?? "unassigned";
      const outDir = await invoke<string>("export_dir", { projectId });
      const filename = `print-${Date.now()}.pdf`;
      const res = await invoke<{
        path: string;
        pages: number;
        unique_assets: number;
        total_copies: number;
        bytes: number;
        skipped: number;
        skipped_names: string[];
        back_pages: number;
        backs_printed: number;
        backs_missing: number;
        upscaled: number;
        upscaled_ai: number;
      }>(
        "export_pdf",
        {
          args: buildExportArgs(values, cards, projectId, `${outDir}/${filename}`),
        },
      );
      setStatus(
        `PDF creato: ${res.pages} pagine · ${res.unique_assets} asset unici / ${res.total_copies} copie · ${(res.bytes / 1024).toFixed(0)} KB → ${res.path}` +
          (res.backs_printed > 0 ? ` · retro: ${res.backs_printed} copie su ${res.back_pages} pagine` : "") +
          (res.upscaled > 0 ? ` · upscale CPU su ${res.upscaled} asset` : " · nessun upscale necessario") +
          (res.skipped > 0 ? ` — ATTENZIONE: ${res.skipped} copie saltate (sorgenti scadute/non scaricabili)` : "") +
          (res.backs_missing > 0 ? ` — ATTENZIONE: ${res.backs_missing} retri saltati (sorgenti scadute/non scaricabili)` : ""),
      );
      setLastPdf({ path: res.path, dir: outDir });
      // "Vuoi aggiungere questo deck alla tua collezione?": solo le carte
      // davvero stampate (con artwork, flag considering rispettato).
      setCollectItems(
        consolidateItems(
          currentDeck
            .filter((c) => values.includeConsidering !== false || c.zone !== "considering")
            .filter((c) => c.imageFront)
            .map(deckEntryToItem),
        ),
      );
      // Verifica dimensionale automatica (100% + delta stampante ±0.3%).
      await runVerify(res.path, values.cardWmm, values.cardHmm, values.bleedMm);
      // Chiusura pulita: 100% visibile un attimo, poi via.
      setProgress(1);
      setProgDetail((d) => (d ? { ...d, frac: 1, phase: "Completato", done: d.total, etaSecs: 0 } : d));
      await new Promise<void>((r) => window.setTimeout(r, 800));
    } catch (e) {
      setStatus(`Export fallito (solo app desktop): ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (timer !== undefined) window.clearInterval(timer);
      unlisten?.();
      setProgress(null);
      setProgDetail(null);
    }
  };

  const openPath = (p: string): void => {
    void open(p).catch(() => alert(`Impossibile aprire automaticamente, apri a mano:\n${p}`));
  };

  return {
    deck,
    values,
    copies: printedCopies,
    flow: printFlow,
    sheetError,
    totalPages,
    status,
    progress,
    progDetail,
    lastPdf,
    verify,
    verifyBusy,
    reverify,
    customPresets,
    presetId,
    register,
    handleSubmit,
    setValue,
    formState,
    apply,
    applyPreset,
    saveCurrentAsPreset,
    removePreset,
    exportPdf,
    openPath,
    collectItems,
    dismissCollect: () => setCollectItems(null),
  };
}
