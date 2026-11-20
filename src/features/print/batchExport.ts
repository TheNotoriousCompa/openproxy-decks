import { invoke } from "@tauri-apps/api/core";
import { printZoneOf } from "@/features/print/printModel";
import type { CardEntry, PrintSettings, Project } from "@/types";

/** Riga carta per `export_pdf` (stesso shape usato dallo Studio). */
export interface ExportCard {
  src_path: string;
  qty: number;
  source_hash: string;
  zone: string;
  back_src_path?: string;
}

export interface MergedBatch {
  cards: ExportCard[];
  /** voci con artwork saltate (conteggiate, mai silenziose) */
  noArt: string[];
}

/**
 * Unisce i deck di più progetti in un'unica lista da stampare.
 * Puro e testabile: zone mappate come lo Studio (comandante nel main),
 * considering solo col flag, moltiplicatore copie, token in fondo perché
 * il backend impagina lo stesso flusso continuo dello Studio (ordine di zona,
 * pagine sempre piene).
 */
export function buildMergedCards(
  projects: Project[],
  opts: { includeConsidering: boolean; copies: number; backImage?: string },
): MergedBatch {
  const mult = Math.min(99, Math.max(1, Math.round(opts.copies)));
  const cards: ExportCard[] = [];
  const noArt: string[] = [];
  for (const p of projects) {
    for (const c of p.manifest.deck) {
      if (!opts.includeConsidering && c.zone === "considering") continue;
      const qty = Math.min(99, Math.max(1, Math.round(c.qty)) * mult);
      if (!c.imageFront) {
        noArt.push(`${p.name}: ${c.name}`);
        continue;
      }
      cards.push({
        src_path: c.imageFront,
        qty,
        source_hash: `${p.id}:${c.id}`,
        zone: printZoneOf(c.zone),
        back_src_path: (c.hasBack && c.imageBack ? c.imageBack : opts.backImage) || undefined,
      });
    }
  }
  return { cards, noArt };
}

/** Argomenti `export_pdf`: unica costruzione usata da Studio e blocco. */
export function buildExportArgs(
  values: PrintSettings,
  cards: ExportCard[],
  projectId: string,
  destPath: string,
): Record<string, unknown> {
  const dims =
    values.orientation === "portrait"
      ? { w: values.pageWmm, h: values.pageHmm }
      : { w: values.pageHmm, h: values.pageWmm };
  return {
    project_id: projectId,
    dest_path: destPath,
    page_w_mm: dims.w,
    page_h_mm: dims.h,
    card_w_mm: values.cardWmm,
    card_h_mm: values.cardHmm,
    margin_top_mm: values.marginTopMm,
    margin_right_mm: values.marginRightMm,
    margin_bottom_mm: values.marginBottomMm,
    margin_left_mm: values.marginLeftMm,
    spacing_row_mm: values.spacingRowMm,
    spacing_col_mm: values.spacingColMm,
    bleed_mm: values.bleedMm,
    dpi: values.dpi,
    profile: values.profile,
    crop_marks: values.guides.cropMarks,
    corner_marks: values.guides.cornerMarks,
    cut_lines: values.guides.cutLines,
    guide_color: "#000000",
    crop_color: values.guideColor ?? "#00ff00",
    guide_width_pt: values.guideWidthPt ?? 0.75,
    guide_placement: values.guidePlacement ?? "inside",
    guide_length_mm: values.guideLengthMm ?? 2,
    guide_shape: values.guideShape ?? "inside",
    guide_offset_mm: values.guideOffsetMm ?? 0,
    guide_style: values.guideStyle ?? "solid",
    guide_cap: values.guideCap ?? "square",
    guide_page_lines: values.guides.pageLines,
    duplex: values.duplex,
    upscale_mode: values.upscaleMode,
    brightness_pct: values.brightnessPct ?? 0,
    cards,
  };
}

export interface ExportPdfResult {
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
}

export interface VerifySummary {
  pass: boolean;
  worst_dev_pct: number;
  summary: string;
}

/**
 * Export unito: un solo `export_pdf` con le carte di tutti i progetti
 * (token in fondo via ordinamento zone backend) + verifica dimensionale.
 * Le impostazioni sono quelle correnti dello Studio (un solo layout per PDF).
 */
export async function exportMergedPdf(opts: {
  values: PrintSettings;
  cards: ExportCard[];
  dirProjectId: string;
  filename: string;
}): Promise<{ res: ExportPdfResult; dir: string; verify: VerifySummary | null }> {
  const outDir = await invoke<string>("export_dir", { projectId: opts.dirProjectId });
  const args = buildExportArgs(opts.values, opts.cards, opts.dirProjectId, `${outDir}/${opts.filename}`);
  const res = await invoke<ExportPdfResult>("export_pdf", { args });
  let verify: VerifySummary | null = null;
  try {
    const r = await invoke<{ pass: boolean; worst_dev_pct: number; summary: string }>("verify_pdf_file", {
      path: res.path,
      exp_w_mm: opts.values.cardWmm + opts.values.bleedMm * 2,
      exp_h_mm: opts.values.cardHmm + opts.values.bleedMm * 2,
      tol_pct: 0.5,
      printer_err_pct: 0.3,
    });
    verify = { pass: r.pass, worst_dev_pct: r.worst_dev_pct, summary: r.summary };
  } catch {
    verify = null;
  }
  return { res, dir: outDir, verify };
}

/** Riga sintetica per i riepiloghi: quante copie porta ogni progetto. */
export function batchCounts(projects: Project[]): { id: string; name: string; copies: number }[] {
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    copies: p.manifest.deck.reduce((n, c: CardEntry) => n + Math.max(1, c.qty), 0),
  }));
}
