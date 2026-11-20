//! Verifica dimensionale di un PDF generato dal nostro engine + simulazione errore stampante.
//!
//! Legge il PDF che scriviamo noi (formato deterministico): per ogni piazzamento
//! `q W 0 0 H X Y cm /ImN Do` calcola le dimensioni fisiche e le confronta con il
//! nominale. Poi simula l'errore tipico di stampa (scala ±errore%, offset) per dire
//! se, una volta stampato, la carta resta dentro tolleranza.

#[derive(Debug, Clone, serde::Serialize)]
pub struct PrintCheck {
    pub page: usize,
    pub name: String,
    pub placed_w_mm: f64,
    pub placed_h_mm: f64,
    pub img_w_px: u32,
    pub img_h_px: u32,
    pub scale_pct_w: f64,
    pub scale_pct_h: f64,
    pub eff_dpi: f64,
    /// range simulato di misura post-stampa [min,max] in mm (larghezza)
    pub sim_w_mm: [f64; 2],
    /// range simulato di misura post-stampa [min,max] in mm (altezza)
    pub sim_h_mm: [f64; 2],
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct VerifyReport {
    pub pages: usize,
    pub images: Vec<PrintCheck>,
    pub nominal_w_mm: f64,
    pub nominal_h_mm: f64,
    pub tol_pct: f64,
    pub pass: bool,
    pub worst_dev_pct: f64,
    pub summary: String,
}

const PT_PER_MM: f64 = 72.0 / 25.4;

/// Estrae i float da una riga tipo `q 178.583 0 0 249.449 28.346 568.504 cm /Im0 Do Q`.
/// Il nostro writer emette `... Do Q` sulla stessa riga: si tollera il `Q` finale.
/// Match rigido sull'intera riga: i byte binari dei JPEG incorporati non devono
/// mai diventare piazzamenti fantasma.
fn parse_placement(line: &str) -> Option<(f64, f64, String)> {
    let line = line.trim();
    // righe contenuto reali: corte, iniziano con `q`, finiscono con `Do`/`Do Q`.
    if line.len() > 160 || !line.starts_with('q') {
        return None;
    }
    let mut core = line.trim_start_matches('q').trim();
    let trailing_q = core.ends_with(" Q");
    if trailing_q {
        core = core[..core.len() - 2].trim_end();
    }
    if !core.ends_with(" Do") {
        return None;
    }
    core = core[..core.len() - 3].trim_end();
    let (matrix, name) = core.split_once(" cm /")?;
    // nome atteso: ImN (niente spazi, niente operatori extra)
    if !name.starts_with("Im") || !name[2..].chars().all(|c| c.is_ascii_digit()) || name.len() < 3 {
        return None;
    }
    let nums: Vec<f64> = matrix
        .split_whitespace()
        .filter_map(|t| t.parse::<f64>().ok())
        .collect();
    // matrice [w 0 0 h x y]: w,h = dimensioni in pt; zeri fuori diagonale
    if nums.len() != 6 {
        return None;
    }
    let w_pt = nums[0];
    let h_pt = nums[3];
    if w_pt <= 0.0 || h_pt <= 0.0 {
        return None;
    }
    if nums[1] != 0.0 || nums[2] != 0.0 {
        return None;
    }
    Some((w_pt / PT_PER_MM, h_pt / PT_PER_MM, name.to_string()))
}

/// Estrae (nome, w_px, h_px) dagli XObject immagine `/ImN ... /Width W /Height H`.
/// Il nostro writer emette gli XObject in ordine Im0..ImN: li indicizziamo così.
fn parse_images(text: &str) -> Vec<(u32, u32)> {
    let mut out: Vec<(u32, u32)> = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("/Subtype /Image") {
        let seg = &rest[i..];
        let end = seg.find("stream").unwrap_or(seg.len().min(600));
        let head = &seg[..end];
        let w = head
            .find("/Width")
            .and_then(|p| head[p + 6..].split_whitespace().next())
            .and_then(|t| t.parse::<u32>().ok());
        let h = head
            .find("/Height")
            .and_then(|p| head[p + 7..].split_whitespace().next())
            .and_then(|t| t.parse::<u32>().ok());
        if let (Some(w), Some(h)) = (w, h) {
            out.push((w, h));
        }
        rest = &seg[end.min(seg.len())..];
        if rest.is_empty() {
            break;
        }
    }
    out
}

fn im_index(name: &str) -> Option<usize> {
    name.strip_prefix("Im")?.parse::<usize>().ok()
}

/// Verifica un PDF (byte): dimensioni reali vs nominali + simulazione stampante.
///
/// - `tol_pct`: tolleranza di accettazione sullo scalo (es. 1.0 = ±1%).
/// - `printer_err_pct`: errore di scala tipico della stampante simulato (es. 0.5).
///   Le stampanti reali restringono/allargano di qualche decimo di punto % (rulli,
///   fusore) più l'eventuale "adatta all'area stampabile": il report mostra il range
///   di misura atteso in mm.
pub fn verify_pdf(
    bytes: &[u8],
    exp_w_mm: f64,
    exp_h_mm: f64,
    tol_pct: f64,
    printer_err_pct: f64,
) -> Result<VerifyReport, String> {
    if exp_w_mm <= 0.0 || exp_h_mm <= 0.0 {
        return Err("dimensioni nominali non valide".into());
    }
    let text = String::from_utf8_lossy(bytes);
    if !text.starts_with("%PDF-") {
        return Err("non è un PDF".into());
    }
    let images = parse_images(&text);
    if images.is_empty() {
        return Err("nessuna immagine trovata nel PDF".into());
    }
    // pagine: conta gli oggetti /Type /Page (non /Pages)
    let pages = text.matches("/Type /Page ").count() + text.matches("/Type /Page\n").count();
    let mut checks = Vec::new();
    let mut worst = 0.0f64;
    // scansiona gli stream dei contenuti riga per riga tenendo traccia della pagina:
    // euristica pragmatica sul nostro formato: i placement appaiono in ordine di pagina.
    let mut placements: Vec<(f64, f64, String)> = Vec::new();
    for line in text.lines() {
        if line.contains(" cm /Im") && line.contains(" Do") {
            if let Some(p) = parse_placement(line) {
                placements.push(p);
            }
        }
    }
    if placements.is_empty() {
        return Err("nessun piazzamento trovato nel PDF".into());
    }
    let per_page_hint = placements.len().max(1);
    for (i, (w_mm, h_mm, name)) in placements.iter().enumerate() {
        let (iw, ih) = im_index(name)
            .and_then(|n| images.get(n).copied())
            .unwrap_or((0, 0));
        let sw = w_mm / exp_w_mm * 100.0;
        let sh = h_mm / exp_h_mm * 100.0;
        let dev = (sw - 100.0).abs().max((sh - 100.0).abs());
        worst = worst.max(dev);
        let eff_dpi = if *w_mm > 0.0 && *h_mm > 0.0 {
            (iw as f64 / (*w_mm / 25.4)).min(ih as f64 / (*h_mm / 25.4))
        } else {
            0.0
        };
        let e = printer_err_pct / 100.0;
        checks.push(PrintCheck {
            page: i * pages.max(1) / per_page_hint,
            name: name.clone(),
            placed_w_mm: (*w_mm * 100.0).round() / 100.0,
            placed_h_mm: (*h_mm * 100.0).round() / 100.0,
            img_w_px: iw,
            img_h_px: ih,
            scale_pct_w: (sw * 10.0).round() / 10.0,
            scale_pct_h: (sh * 10.0).round() / 10.0,
            eff_dpi: (eff_dpi * 10.0).round() / 10.0,
            sim_w_mm: [
                ((*w_mm * (1.0 - e)) * 100.0).round() / 100.0,
                ((*w_mm * (1.0 + e)) * 100.0).round() / 100.0,
            ],
            sim_h_mm: [
                ((*h_mm * (1.0 - e)) * 100.0).round() / 100.0,
                ((*h_mm * (1.0 + e)) * 100.0).round() / 100.0,
            ],
        });
    }
    let pass = worst <= tol_pct;
    let summary = format!(
        "{} piazzamenti su {} pagine: nominale {exp_w_mm}×{exp_h_mm}mm, scalo peggiore {worst:.1}% (tolleranza ±{tol_pct}%), sim. stampa ±{printer_err_pct}% → {}",
        checks.len(),
        pages.max(1),
        if pass { "OK al 100%" } else { "FUORI TOLLERANZA" }
    );
    Ok(VerifyReport {
        pages: pages.max(1),
        images: checks,
        nominal_w_mm: exp_w_mm,
        nominal_h_mm: exp_h_mm,
        tol_pct,
        pass,
        worst_dev_pct: (worst * 10.0).round() / 10.0,
        summary,
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_placement, verify_pdf};
    use crate::pdf::{build_pdf, GuideOptions, PdfPage, PlacedImage};
    use std::rc::Rc;

    #[test]
    fn placement_rifiuta_spazzatura_binaria() {
        // byte JPEG casuali con sottostringhe simili non diventano piazzamenti
        assert!(parse_placement("q 178.583 0 0 249.449 cm /Im0 Do Q").is_none(), "matrice corta");
        assert!(parse_placement("178.583 0 0 249.449 28.346 568.504 cm /Im0 Do").is_none(), "senza q iniziale");
        assert!(parse_placement("q 178.583 0 0 249.449 28.346 568.504 cm /Im0").is_none(), "senza Do");
        assert!(parse_placement("q 178.583 0 0 249.449 28.346 568.504 cm /Foo Do").is_none(), "nome non-Im");
        assert!(parse_placement("q 10 1 0 10 5 5 cm /Im0 Do").is_none(), "matrice con shear");
        let lunga = format!("q {} cm /Im0 Do Q", "9 ".repeat(100));
        assert!(parse_placement(&lunga).is_none(), "riga troppo lunga");
    }

    #[test]
    fn placement_tollera_do_q_finale() {
        // regressione: il writer emette `Do Q` sulla stessa riga, il parser accettava solo `Do`.
        let p = parse_placement("q 178.583 0 0 249.449 28.346 568.504 cm /Im0 Do Q").unwrap();
        assert_eq!(p.2, "Im0");
        assert!((p.0 - 63.0).abs() < 0.01);
        let p2 = parse_placement("q 178.583 0 0 249.449 28.346 568.504 cm /Im1 Do").unwrap();
        assert_eq!(p2.2, "Im1");
    }

    fn sample_pdf() -> Vec<u8> {
        let jpeg = vec![0xFF, 0xD8, 0xFF, 0xD9];
        let pages = vec![
            PdfPage {
                w_mm: 210.0,
                h_mm: 297.0,
                images: vec![
                    PlacedImage {
                        hash: "a".into(),
                        x_mm: 5.0,
                        y_mm_top: 5.0,
                        w_mm: 63.0,
                        h_mm: 88.0,
                        jpeg_bytes: Rc::new(jpeg.clone()),
                        img_w_px: 744,
                        img_h_px: 1039,
                    },
                    PlacedImage {
                        hash: "b".into(),
                        x_mm: 70.0,
                        y_mm_top: 5.0,
                        w_mm: 63.0,
                        h_mm: 88.0,
                        jpeg_bytes: Rc::new(jpeg),
                        img_w_px: 744,
                        img_h_px: 1039,
                    },
                ],
                guides: GuideOptions::default(),
                guide_rects: vec![],
            },
            PdfPage {
                w_mm: 210.0,
                h_mm: 297.0,
                images: vec![],
                guides: GuideOptions::default(),
                guide_rects: vec![],
            },
        ];
        build_pdf(&pages).unwrap()
    }

    #[test]
    fn verify_exact_size_pass() {
        // default stretti scelti in UI: tol ±0.5%, sim stampante ±0.3%
        let pdf = sample_pdf();
        let r = verify_pdf(&pdf, 63.0, 88.0, 0.5, 0.3).unwrap();
        assert!(r.pass, "{}", r.summary);
        assert_eq!(r.images.len(), 2);
        assert_eq!(r.pages, 2);
        assert!((r.images[0].scale_pct_w - 100.0).abs() < 0.2, "{:?}", r.images[0]);
        assert!((r.images[0].placed_w_mm - 63.0).abs() < 0.01);
        assert!((r.images[0].placed_h_mm - 88.0).abs() < 0.01);
        // DPI effettivi dai pixel embedded: 744px / (63/25.4)" ≈ 300
        assert!((r.images[0].eff_dpi - 300.0).abs() < 1.0);
        // simulazione stampante ±0.3%: range stretto ma attorno al nominale
        assert!(r.images[0].sim_w_mm[0] < 63.0 && r.images[0].sim_w_mm[1] > 63.0);
        assert!((r.images[0].sim_w_mm[1] - r.images[0].sim_w_mm[0] - 63.0 * 0.006).abs() < 0.02);
    }

    #[test]
    fn verify_wrong_nominal_fails() {
        let pdf = sample_pdf();
        let r = verify_pdf(&pdf, 59.0, 86.0, 0.5, 0.3).unwrap();
        assert!(!r.pass);
        assert!(r.worst_dev_pct > 0.5);
    }

    #[test]
    fn verify_strict_boundary() {
        // 0.4% di scalo passa con tol 0.5 ma fallirebbe con tol 0.3
        let pdf = sample_pdf();
        let ok = verify_pdf(&pdf, 63.0 * 1.004, 88.0 * 1.004, 0.5, 0.3).unwrap();
        assert!(ok.pass, "{}", ok.summary);
        let ko = verify_pdf(&pdf, 63.0 * 1.004, 88.0 * 1.004, 0.3, 0.3).unwrap();
        assert!(!ko.pass);
    }

    #[test]
    fn verify_rejects_garbage() {
        assert!(verify_pdf(b"ciao", 63.0, 88.0, 0.5, 0.3).is_err());
        assert!(verify_pdf(b"%PDF-1.4 senza immagini", 63.0, 88.0, 0.5, 0.3).is_err());
        assert!(verify_pdf(&sample_pdf(), 0.0, 88.0, 0.5, 0.3).is_err());
    }
}
