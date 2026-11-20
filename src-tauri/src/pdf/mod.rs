//! PDF engine nativo: misure fisiche precise, asset deduplicati,
//! guide vettoriali, processing pagina-per-pagina.
//! Formato: PDF 1.4 con XObject riutilizzati (10 copie = 1 stream + 10 `Do`).

pub mod verify;

pub const PT_PER_MM: f64 = 72.0 / 25.4;

pub fn mm_to_pt(mm: f64) -> f64 {
    mm * PT_PER_MM
}

#[derive(Debug, Clone)]
pub struct PlacedImage {
    /// hash del processed asset (deduplicazione)
    pub hash: String,
    pub x_mm: f64,
    pub y_mm_top: f64,
    pub w_mm: f64,
    pub h_mm: f64,
    /// byte JPEG condivisi (`Rc`): N copie dello stesso asset NON duplicano
    /// i MB in RAM (prima un `clone()` per copia: 100 copie × 4 MB = 400 MB).
    pub jpeg_bytes: std::rc::Rc<Vec<u8>>,
    pub img_w_px: u32,
    pub img_h_px: u32,
}

#[derive(Debug, Clone, Default)]
pub struct GuideOptions {
    /// segni d'angolo (bracci di `mark_len_mm` su ogni angolo del trim)
    pub crop_marks: bool,
    /// segni d'angolo corti: campo storico, migrato in `crop_marks`
    pub corner_marks: bool,
    /// riquadro di taglio su ogni carta
    pub cut_lines: bool,
    /// linee di taglio a tutta pagina (guide per la taglierina)
    pub page_lines: bool,
    pub mark_len_mm: f64,
    /// cross | inside | outside: bracci dentro e fuori, solo dentro, solo fuori
    pub cut_shape: String,
    /// scostamento fine della linea in mm: positivo = verso l'interno della carta
    pub cut_offset_mm: f64,
    /// colore delle linee di taglio RGB 0..1 (nero)
    pub color_rgb: [f32; 3],
    /// colore dei segni d'angolo RGB 0..1 (verde)
    pub crop_rgb: [f32; 3],
    /// spessore linea in pt (0.25–3, default 0.75)
    pub width_pt: f64,
    /// outside | inside | center (default inside)
    pub placement: String,
    /// solid | dashed (default solid)
    pub line_style: String,
    /// square | round (default square)
    pub line_cap: String,
    /// bleed in mm: le guide sono riferite al formato di taglio (carta),
    /// non al bordo esterno inchiostrato (carta + bleed). 0 = nessun rientro (back-compat).
    pub bleed_mm: f64,
}

impl GuideOptions {
    pub fn red() -> Self {
        Self { color_rgb: [1.0, 0.0, 0.0], crop_rgb: [0.0, 1.0, 0.0], ..Default::default() }
    }
}

/// "#rrggbb" → [r,g,b] 0..1 (fallback rosso su input invalido).
pub fn parse_hex_color(s: &str) -> [f32; 3] {
    let h = s.trim().trim_start_matches('#');
    if h.len() == 6 {
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&h[0..2], 16),
            u8::from_str_radix(&h[2..4], 16),
            u8::from_str_radix(&h[4..6], 16),
        ) {
            return [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0];
        }
    }
    [1.0, 0.0, 0.0]
}

#[derive(Debug, Clone)]
pub struct PdfPage {
    pub w_mm: f64,
    pub h_mm: f64,
    pub images: Vec<PlacedImage>,
    pub guides: GuideOptions,
    /// extra rettangoli guida in mm (x, y_top, w, h) per cut lines
    pub guide_rects: Vec<(f64, f64, f64, f64)>,
}

/// Costruisce un PDF 1.4 valido. Ritorna i byte del file.
/// Per export grandi preferire `build_pdf_to_file` (scrittura incrementale).
pub fn build_pdf(pages: &[PdfPage]) -> Result<Vec<u8>, String> {
    let mut buf = std::io::Cursor::new(Vec::new());
    build_pdf_into(pages, &mut buf)?;
    Ok(buf.into_inner())
}

