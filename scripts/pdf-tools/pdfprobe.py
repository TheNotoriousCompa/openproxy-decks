import re, sys, zlib

def collect_xref(f, size):
    """Raccoglie tutte le sezioni xref seguendo /Prev + oggetti in object-stream."""
    f.seek(max(0, size - 131072))
    tail = f.read()
    m = re.findall(rb'startxref\s*(\d+)', tail)
    if not m:
        raise SystemExit('startxref non trovato')
    table = {}
    ostreams = {}  # objnum -> (container, index)
    root = None
    seen = set()
    pos = int(m[-1])
    while pos and pos not in seen:
        seen.add(pos)
        f.seek(pos)
        head = f.read(16)
        if head.startswith(b'xref'):
            f.seek(pos)
            data = b''
            while b'trailer' not in data[-64:]:
                b = f.read(65536)
                if not b:
                    break
                data += b
            raw = data[:data.index(b'trailer')]
            for first, count, rows in re.findall(rb'(\d+) (\d+)\s*\n((?:\d{10} \d{5} [fn] ?\n?)+)', raw):
                first = int(first)
                for i, row in enumerate(re.findall(rb'(\d{10}) (\d{5}) ([fn])', rows)):
                    if row[2] == b'n':
                        table[(first + i, int(row[1]))] = int(row[0])
            tr = data[data.index(b'trailer'):data.index(b'trailer') + 4096]
            rm = re.search(rb'/Root\s+(\d+)', tr)
            if rm and root is None:
                root = int(rm.group(1))
            pm = re.search(rb'/Prev\s+(\d+)', tr)
            pos = int(pm.group(1)) if pm else 0
        else:
            f.seek(pos)
            buf = f.read(262144)
            hm = re.search(rb'(\d+)\s+(\d+)\s+obj\s*<<(.*?)>>\s*stream\r?\n', buf, re.S)
            if not hm:
                raise SystemExit('xref stream non riconosciuto')
            d = hm.group(3)
            rm = re.search(rb'/Root\s+(\d+)', d)
            if rm and root is None:
                root = int(rm.group(1))
            w = [int(x) for x in re.search(rb'/W\s*\[([^\]]+)\]', d).group(1).split()]
            idx = re.search(rb'/Index\s*\[([^\]]+)\]', d)
            pairs = [int(x) for x in idx.group(1).split()] if idx else [0, int(re.search(rb'/Size\s+(\d+)', d).group(1))]
            pm = re.search(rb'/Prev\s+(\d+)', d)
            pos = int(pm.group(1)) if pm else 0
            data_start = f.tell() - len(buf) + buf.index(hm.group(0)) + len(hm.group(0))
            f.seek(data_start)
            raw = b''
            while b'endstream' not in raw[-16:]:
                b = f.read(65536)
                if not b:
                    break
                raw += b
            raw = raw[:raw.index(b'endstream')].rstrip(b'\r\n')
            if b'FlateDecode' in d:
                raw = zlib.decompress(raw)
            stride = sum(w)
            p = 0
            for i in range(0, len(pairs), 2):
                objnum = pairs[i]; count = pairs[i + 1]
                for _ in range(count):
                    e = raw[p:p + stride]; p += stride
                    typ = int.from_bytes(e[0:w[0]], 'big') if w[0] else 1
                    f2 = int.from_bytes(e[w[0]:w[0] + w[1]], 'big') if w[1] else 0
                    f3 = int.from_bytes(e[w[0] + w[1]:w[0] + w[1] + w[2]], 'big') if w[2] else 0
                    if typ == 1:
                        table.setdefault((objnum, f3), f2)
                    elif typ == 2:
                        ostreams.setdefault(objnum, (f2, f3))
                    objnum += 1
    return table, ostreams, root


