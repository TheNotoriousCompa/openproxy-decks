"""Estrae le immagini di una pagina PDF in file JPEG, ordinate come nella griglia.
Uso: python dump-page-images.py <pdf> <pagina 1-based> <cartella output> <prefisso> [max]

Legge lo stream per lunghezza dichiarata (/Length), quindi funziona anche con
JPEG da vari MB senza leggere tutto l'oggetto in memoria.
"""
import io, os, re, sys, zlib

PT_MM = 25.4 / 72
probe_src = io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pdfprobe.py"), encoding="utf-8").read().split("main(sys.argv")[0]
NS = {}
exec(compile(probe_src, "pdfprobe", "exec"), NS)


def raw_stream(f, table, num):
    """Byte esatti dello stream dell'oggetto `num`: usa /Length, con fallback
    agli oggetti dentro object-stream (che non hanno offset nello xref)."""
    off = table.get((num, 0))
    if off is None:
        for (n, _g), o in table.items():
            if n == num:
                off = o
                break
    if off is None:
        return _slice_stream(NS["get_obj"](f, table, num))
    f.seek(off)
    head = f.read(8192)
    m = re.search(rb"stream\r?\n", head)
    if not m:
        return _slice_stream(NS["get_obj"](f, table, num))
    lm = re.search(rb"/Length\s+(\d+)", head[: m.start()])
    if lm:
        f.seek(off + m.end())
        return f.read(int(lm.group(1)))
    # /Length indiretto: leggi fino a endstream
    f.seek(off + m.end())
    buf = b""
    while b"endstream" not in buf[-16:]:
        chunk = f.read(65536)
        if not chunk:
            break
        buf += chunk
    return buf[: buf.index(b"endstream")].rstrip(b"\r\n")


def _slice_stream(raw):
    """Contenuto di uno stream già letto come oggetto (per oggetti piccoli)."""
    if b"stream" not in raw:
        return b""
    data = raw.split(b"stream", 1)[1].lstrip(b"\r\n")
    if b"endstream" in data:
        data = data[: data.index(b"endstream")].rstrip(b"\r\n")
    return data


def main(path, page_no, out_dir, prefix, max_imgs=12):
    f = open(path, "rb")
    size = os.path.getsize(path)
    table, ost, root = NS["collect_xref"](f, size)
    NS["OSTREAMS"] = ost
    cat = NS["get_obj"](f, table, root)
    m = re.search(rb"/Pages\s+(\d+)", cat)
    pages = NS["get_obj"](f, table, int(m.group(1))) if m else cat
    kids = [int(k) for k in re.findall(rb"(\d+)\s+\d+\s+R", pages.split(b"/Kids")[1].split(b"]")[0])]
    pg = NS["get_obj"](f, table, kids[page_no - 1])
    xobjs = {}
    res = re.search(rb"/XObject\s*<<(.+?)>>", pg, re.S)
    for nm, num in re.findall(rb"/(\S+)\s+(\d+)\s+\d+\s+R", res.group(1)):
        xobjs[nm.decode()] = int(num)
    cm = re.search(rb"/Contents\s+(\d+)\s+\d+\s+R", pg) or re.search(rb"/Contents\s*\[\s*(\d+)", pg)
    contents = raw_stream(f, table, int(cm.group(1)))
    if b"FlateDecode" in NS["get_obj"](f, table, int(cm.group(1))).split(b"stream")[0]:
        contents = zlib.decompress(contents)
    t = contents.decode("latin1")
    placements = []
    for mm in re.finditer(
        r"1 0 0 1 ([\d\.\-]+) ([\d\.\-]+) cm\s*1 0 0 1 0 0 cm\s*([\d\.\-]+) 0 0 ([\d\.\-]+) 0 0 cm\s*(?:1 0 0 1 0 0 cm\s*)?/(\S+) Do", t
    ):
        x, y, w, h = (float(mm.group(i)) * PT_MM for i in (1, 2, 3, 4))
        placements.append((round(y, 1), round(x, 1), round(w, 1), round(h, 1), mm.group(5)))
    for mm in re.finditer(r"q ([\d\.\-]+) 0 0 ([\d\.\-]+) ([\d\.\-]+) ([\d\.\-]+) cm /(\S+) Do Q", t):
        w, h, x, y = (float(mm.group(i)) * PT_MM for i in (1, 2, 3, 4))
        placements.append((round(y, 1), round(x, 1), round(w, 1), round(h, 1), mm.group(5)))
    from collections import Counter
    common = Counter((p[2], p[3]) for p in placements)
    (cw, ch), _ = common.most_common(1)[0]
    cards = [p for p in placements if (p[2], p[3]) == (cw, ch)]
    cards.sort(key=lambda p: (-p[0], p[1]))
    os.makedirs(out_dir, exist_ok=True)
    for i, (y, x, w, h, nm) in enumerate(cards[:max_imgs]):
        jpg = raw_stream(f, table, xobjs[nm])
        out = os.path.join(out_dir, f"{prefix}-cell{i:02d}.jpg")
        io.open(out, "wb").write(jpg)
        print(f"  {os.path.basename(out)}  cella {i} (y={y} x={x})  {len(jpg)/1e6:.1f}MB")
    f.close()


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4], int(sys.argv[5]) if len(sys.argv) > 5 else 12)