/// Scrive il PDF direttamente su file, oggetto per oggetto: la RAM resta
/// proporzionale agli asset unici, non alla dimensione del PDF finale
/// (un deck da 100 carte a 1200 DPI supera i 300 MB su disco).
pub fn build_pdf_to_file(pages: &[PdfPage], path: &std::path::Path) -> Result<u64, String> {
    let mut f = std::fs::File::create(path).map_err(|e| e.to_string())?;
    if let Err(e) = build_pdf_into(pages, &mut f) {
        let _ = std::fs::remove_file(path);
        return Err(e);
    }
    std::fs::metadata(path).map(|m| m.len()).map_err(|e| e.to_string())
}

fn build_pdf_into<W: std::io::Write + std::io::Seek>(
    pages: &[PdfPage],
    out: &mut W,
) -> Result<(), String> {
    fn werr(e: std::io::Error) -> String {
        e.to_string()
    }
    if pages.is_empty() {
        return Err("nessuna pagina".into());
    }
    // 1. Deduplica asset per hash
    use std::collections::HashMap;
    let mut hash_to_idx: HashMap<String, usize> = HashMap::new();
    let mut uniq: Vec<&PlacedImage> = Vec::new();
    for p in pages {
        for im in &p.images {
            if !hash_to_idx.contains_key(&im.hash) {
                hash_to_idx.insert(im.hash.clone(), uniq.len());
                uniq.push(im);
            }
        }
    }

    // 2. Assegna numeri oggetto:
    // 1=catalog, 2=pages, poi per ogni pagina: page obj + content obj (2N),
    // poi per ogni asset unico: 1 obj XObject image.
    let n_pages = pages.len();
    let n_img = uniq.len();
    let total_objects = 2 + n_pages * 2 + n_img;
    let first_img_obj = 2 + n_pages * 2 + 1;

    // Oggetti piccoli (catalog, pages, page, content) restano in RAM: sono testo.
    let mut small: HashMap<usize, Vec<u8>> = HashMap::new();

    // Catalog (1)
    small.insert(1, b"<< /Type /Catalog /Pages 2 0 R >>".to_vec());
    // Pages (2)
    let kids: String = (0..n_pages)
        .map(|i| format!("{} 0 R", 3 + i * 2))
        .collect::<Vec<_>>()
        .join(" ");
    small.insert(2, format!("<< /Type /Pages /Kids [ {kids} ] /Count {n_pages} >>").into_bytes());

    // XObject names: /Im0.. per asset unico
    let mut hash_to_name: HashMap<String, String> = HashMap::new();
    for im in uniq.iter() {
        hash_to_name.insert(im.hash.clone(), format!("Im{}", hash_to_name.len()));
    }

    // Pages + contents
    for (pi, page) in pages.iter().enumerate() {
        let page_obj = 3 + pi * 2;
        let content_obj = 4 + pi * 2;
        let pw = mm_to_pt(page.w_mm);
        let ph = mm_to_pt(page.h_mm);

        // resources: XObject con solo gli asset usati in questa pagina
        let mut used: Vec<String> = Vec::new();
        for im in &page.images {
            let name = &hash_to_name[&im.hash];
            if !used.contains(name) {
                used.push(name.clone());
            }
        }
        let xobj = used
            .iter()
            .map(|n| {
                let idx = n.trim_start_matches("Im").parse::<usize>().unwrap_or(0);
                format!("/{n} {} 0 R", first_img_obj + idx)
            })
            .collect::<Vec<_>>()
            .join(" ");
        let content = page_content(page, &hash_to_name, ph)?;
        small.insert(content_obj, wrap_stream(&content));
        small.insert(
            page_obj,
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 {:.3} {:.3} ] /Resources << /XObject << {xobj} >> /ProcSet [ /PDF /ImageC ] >> /Contents {content_obj} 0 R >>",
                pw, ph
            )
            .into_bytes(),
        );
    }

    // 3. Serializza con xref, in streaming: mai l'intero PDF in RAM.
    out.write_all(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n").map_err(werr)?;
    let mut offsets: Vec<u64> = vec![0; total_objects + 1];
    for no in 1..=total_objects {
        offsets[no] = out.stream_position().map_err(werr)?;
        out.write_all(format!("{no} 0 obj\n").as_bytes()).map_err(werr)?;
        if no >= first_img_obj {
            // XObject immagine: header + byte JPEG condivisi, zero copie.
            let im = uniq[no - first_img_obj];
            out.write_all(&image_xobject_header(im)).map_err(werr)?;
            out.write_all(&im.jpeg_bytes).map_err(werr)?;
            out.write_all(b"\nendstream").map_err(werr)?;
        } else if let Some(body) = small.get(&no) {
            out.write_all(body).map_err(werr)?;
        } else {
            return Err(format!("oggetto {no} mancante"));
        }
        out.write_all(b"\nendobj\n").map_err(werr)?;
    }
    let xref_pos = out.stream_position().map_err(werr)?;
    out.write_all(format!("xref\n0 {}\n", total_objects + 1).as_bytes()).map_err(werr)?;
    out.write_all(b"0000000000 65535 f \n").map_err(werr)?;
    for no in 1..=total_objects {
        out.write_all(format!("{:010} 00000 n \n", offsets[no]).as_bytes()).map_err(werr)?;
    }
    out.write_all(
        format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF", total_objects + 1).as_bytes(),
    )
    .map_err(werr)?;
    Ok(())
}

