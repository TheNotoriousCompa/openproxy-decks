//! Unità canonica mm + conversioni + calcolo DPI/target pixel + decisione upscale.
//! Mirror delle funzioni in src/lib/units.ts (mantenere allineate).

pub const MM_PER_INCH: f64 = 25.4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LengthUnit {
    Mm,
    Cm,
    Inch,
}

pub fn to_mm(value: f64, unit: LengthUnit) -> f64 {
    match unit {
        LengthUnit::Mm => value,
        LengthUnit::Cm => value * 10.0,
        LengthUnit::Inch => value * MM_PER_INCH,
    }
}

pub fn from_mm(mm: f64, unit: LengthUnit) -> f64 {
    match unit {
        LengthUnit::Mm => mm,
        LengthUnit::Cm => mm / 10.0,
        LengthUnit::Inch => mm / MM_PER_INCH,
    }
}

/// effectiveDPI = sourcePixels / targetInches
pub fn effective_dpi(source_px: u32, target_mm: f64) -> f64 {
    if target_mm <= 0.0 {
        return 0.0;
    }
    source_px as f64 / (target_mm / MM_PER_INCH)
}

pub fn required_pixels(target_mm: f64, dpi: f64) -> u32 {
    ((target_mm / MM_PER_INCH) * dpi).round() as u32
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QualityStatus {
    Green,
    Blue,
    Yellow,
    Orange,
    Red,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpscaleMethod {
    None,
    Interpolate,
    Ai,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct QualityReport {
    pub src_w: u32,
    pub src_h: u32,
    pub req_w: u32,
    pub req_h: u32,
    pub eff_dpi_w: f64,
    pub eff_dpi_h: f64,
    pub eff_dpi: f64,
    pub target_dpi: f64,
    pub scale_needed: f64,
    pub status: QualityStatus,
    pub method: UpscaleMethod,
    pub final_w: u32,
    pub final_h: u32,
}

/// Regole:
/// - scale <= 1.0 → None/Green (mai upscale se già abbastanza grande)
/// - scale <= 1.25 → interpolate/Blue
/// - scale <= 2.0 → AI/Yellow
/// - scale <= 3.5 → AI/Orange
/// - oltre → Red (sorgente troppo piccola; AI comunque ma segnalata)
pub fn analyze_quality(src_w: u32, src_h: u32, target_w_mm: f64, target_h_mm: f64, target_dpi: f64) -> QualityReport {
    let req_w = required_pixels(target_w_mm, target_dpi);
    let req_h = required_pixels(target_h_mm, target_dpi);
    let eff_w = effective_dpi(src_w, target_w_mm);
    let eff_h = effective_dpi(src_h, target_h_mm);
    let eff = eff_w.min(eff_h);
    let sx = if src_w == 0 { f64::INFINITY } else { req_w as f64 / src_w as f64 };
    let sy = if src_h == 0 { f64::INFINITY } else { req_h as f64 / src_h as f64 };
    let scale = sx.max(sy);
    let (status, method) = if src_w == 0 || src_h == 0 {
        (QualityStatus::Red, UpscaleMethod::Ai)
    } else if scale <= 1.0 {
        (QualityStatus::Green, UpscaleMethod::None)
    } else if scale <= 1.25 {
        (QualityStatus::Blue, UpscaleMethod::Interpolate)
    } else if scale <= 2.0 {
        (QualityStatus::Yellow, UpscaleMethod::Ai)
    } else if scale <= 3.5 {
        (QualityStatus::Orange, UpscaleMethod::Ai)
    } else {
        (QualityStatus::Red, UpscaleMethod::Ai)
    };
    QualityReport {
        src_w,
        src_h,
        req_w,
        req_h,
        eff_dpi_w: eff_w,
        eff_dpi_h: eff_h,
        eff_dpi: eff,
        target_dpi,
        scale_needed: if scale.is_infinite() { 0.0 } else { scale },
        status,
        method,
        final_w: req_w,
        final_h: req_h,
    }
}

// ---------- Layout engine ----------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LayoutInput {
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
    pub total_cards: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CardPlacement {
    pub index: usize,
    pub page: usize,
    pub x_mm: f64,
    pub y_mm: f64,
    pub w_mm: f64,
    pub h_mm: f64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LayoutOutput {
    pub cols: usize,
    pub rows: usize,
    pub per_page: usize,
    pub pages: usize,
    pub placements: Vec<CardPlacement>,
}

pub fn compute_layout(input: &LayoutInput) -> Result<LayoutOutput, String> {
    if input.page_w_mm <= 0.0 || input.page_h_mm <= 0.0 {
        return Err("pagina non valida".into());
    }
    if input.card_w_mm <= 0.0 || input.card_h_mm <= 0.0 {
        return Err("carta non valida".into());
    }
    let cw = input.card_w_mm + input.bleed_mm * 2.0;
    let ch = input.card_h_mm + input.bleed_mm * 2.0;
    let avail_w = input.page_w_mm - input.margin_left_mm - input.margin_right_mm;
    let avail_h = input.page_h_mm - input.margin_top_mm - input.margin_bottom_mm;
    if avail_w <= 0.0 || avail_h <= 0.0 {
        return Err("margini troppo grandi".into());
    }
    let cols = ((avail_w + input.spacing_col_mm) / (cw + input.spacing_col_mm)).floor() as usize;
    let rows = ((avail_h + input.spacing_row_mm) / (ch + input.spacing_row_mm)).floor() as usize;
    if cols == 0 || rows == 0 {
        return Err("la carta non entra nella pagina (overflow)".into());
    }
    let per_page = cols * rows;
    let pages = if input.total_cards == 0 {
        0
    } else {
        (input.total_cards + per_page - 1) / per_page
    };
    let mut placements = Vec::with_capacity(input.total_cards);
    // Griglia CENTRATA nell'area utile (come proxxied.com): i margini restano
    // minimi garantiti, lo spazio in eccesso si divide equamente ai lati.
    let used_w = cols as f64 * cw + (cols as f64 - 1.0) * input.spacing_col_mm;
    let used_h = rows as f64 * ch + (rows as f64 - 1.0) * input.spacing_row_mm;
    let start_x = input.margin_left_mm + (avail_w - used_w) / 2.0;
    let start_y = input.margin_top_mm + (avail_h - used_h) / 2.0;
    for i in 0..input.total_cards {
        let page = i / per_page;
        let slot = i % per_page;
        let r = slot / cols;
        let c = slot % cols;
        placements.push(CardPlacement {
            index: i,
            page,
            x_mm: start_x + c as f64 * (cw + input.spacing_col_mm),
            y_mm: start_y + r as f64 * (ch + input.spacing_row_mm),
            w_mm: cw,
            h_mm: ch,
        });
    }
    Ok(LayoutOutput { cols, rows, per_page, pages, placements })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mm_inch_roundtrip() {
        assert!((to_mm(1.0, LengthUnit::Inch) - 25.4).abs() < 1e-9);
        assert!((from_mm(25.4, LengthUnit::Inch) - 1.0).abs() < 1e-9);
        assert!((to_mm(1.0, LengthUnit::Cm) - 10.0).abs() < 1e-9);
    }

    #[test]
    fn dpi_math() {
        // 63mm ≈ 2.4803in; 744px / 2.4803in = 300dpi
        let d = effective_dpi(744, 63.0);
        assert!((d - 300.0).abs() < 1.0, "got {d}");
        assert_eq!(required_pixels(63.0, 300.0), 744);
    }

    #[test]
    fn quality_thresholds() {
        let g = analyze_quality(1488, 2079, 63.0, 88.0, 300.0);
        assert_eq!(g.status, QualityStatus::Green);
        // 650x900 vs richiesti 744x1039 → scala ~1.15 → Blue (interpolazione leggera)
        let b = analyze_quality(650, 900, 63.0, 88.0, 300.0);
        assert_eq!(b.status, QualityStatus::Blue);
        let r = analyze_quality(200, 280, 63.0, 88.0, 300.0);
        assert_eq!(r.status, QualityStatus::Red);
    }

    #[test]
    fn a4_63x88_layout() {
        let out = compute_layout(&LayoutInput {
            page_w_mm: 210.0,
            page_h_mm: 297.0,
            card_w_mm: 63.0,
            card_h_mm: 88.0,
            margin_top_mm: 10.0,
            margin_right_mm: 10.0,
            margin_bottom_mm: 10.0,
            margin_left_mm: 10.0,
            spacing_row_mm: 2.0,
            spacing_col_mm: 2.0,
            bleed_mm: 0.0,
            total_cards: 10,
        })
        .unwrap();
        assert_eq!((out.cols, out.rows), (2, 3));
        assert_eq!(out.per_page, 6);
        assert_eq!(out.pages, 2);
        assert_eq!(out.placements.len(), 10);
    }

    #[test]
    fn griglia_centrata_come_proxxied() {
        // A4, 63x88 + bleed 1 (celle 65x90), margini 3, spacing 0 → 3x3
        // centrata: x=7.5 (come proxxied.com), y=13.5
        let out = compute_layout(&LayoutInput {
            page_w_mm: 210.0,
            page_h_mm: 297.0,
            card_w_mm: 63.0,
            card_h_mm: 88.0,
            margin_top_mm: 3.0,
            margin_right_mm: 3.0,
            margin_bottom_mm: 3.0,
            margin_left_mm: 3.0,
            spacing_row_mm: 0.0,
            spacing_col_mm: 0.0,
            bleed_mm: 1.0,
            total_cards: 9,
        })
        .unwrap();
        assert_eq!((out.cols, out.rows), (3, 3));
        let p0 = &out.placements[0];
        assert!((p0.x_mm - 7.5).abs() < 1e-9, "x={}", p0.x_mm);
        assert!((p0.y_mm - 13.5).abs() < 1e-9, "y={}", p0.y_mm);
        // simmetria: bordo dx = bordo sx
        let last = &out.placements[8];
        assert!((210.0 - (last.x_mm + last.w_mm) - p0.x_mm).abs() < 1e-9);
    }

    #[test]
    fn overflow_errors() {        let err = compute_layout(&LayoutInput {
            page_w_mm: 50.0,
            page_h_mm: 50.0,
            card_w_mm: 63.0,
            card_h_mm: 88.0,
            margin_top_mm: 5.0,
            margin_right_mm: 5.0,
            margin_bottom_mm: 5.0,
            margin_left_mm: 5.0,
            spacing_row_mm: 2.0,
            spacing_col_mm: 2.0,
            bleed_mm: 0.0,
            total_cards: 1,
        });
        assert!(err.is_err());
    }

    #[test]
    fn dedup_key_stable() {
        let k1 = format!("{}|{}|{}|{}", "abc", 744, 300, "q90");
        let k2 = format!("{}|{}|{}|{}", "abc", 744, 300, "q90");
        assert_eq!(k1, k2);
    }
}
