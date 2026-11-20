use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Deserialize)]
pub struct PrintCard {
    pub src_path: String,
    pub qty: u32,
    /// id voce deck (dedup UI); MAI usato come identità cache export:
    /// resterebbe stabile al cambio stampa → il PDF riuserebbe la vecchia arte.
    pub source_hash: Option<String>,
    /// zona di stampa (main/side/commander/…): il PDF impagina per zona come
    /// l'anteprima (stesso ordine, stesse interruzioni pagina). Assente = main.
    #[serde(default)]
    pub zone: Option<String>,
    /// retro DFC/MDFC (fronte/retro della stessa carta). Assente = solo fronte.
    #[serde(default)]
    pub back_src_path: Option<String>,
    pub target_w_px: Option<u32>,
    pub target_h_px: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExportPdfArgs {
    pub project_id: String,
    pub dest_path: String,
    pub page_w_mm: f64,
    pub page_h_mm: f64,
    pub card_w_mm: f64,
    pub card_h_mm: f64,
    pub margin_top_mm: f64,
    pub margin_right_mm: f64,
    pub margin_bottom_mm: f64,
    pub margin_left_mm: f64,
    pub spacing_row_mm: f64,
    pub spacing_col_mm: f64,
    pub bleed_mm: f64,
    pub dpi: f64,
    /// minimum | balanced | high | maximum
    pub profile: String,
    pub crop_marks: bool,
    pub corner_marks: bool,
    pub cut_lines: bool,
    /// colore guide esadecimale (default rosso)
    #[serde(default = "default_guide_color")]
    pub guide_color: String,
    /// colore crocini d'angolo esadecimale (default verde, come proxxied.com)
    #[serde(default = "default_crop_color")]
    pub crop_color: String,
    #[serde(default = "default_guide_width")]
    pub guide_width_pt: f64,
    #[serde(default = "default_guide_placement")]
    pub guide_placement: String,
    #[serde(default = "default_guide_length")]
    pub guide_length_mm: f64,
    #[serde(default = "default_guide_style")]
    pub guide_style: String,
    #[serde(default = "default_guide_cap")]
    pub guide_cap: String,
    /// cross | inside | outside: forma dei segni d'angolo
    #[serde(default = "default_cut_shape")]
    pub guide_shape: String,
    /// scostamento fine della linea in mm (positivo = dentro la carta)
    #[serde(default)]
    pub guide_offset_mm: f64,
    /// linee di taglio a tutta pagina (guide per la taglierina)
    #[serde(default)]
    pub guide_page_lines: bool,
    pub cards: Vec<PrintCard>,
    /// front_only | back_only | separate | duplex_long | duplex_short (default front_only)
    #[serde(default = "default_duplex")]
    pub duplex: String,
    /// off | ask | auto | always (default auto: miglioramento sempre attivo)
    #[serde(default = "default_upscale_mode")]
    pub upscale_mode: String,
    /// luminosità in punti percentuale (-50..+50, 0 = invariata)
    #[serde(default)]
    pub brightness_pct: i32,
}

fn default_duplex() -> String {
    "front_only".to_string()
}

fn default_upscale_mode() -> String {
    "auto".to_string()
}

fn default_guide_color() -> String {
    "#000000".to_string()
}

fn default_crop_color() -> String {
    "#00ff00".to_string()
}

fn default_guide_width() -> f64 {
    0.4
}

fn default_guide_placement() -> String {
    "outside".to_string()
}

fn default_guide_length() -> f64 {
    1.5
}

fn default_guide_style() -> String {
    "solid".to_string()
}

fn default_guide_cap() -> String {
    "square".to_string()
}

fn default_cut_shape() -> String {
    "inside".to_string()
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportPdfResult {
    pub path: String,
    pub pages: usize,
    pub unique_assets: usize,
    pub total_copies: usize,
    pub bytes: u64,
    /// copie saltate (sorgente illeggibile: blob: scaduti, remoti falliti)
    pub skipped: usize,
    pub skipped_names: Vec<String>,
    /// pagine retro incluse nel PDF (0 se duplex front_only o nessun retro)
    pub back_pages: usize,
    /// copie retro stampate (solo carte con back_src_path risolvibile)
    pub backs_printed: usize,
    /// copie retro saltate (back dichiarato ma illeggibile)
    pub backs_missing: usize,
    /// asset unici passati per l'upscale CPU (upscaled_ai sempre 0: niente AI)
    pub upscaled: usize,
    pub upscaled_ai: usize,
}

/// Versione della pipeline di elaborazione: dentro la chiave di cache, così una
/// correzione (es. l'adattamento proporzioni) non riusa i file elaborati vecchi.
const PIPELINE_VERSION: u32 = 9;

/// Decisione upscale pura e testabile (mirror della policy in upscale::upscale_file).
/// Solo CPU Lanczos3: off → mai · always → se scala>1 · auto/ask → se aumento significativo.
pub fn decide_upscale(mode: &str, scale_needed: f64) -> bool {
    match mode {
        "off" => false,
        "always" => scale_needed > 1.0,
        _ => scale_needed > 1.25,
    }
}

fn jpeg_quality_for(profile: &str) -> u8 {
    match profile {
        "minimum" => 60,
        "high" => 92,
        "maximum" => 96,
        _ => 85, // balanced default — mai 100 automatico
    }
}

/// Identità del contenuto sorgente per la cache export.
///
/// `source_hash` (id voce deck) NON basta: dopo un cambio stampa l'id resta lo
/// stesso ma il file è diverso → la cache colpirebbe l'elaborato vecchio e il
/// PDF stamperebbe la stampa precedente.
///
/// Basta `path + dimensione + mtime`: gli asset scaricati hanno già l'hash del
/// contenuto nel nome file (`<sha256>.<ext>`), quindi due stampe identiche
/// condividono il path e il cambio stampa cambia path (o mtime). Così non
/// leggiamo e hashamo centinaia di MB a ogni export.
fn content_identity(fs_path: &str, memo: &mut std::collections::HashMap<String, String>) -> String {
    if let Some(hit) = memo.get(fs_path) {
        return hit.clone();
    }
    let ident = match std::fs::metadata(fs_path) {
        Ok(m) => {
            let mtime = m.modified().map(|t| format!("{:?}", t)).unwrap_or_default();
            format!("file:{}:{}:{}", fs_path, m.len(), mtime)
        }
        Err(_) => format!("path:{fs_path}"),
    };
    memo.insert(fs_path.to_string(), ident.clone());
    ident
}

/// Lato di una pagina nel PDF finale.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PageSide {
    Front,
    Back,
}

/// Specchia un piazzamento retro per la stampa fronte/retro allineata:
/// - duplex_long (rilegatura lato lungo): specchio orizzontale.
/// - duplex_short (rilegatura lato corto): specchio verticale.
/// - altri modi: nessuna trasformazione.
pub fn mirror_back_placement(
    x_mm: f64,
    y_top_mm: f64,
    w_mm: f64,
    h_mm: f64,
    page_w_mm: f64,
    page_h_mm: f64,
    duplex: &str,
) -> (f64, f64) {
    match duplex {
        "duplex_long" => (page_w_mm - x_mm - w_mm, y_top_mm),
        "duplex_short" => (x_mm, page_h_mm - y_top_mm - h_mm),
        _ => (x_mm, y_top_mm),
    }
}

/// Ordine delle zone di stampa. Mirror di `printGroupsInOrder` (frontend
/// `features/print/printModel.ts`): anteprima e PDF devono usare lo stesso
/// ordine — le due liste vanno tenute allineate. Token per ultimi.
pub const ZONE_ORDER: &[&str] =
    &["main", "side", "commander", "extra", "maybe", "considering", "custom", "tokens"];

/// Zone incontrate, ordinate: prima quelle note (nell'ordine UI), poi le
/// eventuali altre in ordine di incontro. Pura e testabile.
pub fn order_zones(encountered: &[String]) -> Vec<String> {
    let mut out: Vec<String> = ZONE_ORDER
        .iter()
        .map(|s| s.to_string())
        .filter(|z| encountered.contains(z))
        .collect();
    for z in encountered {
        if !out.contains(z) {
            out.push(z.clone());
        }
    }
    out
}

/// Ordine delle pagine fronte/retro nel PDF finale.
/// Ritorna (lato, indice_pagina_nel_layout_del_lato) per ogni pagina emessa.
pub fn plan_page_sides(front_pages: usize, back_pages: usize, duplex: &str) -> Vec<(PageSide, usize)> {
    match duplex {
        "back_only" => (0..back_pages).map(|i| (PageSide::Back, i)).collect(),
        "separate" => (0..front_pages)
            .map(|i| (PageSide::Front, i))
            .chain((0..back_pages).map(|i| (PageSide::Back, i)))
            .collect(),
        "duplex_long" | "duplex_short" => {
            let mut out = Vec::with_capacity(front_pages + back_pages);
            for i in 0..front_pages.max(back_pages) {
                if i < front_pages {
                    out.push((PageSide::Front, i));
                }
                if i < back_pages {
                    out.push((PageSide::Back, i));
                }
            }
            out
        }
        _ => (0..front_pages).map(|i| (PageSide::Front, i)).collect(),
    }
}

#[tauri::command]
pub async fn export_pdf(handle: AppHandle, args: ExportPdfArgs) -> Result<ExportPdfResult, String> {
    use crate::processing::{required_pixels, LayoutInput};
    if args.cards.is_empty() {
        return Err("nessuna carta da stampare".into());
    }
    let job_id = crate::jobs::enqueue("export-pdf", &format!("PDF {}", args.project_id));
    let duplex = args.duplex.as_str();
    let wants_backs = matches!(duplex, "back_only" | "separate" | "duplex_long" | "duplex_short");
    // Risolvi sorgenti → path filesystem reali.
    // - asset://localhost → path locale; - http(s) remoto → scaricato in cache;
    // - blob:/data: o illeggibili → copie saltate (conteggiate, mai silenziose).
    async fn resolve_src(handle: &AppHandle, src: &str) -> Option<String> {
        match crate::commands::assets::resolve_to_fs_path(src) {
            Ok(p) => {
                if std::path::Path::new(&p).exists() {
                    Some(p)
                } else {
                    None
                }
            }
            Err(e) if e.starts_with("URL remoto") => {
                match crate::commands::assets::download_remote_to_cache(handle, src).await {
                    Ok(p) => Some(p.to_string_lossy().to_string()),
                    Err(_) => None,
                }
            }
            Err(_) => None,
        }
    }
    // Espandi quantità → copie (zona, carta, path). Il PDF impagina il flusso
    // continuo come l'anteprima: stesso ordine, pagine sempre piene.
    let mut fronts: Vec<(String, &PrintCard, String)> = Vec::new();
    let mut backs: Vec<(String, &PrintCard, String)> = Vec::new();
    let mut skipped_names: Vec<String> = Vec::new();
    let mut backs_missing: usize = 0;
    for c in &args.cards {
        let zone = c.zone.clone().unwrap_or_else(|| "main".to_string());
        let n = c.qty.max(1) as usize;
        match resolve_src(&handle, &c.src_path).await {
            Some(p) => {
                for _ in 0..n {
                    fronts.push((zone.clone(), c, p.clone()));
                }
            }
            None => {
                for _ in 0..n {
                    skipped_names.push(c.source_hash.clone().unwrap_or_else(|| c.src_path.clone()));
                }
            }
        }
        if wants_backs {
            if let Some(back) = c.back_src_path.as_deref().filter(|s| !s.trim().is_empty()) {
                match resolve_src(&handle, back).await {
                    Some(p) => {
                        for _ in 0..n {
                            backs.push((zone.clone(), c, p.clone()));
                        }
                    }
                    None => {
                        backs_missing += n;
                    }
                }
            }
        }
    }
    if fronts.is_empty() && duplex != "back_only" {
        return Err(format!(
            "nessuna immagine stampabile ({} copie saltate: sorgenti scadute o non scaricabili)",
            skipped_names.len()
        ));
    }
    if duplex == "back_only" && backs.is_empty() {
        return Err("nessun retro disponibile da stampare (nessuna carta con retro valido)".into());
    }
    // Zone in ordine di stampa (come l'anteprima). Il flusso è CONTINUO:
    // le copie seguono l'ordine delle zone ma un solo layout riempie ogni
    // pagina — le zone non ripartono da pagina nuova, solo l'ultima pagina
    // può restare incompleta.
    let zones = order_zones(
        &fronts
            .iter()
            .map(|(z, _, _)| z.clone())
            .chain(backs.iter().map(|(z, _, _)| z.clone()))
            .collect::<Vec<_>>(),
    );
    let layout_args = |total_cards: usize| LayoutInput {
        page_w_mm: args.page_w_mm,
        page_h_mm: args.page_h_mm,
        card_w_mm: args.card_w_mm,
        card_h_mm: args.card_h_mm,
        margin_top_mm: args.margin_top_mm,
        margin_right_mm: args.margin_right_mm,
        margin_bottom_mm: args.margin_bottom_mm,
        margin_left_mm: args.margin_left_mm,
        spacing_row_mm: args.spacing_row_mm,
        spacing_col_mm: args.spacing_col_mm,
        bleed_mm: args.bleed_mm,
        total_cards,
    };
    // Copie ordinate per zona (stabile dentro la zona) + un solo layout per
    // lato (back_only non calcola alcun layout fronte).
    let ordered_fronts: Vec<(&PrintCard, String)> = zones
        .iter()
        .flat_map(|zone| {
            fronts
                .iter()
                .filter(|(z, _, _)| z == zone)
                .map(|(_, c, p)| (*c, p.clone()))
                .collect::<Vec<_>>()
        })
        .collect();
    let ordered_backs: Vec<(&PrintCard, String)> = zones
        .iter()
        .flat_map(|zone| {
            backs
                .iter()
                .filter(|(z, _, _)| z == zone)
                .map(|(_, c, p)| (*c, p.clone()))
                .collect::<Vec<_>>()
        })
        .collect();
    let front_layout = if duplex == "back_only" || ordered_fronts.is_empty() {
        None
    } else {
        Some(crate::processing::compute_layout(&layout_args(ordered_fronts.len()))?)
    };
    let back_layout = if wants_backs && !ordered_backs.is_empty() {
        Some(crate::processing::compute_layout(&layout_args(ordered_backs.len()))?)
    } else {
        None
    };

    let t_start = std::time::Instant::now();
    let t_process: std::time::Duration;
    let mut cache_hits = 0usize;
    let req_w = required_pixels(args.card_w_mm + args.bleed_mm * 2.0, args.dpi);
    let req_h = required_pixels(args.card_h_mm + args.bleed_mm * 2.0, args.dpi);
    let quality = jpeg_quality_for(&args.profile);
    let cache_dir = crate::cache::final_dir(&handle)?;
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    let models_dir = crate::storage::models_dir(&handle)?;
    let tmp_dir = crate::storage::app_root(&handle)?.join("tmp");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    let mut upscaled = 0usize;
    let upscaled_ai = 0usize; // niente AI: campo tenuto per compatibilità frontend

    // Processa fronti + retri con un'unica pipeline, un asset unico una sola volta (dedup).
    // I byte sono condivisi via Rc: le copie non duplicano i MB in RAM.
    use std::collections::HashMap;
    use std::rc::Rc;
    let mut processed: HashMap<String, (Rc<Vec<u8>>, u32, u32)> = HashMap::new();
    let mut ident_memo: HashMap<String, String> = HashMap::new();
    let all_copies: Vec<(&PrintCard, String)> = fronts
        .iter()
        .chain(backs.iter())
        .map(|(_, c, p)| (*c, p.clone()))
        .collect();
    let total = all_copies.len();
    for (i, pair) in all_copies.iter().enumerate() {
        if crate::jobs::is_cancelled(&job_id) {
            return Err("export annullato".into());
        }
        let (_pcard, fs_path) = (pair.0, pair.1.as_str());
        let key_src = content_identity(fs_path, &mut ident_memo);
        let ckey = crate::cache::make_key(&[
            &key_src,
            &format!("{req_w}x{req_h}"),
            &format!("dpi{}", args.dpi as u32),
            &format!("q{quality}"),
            &format!("bleed{}", args.bleed_mm),
            &format!("up{}", args.upscale_mode),
            &format!("br{}", args.brightness_pct),
            &format!("pipe{PIPELINE_VERSION}"),
        ]);
        if processed.contains_key(&ckey) {
            continue;
        }
        let t_asset = std::time::Instant::now();
        // un file in cache troncato (export interrotto) NON va riusato: nel PDF
        // uscirebbe come carta nera o bianca
        let hit = crate::cache::lookup(&handle, &ckey)?
            .filter(|p| crate::image::file_looks_complete(p));
        if let Some(hit) = hit {
            cache_hits += 1;
            let bytes = Rc::new(std::fs::read(&hit).map_err(|e| e.to_string())?);
            // Dimensioni dall'header del JPEG: decodificare l'immagine intera
            // (3000x4200px) solo per leggere due numeri costava ~0.2s per carta.
            let (w, h) = image::image_dimensions(&hit).unwrap_or((req_w, req_h));
            processed.insert(ckey, (bytes, w, h));
        } else {
            // Dimensioni della CELLA (carta + bleed) in pixel.
            //
            // Regola: la cella ha sempre le proporzioni della cella fisica; la
            // densità è quella richiesta ma, con upscale off, mai oltre quella
            // che la sorgente può coprire. Così l'immagine nel PDF non viene mai
            // stirata dalla finestra di visualizzazione/stampa (era l'errore per
            // cui le carte uscivano più strette di ~1 mm, fuori misura nativa).
            // Composizione come proxxied: si adatta l'arte alla CARTA (con scala
            // uniforme e ritaglio centrato) e la cella nasce dalla banda di bleed
            // costruita attorno. La cella e' quindi il riferimento in pixel: cosi'
            // la banda e' esattamente bleed_mm e la guida di taglio (a bleed_mm dal
            // bordo cella) cade sul bordo della carta senza scarti di arrotondamento.
            let cell_w_mm = args.card_w_mm + args.bleed_mm * 2.0;
            let cell_h_mm = args.card_h_mm + args.bleed_mm * 2.0;
            let req_cell_w = required_pixels(cell_w_mm, args.dpi).max(1);
            let req_cell_h = required_pixels(cell_h_mm, args.dpi).max(1);
            let mut cell_px = (req_cell_w, req_cell_h);
            let mut bleed_px = (args.bleed_mm * (req_cell_w as f64 / cell_w_mm)).round() as u32;
            let mut card_px = (
                req_cell_w.saturating_sub(bleed_px * 2).max(1),
                req_cell_h.saturating_sub(bleed_px * 2).max(1),
            );
            let mut src_for_process = fs_path.to_string();
            if let Some((sw, sh)) = image::image_dimensions(std::path::Path::new(fs_path)).ok() {
                if args.upscale_mode == "off" {
                    // densita' (px per mm) che la sorgente copre sulla CARTA: se la
                    // sorgente ha un bleed suo (MPC = 1/8 in), la densita' va calcolata
                    // sulla sola carta, non sull'immagine intera
                    let src_bleed = crate::image::source_bleed_mm((sw, sh), args.card_w_mm, args.card_h_mm)
                        .unwrap_or(0.0);
                    let span_w = args.card_w_mm + 2.0 * src_bleed;
                    let span_h = args.card_h_mm + 2.0 * src_bleed;
                    let src_density = f64::min(sw as f64 / span_w, sh as f64 / span_h);
                    let req_density = args.dpi / 25.4;
                    let density = src_density.min(req_density);
                    let w = (cell_w_mm * density).round() as u32;
                    let h = (cell_h_mm * density).round() as u32;
                    cell_px = (w.max(1), h.max(1));
                    bleed_px = (args.bleed_mm * density).round() as u32;
                    card_px = (
                        cell_px.0.saturating_sub(bleed_px * 2).max(1),
                        cell_px.1.saturating_sub(bleed_px * 2).max(1),
                    );
                }
                let report = crate::processing::analyze_quality(
                    sw,
                    sh,
                    args.card_w_mm + args.bleed_mm * 2.0,
                    args.card_h_mm + args.bleed_mm * 2.0,
                    args.dpi,
                );
                if decide_upscale(&args.upscale_mode, report.scale_needed) {
                    match crate::upscale::upscale_file(
                        &crate::upscale::UpscaleRequest {
                            src_path: fs_path.to_string(),
                            target_w_px: card_px.0,
                            target_h_px: card_px.1,
                            mode: args.upscale_mode.clone(),
                            model: None,
                        },
                        &models_dir,
                        &tmp_dir,
                    ) {
                        Ok(p) => {
                            src_for_process = p.to_string_lossy().to_string();
                            upscaled += 1;
                        }
                        Err(_) => {
                            // fallback: resize HQ diretto sotto
                        }
                    }
                }
            }
            let out = crate::image::process_to_cache(
                std::path::Path::new(&src_for_process),
                &crate::image::ProcessOptions {
                    target_w_px: card_px.0,
                    target_h_px: card_px.1,
                    card_w_mm: args.card_w_mm,
                    card_h_mm: args.card_h_mm,
                    crop: None,
                    rotate_deg: 0,
                    flip_h: false,
                    flip_v: false,
                    bleed_px,
                    quality,
                    out_format: "jpg".into(),
                    method: crate::processing::UpscaleMethod::Interpolate,
                    brightness_pct: args.brightness_pct,
                },
                &ckey,
                &cache_dir,
            )?;
            let bytes = Rc::new(std::fs::read(&out).map_err(|e| e.to_string())?);
            // dimensioni reali del file elaborato (il cover può cambiare i pixel)
            let (ow, oh) = image::image_dimensions(&out).unwrap_or(cell_px);
            processed.insert(ckey.clone(), (bytes, ow, oh));
            crate::cache::store(&handle, &ckey, &out)?;
        }
        let _ = t_asset.elapsed();
        crate::jobs::emit_progress(&handle, &job_id, (i + 1) as f32 / total as f32 * 0.8, "processing");
        // Libera memoria temporanea tra un asset e l'altro: drop esplicito a fine iterazione.
    }
    let t_after_process = std::time::Instant::now();

    t_process = t_after_process - t_start;
    // Pagine PDF sul flusso continuo (stesso ordine e stesso riempimento
    // dell'anteprima), con XObject deduplicati e ordine fronte/retro del modo
    // duplex sull'intero documento.
    let mut pdf_pages: Vec<crate::pdf::PdfPage> = Vec::new();
    let mut emitted_back_pages: usize = 0;
    let mut placed: usize = 0;
    let place_total = fronts.len() + backs.len();
    let front_pages = front_layout.as_ref().map(|l| l.pages).unwrap_or(0);
    let back_pages = back_layout.as_ref().map(|l| l.pages).unwrap_or(0);
    let order = plan_page_sides(front_pages, back_pages, duplex);
    for (side, side_page) in &order {
        let (side_layout, side_copies): (_, &Vec<(&PrintCard, String)>) = match side {
            PageSide::Front => (front_layout.as_ref().expect("layout fronte"), &ordered_fronts),
            PageSide::Back => (back_layout.as_ref().expect("layout retro"), &ordered_backs),
        };
        let mut page = crate::pdf::PdfPage {
            w_mm: args.page_w_mm,
            h_mm: args.page_h_mm,
            images: Vec::new(),
            guides: crate::pdf::GuideOptions {
                crop_marks: args.crop_marks,
                corner_marks: args.corner_marks,
                cut_lines: args.cut_lines,
                mark_len_mm: args.guide_length_mm,
                cut_shape: args.guide_shape.clone(),
                cut_offset_mm: args.guide_offset_mm,
                color_rgb: crate::pdf::parse_hex_color(&args.guide_color),
                crop_rgb: crate::pdf::parse_hex_color(&args.crop_color),
                width_pt: args.guide_width_pt,
                placement: args.guide_placement.clone(),
                line_style: args.guide_style.clone(),
                line_cap: args.guide_cap.clone(),
                page_lines: args.guide_page_lines,
                // Trim sul formato carta: l'esterno include il bleed, il taglio rientra.
                bleed_mm: args.bleed_mm.max(0.0),
            },
            guide_rects: Vec::new(),
        };
        for pl in side_layout.placements.iter().filter(|p| p.page == *side_page) {
            let (_pcard, fs_path) = &side_copies[pl.index];
            let key_src = content_identity(fs_path, &mut ident_memo);
            let ckey = crate::cache::make_key(&[
                &key_src,
                &format!("{req_w}x{req_h}"),
                &format!("dpi{}", args.dpi as u32),
                &format!("q{quality}"),
                &format!("bleed{}", args.bleed_mm),
                &format!("up{}", args.upscale_mode),
                &format!("br{}", args.brightness_pct),
                &format!("pipe{PIPELINE_VERSION}"),
            ]);
            if let Some((bytes, w, h)) = processed.get(&ckey) {
                // I retri duplex sono specchiati per l'allineamento fronte/retro in stampa.
                let (x_mm, y_mm_top) = match side {
                    PageSide::Back => mirror_back_placement(
                        pl.x_mm,
                        pl.y_mm,
                        pl.w_mm,
                        pl.h_mm,
                        args.page_w_mm,
                        args.page_h_mm,
                        duplex,
                    ),
                    PageSide::Front => (pl.x_mm, pl.y_mm),
                };
                page.images.push(crate::pdf::PlacedImage {
                    hash: ckey.clone(),
                    x_mm,
                    y_mm_top: y_mm_top,
                    w_mm: pl.w_mm,
                    h_mm: pl.h_mm,
                    // Rc: nessun clone dei MB, solo il puntatore condiviso
                    jpeg_bytes: Rc::clone(bytes),
                    img_w_px: *w,
                    img_h_px: *h,
                });
                page.guide_rects.push((x_mm, y_mm_top, pl.w_mm, pl.h_mm));
            }
            placed += 1;
            crate::jobs::emit_progress(
                &handle,
                &job_id,
                0.8 + 0.15 * placed as f32 / place_total.max(1) as f32,
                "layout",
            );
        }
        if *side == PageSide::Back {
            emitted_back_pages += 1;
        }
        pdf_pages.push(page);
    }

    let t_layout = t_after_process.elapsed();
    // Mai path relativi alla CWD: risolvi contro exports/ del progetto.
    let dest_path = if std::path::Path::new(&args.dest_path).is_absolute() {
        args.dest_path.clone()
    } else {
        let dir = crate::storage::project_dir(&handle, &args.project_id)?.join("exports");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        dir.join(&args.dest_path).to_string_lossy().to_string()
    };
    if let Some(parent) = std::path::Path::new(&dest_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Scrittura incrementale su file: mai l'intero PDF in RAM (deck grandi).
    let t_pdf = std::time::Instant::now();
    let pdf_len = crate::pdf::build_pdf_to_file(&pdf_pages, std::path::Path::new(&dest_path))?;
    let t_build = t_pdf.elapsed();
    // Tempi per fase nel log del backend: se un export sembra lento si vede dove.
    println!(
        "[export] {} copie · {} asset unici ({} da cache) · elaborazione {:.1}s · impaginazione {:.1}s · PDF {:.1}s · totale {:.1}s · {:.0} MB",
        fronts.len() + backs.len(),
        processed.len(),
        cache_hits,
        t_process.as_secs_f64(),
        t_layout.as_secs_f64(),
        t_build.as_secs_f64(),
        t_start.elapsed().as_secs_f64(),
        pdf_len as f64 / 1_048_576.0,
    );
    let unique = processed.len();
    crate::jobs::emit_progress(&handle, &job_id, 1.0, "done");
    let job = crate::jobs::begin_next(None).unwrap_or(crate::jobs::JobInfo {
        id: job_id.clone(),
        kind: "export-pdf".into(),
        label: String::new(),
        status: "done".into(),
        progress: 1.0,
        error: None,
    });
    crate::jobs::finish_job(&handle, job, true, None);

    Ok(ExportPdfResult {
        bytes: pdf_len,
        pages: pdf_pages.len(),
        unique_assets: unique,
        total_copies: fronts.len(),
        path: dest_path,
        skipped: skipped_names.len(),
        skipped_names: skipped_names.into_iter().take(20).collect(),
        back_pages: emitted_back_pages,
        backs_printed: backs.len(),
        backs_missing,
        upscaled,
        upscaled_ai,
    })
}

/// Verifica dimensionale di un PDF appena esportato (100% + delta stampante).
/// Legge il file dal filesystem (solo app desktop) e confronta ogni
/// piazzamento con il nominale carta+bleed.
#[tauri::command]
pub async fn verify_pdf_file(
    path: String,
    exp_w_mm: f64,
    exp_h_mm: f64,
    tol_pct: f64,
    printer_err_pct: f64,
) -> Result<crate::pdf::verify::VerifyReport, String> {
    if path.trim().is_empty() {
        return Err("path PDF vuoto".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("lettura PDF: {e}"))?;
    if bytes.len() > 200 * 1024 * 1024 {
        return Err("PDF troppo grande per la verifica".into());
    }
    crate::pdf::verify::verify_pdf(&bytes, exp_w_mm, exp_h_mm, tol_pct, printer_err_pct)
}

#[cfg(test)]
mod tests {
    use super::{content_identity, decide_upscale, mirror_back_placement, order_zones, plan_page_sides, PageSide};

    #[test]
    fn mirror_duplex_long_specchia_orizzontale() {
        // A4, carta 63×88 a (10,10): x' = 210-10-63 = 137, y invariata
        let (x, y) = mirror_back_placement(10.0, 10.0, 63.0, 88.0, 210.0, 297.0, "duplex_long");
        assert!((x - 137.0).abs() < 1e-9, "{x}");
        assert!((y - 10.0).abs() < 1e-9, "{y}");
    }

    #[test]
    fn mirror_duplex_short_specchia_verticale() {
        // y_top' = 297-10-88 = 199, x invariata
        let (x, y) = mirror_back_placement(10.0, 10.0, 63.0, 88.0, 210.0, 297.0, "duplex_short");
        assert!((x - 10.0).abs() < 1e-9, "{x}");
        assert!((y - 199.0).abs() < 1e-9, "{y}");
    }

    #[test]
    fn mirror_altri_modi_identita() {
        for mode in ["front_only", "back_only", "separate", "sconosciuto"] {
            let (x, y) = mirror_back_placement(10.0, 10.0, 63.0, 88.0, 210.0, 297.0, mode);
            assert!((x - 10.0).abs() < 1e-9 && (y - 10.0).abs() < 1e-9, "{mode}: {x},{y}");
        }
    }

    #[test]
    fn plan_front_only_ignora_retri() {
        assert_eq!(plan_page_sides(3, 2, "front_only"), vec![(PageSide::Front, 0), (PageSide::Front, 1), (PageSide::Front, 2)]);
        assert_eq!(plan_page_sides(2, 0, "separate"), vec![(PageSide::Front, 0), (PageSide::Front, 1)]);
    }

    #[test]
    fn plan_back_only_solo_retri() {
        assert_eq!(plan_page_sides(3, 2, "back_only"), vec![(PageSide::Back, 0), (PageSide::Back, 1)]);
    }

    #[test]
    fn plan_separate_fronti_poi_retri() {
        assert_eq!(
            plan_page_sides(2, 1, "separate"),
            vec![(PageSide::Front, 0), (PageSide::Front, 1), (PageSide::Back, 0)]
        );
    }

    #[test]
    fn plan_duplex_interleaved() {
        use PageSide::{Back, Front};
        assert_eq!(
            plan_page_sides(2, 2, "duplex_long"),
            vec![(Front, 0), (Back, 0), (Front, 1), (Back, 1)]
        );
        // più fronti che retri: i fronti restanti accodati dopo l'ultima coppia
        assert_eq!(
            plan_page_sides(3, 1, "duplex_short"),
            vec![(Front, 0), (Back, 0), (Front, 1), (Front, 2)]
        );
        // nessun retro: solo fronti (niente pagine vuote)
        assert_eq!(plan_page_sides(2, 0, "duplex_long"), vec![(Front, 0), (Front, 1)]);
    }

    #[test]
    fn content_identity_cambia_col_contenuto_senza_leggere_tutto() {
        let dir = std::env::temp_dir().join(format!("proxxied-ident-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.jpg");
        let b = dir.join("b.jpg");
        std::fs::write(&a, b"print-one").unwrap();
        let mut memo = Default::default();
        let ia = content_identity(&a.to_string_lossy(), &mut memo);
        // stesso file → stessa identità (memo + metadati stabili)
        let ia2 = content_identity(&a.to_string_lossy(), &mut Default::default());
        assert_eq!(ia, ia2);
        // contenuto diverso (dimensione diversa) → identità diversa
        std::fs::write(&b, b"print-one-plus").unwrap();
        let ib = content_identity(&b.to_string_lossy(), &mut memo);
        assert_ne!(ia, ib);
        // file inesistente: fallback sul path, mai panic
        let iz = content_identity("Z:\\inexistent\\x.jpg", &mut memo);
        assert!(iz.starts_with("path:"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn zone_in_ordine_ui_poi_altre() {
        // anteprima (printGroupsInOrder frontend) e PDF condividono l'ordine
        let got = order_zones(&["side".into(), "main".into(), "custom-x".into(), "commander".into()]);
        assert_eq!(got, vec!["main", "side", "commander", "custom-x"]);
        // token sempre per ultimi, anche dopo custom
        let got2 = order_zones(&["tokens".into(), "custom".into(), "main".into()]);
        assert_eq!(got2, vec!["main", "custom", "tokens"]);
        // deck a sola zona: una sola sezione
        assert_eq!(order_zones(&["main".into()]), vec!["main"]);
        // senza zona dichiarata il chiamante usa main
        assert!(order_zones(&[]).is_empty());
    }

    #[test]
    fn upscale_decision_matrix() {
        // solo CPU Lanczos3: off → mai; always → se scala>1; auto/ask → se aumento significativo
        assert!(!decide_upscale("off", 2.5));
        assert!(decide_upscale("auto", 2.0));
        assert!(decide_upscale("ask", 3.0));
        assert!(!decide_upscale("auto", 1.1));
        assert!(!decide_upscale("ask", 1.25));
        assert!(decide_upscale("always", 1.1));
        assert!(decide_upscale("always", 2.0));
        assert!(!decide_upscale("always", 0.9));
        // mode sconosciuto → auto
        assert!(decide_upscale("xxx", 2.0));
        assert!(!decide_upscale("xxx", 1.0));
    }




}