fn image_xobject_header(im: &PlacedImage) -> Vec<u8> {
    // JPEG → /DCTDecode diretto. (Tutti gli asset print sono JPEG salvo PNG con alpha.)
    format!(
        "<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n",
        im.img_w_px, im.img_h_px, im.jpeg_bytes.len()
    )
    .into_bytes()
}

fn wrap_stream(content: &[u8]) -> Vec<u8> {
    let mut v = format!("<< /Length {} >>\nstream\n", content.len()).into_bytes();
    v.extend_from_slice(content);
    v.extend_from_slice(b"\nendstream");
    v
}

/// Rettangolo di taglio (trim) da un rettangolo esterno inchiostrato.
/// L'esterno è carta + bleed per lato; il taglio è sul formato carta,
/// rientrato di `bleed_mm` per lato. Con bleed<=0 coincide con l'esterno.
/// Ritorna (x, y_top, w, h) in mm, con w/h clampati a >= 0.
pub fn trim_rect(x: f64, y_top: f64, w: f64, h: f64, bleed_mm: f64) -> (f64, f64, f64, f64) {
    if bleed_mm <= 0.0 {
        return (x, y_top, w, h);
    }
    let b = bleed_mm.max(0.0);
    ((x + b), (y_top + b), ((w - 2.0 * b).max(0.0)), ((h - 2.0 * b).max(0.0)))
}

