"""Verifica geometrica di un PDF esportato contro un riferimento (proxxied.com).

Controlla, senza renderizzare nulla (solo struttura PDF):
 1. numero pagine e MediaBox
 2. misura della cella (carta + bleed) e posizione della griglia
 3. passo fra righe/colonne
 4. proporzioni di OGNI immagine piazzata rispetto a quelle della cella
 5. DPI effettivi di ogni classe di immagine

Uso:
    python verify-export.py <riferimento.pdf> <nostro.pdf>
"""

import importlib.util
import io
import os
import re
import sys
import zlib
from collections import Counter

PT_MM = 25.4 / 72

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("pdfprobe", os.path.join(HERE, "pdfprobe.py"))
probe_src = io.open(os.path.join(HERE, "pdfprobe.py"), encoding="utf-8").read().split("main(sys.argv")[0]
NS = {}
exec(compile(probe_src, "pdfprobe", "exec"), NS)


def xref_and_pages(path):
    f = open(path, "rb")
    size = os.path.getsize(path)
    table, ost, root = NS["collect_xref"](f, size)
    NS["OSTREAMS"] = ost
    cat = NS["get_obj"](f, table, root)
    m = re.search(rb"/Pages\s+(\d+)", cat)
    pages = NS["get_obj"](f, table, int(m.group(1))) if m else cat
    kids = [int(k) for k in re.findall(rb"(\d+)\s+\d+\s+R", pages.split(b"/Kids")[1].split(b"]")[0])]
    return f, size, table, ost, kids


def page_pdf(path):
    """Estrae (MediaBox, piazzamenti, dims XObject) per ogni pagina."""
    f, size, table, ost, kids = xref_and_pages(path)
    out = []
    for pno in kids:
        pg = NS["get_obj"](f, table, pno)
        mb = re.search(rb"/MediaBox\s*\[([^\]]+)\]", pg)
        box = tuple(float(x) * PT_MM for x in mb.group(1).split()[2:]) if mb else (0.0, 0.0)
        xobjs = {}
        res = re.search(rb"/XObject\s*<<(.+?)>>", pg, re.S)
        if res:
            for nm, num in re.findall(rb"/(\S+)\s+(\d+)\s+\d+\s+R", res.group(1)):
                d = NS["get_obj"](f, table, int(num)).split(b"stream")[0].decode("latin1")
                w = re.search(r"/Width\s+(\d+)", d)
                h = re.search(r"/Height\s+(\d+)", d)
                xobjs[nm.decode()] = (int(w.group(1)) if w else 0, int(h.group(1)) if h else 0)
        cm = re.search(rb"/Contents\s+(\d+)\s+\d+\s+R", pg) or re.search(rb"/Contents\s*\[\s*(\d+)", pg)
        if not cm:
            continue
        raw = NS["get_obj"](f, table, int(cm.group(1)))
        data = raw.split(b"stream", 1)[1].lstrip(b"\r\n")
        data = data[: data.index(b"endstream")].rstrip(b"\r\n")
        if b"FlateDecode" in raw.split(b"stream")[0]:
            data = zlib.decompress(data)
        t = data.decode("latin1")
        placements = []
        # forma proxxied.com: "1 0 0 1 x y cm / 1 0 0 1 0 0 cm / w 0 0 h 0 0 cm / ... Do"
        for m in re.finditer(
            r"1 0 0 1 ([\d\.\-]+) ([\d\.\-]+) cm\s*1 0 0 1 0 0 cm\s*([\d\.\-]+) 0 0 ([\d\.\-]+) 0 0 cm\s*(?:1 0 0 1 0 0 cm\s*)?/(\S+) Do",
            t,
        ):
            x, y, w, h = (float(m.group(i)) * PT_MM for i in (1, 2, 3, 4))
            placements.append((round(x, 3), round(y, 3), round(w, 3), round(h, 3), m.group(5)))
        # forma nostra: "q w 0 0 h x y cm /N Do Q"
        for m in re.finditer(r"q ([\d\.\-]+) 0 0 ([\d\.\-]+) ([\d\.\-]+) ([\d\.\-]+) cm /(\S+) Do Q", t):
            w, h, x, y = (float(m.group(i)) * PT_MM for i in (1, 2, 3, 4))
            placements.append((round(x, 3), round(y, 3), round(w, 3), round(h, 3), m.group(5)))
        out.append({"page": pno, "box": box, "placements": placements, "xobjs": xobjs})
    f.close()
    return out


