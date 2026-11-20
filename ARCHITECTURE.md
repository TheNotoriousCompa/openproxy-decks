# ARCHITECTURE

## Principio

- **Frontend** (`src/`): esclusivamente UI, interazioni, deck builder, print builder,
  preview, stato app. Mai filesystem, mai processing pesante.
- **Backend** (`src-tauri/src/`): filesystem, SQLite, immagini, cache, processing,
  upscaling, job queue, PDF, export, memoria. Mai UI.

Unità canonica interna: **millimetri**. Conversioni in `src/lib/units.ts`
e `src-tauri/src/processing` (tenere allineate: stessi test su entrambi i lati).

## Backend Rust

```text
src-tauri/src/
  main.rs / lib.rs        # bootstrap Tauri, registrazione comandi
  commands/               # projects, assets, image, layout, upscale, pdf, export, jobs, settings
  database/               # SQLite (rusqlite bundled): SOLO metadata, mai blob
  storage/                # percorsi AppData/ProxyApp, hash SHA-256, validazione traversal
  image/                  # pipeline: analyze→crop→rotate/flip→requiredPx→upscale→resize→bleed→optimize→cache
  upscale/                # trait ImageUpscaler: CPU Lanczos3 sempre; ORT/Real-ESRGAN con feature ai-upscale
  processing/             # unità, DPI, quality report, layout engine
  pdf/                    # PDF 1.4 nativo: XObject deduplicati, guide vettoriali, misure pt precise
  export/                 # ZIP immagini, pack/unpack .proxyproject
  jobs/                   # coda sequenziale: progress/cancel via eventi Tauri
  cache/                  # 4 livelli su fs + indice SQLite, chiave hash completa, LRU
```

### Storage

```text
%APPDATA%/ProxyApp/            (dirs::data_dir, Windows-first)
  database.sqlite              (WAL, FK on)
  projects/PROJECT_ID/{manifest.json, assets/, processed/, exports/, cache/, artwork/}
  models/                      (.onnx scaricati manualmente, mai committati)
  cache/{processed/, final/, pdf-assets/}
  tmp/
```

Tabelle: `projects`, `cards`, `assets` (con `source_hash` per dedup), `cache_entries`, `kv_settings`.

### Provider

Interfaccia frontend `CardProvider`: `searchCards / getCardById / getCardPrintings /
getCardImages* / getAutocomplete / getSets*` (*estendibile).
Implementati: **Scryfall** (search, get by id, autocomplete, printings con paginazione)
+ **catalogo locale JSON** (fallback offline automatico). Debounce 350 ms,
AbortController via TanStack Query, cache 5 min, retry 2 con backoff,
timeout 12 s (8 s autocomplete, 15 s printings).

**Stampe community (stile MPC Autofill)**: provider separato `services/mpc.ts`
(implementazione originale sul contratto HTTP appreso da repo pubblico, nessun
codice copiato) — server **preconfigurato a `https://mpcfill.com` (verificato live)**,
modificabile nelle Settings. Contratto confermato con prove live:
`GET /2/searchEngineHealth/` → `{online}`, `GET /2/sources/` (279 drive),
`POST /2/editorSearch/` `{searchSettings, queries:[{cardType:"CARD",query}]}` con
`sources:[[pk,true]…]` → Drive-ID, `POST /2/cards/` → `{dpi, small/mediumThumbnailUrl,
downloadLink, sourceName}` (es. Command Tower: decine di render, 1210 DPI).
Vincoli reali: `cardType` maiuscolo (minuscolo → 422), sources valorizzate (vuote →
zero risultati), `/3/editorSearch/` 404 su mpcfill (v2 primaria, v3 fallback),
User-Agent browser (client minimali → 403). Full-res via `downloadLink` (303 →
drive.usercontent, seguito da reqwest). **Download Drive con UA browser-like**
(`download_remote_to_cache`): Drive blocca gli UA non browser con 403, e con
UA custom fallivano in blocco anteprime + export delle art MPC. Errori tipizzati
(`not-configured/unreachable/unhealthy/invalid`), mai stampe finte.

**CORS**: il `fetch` browser verso il server MPC è bloccato senza
`Access-Control-Allow-Origin` (`TypeError: Failed to fetch` anche a server sano).
L'app desktop instrada quindi tutte le chiamate MPC nel comando Rust `mpc_proxy`
(allowlist stretta anti-SSRF: solo `2/searchEngineHealth|sources|editorSearch`,
`3/editorSearch`, `2/cards`; solo GET/POST; timeout 25s; cap 15MB; UA browser).
Nel browser (dev) resta il fetch diretto.

### Pipeline di stampa (corretta)