/// Content stream: immagini (`q w 0 0 h x y cm /ImN Do Q`) + guide vettoriali.
fn page_content(
    page: &PdfPage,
    names: &std::collections::HashMap<String, String>,
    page_h_pt: f64,
) -> Result<Vec<u8>, String> {
    let mut s = String::new();
    s.push_str("q\n");
    for im in &page.images {
        let name = &names[&im.hash];
        let w = mm_to_pt(im.w_mm);
        let h = mm_to_pt(im.h_mm);
        // PDF y dal basso: y_bottom = page_h - y_top - h
        let x = mm_to_pt(im.x_mm);
        let y = page_h_pt - mm_to_pt(im.y_mm_top) - h;
        s.push_str(&format!("q {w:.3} 0 0 {h:.3} {x:.3} {y:.3} cm /{name} Do Q\n"));
    }
    // Guide vettoriali: segni d'angolo colorati + linee di taglio nere.
    if page.guides.crop_marks || page.guides.corner_marks || page.guides.cut_lines || page.guides.page_lines
    {
        let [cr, cg, cb] = page.guides.crop_rgb;
        let w = page.guides.width_pt.clamp(0.25, 3.0);
        s.push_str(&format!("0.000 0.000 0.000 RG {w:.2} w\n"));
        // terminazioni: square (butt/miter) o round
        if page.guides.line_cap == "round" {
            s.push_str("1 J 1 j\n");
        } else {
            s.push_str("0 J 0 j\n");
        }
        // tratto: continuo o tratteggiato
        if page.guides.line_style == "dashed" {
            s.push_str("[3 3] 0 d\n");
        } else {
            s.push_str("[] 0 d\n");
        }
        // guide_rects = rettangoli ESTERNI (carta + bleed). Il taglio e' sul formato
        // carta, spostato da placement (compensa lo spessore) e da cut_offset_mm.
        // Il tratto e' centrato sul percorso: il percorso rientra di quell'offset.
        // NB: la compensazione dello spessore va in MM (il layout e' in mm).
        let bleed = page.guides.bleed_mm.max(0.0);
        let half_mm = (w * 25.4 / 72.0) / 2.0;
        let placement_mm = match page.guides.placement.as_str() {
            "inside" => half_mm,
            "outside" => -half_mm,
            _ => 0.0,
        };
        let inset_mm = placement_mm + page.guides.cut_offset_mm;
        let l = mm_to_pt(page.guides.mark_len_mm.clamp(0.5, 20.0));
        let pw = mm_to_pt(page.w_mm);
        struct GuideRect {
            left: f64,
            right: f64,
            bottom: f64,
            top: f64,
        }
        let rects: Vec<GuideRect> = page
            .guide_rects
            .iter()
            .map(|(x, y_top, w_mm, h_mm)| {
                let (tx, ty, tw, th) = trim_rect(*x, *y_top, *w_mm, *h_mm, bleed);
                let left = mm_to_pt(tx + inset_mm);
                let right = mm_to_pt(tx + tw - inset_mm).max(left);
                let top = page_h_pt - mm_to_pt(ty + inset_mm);
                let bottom = (page_h_pt - mm_to_pt(ty + th - inset_mm)).min(top);
                GuideRect { left, right, bottom, top }
            })
            .collect();

        if page.guides.cut_lines {
            for r in &rects {
                s.push_str(&format!(
                    "{:.3} {:.3} {:.3} {:.3} re S\n",
                    r.left,
                    r.bottom,
                    r.right - r.left,
                    r.top - r.bottom
                ));
            }
        }
        if page.guides.page_lines {
            for r in &rects {
                for lx in [r.left, r.right] {
                    s.push_str(&format!("{lx:.3} 0 m {lx:.3} {page_h_pt:.3} l S\n"));
                }
                for ly in [r.bottom, r.top] {
                    s.push_str(&format!("0 {ly:.3} m {pw:.3} {ly:.3} l S\n"));
                }
            }
        }
        if page.guides.crop_marks || page.guides.corner_marks {
            s.push_str(&format!("{cr:.3} {cg:.3} {cb:.3} RG\n"));
            let shape = page.guides.cut_shape.as_str();
            for r in &rects {
                // [angolo x, angolo y, verso interno x, verso interno y]
                let corners = [
                    (r.left, r.bottom, 1.0, 1.0),
                    (r.right, r.bottom, -1.0, 1.0),
                    (r.left, r.top, 1.0, -1.0),
                    (r.right, r.top, -1.0, -1.0),
                ];
                for (cx, cy, ix, iy) in corners {
                    match shape {
                        "cross" => {
                            s.push_str(&format!("{:.3} {cy:.3} m {:.3} {cy:.3} l S\n", cx - ix * l, cx + ix * l));
                            s.push_str(&format!("{cx:.3} {:.3} m {cx:.3} {:.3} l S\n", cy - iy * l, cy + iy * l));
                        }
                        "outside" => {
                            s.push_str(&format!("{cx:.3} {cy:.3} m {:.3} {cy:.3} l S\n", cx - ix * l));
                            s.push_str(&format!("{cx:.3} {cy:.3} m {cx:.3} {:.3} l S\n", cy - iy * l));
                        }
                        _ => {
                            s.push_str(&format!("{cx:.3} {cy:.3} m {:.3} {cy:.3} l S\n", cx + ix * l));
                            s.push_str(&format!("{cx:.3} {cy:.3} m {cx:.3} {:.3} l S\n", cy + iy * l));
                        }
                    }
                }
            }
        }
    }
    s.push_str("Q\n");
    Ok(s.into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::rc::Rc;

    #[test]
    fn mm_pt() {
        assert!((mm_to_pt(25.4) - 72.0).abs() < 1e-6);
    }

    #[test]
    fn dedup_and_multipage() {
        let jpeg = vec![0xFF, 0xD8, 0xFF, 0xD9]; // stub minimo
        let mk = |_page: f64| PlacedImage {
            hash: "same".into(),
            x_mm: 10.0,
            y_mm_top: 10.0,
            w_mm: 63.0,
            h_mm: 88.0,
            jpeg_bytes: Rc::new(jpeg.clone()),
            img_w_px: 10,
            img_h_px: 10,
        };
        let pages = vec![
            PdfPage { w_mm: 210.0, h_mm: 297.0, images: vec![mk(0.0)], guides: GuideOptions::default(), guide_rects: vec![] },
            PdfPage { w_mm: 210.0, h_mm: 297.0, images: vec![mk(1.0)], guides: GuideOptions::default(), guide_rects: vec![] },
        ];
        let pdf = build_pdf(&pages).unwrap();
        let text = String::from_utf8_lossy(&pdf);
        // 1 solo XObject per 2 pagine (deduplicazione)
        assert_eq!(text.matches("/Subtype /Image").count(), 1);
        // 2 oggetti pagina (l'oggetto /Pages non matcha grazie allo spazio finale)
        assert_eq!(text.matches("/Type /Page ").count(), 2);
        assert!(pdf.starts_with(b"%PDF-1.4"));
        assert!(text.contains("%%EOF"));
    }

    #[test]
    fn empty_errors() {
        assert!(build_pdf(&[]).is_err());
    }

    #[test]
    fn hex_color_parse() {
        assert_eq!(parse_hex_color("#ff0000"), [1.0, 0.0, 0.0]);
        assert_eq!(parse_hex_color("#00ff00"), [0.0, 1.0, 0.0]);
        assert_eq!(parse_hex_color("#000000"), [0.0, 0.0, 0.0]);
        assert_eq!(parse_hex_color("#ffffff"), [1.0, 1.0, 1.0]);
        // invalidi → rosso fallback
        assert_eq!(parse_hex_color("nope"), [1.0, 0.0, 0.0]);
        assert_eq!(parse_hex_color("#12345"), [1.0, 0.0, 0.0]);
    }

    // ---------- guide: geometria ----------

    /// Pagina A4 con UNA carta: esterno (10,10)-65x90 = carta 63x88 + bleed 1.
    fn guide_content(opts: GuideOptions) -> String {
        let jpeg = vec![0xFF, 0xD8, 0xFF, 0xD9];
        let pages = vec![PdfPage {
            w_mm: 210.0,
            h_mm: 297.0,
            images: vec![PlacedImage {
                hash: "h".into(),
                x_mm: 10.0,
                y_mm_top: 10.0,
                w_mm: 65.0,
                h_mm: 90.0,
                jpeg_bytes: Rc::new(jpeg),
                img_w_px: 10,
                img_h_px: 10,
            }],
            guides: opts,
            guide_rects: vec![(10.0, 10.0, 65.0, 90.0)],
        }];
        String::from_utf8_lossy(&build_pdf(&pages).unwrap()).to_string()
    }

    /// Segni d'angolo attivi su una carta con bleed 1.
    fn mark_options(placement: &str, shape: &str, offset_mm: f64) -> GuideOptions {
        GuideOptions {
            crop_marks: true,
            corner_marks: false,
            cut_lines: false,
            page_lines: false,
            mark_len_mm: 2.0,
            cut_shape: shape.into(),
            cut_offset_mm: offset_mm,
            color_rgb: [0.0, 0.0, 0.0],
            crop_rgb: [0.0, 1.0, 0.0],
            width_pt: 0.75,
            placement: placement.into(),
            line_style: "solid".into(),
            line_cap: "square".into(),
            bleed_mm: 1.0,
        }
    }

    /// Bordi del percorso (coordinate PDF, y dal basso) con placement inside:
    /// la carta 63x88 parte a 11mm e finisce a 74x99mm, il tratto e' centrato.
    fn inside_edges() -> (f64, f64, f64, f64) {
        let half = (0.75 * 25.4 / 72.0) / 2.0;
        let page_h = mm_to_pt(297.0);
        (
            mm_to_pt(11.0 + half),
            page_h - mm_to_pt(99.0 - half),
            mm_to_pt(74.0 - half),
            page_h - mm_to_pt(11.0 + half),
        )
    }

    #[test]
    fn trim_rect_rientra_di_bleed() {
        // esterno 65x90 con bleed 1 → taglio 63x88 rientrato di 1 per lato
        assert_eq!(trim_rect(10.0, 10.0, 65.0, 90.0, 1.0), (11.0, 11.0, 63.0, 88.0));
        // bleed 0 = identità
        assert_eq!(trim_rect(10.0, 10.0, 63.0, 88.0, 0.0), (10.0, 10.0, 63.0, 88.0));
        // bleed eccessivo: mai dimensioni negative
        assert_eq!(trim_rect(0.0, 0.0, 2.0, 2.0, 5.0), (5.0, 5.0, 0.0, 0.0));
    }

    #[test]
    fn segni_angolo_dentro_partono_dall_angolo() {
        let t = guide_content(mark_options("inside", "inside", 0.0));
        let (left, bottom, _, _) = inside_edges();
        let l = mm_to_pt(2.0);
        // angolo basso-sinistro: braccio orizzontale verso l'interno e verticale verso l'alto
        assert!(
            t.contains(&format!("{left:.3} {bottom:.3} m {:.3} {bottom:.3} l S", left + l)),
            "braccio orizzontale:\n{t}"
        );
        assert!(
            t.contains(&format!("{left:.3} {bottom:.3} m {left:.3} {:.3} l S", bottom + l)),
            "braccio verticale:\n{t}"
        );
        assert!(
            !t.contains(&format!("{:.3} {bottom:.3} m {left:.3}", left - l)),
            "niente braccio esterno"
        );
    }

    #[test]
    fn segni_angolo_croce_e_fuori() {
        let (left, bottom, _, _) = inside_edges();
        let l = mm_to_pt(2.0);
        let cross = guide_content(mark_options("inside", "cross", 0.0));
        assert!(
            cross.contains(&format!("{:.3} {bottom:.3} m {:.3} {bottom:.3} l S", left - l, left + l)),
            "croce:\n{cross}"
        );
        let out = guide_content(mark_options("inside", "outside", 0.0));
        assert!(
            out.contains(&format!("{left:.3} {bottom:.3} m {:.3} {bottom:.3} l S", left - l)),
            "fuori:\n{out}"
        );
        assert!(
            !out.contains(&format!("{left:.3} {bottom:.3} m {:.3}", left + l)),
            "fuori non va dentro"
        );
    }

    #[test]
    fn placement_e_scostamento_spostano_il_tratto() {
        let (left_inside, _, _, _) = inside_edges();
        let half = (0.75 * 25.4 / 72.0) / 2.0;
        // fuori: percorso mezza traccia oltre il trim (verso il bleed)
        let outside = guide_content(mark_options("outside", "inside", 0.0));
        assert!(outside.contains(&format!("{:.3} ", mm_to_pt(11.0 - half))), "fuori:\n{outside}");
        // sul bordo: percorso esattamente sul trim
        let center = guide_content(mark_options("center", "inside", 0.0));
        assert!(center.contains(&format!("{:.3} ", mm_to_pt(11.0))), "sul bordo:\n{center}");
        // scostamento +1mm: percorso 1mm dentro la carta
        let shifted = guide_content(mark_options("inside", "inside", 1.0));
        assert!(
            shifted.contains(&format!("{:.3} ", mm_to_pt(11.0 + half + 1.0))),
            "scostato:\n{shifted}"
        );
        assert!((left_inside - mm_to_pt(11.0 + half)).abs() < 1e-9);
    }

    #[test]
    fn riquadro_carta_e_linee_pagina() {
        let (left, bottom, right, top) = inside_edges();
        let rect = GuideOptions {
            cut_lines: true,
            ..mark_options("inside", "inside", 0.0)
        };
        let t = guide_content(rect);
        assert!(
            t.contains(&format!(
                "{left:.3} {bottom:.3} {:.3} {:.3} re S",
                right - left,
                top - bottom
            )),
            "riquadro:\n{t}"
        );
        let page = GuideOptions {
            crop_marks: false,
            page_lines: true,
            ..mark_options("inside", "inside", 0.0)
        };
        let p = guide_content(page);
        // verticali e orizzontali a tutta pagina sui bordi di taglio
        assert!(
            p.contains(&format!("{left:.3} 0 m {left:.3} {:.3} l S", mm_to_pt(297.0))),
            "verticale:\n{p}"
        );
        assert!(
            p.contains(&format!("0 {bottom:.3} m {:.3} {bottom:.3} l S", mm_to_pt(210.0))),
            "orizzontale:\n{p}"
        );
    }

    #[test]
    fn colori_stile_e_spessore() {
        let guides = GuideOptions {
            cut_lines: true,
            ..mark_options("inside", "inside", 0.0)
        };
        let t = guide_content(guides);
        assert!(t.contains("0.000 1.000 0.000 RG"), "segni verdi");
        assert!(t.contains("0.000 0.000 0.000 RG"), "taglio nero");
        assert!(t.contains("0.75 w"), "spessore dal setting");

        let fancy = GuideOptions {
            line_style: "dashed".into(),
            line_cap: "round".into(),
            ..mark_options("inside", "inside", 0.0)
        };
        let f = guide_content(fancy);
        assert!(f.contains("[3 3] 0 d"), "tratteggio");
        assert!(f.contains("1 J 1 j"), "estremità arrotondate");
    }

    #[test]
    fn nessuna_guida_nessun_tratto() {
        let off = GuideOptions {
            crop_marks: false,
            cut_lines: false,
            page_lines: false,
            ..mark_options("inside", "inside", 0.0)
        };
        let t = guide_content(off);
        assert!(!t.contains(" RG"), "nessun colore guida:\n{t}");
    }

#[test]
fn real_cards_pdf_100_percent() {
        use std::io::Cursor;
        let dir = format!("{}/tests/fixtures/cards", env!("CARGO_MANIFEST_DIR"));
        let mut placed: Vec<(String, Vec<u8>, u32, u32)> = Vec::new();
        for i in 0..9 {
            let p = format!("{dir}/{i:02}.png");
            let bytes = std::fs::read(&p)
                .unwrap_or_else(|_| panic!("fixture mancante: {p} (scarica le PNG Scryfall)"));
            let img = image::load_from_memory(&bytes).expect("decode png reale");
            use image::GenericImageView;
            let (w, h) = img.dimensions();
            assert!(w >= 600 && h >= 800, "thumbnail sospetta {w}x{h}");
            let mut jpg = Vec::new();
            img.write_to(&mut Cursor::new(&mut jpg), image::ImageFormat::Jpeg)
                .expect("encode jpeg");
            placed.push((format!("card-{i}"), jpg, w, h));
        }
        // Layout produzione: A4, 63x88 + bleed 1, margini 3, spacing 0 → 3x3 in 1 pagina
        let layout = crate::processing::compute_layout(&crate::processing::LayoutInput {
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
        assert_eq!((layout.cols, layout.rows, layout.pages), (3, 3, 1));
        let guides = GuideOptions {
            crop_marks: true,
            corner_marks: false,
            cut_lines: true,
            mark_len_mm: 2.0,
            cut_offset_mm: 0.0,
            cut_shape: "inside".into(),
            page_lines: false,
            color_rgb: parse_hex_color("#000000"),
            crop_rgb: parse_hex_color("#00ff00"),
            width_pt: 0.75,
            placement: "inside".into(),
            line_style: "solid".into(),
            line_cap: "square".into(),
            bleed_mm: 1.0,
        };
        let mut images: Vec<PlacedImage> = Vec::new();
        let mut rects: Vec<(f64, f64, f64, f64)> = Vec::new();
        for (pl, (hash, jpg, w, h)) in layout.placements.iter().zip(placed.iter()) {
            images.push(PlacedImage {
                hash: hash.clone(),
                x_mm: pl.x_mm,
                y_mm_top: pl.y_mm,
                w_mm: pl.w_mm,
                h_mm: pl.h_mm,
                jpeg_bytes: Rc::new((*jpg).clone()),
                img_w_px: *w,
                img_h_px: *h,
            });
            rects.push((pl.x_mm, pl.y_mm, pl.w_mm, pl.h_mm));
        }
        let pages = vec![PdfPage { w_mm: 210.0, h_mm: 297.0, images, guides, guide_rects: rects }];
        let pdf = build_pdf(&pages).unwrap();
        if let Ok(dump) = std::env::var("PROXXIED_DUMP_PDF") {
            std::fs::write(&dump, &pdf).expect("dump pdf");
        }
        assert!(pdf.len() > 100_000, "pdf con 9 jpeg reali troppo piccolo: {}B", pdf.len());
        let rep = crate::pdf::verify::verify_pdf(&pdf, 65.0, 90.0, 0.5, 0.3).unwrap();
        assert!(rep.pass, "{}", rep.summary);
        assert_eq!(rep.images.len(), 9);
        assert!(rep.worst_dev_pct <= 0.5, "{}", rep.summary);
        // eff_dpi reali delle PNG Scryfall su 65x90mm
        assert!(rep.images.iter().all(|c| c.eff_dpi > 100.0), "{:?}", rep.summary);
    }

    /// Scala mazzo vero: 137 carte (Sauron) in 3x3 → 16 pagine (15 piene + 2).

#[test]
fn real_deck_page_count() {
        let layout = crate::processing::compute_layout(&crate::processing::LayoutInput {
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
            total_cards: 137,
        })
        .unwrap();
        assert_eq!(layout.pages, 16);
        assert_eq!(layout.per_page, 9);
    }
}
