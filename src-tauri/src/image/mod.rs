//! Analisi + pipeline immagini: analyze → crop → rotate/flip → requiredPx →
//! upscale-if-needed → final resize → bleed → optimize/compress → cache → embed.
//! Mai fingere qualità cambiando solo il metadata DPI.
use image::{DynamicImage, GenericImageView, ImageFormat, imageops::FilterType};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, serde::Serialize)]
pub struct ImageAnalysis {
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub source_hash: String,
    pub quality: crate::processing::QualityReport,
}

pub fn detect_format(path: &Path) -> String {
    mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string()
}

/// Analisi per la qualità delle celle: bastano le dimensioni, quindi si legge
/// solo l'header (`image_dimensions`) invece di decodificare l'immagine intera —
/// su un asset MPC da 14 MB il chip DPI compariva dopo secondi invece che subito.
pub fn analyze_file(
    path: &Path,
    target_w_mm: f64,
    target_h_mm: f64,
    target_dpi: f64,
) -> Result<ImageAnalysis, String> {
    let (w, h) = image::image_dimensions(path).map_err(|e| format!("dimensioni: {e}"))?;
    // identità leggera: path + dimensione + mtime (nessun hash di centinaia di MB)
    let source_hash = match std::fs::metadata(path) {
        Ok(m) => crate::storage::sha256_bytes(
                format!(
                    "{}:{}:{}",
                    path.to_string_lossy(),
                    m.len(),
                    m.modified().map(|t| format!("{:?}", t)).unwrap_or_default()
                )
                .as_bytes(),
            ),
        Err(_) => String::new(),
    };
    let quality = crate::processing::analyze_quality(w, h, target_w_mm, target_h_mm, target_dpi);
    Ok(ImageAnalysis {
        width: w,
        height: h,
        format: detect_format(path),
        source_hash,
        quality,
    })
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ProcessOptions {
    pub target_w_px: u32,
    pub target_h_px: u32,
    /// dimensioni nominali della CARTA in mm (cella meno bleed): servono per
    /// dedurre il bleed della sorgente e la banda in mm. Mai hardcoded.
    pub card_w_mm: f64,
    pub card_h_mm: f64,
    /// 0 = nessun crop; altrimenti frazioni 0..1 (x,y,w,h)
    pub crop: Option<[f32; 4]>,
    pub rotate_deg: i32,
    pub flip_h: bool,
    pub flip_v: bool,
    /// bleed in pixel da aggiungere attorno
    pub bleed_px: u32,
    /// jpeg quality 1..100 / png: compressione; webp: quality
    pub quality: u8,
    pub out_format: String,
    /// metodo deciso da analyze_quality
    pub method: crate::processing::UpscaleMethod,
    /// luminosità in punti percentuale (-50..+50, 0 = invariata): le stampe
    /// casalinghe escono più scure dello schermo (tip proxxied: +5..+10).
    pub brightness_pct: i32,
}

/// Crop PRIMA dell'upscale per evitare processing inutile.
pub fn process_to_cache(
    src: &Path,
    opts: &ProcessOptions,
    cache_key: &str,
    cache_dir: &Path,
) -> Result<PathBuf, String> {
    let bytes = std::fs::read(src).map_err(|e| format!("read: {e}"))?;
    let mut img = image::load_from_memory(&bytes).map_err(|e| format!("decode: {e}"))?;

    if let Some([x, y, w, h]) = opts.crop {
        let (sw, sh) = img.dimensions();
        let cx = (x.clamp(0.0, 1.0) * sw as f32) as u32;
        let cy = (y.clamp(0.0, 1.0) * sh as f32) as u32;
        let cw = ((w.clamp(0.0, 1.0) * sw as f32) as u32).max(1).min(sw.saturating_sub(cx));
        let ch = ((h.clamp(0.0, 1.0) * sh as f32) as u32).max(1).min(sh.saturating_sub(cy));
        if cw > 0 && ch > 0 {
            img = img.crop_imm(cx, cy, cw, ch);
        }
    }

    img = match (opts.rotate_deg % 360 + 360) % 360 {
        90 => img.rotate90(),
        180 => img.rotate180(),
        270 => img.rotate270(),
        _ => img,
    };
    if opts.flip_h {
        img = img.fliph();
    }
    if opts.flip_v {
        img = img.flipv();
    }

    // Upscale / resize finale di alta qualità.
    // Se serve AI vera, il chiamante usa crate::upscale prima di questa fase
    // e passa l'immagine già ingrandita; qui facciamo il resize finale esatto.
    //
    // Fast path IMPORTANTE: se le dimensioni coincidono (asset MPC già a 1200
    // DPI, o target fermato ai DPI nativi con upscale off) non si ridimensiona:
    // un Lanczos3 su 3000x4200 px costa ~25 s per carta, a vuoto.
    let (want_w, want_h) = (opts.target_w_px.max(1), opts.target_h_px.max(1));
    let mut img = compose_cell(img, want_w, want_h, opts.bleed_px, opts.card_w_mm, opts.card_h_mm);
    if opts.brightness_pct != 0 {
        apply_brightness(&mut img, opts.brightness_pct);
    }

    std::fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;
    let ext = match opts.out_format.to_lowercase().as_str() {
        "png" => "png",
        "webp" => "webp",
        _ => "jpg",
    };
    let out = cache_dir.join(format!("{cache_key}.{ext}"));
    write_optimized(&img, &out, opts.quality)?;
    Ok(out)
}

/// Soglia "quasi nero" (come proxxied): pulisce il rumore JPEG attorno al bordo.
const BLACK_THRESHOLD: u8 = 30;

/// Vero se il file immagine sembra **completo** (non troncato).
///
/// Un export interrotto (app chiusa a metà) lascia file parziali in cache: se
/// vengono riusati, il PDF incorpora JPEG monchi che i lettori mostrano come
/// carte **nere o bianche**. Controllo economico: magic + marcatore di fine.
pub fn file_looks_complete(path: &Path) -> bool {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(meta) = std::fs::metadata(path) else { return false };
    if meta.len() < 512 {
        return false;
    }
    let Ok(mut f) = std::fs::File::open(path) else { return false };
    let mut head = [0u8; 8];
    if f.read_exact(&mut head).is_err() {
        return false;
    }
    if head.starts_with(&[0xFF, 0xD8]) {
        if f.seek(SeekFrom::End(-2)).is_err() {
            return false;
        }
        let mut tail = [0u8; 2];
        return f.read_exact(&mut tail).is_ok() && tail == [0xFF, 0xD9];
    }
    if head.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        if f.seek(SeekFrom::End(-12)).is_err() {
            return false;
        }
        let mut tail = [0u8; 12];
        return f.read_exact(&mut tail).is_ok() && tail.ends_with(&[0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);
    }
    false
}

/// Scala uniforme per COPRIRE il box e ritaglio centrato (mai stirare l'artwork).
pub fn cover_into(img: DynamicImage, want_w: u32, want_h: u32) -> DynamicImage {
    let (sw, sh) = (img.width().max(1) as f64, img.height().max(1) as f64);
    let (cw, ch) = (want_w.max(1) as f64, want_h.max(1) as f64);
    let scale = f64::max(cw / sw, ch / sh);
    let cover_w = ((sw * scale).round() as u32).max(want_w);
    let cover_h = ((sh * scale).round() as u32).max(want_h);
    let cover = if (cover_w, cover_h) == (img.width(), img.height()) {
        img
    } else {
        resize_fast(img, cover_w, cover_h)
    };
    let x = cover.width().saturating_sub(want_w) / 2;
    let y = cover.height().saturating_sub(want_h) / 2;
    cover.crop_imm(x, y, want_w.min(cover.width()), want_h.min(cover.height()))
}

/// Guadagno luminosità in punti percentuale (-50..+50): le stampe casalinghe
/// escono più scure dello schermo, da qui il tip di alzare di +5..+10.
/// Moltiplicazione semplice con clamp, sul buffer RGB già composto.
fn apply_brightness(img: &mut DynamicImage, pct: i32) {
    let p = pct.clamp(-50, 50);
    if p == 0 {
        return;
    }
    let rgb = img.to_rgb8();
    let (w, h) = (rgb.width(), rgb.height());
    let src = rgb.as_raw();
    let gain = 100 + p;
    let mut out = Vec::with_capacity(src.len());
    for &v in src {
        out.push(((v as i32 * gain / 100).clamp(0, 255)) as u8);
    }
    if let Some(buf) = image::RgbImage::from_raw(w, h, out) {
        *img = DynamicImage::ImageRgb8(buf);
    }
}

/// Pulizie di bordo come proxxied: angoli chiari/trasparenti riempiti col colore
/// medio della zona adiacente, e quasi-neri dell'anello esterno portati a nero pieno.
fn polish_card(card: &mut image::RgbImage) {
    let (w, h) = card.dimensions();
    // anello in proporzione (a 600 DPI proxxied usa 192/800/96: ~9% / 38% / 4.6%)
    let ring_top = (h as f64 * 0.09) as u32;
    let ring_bottom = (h as f64 * 0.38) as u32;
    let ring_side = (w as f64 * 0.046) as u32;
    for y in 0..h {
        for x in 0..w {
            let in_ring = y < ring_top || y + ring_bottom >= h || x < ring_side || x + ring_side >= w;
            if !in_ring {
                continue;
            }
            let p = card.get_pixel_mut(x, y);
            let [r, g, b] = p.0;
            if r < BLACK_THRESHOLD && g < BLACK_THRESHOLD && b < BLACK_THRESHOLD {
                *p = image::Rgb([0, 0, 0]);
            }
        }
    }
    // angoli chiari (bordi bianchi/arrotondati): riempi col colore medio vicino
    let corner = ((w as f64 * 0.05) as u32).max(4).min(w / 3).min(h / 3);
    let inset = corner / 3;
    for (cx, cy) in [(0u32, 0u32), (w - corner, 0), (0, h - corner), (w - corner, h - corner)] {
        // Si guarda SOLO l'anello esterno (2 px) dell'angolo: una carta vera ha
        // sempre bordo o arte lì, un upload con angoli vuoti è bianco/trasparente.
        // Così non si riempie di colore piatto la barra del titolo o l'arte chiara.
        let edge_px = 2;
        let mut white = 0u32;
        let mut total = 0u32;
        for y in cy..cy + corner {
            for x in cx..cx + corner {
                let on_edge = x < cx + edge_px
                    || x + edge_px >= cx + corner
                    || y < cy + edge_px
                    || y + edge_px >= cy + corner;
                if !on_edge {
                    continue;
                }
                total += 1;
                let [r, g, b] = card.get_pixel(x, y).0;
                if r >= 250 && g >= 250 && b >= 250 {
                    white += 1;
                }
            }
        }
        let blank_corner = total > 0 && white as f64 / total as f64 > 0.9;
        if !blank_corner {
            continue;
        }
        // media dell'arte APPENA FUORI dall'angolo (dentro l'angolo il campione
        // sarebbe ancora bianco: proxxied campionava dentro e lasciava il bianco)
        let sample_box = 10u32.min(w / 4).min(h / 4).max(1);
        let sx = if cx == 0 { (corner + inset).min(w.saturating_sub(sample_box)) } else { cx.saturating_sub(inset + sample_box) };
        let sy = if cy == 0 { (corner + inset).min(h.saturating_sub(sample_box)) } else { cy.saturating_sub(inset + sample_box) };
        let (mut ar, mut ag, mut ab, mut n) = (0u32, 0u32, 0u32, 0u32);
        for y in sy..(sy + sample_box).min(h) {
            for x in sx..(sx + sample_box).min(w) {
                let [r, g, b] = card.get_pixel(x, y).0;
                ar += r as u32;
                ag += g as u32;
                ab += b as u32;
                n += 1;
            }
        }
        if n == 0 {
            continue;
        }
        let fill = image::Rgb([(ar / n) as u8, (ag / n) as u8, (ab / n) as u8]);
        for y in cy..cy + corner {
            for x in cx..cx + corner {
                card.put_pixel(x, y, fill);
            }
        }
    }
}

/// Bleed già presente nella sorgente, dedotto dalle proporzioni.
///
/// Gli asset MPC (full art) sono **carta + ~3 mm di bleed per lato**: prendendo
/// per buono che la sorgente sia `carta + b` su ciascun lato, `b` si ricava
/// dall'aspect. Serve perché adattare un'immagine così alla *carta* la
/// rimpicciolisce (era il "l'arte è troppo piccola" sulle full art).
pub fn source_bleed_mm(src: (u32, u32), card_w_mm: f64, card_h_mm: f64) -> Option<f64> {
    let (sw, sh) = (src.0.max(1) as f64, src.1.max(1) as f64);
    let ar = sw / sh;
    let card_ar = card_w_mm / card_h_mm;
    if ar <= card_ar * 1.005 {
        return None; // non più larga della carta: nessun bleed riconoscibile
    }
    // ar = (card_w + 2b) / (card_h + 2b)  ->  b = (ar*card_h - card_w) / (2 * (1 - ar))
    let b = (ar * card_h_mm - card_w_mm) / (2.0 * (1.0 - ar));
    if b.is_finite() && (0.05..=8.0).contains(&b) {
        Some(b)
    } else {
        None
    }
}

/// Compone la cella (carta + bleed) **come fa proxxied.com**.
///
/// `card_w_mm`/`card_h_mm` sono il formato carta NOMINALE (mai hardcoded:
/// con formati diversi da 63×88 la deduzione del bleed sorgente e la banda
/// in mm sarebbero sfasate di qualche decimo di mm, fuori registro guide).
///
/// - Sorgente **con bleed** (MPC full art: proporzioni più larghe della carta):
///   si ritaglia il suo bleed fino al nostro (carta 63×88 + 1 mm) e si scala in
///   modo uniforme → la carta cade esattamente a misura e la banda è **l'arte
///   vera** dell'asset: niente specchi, niente nero.
/// - Sorgente **della sola carta** (Scryfall, o comunque senza bleed): carta a
///   misura + banda costruita attorno: **specchiata** (arte che continua) oppure
///   **a strisce stirate** se il bordo della carta è quasi tutto nero, come
///   l'euristica di proxxied (per le carte dal bordo nero è una banda nera
///   pulita; per le full art questo ramo non si applica mai).
/// - Pulizie di bordo: quasi-neri portati a nero pieno, angoli vuoti riempiti.
pub fn compose_cell(
    img: DynamicImage,
    card_w: u32,
    card_h: u32,
    bleed_px: u32,
    card_w_mm: f64,
    card_h_mm: f64,
) -> DynamicImage {
    let card_w = card_w.max(1);
    let card_h = card_h.max(1);
    let (card_w_mm, card_h_mm) = (card_w_mm.max(1.0), card_h_mm.max(1.0));
    // alpha appiattito su nero (bordo carta): un upload con trasparenza diventa
    // carta nera, non spicchi bianchi agli angoli (to_rgb8 da solo scarterebbe
    // il canale alpha)
    let flat = DynamicImage::ImageRgb8(flatten_alpha(&img));
    let src_dims = (flat.width(), flat.height());
    if let Some(b_src) = source_bleed_mm(src_dims, card_w_mm, card_h_mm) {
        // px per mm stimati sulla sorgente (carta + bleed suo)
        let px_per_mm = src_dims.0 as f64 / (card_w_mm + 2.0 * b_src);
        // il nostro bleed in mm, dedotto dai pixel richiesti
        let b_our_mm = card_w_mm * bleed_px as f64 / card_w as f64;
        let keep_w = (((card_w_mm + 2.0 * b_our_mm) * px_per_mm).round() as u32).max(1).min(src_dims.0);
        let keep_h = (((card_h_mm + 2.0 * b_our_mm) * px_per_mm).round() as u32).max(1).min(src_dims.1);
        let x = src_dims.0.saturating_sub(keep_w) / 2;
        let y = src_dims.1.saturating_sub(keep_h) / 2;
        let cropped = flat.crop_imm(x, y, keep_w, keep_h);
        let cell_w = card_w + bleed_px * 2;
        let cell_h = card_h + bleed_px * 2;
        return DynamicImage::ImageRgb8(cover_into(cropped, cell_w, cell_h).to_rgb8());
    }
    let mut card = cover_into(flat, card_w, card_h).to_rgb8();
    polish_card(&mut card);
    if bleed_px == 0 {
        return DynamicImage::ImageRgb8(card);
    }
    let (cw, chh) = (card_w as usize, card_h as usize);
    let b = bleed_px as usize;
    let (out_w, out_h) = (cw + b * 2, chh + b * 2);
    let mut out = vec![0u8; out_w * out_h * 3];
    let src = card.as_raw();
    let at = |x: usize, y: usize| -> [u8; 3] {
        let i = (y * cw + x) * 3;
        [src[i], src[i + 1], src[i + 2]]
    };
    let put = |out: &mut Vec<u8>, x: usize, y: usize, px: [u8; 3]| {
        let i = (y * out_w + x) * 3;
        out[i] = px[0];
        out[i + 1] = px[1];
        out[i + 2] = px[2];
    };
    // 1. carta al centro
    for y in 0..chh {
        for x in 0..cw {
            put(&mut out, x + b, y + b, at(x, y));
        }
    }
    // 2. banda: specchio dell'arte, oppure strisce stirate se il bordo della
    //    carta e' quasi tutto nero (euristica di proxxied: banda nera pulita,
    //    com'e' nelle carte dal bordo nero). Le full art non passano di qui.
    let black_left = (0..chh)
        .filter(|y| at(0, *y).iter().all(|c| *c < BLACK_THRESHOLD))
        .count() as f64
        / chh as f64;
    let mostly_black = black_left > 0.7;
    let slice = ((cw / 100).max(1)).min(b.max(1));
    let sample = |x: usize, y: usize| -> [u8; 3] {
        if mostly_black {
            let sx = if x < b { x * slice / b } else { cw - 1 - (out_w - 1 - x) * slice / b };
            let sy = if y < b { y * slice / b } else { chh - 1 - (out_h - 1 - y) * slice / b };
            at(sx.min(cw - 1), sy.min(chh - 1))
        } else {
            // specchio attorno al bordo della carta (angoli specchiati su due assi)
            let mx = if x < b { b - 1 - x } else { 2 * cw + b - 1 - x };
            let my = if y < b { b - 1 - y } else { 2 * chh + b - 1 - y };
            at(mx.min(cw - 1), my.min(chh - 1))
        }
    };
    for y in 0..out_h {
        for x in 0..out_w {
            let in_card = x >= b && x < b + cw && y >= b && y < b + chh;
            if in_card {
                continue;
            }
            put(&mut out, x, y, sample(x, y));
        }
    }
    let buf = image::RgbImage::from_raw(out_w as u32, out_h as u32, out)
        .expect("buffer cella di dimensione coerente");
    DynamicImage::ImageRgb8(buf)
}

pub(crate) fn resize_fast(img: DynamicImage, w: u32, h: u32) -> DynamicImage {
    use fast_image_resize as fir;
    let opts = fir::ResizeOptions::new().resize_alg(fir::ResizeAlg::Convolution(fir::FilterType::Lanczos3));
    macro_rules! fast {
        ($buf:expr, $ty:expr, $variant:path) => {{
            match fir::images::ImageRef::new($buf.width(), $buf.height(), $buf.as_raw(), $ty) {
                Ok(src) => {
                    let mut dst = fir::images::Image::new(w, h, $ty);
                    if fir::Resizer::new().resize(&src, &mut dst, &opts).is_ok() {
                        image::ImageBuffer::from_raw(w, h, dst.into_vec()).map($variant)
                    } else {
                        None
                    }
                }
                Err(_) => None,
            }
        }};
    }
    let fast_result = match &img {
        DynamicImage::ImageRgb8(buf) => fast!(buf, fir::PixelType::U8x3, DynamicImage::ImageRgb8),
        DynamicImage::ImageRgba8(buf) => fast!(buf, fir::PixelType::U8x4, DynamicImage::ImageRgba8),
        DynamicImage::ImageLuma8(buf) => fast!(buf, fir::PixelType::U8, DynamicImage::ImageLuma8),
        other => {
            // formati non gestiti (16 bit, float, palette): conversione in 8 bit
            let rgb = other.to_rgb8();
            fast!(rgb, fir::PixelType::U8x3, DynamicImage::ImageRgb8)
        }
    };
    fast_result.unwrap_or_else(|| img.resize_exact(w, h, FilterType::Lanczos3))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, Rgba};

    #[test]
    fn flatten_alpha_appiattisce_su_nero() {
        let mut img = image::RgbaImage::new(2, 1);
        img.put_pixel(0, 0, Rgba([255, 0, 0, 128])); // rosso al 50% -> rosso scuro su nero
        img.put_pixel(1, 0, Rgba([0, 0, 255, 0])); // trasparente -> nero pieno
        let out = flatten_alpha(&DynamicImage::ImageRgba8(img));
        assert_eq!(out.dimensions(), (2, 1));
        let a = out.get_pixel(0, 0).0;
        assert!((120..=135).contains(&a[0]) && a[1] == 0 && a[2] == 0, "{a:?}");
        assert_eq!(out.get_pixel(1, 0).0, [0, 0, 0]);
    }

    #[test]
    fn compose_cell_angoli_trasparenti_restano_neri() {
        // render con angoli arrotondati trasparenti (caso dei PNG MPC): dopo
        // l'appiattimento su nero non devono uscire spicchi bianchi né sulla
        // carta né sulla banda di bleed specchiata.
        let (w, h) = (200u32, 280u32);
        let mut img = image::RgbaImage::from_pixel(w, h, Rgba([120, 40, 40, 255]));
        let r = 30u32;
        for (cx, cy) in [(0u32, 0u32), (w - 1, 0), (0, h - 1), (w - 1, h - 1)] {
            for y in 0..h {
                for x in 0..w {
                    let dx = x.abs_diff(cx) as f64;
                    let dy = y.abs_diff(cy) as f64;
                    if dx * dx + dy * dy < (r * r) as f64 {
                        img.put_pixel(x, y, Rgba([0, 0, 0, 0]));
                    }
                }
            }
        }
        let out = compose_cell(DynamicImage::ImageRgba8(img), w, h, 10, 63.0, 88.0).to_rgb8();
        assert_eq!(out.dimensions(), (w + 20, h + 20));
        // angolo carta (10,10) e angolo bleed (0,0): neri, mai bianchi
        for (x, y) in [(10u32, 10u32), (0, 0), (w + 19, 0), (0, h + 19), (w + 19, h + 19)] {
            let [pr, pg, pb] = out.get_pixel(x, y).0;
            assert!(pr < 40 && pg < 40 && pb < 40, "({x},{y}): {:?}", out.get_pixel(x, y).0);
        }
        // centro intatto: l'arte non è stata toccata
        assert_eq!(out.get_pixel(w / 2 + 10, h / 2 + 10).0, [120, 40, 40]);
    }

    #[test]
    fn flatten_alpha_su_rgb_non_tocca_i_pixel() {
        let img = image::RgbImage::from_pixel(3, 2, Rgb([10, 20, 30]));
        let out = flatten_alpha(&DynamicImage::ImageRgb8(img));
        assert_eq!(out.dimensions(), (3, 2));
        assert_eq!(out.get_pixel(1, 1).0, [10, 20, 30]);
    }

    /// La banda di bleed deve essere esattamente bleed_mm della cella: e' il
    /// riferimento su cui il PDF disegna la guida di taglio (cella - bleed).
    #[test]
    fn compose_cell_allinea_carta_e_guida() {
        // caso 1200 DPI reali: cella 65x90 mm, bleed 1 mm, carta 63x88 mm
        let density: f64 = 1200.0 / 25.4; // px per mm
        let cell = ((65.0 * density).round() as u32, (90.0 * density).round() as u32);
        let bleed = (1.0 * density).round() as u32;
        let card = (cell.0 - 2 * bleed, cell.1 - 2 * bleed);
        // carta con bordo ben visibile su tutti i lati
        let mut src = image::RgbImage::new(card.0, card.1);
        for (x, y, p) in src.enumerate_pixels_mut() {
            let edge = x < 2 || y < 2 || x + 2 >= card.0 || y + 2 >= card.1;
            *p = Rgb(if edge { [10, 10, 10] } else { [220, 220, 220] });
        }
        let out = compose_cell(DynamicImage::ImageRgb8(src), card.0, card.1, bleed, 63.0, 88.0);
        assert_eq!(out.dimensions(), cell, "la cella composta e' carta + 2*bleed");
        // la banda (prima colonna della cella) deve appartenere all'immagine, non a un vuoto
        let buf = out.to_rgb8();
        let band_mm = bleed as f64 / cell.0 as f64 * 65.0;
        assert!((band_mm - 1.0).abs() < 0.02, "banda {band_mm:.3} mm (attesa 1.000)");
        // e la carta che resta e' 63 mm (guida di taglio a 1 mm dal bordo cella)
        let card_mm = (cell.0 - 2 * bleed) as f64 / cell.0 as f64 * 65.0;
        assert!((card_mm - 63.0).abs() < 0.05, "carta {card_mm:.3} mm (attesa 63.0)");
        // il pixel all'inizio della carta e' il bordo scuro (bordo nero pulito)
        assert_eq!(buf.get_pixel(bleed, bleed).0, [0, 0, 0]);
    }

    #[test]
    fn compose_cell_specchia_il_bleed() {
        // carta 4x4 con colonne distinte: la banda sinistra deve SPECCHIARE la
        // striscia adiacente (non replicare un pixel solo: era la striscia piatta)
        let mut card = image::RgbImage::new(4, 4);
        for (x, _y, p) in card.enumerate_pixels_mut() {
            *p = Rgb([(x as u8 + 1) * 40, 100, 100]);
        }
        let out = compose_cell(DynamicImage::ImageRgb8(card), 4, 4, 2, 63.0, 88.0);
        assert_eq!(out.dimensions(), (8, 8));
        let buf = out.to_rgb8();
        // bordo destro della banda sinistra = prima colonna della carta (40)
        assert_eq!(buf.get_pixel(1, 4).0[0], 40);
        // a sinistra del bordo: specchio (colonna 1 -> 80)
        assert_eq!(buf.get_pixel(0, 4).0[0], 80);
        // banda destra: specchio della colonna 3 (160) subito dopo il bordo
        assert_eq!(buf.get_pixel(6, 4).0[0], 160);
        assert_eq!(buf.get_pixel(7, 4).0[0], 120);
        // centro intatto
        assert_eq!(buf.get_pixel(3, 3).0[0], 80);
    }

    #[test]
    fn file_troncato_non_riusabile() {
        let dir = std::env::temp_dir().join(format!("proxxied-trunc-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // JPEG completo (SOI ... EOI) di dimensione sufficiente
        let mut jpg = vec![0xFF, 0xD8, 0xFF, 0xDB];
        jpg.extend(std::iter::repeat(0u8).take(600));
        jpg.extend_from_slice(&[0xFF, 0xD9]);
        let good = dir.join("good.jpg");
        std::fs::write(&good, &jpg).unwrap();
        assert!(file_looks_complete(&good), "jpeg completo accettato");
        // stesso file senza EOI = troncato
        let bad = dir.join("bad.jpg");
        std::fs::write(&bad, &jpg[..jpg.len() - 2]).unwrap();
        assert!(!file_looks_complete(&bad), "jpeg troncato rifiutato");
        // file troppo piccolo
        let tiny = dir.join("tiny.jpg");
        std::fs::write(&tiny, [0xFF, 0xD8, 0xFF, 0xD9]).unwrap();
        assert!(!file_looks_complete(&tiny));
        // PNG senza IEND finale
        let png = dir.join("bad.png");
        let mut data = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        data.extend(std::iter::repeat(0u8).take(600));
        std::fs::write(&png, &data).unwrap();
        assert!(!file_looks_complete(&png));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn source_bleed_dedotto_dalle_proporzioni() {
        // MPC full art: carta 63x88 + 3 mm per lato -> (69/94) = 0.7340
        let b = source_bleed_mm((3264, 4440), 63.0, 88.0).unwrap();
        assert!((b - 3.175).abs() < 0.1, "bleed dedotto {b} (MPC usa 1/8 in = 3.175 mm)");
        // 2187x2975 (classe MPC 800) -> stesso bleed
        let b2 = source_bleed_mm((2187, 2975), 63.0, 88.0).unwrap();
        assert!((b2 - 3.175).abs() < 0.4, "bleed dedotto {b2}");
        // Scryfall (sola carta): nessun bleed da ritagliare
        assert!(source_bleed_mm((672, 936), 63.0, 88.0).is_none());
    }

    #[test]
    fn compose_cell_full_art_usa_il_suo_bleed() {
        // sorgente = carta + bleed marcato (colore 90), carta = 200
        // dopo la composizione la carta deve essere a misura (200) e la banda
        // deve contenere il bleed VERO (90), non uno specchio/n
        let (sw, sh) = (690u32, 940u32); // 69x94 mm a 10 px/mm
        let mut src = image::RgbImage::new(sw, sh);
        for (x, y, p) in src.enumerate_pixels_mut() {
            let in_card = x >= 30 && x < 660 && y >= 30 && y < 910;
            *p = Rgb(if in_card { [200, 200, 200] } else { [90, 90, 90] });
        }
        let out = compose_cell(DynamicImage::ImageRgb8(src), 630, 880, 10, 63.0, 88.0);
        let buf = out.to_rgb8();
        assert_eq!(out.dimensions(), (650, 900), "cella 65x90 mm a 10 px/mm");
        // angolo = bleed originale (90), non specchio della carta (200)
        assert_eq!(buf.get_pixel(2, 2).0, [90, 90, 90], "la banda e' l'arte/bleed vero");
        // centro = carta
        assert_eq!(buf.get_pixel(325, 450).0, [200, 200, 200]);
        // e la carta comincia esattamente dove ci aspettiamo: 10 px = 1 mm
        assert_eq!(buf.get_pixel(9, 450).0, [90, 90, 90], "ultimo pixel di banda");
        assert_eq!(buf.get_pixel(10, 450).0, [200, 200, 200], "primo pixel di carta");
        assert_eq!(buf.get_pixel(639, 450).0, [200, 200, 200], "ultimo pixel di carta (63 mm esatti)");
        assert_eq!(buf.get_pixel(640, 450).0, [90, 90, 90], "primo pixel di banda a destra");
    }

    /// Regressione: il formato carta non è più hardcoded a 63×88. Con
    /// magic_true (63.5×88.9) e bleed sorgente 3.175mm la deduzione deve dare
    /// ~3.175 (prima dava ~2.87: carta spostata e guide fuori registro).
    #[test]
    fn compose_cell_rispetta_formato_custom() {
        let ar: f64 = (63.5 + 2.0 * 3.175) / (88.9 + 2.0 * 3.175);
        let (sw, sh) = (1397u32, (1397.0 / ar).round() as u32);
        let b = source_bleed_mm((sw, sh), 63.5, 88.9).unwrap();
        assert!((b - 3.175).abs() < 0.1, "bleed dedotto {b} (atteso 3.175)");
        // carta centrata a misura con banda vera attorno
        let mut src = image::RgbImage::new(sw, sh);
        let px_mm = sw as f64 / (63.5 + 2.0 * 3.175);
        let bx = (3.175 * px_mm).round() as u32;
        let cw = (63.5 * px_mm).round() as u32;
        let chh = (88.9 * px_mm).round() as u32;
        for (x, y, p) in src.enumerate_pixels_mut() {
            let in_card = x >= bx && x < bx + cw && y >= bx && y < bx + chh;
            *p = Rgb(if in_card { [200, 200, 200] } else { [90, 90, 90] });
        }
        let our_bleed = 10u32;
        let out = compose_cell(DynamicImage::ImageRgb8(src), cw, chh, our_bleed, 63.5, 88.9);
        let buf = out.to_rgb8();
        assert_eq!(out.dimensions(), (cw + 2 * our_bleed, chh + 2 * our_bleed));
        assert_eq!(buf.get_pixel(1, 1).0, [90, 90, 90], "banda = bleed vero");
        // transizione banda→carta entro ±1px dal bleed nominale (arrotondamenti)
        assert_eq!(buf.get_pixel(our_bleed - 1, out.dimensions().1 / 2).0, [90, 90, 90]);
        assert_eq!(buf.get_pixel(our_bleed + 1, out.dimensions().1 / 2).0, [200, 200, 200], "carta a misura");
    }

    #[test]
    fn luminosita_guadagno_e_clamp() {
        let mut img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(2, 1, Rgb([100, 100, 100])));
        apply_brightness(&mut img, 10);
        assert_eq!(img.to_rgb8().get_pixel(0, 0).0, [110, 110, 110]);
        apply_brightness(&mut img, -50);
        assert_eq!(img.to_rgb8().get_pixel(0, 0).0, [55, 55, 55]);
        let mut white = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(1, 1, Rgb([250, 250, 250])));
        apply_brightness(&mut white, 50);
        assert_eq!(white.to_rgb8().get_pixel(0, 0).0, [255, 255, 255], "clamp a 255");
        let mut same = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(1, 1, Rgb([7, 7, 7])));
        apply_brightness(&mut same, 0);
        assert_eq!(same.to_rgb8().get_pixel(0, 0).0, [7, 7, 7]);
    }

    #[test]
    fn compose_cell_full_art_non_mette_nero() {
        // FULL ART con arte scura (grigio 40) sui bordi: la banda deve essere
        // l'ARTE specchiata, mai pixel neri inventati
        let mut card = image::RgbImage::new(6, 6);
        for (x, _y, p) in card.enumerate_pixels_mut() {
            *p = Rgb([if x < 2 || x >= 4 { 40 } else { 220 }, 40, 40]);
        }
        let out = compose_cell(DynamicImage::ImageRgb8(card), 6, 6, 2, 63.0, 88.0);
        let buf = out.to_rgb8();
        assert_eq!(out.dimensions(), (10, 10));
        for x in 0..10 {
            let v = buf.get_pixel(x, 5).0;
            assert!(v[0] >= 38, "pixel {x} troppo scuro: {v:?} (atteso arte, non nero)");
        }
        // il bordo nero VERO resta nero (lo specchio di nero e' nero)
        let mut black_border = image::RgbImage::new(6, 6);
        for (x, _y, p) in black_border.enumerate_pixels_mut() {
            *p = Rgb(if x == 0 { [0, 0, 0] } else { [200, 200, 200] });
        }
        let out2 = compose_cell(DynamicImage::ImageRgb8(black_border), 6, 6, 2, 63.0, 88.0);
        let buf2 = out2.to_rgb8();
        assert_eq!(buf2.get_pixel(1, 5).0, [0, 0, 0], "bordo nero specchiato resta nero");
    }

    #[test]
    fn corner_fill_only_on_blank_corners() {
        // carta con arte chiara (barra titolo bianca) ma bordo scuro: NON va riempita
        let mut card = image::RgbImage::new(40, 56);
        for (x, y, p) in card.enumerate_pixels_mut() {
            let border = x < 2 || y < 2 || x + 2 >= 40 || y + 2 >= 56;
            *p = Rgb(if border { [10, 10, 10] } else if y < 12 { [255, 255, 255] } else { [120, 40, 40] });
        }
        let out = compose_cell(DynamicImage::ImageRgb8(card), 40, 56, 0, 63.0, 88.0);
        let buf = out.to_rgb8();
        // la barra titolo resta bianca: nessun riempimento piatto
        assert_eq!(buf.get_pixel(6, 6).0, [255, 255, 255], "barra titolo intatta");
        assert_eq!(buf.get_pixel(1, 1).0, [0, 0, 0], "bordo rimane scuro");

        // angolo davvero vuoto (upload trasparente/bianco): viene riempito col colore vicino
        let mut blank = image::RgbImage::new(40, 56);
        for (x, y, p) in blank.enumerate_pixels_mut() {
            let corner = x < 8 && y < 8;
            *p = Rgb(if corner { [255, 255, 255] } else { [120, 40, 40] });
        }
        let filled = compose_cell(DynamicImage::ImageRgb8(blank), 40, 56, 0, 63.0, 88.0).to_rgb8();
        // il quadrato d'angolo (5% del lato) viene riempito con l'arte vicina
        let v = filled.get_pixel(2, 2).0;
        assert!(v[0] < 200, "angolo vuoto riempito col colore dell'arte: {v:?}");
    }

    #[test]
    fn cover_into_ritaglia_senza_stirare() {
        // sorgente piu' larga della carta: si ritaglia in larghezza, non si stira
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(200, 100, Rgb([7, 7, 7])));
        let out = cover_into(img, 100, 100);
        assert_eq!(out.dimensions(), (100, 100));
    }

    #[test]
    fn resize_fast_ridimensiona_e_conserva_i_colori() {
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(8, 8, Rgb([200, 10, 10])));
        let out = resize_fast(img, 4, 4);
        assert_eq!(out.dimensions(), (4, 4));
        let px = out.to_rgb8().get_pixel(1, 1).0;
        assert!(px[0] > 180 && px[1] < 40 && px[2] < 40, "{px:?}");
    }

    #[test]
    fn resize_fast_conserva_alpha_e_gestisce_formati_strani() {
        let rgba = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(6, 6, Rgba([0, 128, 0, 200])));
        let out = resize_fast(rgba, 3, 3);
        assert_eq!(out.dimensions(), (3, 3));
        assert_eq!(out.to_rgba8().get_pixel(0, 0).0[3], 200);
        // 16 bit: convertito in 8 bit senza panic
        let gray16 = DynamicImage::ImageLuma16(image::ImageBuffer::from_pixel(5, 5, image::Luma([0x4000u16])));
        assert_eq!(resize_fast(gray16, 2, 2).dimensions(), (2, 2));
    }
}