def read_xref(f, size):
    table, _, _ = collect_xref(f, size)
    return table
    f.seek(max(0, size - 131072))
    tail = f.read()
    m = re.findall(rb'startxref\s*(\d+)', tail)
    if not m:
        raise SystemExit('startxref non trovato (xref compresso?)')
    xref_pos = int(m[-1])
    f.seek(xref_pos)
    head = f.read(64)
    table = {}
    if head.startswith(b'xref'):
        # tabella classica
        data = head
        # leggi a blocchi finche' non trovi trailer
        chunks = [data]
        while b'trailer' not in chunks[-1][-32:]:
            b = f.read(65536)
            if not b:
                break
            chunks.append(b)
        raw = b''.join(chunks)
        raw = raw[:raw.index(b'trailer')]
        # sottosezioni: "prima count" poi righe
        tokens = re.findall(rb'(\d+) (\d+)\s*\n((?:\d{10} \d{5} [fn] ?\n?)+)', raw)
        for first, count, rows in tokens:
            first = int(first)
            for i, row in enumerate(re.findall(rb'(\d{10}) (\d{5}) ([fn])', rows)):
                off, gen, typ = row
                if typ == b'n':
                    table[(first + i, int(gen))] = int(off)
    else:
        # xref stream compresso: N G obj << /Type/XRef /Size /Root /W /Index /Filter? >> stream ... endstream
        f.seek(xref_pos)
        buf = f.read(262144)
        hm = re.search(rb'(\d+)\s+(\d+)\s+obj\s*<<(.*?)>>\s*stream\r?\n', buf, re.S)
        if not hm:
            raise SystemExit('xref stream non riconosciuto')
        d = hm.group(3)
        w = [int(x) for x in re.search(rb'/W\s*\[([^\]]+)\]', d).group(1).split()]
        idx = re.search(rb'/Index\s*\[([^\]]+)\]', d)
        pairs = [int(x) for x in idx.group(1).split()] if idx else [0, int(re.search(rb'/Size\s+(\d+)', d).group(1))]
        # ricalcola: inizio dati = fine del match header
        data_start = xref_pos + buf.index(hm.group(0)) + len(hm.group(0))
        # lunghezza: leggi fino a endstream (a chunk, gli xref sono piccoli)
        f.seek(data_start)
        raw = b''
        while b'endstream' not in raw[-16:]:
            b = f.read(65536)
            if not b:
                break
            raw += b
            if len(raw) > 50_000_000:
                break
        raw = raw[:raw.index(b'endstream')].rstrip(b'\r\n')
        if b'FlateDecode' in d:
            raw = zlib.decompress(raw)
        # entries: per oggetto w[0]+w[1]+w[2] byte; tipo = primo campo
        stride = sum(w)
        table = {}
        objnum = None
        pos = 0
        for i in range(0, len(pairs), 2):
            objnum = pairs[i]; count = pairs[i + 1]
            for _ in range(count):
                e = raw[pos:pos + stride]; pos += stride
                typ = int.from_bytes(e[0:w[0]], 'big') if w[0] else 1
                f2 = int.from_bytes(e[w[0]:w[0] + w[1]], 'big') if w[1] else 0
                f3 = int.from_bytes(e[w[0] + w[1]:w[0] + w[1] + w[2]], 'big') if w[2] else 0
                if typ == 1:
                    table[(objnum, f3)] = f2
                # tipo 2 = in object stream (ignora: proxxied comprime solo xref?)
                # tipo 0 = libero
                objnum += 1
        # catena Prev ignorata (basta l'ultima sezione per gli oggetti recenti)
        return table
    return table

OSTREAMS = {}

def get_ostream_obj(f, table, container, index):
    off = table.get((container, 0))
    if off is None:
        for (n, g), o in table.items():
            if n == container:
                off = o
                break
    f.seek(off)
    buf = f.read(1048576)
    hm = re.search(rb'<<(.*?)>>\s*stream\r?\n', buf, re.S)
    d = hm.group(1)
    n = int(re.search(rb'/N\s+(\d+)', d).group(1))
    first = int(re.search(rb'/First\s+(\d+)', d).group(1))
    start = buf.index(hm.group(0)) + len(hm.group(0))
    end = buf.index(b'endstream', start)
    data = buf[start:end].rstrip(b'\r\n')
    if b'FlateDecode' in d:
        import zlib as _z
        data = _z.decompress(data)
    # header: N coppie (objnum offset) nei primi First byte
    nums = re.findall(rb'(\d+)\s+(\d+)', data[:first])
    if len(nums) < n:
        print(f'  DEBUG ostream: N={n} First={first} trovate {len(nums)} coppie, header={buf[start:start+first][:120]!r}')
        print(f'  DEBUG dict={d!r}')
    pairs = [(int(a), int(b)) for a, b in nums[:n]]
    base = first
    i = pairs[index][1]
    j = pairs[index + 1][1] if index + 1 < len(pairs) else len(data) - base
    return data[base + i:base + j]

def get_obj(f, table, num, gen=0):
    if num in OSTREAMS:
        cont, idx = OSTREAMS[num]
        return get_ostream_obj(f, table, cont, idx)
    off = table.get((num, gen))
    if off is None:
        # prova gen qualsiasi
        for (n, g), o in table.items():
            if n == num:
                off = o
                break
    f.seek(off)
    buf = b''
    # leggi fino a endobj (gli stream immagine sono separati: leggi header finche' stream/endstream)
    depth = 0
    while True:
        chunk = f.read(65536)
        if not chunk:
            break
        buf += chunk
        if b'endobj' in buf:
            buf = buf[:buf.index(b'endobj')]
            break
        if len(buf) > 2_000_000:
            buf = buf[:2_000_000]
            break
    return buf

