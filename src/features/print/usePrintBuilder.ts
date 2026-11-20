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
import { BUILT_IN_PRESETS, deletePreset, listPresets, newPresetId, savePreset, type PrintPreset } from "@/lib/presets";
import type { PrintSettings } from "@/types";
import { printZoneOf, flowCopies, flowCounts, type PrintFlow } from "@/features/print/printModel";
import { buildExportArgs } from "@/features/print/batchExport";
import { ensureActiveTokenBoardFixed } from "@/hooks/useTokenBoardFix";
import { deckEntryToItem, consolidateItems } from "@/lib/collection";
import { useExportJob } from "@/stores/exportJob";

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

export interface PrintBuilderApi {
  deck: ReturnType<typeof useDeck.getState>["deck"];
  values: PrintSettings;
  copies: number;
  flow: PrintFlow;
  sheetError: string | null;
  totalPages: number;
  status: string;
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
  openPath: (m: string) => void;
}

export function usePrintBuilder(): PrintBuilderApi {
  const deck = useDeck((s) => s.deck);
  const print = usePrint();
  const [status, setStatus] = useState("");
  const [lastPdf, setLastPdf] = useState<{ path: string; dir: string } | null>(null);
  const [verify, setVerify] = useState<VerifyReport | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [customPresets, setCustomPresets] = useState<PrintPreset[]>([]);
  const [presetId, setPresetId] = useState<string>(BUILT_IN_PRESETS[0]?.id ?? "");

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
    setLastPdf(null);
    setVerify(null);
    const st = useExportJob.getState();
    if (st.job?.state === "running") {
      setStatus("Export già in corso: segui l'avanzamento nella finestrella in basso a sinistra.");
      return;
    }
    const projectId = useProjects.getState().activeId ?? "unassigned";
    const projectName = useProjects.getState().projects.find((p) => p.id === projectId)?.name;
    st.begin("single", projectName ? `PDF · ${projectName}` : "Export PDF");
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
        st.dismiss();
        setStatus("Nessuna carta con immagine da stampare (aggiungi artwork o carte custom).");
        return;
      }
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
      st.finish({
        detail: `${res.pages} pagine · ${res.unique_assets} asset unici / ${res.total_copies} copie · ${(res.bytes / 1024).toFixed(0)} KB`,
        pdfPath: res.path,
        dir: outDir,
      });
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
      st.setCollectItems(
        consolidateItems(
          currentDeck
            .filter((c) => values.includeConsidering !== false || c.zone !== "considering")
            .filter((c) => c.imageFront)
            .map(deckEntryToItem),
        ),
      );
      // Verifica dimensionale automatica (100% + delta stampante ±0.3%).
      await runVerify(res.path, values.cardWmm, values.cardHmm, values.bleedMm);
    } catch (e) {
      const msg = `Export fallito (solo app desktop): ${e instanceof Error ? e.message : String(e)}`;
      useExportJob.getState().fail(msg);
      setStatus(msg);
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
  };
}