```text
SOURCE → ANALYZE (DPI effettivi) → CROP (prima!) → ROTATE/FLIP
  → REQUIRED PX (target mm × DPI) → UPSCALE SE NECESSARIO → FINAL RESIZE HQ
  → BLEED (extend-edge) → OPTIMIZE (JPEG q-profile / PNG) → CACHE → EMBED
```

Sorgenti accettate da `export_pdf`: path locali, URL `asset://` (convertFileSrc),
remoti http(s) (scaricati in cache via backend). `blob:`/`data:` e file mancanti
→ copie **saltate e conteggiate** (`skipped/skipped_names`), mai silenziose.
Destinazione: sempre path assoluto (relativi risolti contro `exports/` del progetto).

Regole upscale (solo CPU Lanczos3 HQ): **auto (default)** = se aumento
significativo (>1.25×); off = mai ingrandire oltre i DPI nativi; always = se
scala>1. Mai embeddare x4 se la stampa richiede meno pixel (downsample finale HQ).

**Quando parte l'upscale**: SOLO in `export_pdf`, per asset unico, guidato da
`upscale_mode` (default auto). Preview/thumb/picker NON upscalano mai
(solo resize/downsample o byte originali). Il report export riporta `upscaled`.
PNG con alpha appiattiti su bianco prima del JPEG (angoli arrotondati dei
render MPC non rompono più l'encode).

### PDF engine

Writer PDF 1.4 minimale e corretto, senza rasterizzare pagine intere:

- `1 mm = 72/25.4 pt`, `MediaBox` precise, immagini via `cm … Do`.
- **Dedup**: `sourceHash → 1 XObject`; N copie = N placement (byte condivisi
  via `Rc`, niente cloni per copia).
- **Per zona**: come l'anteprima (stesso `ZONE_ORDER`, stesse interruzioni
  pagina) — anteprima e PDF coincidono sempre.
- Guide (crop/corner/cut) come operatori vettoriali `m/l/S`.
- Processing **pagina per pagina**, un asset unico processato una sola volta,
  memoria temporanea liberata tra asset (job queue + eventi `job://progress/done`).
- Scrittura **incrementale su file** (`build_pdf_to_file`): mai l'intero PDF
  in RAM, anche per deck da centinaia di MB.
- Compressione smart: JPEG q60 minimum / q85 balanced / q92 high / q96 maximum (default);
  mai q100 automatico; PNG per alpha/testo.

### Cache

Chiave = `sha256(source_hash | targetPx | dpi | quality | bleed | crop | rotation |
model | version | settings)`. Livelli: source / processed / final / pdf-asset.
`enforce_budget` LRU per budget MB. Preview = low-res veloce; export = full quality:
la preview non determina mai la qualità dell'export.

### Upscale (solo CPU)

Niente dipendenze ML: `upscale/` fa solo Lanczos3 HQ con policy per mode
(off/ask/auto/always, default auto). Rimosso il 2026-09-12: runtime ONNX,
feature `ai-upscale`, hash modelli, sessioni ORT. Rimosso il 2026-09-22 anche
il crate `printpdf` (mai usato: il writer è quello nativo in `pdf/`).

## Frontend

```text
src/
  App.tsx (+ TopBar, pannelli ridimensionabili persistiti in localStorage)
  features/{projects, deck(via components), print, settings, import(via LeftPanel)}
  components/{TopBar, LeftPanel, DeckGrid, RightPanel, QualityBadge, PrintPicker}
  stores/{projects, deck(undo/redo 100 snap), print, ui, settings(+mpcServerUrl)} (zustand)
  services/{backend(invoke+fallback browser), providers, mpc, artwork, images(convertFileSrc), queryClient}

**Display artwork ( Mai più nero muto )**: le anteprime NON dipendono dalla rete
della WebView né dallo scope `asset://` (che richiede allowlist esplicita in
`tauri.conf.json` → `app.security.assetProtocol`, altrimenti la vista rifiuta il
load). `thumb_for` scarica/valida/cache; `thumb_data_url` lo espone come
`data:` URL (rendering garantito, ~60KB per thumb); fallback remoto diretto e
badge diagnostico cliccabile (`artwork_status`: local/missing/corrupt/remote/session).
  lib/{units, layout, quality, decklist, schemas(zod)}
  workers/decklist.worker.ts
```

Accessibilità: landmarks, aria-label/pressed/live, focus visibile, shortcut,
ogni azione DnD replicabile via bottoni/select/tastiera.

## Limiti noti

- Export PDF/download artwork/analisi reale file richiedono l'app desktop
  (nel browser: fallback locale, URL remoti e `blob:` di sessione).
- ICNS macOS non generata (solo ICO/PNG; target primario Windows).
- ORT compila solo con `--features ai-upscale` + modello scaricato a mano.
- Tab MPC: richiede un server compatibile configurato; senza, resta disabilitata
  con guida (nessun dato dimostrativo).