pub fn write_optimized(img: &DynamicImage, out: &Path, quality: u8) -> Result<(), String> {
    let q = quality.clamp(1, 100);
    let ext = out.extension().and_then(|s| s.to_str()).unwrap_or("jpg").to_lowercase();
    match ext.as_str() {
        "png" => {
            img.save_with_format(out, ImageFormat::Png).map_err(|e| e.to_string())?;
        }
        "webp" => {
            // image 0.25: WebP via save_with_format (lossy di default accettabile per preview/print bilanciato)
            img.save_with_format(out, ImageFormat::WebP).map_err(|e| e.to_string())?;
        }
        _ => {
            use image::codecs::jpeg::JpegEncoder;
            // JPEG non ha canale alpha: i PNG con trasparenza (angoli arrotondati
            // dei render MPC) fallirebbero l'encode → fondo nero (bordo carta).
            // Senza alpha si evita del tutto il passaggio per pixel (12M px per carta).
            let rgb = match img {
                DynamicImage::ImageRgb8(buf) => buf.clone(),
                other => flatten_alpha(other),
            };
            let f = std::fs::File::create(out).map_err(|e| e.to_string())?;
            let mut enc = JpegEncoder::new_with_quality(f, q);
            enc.encode_image(&image::DynamicImage::ImageRgb8(rgb)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Appiattisce l'alpha su fondo NERO (bordo carta).
/// I PNG con trasparenza sono quasi sempre angoli arrotondati dei render:
/// su bianco uscivano spicchi chiari tra angolo carta e bleed (bug visibile
/// nel PDF), su nero leggono come bordo carta. Esperimento reversibile: per
/// tornare al bianco basta cambiare il pixel iniziale e la formula sotto.
pub fn flatten_alpha(img: &DynamicImage) -> image::RgbImage {
    let (w, h) = img.dimensions();
    if let DynamicImage::ImageRgb8(buf) = img {
        return buf.clone();
    }
    let rgba = img.to_rgba8();
    let src = rgba.as_raw();
    let mut out = image::RgbImage::from_pixel(w, h, image::Rgb([0, 0, 0]));
    let dst = out.as_mut();
    for (i, px) in src.chunks_exact(4).enumerate() {
        let a = px[3] as u32;
        let o = i * 3;
        // out = src*a/255 su fondo nero
        dst[o] = ((px[0] as u32 * a) / 255) as u8;
        dst[o + 1] = ((px[1] as u32 * a) / 255) as u8;
        dst[o + 2] = ((px[2] as u32 * a) / 255) as u8;
    }
    out
}