def main(path, max_pages=1):
    f = open(path, 'rb')
    import os
    size = os.path.getsize(path)
    table = read_xref(f, size)
    global OSTREAMS
    _, OSTREAMS, ROOT = collect_xref(f, size)
    print(f'== {path} ({size/1e6:.0f} MB)')
    print(f'oggetti in xref: {len(table)} (+{len(OSTREAMS)} in object-stream) root={ROOT}')
    # catalogo -> /Pages (mai assumere l'oggetto 1: puo' essere il nodo Pages)
    cat = get_obj(f, table, ROOT or 1)
    m = re.search(rb'/Pages\s*(\d+)', cat)
    if not m:
        # ROOT era gia' il nodo Pages
        pages = cat
    else:
        pages = get_obj(f, table, int(m.group(1)))
    kids = re.findall(rb'(\d+)\s+\d+\s+R', pages.split(b'/Kids')[1].split(b']')[0])
    print(f'pagine dichiarate: {len(kids)}')
    for pnum in kids[:max_pages]:
        pg = get_obj(f, table, int(pnum))
        for box in [b'MediaBox', b'CropBox', b'TrimBox', b'BleedBox', b'ArtBox']:
            mm = re.search(box + rb'\s*\[([^\]]+)\]', pg)
            if mm:
                vals = [float(x) for x in mm.group(1).split()]
                mmv = [v * 25.4 / 72 for v in vals]
                print(f'  {box.decode()}: pt {vals}  = mm {[round(v,3) for v in mmv]}')
        # contents
        cm = re.search(rb'/Contents\s*(\d+)\s+\d+\s+R', pg)
        if not cm:
            cm = re.search(rb'/Contents\s*\[([^\]]+)\]', pg)
            refs = [int(x) for x in re.findall(rb'(\d+)\s+\d+\s+R', cm.group(1))] if cm else []
        else:
            refs = [int(cm.group(1))]
        # resources -> xobject
        rm = re.search(rb'/Resources\s*(\d+)\s+\d+\s+R', pg)
        xobjs = {}
        if rm:
            res = get_obj(f, table, int(rm.group(1)))
            xo = re.search(rb'/XObject\s*<<(.+?)>>', res, re.S)
            if xo:
                for nm, onum in re.findall(rb'/(\S+)\s+(\d+)\s+\d+\s+R', xo.group(1)):
                    xobjs[nm.decode()] = int(onum)
        print(f'  contents refs: {refs}  xobjects: {len(xobjs)}')
        for r in refs:
            raw = get_obj(f, table, r)
            # header dict
            hdr = raw.split(b'stream')[0]
            flt = b'FlateDecode' in hdr
            data = raw.split(b'stream', 1)[1].lstrip(b'\r\n') if b'stream' in raw else b''
            # rimuovi endstream finale se presente nel buffer
            if data.endswith(b'endstream'):
                data = data[:-9].rstrip(b'\r\n')
            if flt:
                try:
                    data += b''  # chunk potrebbe essere troncato
                    txt = zlib.decompress(data)
                except Exception as e:
                    print(f'  stream {r}: decompressione fallita ({e}), len={len(data)}')
                    continue
            else:
                txt = data
            print(f'  stream {r}: {len(txt)} byte testo')
            t = txt.decode('latin1')
            # piazzamenti immagini: a b c d e f cm /Nome Do
            for a, b, c, d, e, g, nm in re.findall(
                r'([\d\.\-]+)\s+([\d\.\-]+)\s+([\d\.\-]+)\s+([\d\.\-]+)\s+([\d\.\-]+)\s+([\d\.\-]+)\s+cm\s*/(\S+)\s+Do', t):
                wmm = float(a) * 25.4 / 72
                hmm = float(d) * 25.4 / 72
                xmm = float(e) * 25.4 / 72
                # y dal basso -> y_top
                print(f'    IMG /{nm}: x={xmm:.3f}mm y_basso={float(g)*25.4/72:.3f}mm w={wmm:.3f}mm h={hmm:.3f}mm')
            # stili linea
            for col in set(re.findall(r'([\d\.]+ [\d\.]+ [\d\.]+) RG', t)):
                print(f'    colore RG: {col}')
            for w in set(re.findall(r'([\d\.]+) w\b', t)):
                print(f'    spessore: {w} pt')
            # segmenti: contiamo m/l/S
            nm_ = len(re.findall(r'\bm\b', t)); nl = len(re.findall(r'\bl\b', t)); ns = len(re.findall(r'\bS\b', t))
            print(f'    path ops: m={nm_} l={nl} S={ns}')
            # mostra prime righe con m/l per capire le forme
            lines = [ln.strip() for ln in t.split('\n') if re.search(r'\bm\b|\bl\b', ln)]
            print(f'    primi segmenti:')
            for ln in lines[:12]:
                print(f'      {ln}')
        # dimensioni immagini uniche (prime 3)
        for nm, onum in list(xobjs.items())[:3]:
            d = get_obj(f, table, onum).split(b'stream')[0].decode('latin1')
            w = re.search(r'/Width\s+(\d+)', d); h = re.search(r'/Height\s+(\d+)', d)
            cs = re.search(r'/ColorSpace\s*/(\w+)', d); fl = re.search(r'/Filter\s*/(\w+)', d)
            print(f'    XObj /{nm}: {w.group(1) if w else "?"}x{h.group(1) if h else "?"}px {cs.group(1) if cs else "?"} {fl.group(1) if fl else "?"}')
    f.close()

main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 1)