def summarize(path, label):
    print(f"\n=== {label}: {os.path.basename(path)} ({os.path.getsize(path)/1e6:.0f} MB)")
    pages = page_pdf(path)
    boxes = Counter(p["box"] for p in pages)
    print(f"pagine: {len(pages)} · MediaBox: {[f'{b[0]:.2f}x{b[1]:.2f}mm x{n}' for b, n in boxes.items()]}")
    sizes = Counter()
    for p in pages:
        for pl in p["placements"]:
            sizes[(pl[2], pl[3])] += 1
    if not sizes:
        print("  nessuna immagine piazzata")
        return pages, sizes
    (cell_w, cell_h), cards = sizes.most_common(1)[0]
    print(f"celle: {cell_w:.3f} x {cell_h:.3f} mm (x{cards}); altre misure: "
          f"{ {f'{w}x{h}': n for (w, h), n in sizes.items() if (w, h) != (cell_w, cell_h)} or 'nessuna'}")
    xs = sorted({pl[0] for p in pages for pl in p["placements"] if (pl[2], pl[3]) == (cell_w, cell_h)})
    ys = sorted({pl[1] for p in pages for pl in p["placements"] if (pl[2], pl[3]) == (cell_w, cell_h)})
    pitch_x = round(xs[1] - xs[0], 3) if len(xs) > 1 else None
    pitch_y = round(ys[1] - ys[0], 3) if len(ys) > 1 else None
    print(f"griglia: x {xs[:4]} (passo {pitch_x}) · y {ys[:4]} (passo {pitch_y})")
    # classi di immagine -> proporzioni e DPI
    dims_count = Counter()
    for p in pages:
        dims = Counter(p["xobjs"][pl[4]] for pl in p["placements"] if pl[4] in p["xobjs"] and (pl[2], pl[3]) == (cell_w, cell_h))
        dims_count.update(dims)
    cell_ar = cell_w / cell_h
    print("  immagini nella cella (px, proporzione, scarto vs cella, DPI):")
    for (w, h), n in sorted(dims_count.items(), key=lambda kv: -kv[1]):
        ar = w / h if h else 0
        print(
            f"    {w}x{h}px x{n}  ar {ar:.4f} (cella {cell_ar:.4f}, "
            f"scarto {(ar/cell_ar - 1)*100:+.2f}%)  -> {w/cell_w*25.4:.0f} x {h/cell_h*25.4:.0f} DPI"
        )
    return pages, sizes


def verdict(ref_path, ours_path):
    print("#" * 78)
    print("# VERIFICA EXPORT vs RIFERIMENTO")
    print("#" * 78)
    _, ref_sizes = summarize(ref_path, "RIFERIMENTO")
    pages, ours_sizes = summarize(ours_path, "NOSTRO EXPORT")

    (cell_w, cell_h), _ = ours_sizes.most_common(1)[0]
    cell_ar = cell_w / cell_h
    dims = Counter()
    for p in pages:
        for pl in p["placements"]:
            if (pl[2], pl[3]) == (cell_w, cell_h) and pl[4] in p["xobjs"]:
                dims[p["xobjs"][pl[4]]] += 1

    checks = []
    # 1. cella = carta 63x88 + bleed 1mm (65x90), tolleranza 0.05 mm
    checks.append((
        "cella carta+bleed 65.0x90.0 mm",
        abs(cell_w - 65.0) <= 0.05 and abs(cell_h - 90.0) <= 0.05,
        f"{cell_w:.3f}x{cell_h:.3f}",
    ))
    # 2. proporzioni di ogni classe immagine = proporzioni cella (tolleranza 0.5%)
    worst = max(abs(w / h / cell_ar - 1) * 100 for (w, h) in dims if h)
    checks.append((
        "proporzioni artwork = cella (nessuna distorsione)",
        worst <= 0.5,
        f"scarto peggiore {worst:+.2f}%",
    ))
    # 3. stesso numero di pagine del riferimento (se noto)
    ref_pages = len(page_pdf(ref_path))
    checks.append(("pagine come il riferimento", len(pages) == ref_pages, f"{len(pages)} vs {ref_pages}"))
    # 4. risoluzione: classe migliore >= 1200 DPI in almeno una classe
    best_dpi = max(w / cell_w * 25.4 for (w, h) in dims)
    checks.append(("classe immagine a >=1200 DPI presente", best_dpi >= 1195, f"{best_dpi:.0f} DPI"))

    print("\n--- ESITO ---")
    ok = True
    for name, passed, detail in checks:
        print(f"  [{'OK ' if passed else 'FAIL'}] {name}: {detail}")
        ok = ok and passed
    print("\nVERDETTO:", "GEOMETRIA CORRETTA" if ok else "DA CORREGGERE")
    return ok


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    sys.exit(0 if verdict(sys.argv[1], sys.argv[2]) else 1)
