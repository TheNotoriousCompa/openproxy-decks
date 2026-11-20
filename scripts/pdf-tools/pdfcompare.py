"""Confronto geometrico tra due PDF: pagine, piazzamenti immagini, DPI effettivi, guide."""
import io, os, re, sys, zlib

sys.setrecursionlimit(10000)
src = io.open('C:/Users/win7/pdfprobe.py', encoding='utf-8').read().split('main(sys.argv')[0]
ns = {}
exec(compile(src, 'pp', 'exec'), ns)

PT_MM = 25.4 / 72


def load(path):
    f = open(path, 'rb')
    size = os.path.getsize(path)
    table, ost, root = ns['collect_xref'](f, size)
    ns_ost = ost
    return f, size, table, ns_ost, root


def obj(f, table, ost, num):
    ns['OSTREAMS'] = ost
    return ns['get_obj'](f, table, num)


def pages_of(f, table, ost, root):
    cat = obj(f, table, ost, root)
    m = re.search(rb'/Pages\s+(\d+)', cat)
    pages = obj(f, table, ost, int(m.group(1))) if m else cat
    kids = re.findall(rb'(\d+)\s+\d+\s+R', pages.split(b'/Kids')[1].split(b']')[0])
    return [int(k) for k in kids]


def analyze(path, max_pages=2):
    f, size, table, ost, root = load(path)
    print(f"\n=== {os.path.basename(path)} — {size/1e6:.0f} MB")
    kids = pages_of(f, table, ost, root)
    print(f"pagine: {len(kids)}")
    for pno in kids[:max_pages]:
        pg = obj(f, table, ost, pno)
        mb = re.search(rb'/MediaBox\s*\[([^\]]+)\]', pg)
        box = [float(x) * PT_MM for x in mb.group(1).split()] if mb else None
        if box:
            print(f"  pagina {pno}: MediaBox {box[2]:.2f} x {box[3]:.2f} mm")
        # resources XObject -> dims
        res = re.search(rb'/XObject\s*<<(.+?)>>', pg, re.S)
        xobjs = {}
        if res:
            for nm, num in re.findall(rb'/(\S+)\s+(\d+)\s+\d+\s+R', res.group(1)):
                d = obj(f, table, ost, int(num)).split(b'stream')[0].decode('latin1')
                w = re.search(r'/Width\s+(\d+)', d)
                h = re.search(r'/Height\s+(\d+)', d)
                xobjs[nm.decode()] = (int(w.group(1)) if w else 0, int(h.group(1)) if h else 0)
        # content stream
        cm = re.search(rb'/Contents\s+(\d+)\s+\d+\s+R', pg) or re.search(rb'/Contents\s*\[\s*(\d+)', pg)
        if not cm:
            print('  (contents non trovato)')
            continue
        raw = obj(f, table, ost, int(cm.group(1)))
        data = raw.split(b'stream', 1)[1].lstrip(b'\r\n')
        data = data[:data.index(b'endstream')].rstrip(b'\r\n')
        if b'FlateDecode' in raw.split(b'stream')[0]:
            data = zlib.decompress(data)
        t = data.decode('latin1')
        img_ops = re.findall(
            r'([\d\.\-]+)\s+([\d\.\-]+)\s+([\d\.\-]+)\s+([\d\.\-]+)\s+([\d\.\-]+)\s+([\d\.\-]+)\s+cm\s*/(\S+)\s+Do', t)
        # il primo cm è la posizione (1 0 0 1 x y), il secondo la scala (w 0 0 h 0 0)
        placements = []
        for m in re.finditer(
            r'1 0 0 1 ([\d\.\-]+) ([\d\.\-]+) cm\s*1 0 0 1 0 0 cm\s*([\d\.\-]+) 0 0 ([\d\.\-]+) 0 0 cm\s*1 0 0 1 0 0 cm\s*/(\S+) Do', t):
            x, y, w, h = (float(m.group(i)) * PT_MM for i in (1, 2, 3, 4))
            placements.append((x, y, w, h, m.group(5)))
        if not placements:
            # formato compatto (q w 0 0 h x y cm /N Do Q)
            for m in re.finditer(r'q ([\d\.\-]+) 0 0 ([\d\.\-]+) ([\d\.\-]+) ([\d\.\-]+) cm /(\S+) Do Q', t):
                w, h, x, y, nm = float(m.group(1)) * PT_MM, float(m.group(2)) * PT_MM, float(m.group(3)) * PT_MM, float(m.group(4)) * PT_MM, m.group(5)
                placements.append((x, y, w, h, nm))
        print(f"  immagini: {len(placements)}")
        if placements:
            from collections import Counter
            common = Counter((round(p[2], 2), round(p[3], 2)) for p in placements)
            (mw, mh), count = common.most_common(1)[0]
            cards = [p for p in placements if (round(p[2], 2), round(p[3], 2)) == (mw, mh)]
            if len(cards) != len(placements):
                print(f"    (ignorati {len(placements) - len(cards)} piazzamenti non-carta: watermark/loghi)")
            placements = cards
            ws = sorted({round(p[2], 3) for p in placements})
            hs = sorted({round(p[3], 3) for p in placements})
            print(f"    larghezze mm: {ws}")
            print(f"    altezze mm:   {hs}")
            xs = sorted({round(p[0], 2) for p in placements})
            ys = sorted({round(p[1], 2) for p in placements})
            print(f"    x mm: {xs[:5]}")
            print(f"    y mm: {ys[:5]}")
            # pitch
            if len(xs) > 1:
                diffs = [round(xs[i + 1] - xs[i], 3) for i in range(min(3, len(xs) - 1))]
                print(f"    passo colonne mm: {diffs}")
            if len(ys) > 1:
                diffs = [round(ys[i + 1] - ys[i], 3) for i in range(min(3, len(ys) - 1))]
                print(f"    passo righe mm: {diffs}")
            # DPI effettivi
            p0 = placements[0]
            dims = xobjs.get(p0[4])
            if dims and dims[0]:
                print(f"    prima img: {dims[0]}x{dims[1]}px in {p0[2]:.2f}x{p0[3]:.2f}mm -> {dims[0]/(p0[2]/25.4):.0f} x {dims[1]/(p0[3]/25.4):.0f} DPI")
            used = {p[4] for p in placements}
            dims_used = sorted({xobjs[n] for n in used if n in xobjs})
            from collections import Counter as C2
            hist = C2(dims_used)
            print(f"    dimensioni XObject usate: {dict(hist)}")
        # guide: colori e geometria
        cols = sorted(set(re.findall(r'([\d\.]+ [\d\.]+ [\d\.]+) RG', t)))
        print(f"    colori RG: {cols}")
        ws_pt = sorted(set(re.findall(r'([\d\.]+) w\b', t)))
        print(f"    spessori: {ws_pt}")
        n_re = len(re.findall(r'\bre S\b', t))
        n_line = len(re.findall(r'\bl S\b', t))
        print(f"    tratti: rettangoli {n_re} · segmenti {n_line}")
        if n_line:
            segs = re.findall(r'([\d\.\-]+) ([\d\.\-]+) m ([\d\.\-]+) ([\d\.\-]+) l S', t)
            sample = [(round(float(a) * PT_MM, 2), round(float(b) * PT_MM, 2)) for a, b, _, _ in segs[:4]]
            print(f"    primi segmenti (mm, x/y o inizio): {sample}")
    f.close()


analyze('C:/Users/win7/Desktop/Proxy MTG/Carte Proxy/proxxied-eldrai_1200dpi_2026-09-11_fronts.pdf', 2)
analyze('C:/Users/win7/AppData/Roaming/ProxyApp/projects/9e348dd5-b252-465e-8bf4-368ff3acfc6c/exports/print-1789816501261.pdf', 2)
