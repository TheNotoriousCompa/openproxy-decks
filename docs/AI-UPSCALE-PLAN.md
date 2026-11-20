# Piano upscale AI reale

Stato: 2026-09-27. Solo pianificazione: nessun codice AI ancora integrato.
Default attuale: Lanczos3 CPU (`upscaleMode: auto`). Proxxied.com offre
upscaling AI (a pagamento): per la parità serve un'opzione AI locale.

## 1. Hardware rilevato (sviluppo) e target utenti

- Sviluppo: **AMD RX 6750 XT 12 GB** (RDNA2, Vulkan 1.3, driver 32.0.21045),
  Ryzen 5 3600 6C, Windows. Niente CUDA → soluzioni CUDA-only escluse.
- Utenti attesi: GPU miste (NVIDIA/AMD/Intel), iGPU, alcuni solo CPU.
  Requisito: **un backend che gira ovunque (Vulkan) + fallback CPU Lanczos**.

## 2. Opzioni valutate

| # | Via | Pro | Contro | Verdetto |
|---|-----|-----|--------|----------|
| A | **realesrgan-ncnn-vulkan** sidecar (exe, MIT) | Vulkan su AMD/NVIDIA/Intel; binari Windows pronti; tile-size per VRAM; modelli x4plus/anime/v3; zero dipendenze Rust | processo esterno da gestire (spawn, progress via parse output, cancel); ~10 MB + modelli | **RACCOMANDATA** |
| B | ONNX Runtime DirectML in-process | integrato, no processi esterni; su AMD via DirectML | reintrodurre ORT (rimosso il 12/09 per peso); serve conversione modelli → ONNX; DirectML più lento di ncnn/Vulkan su AMD | alternativa Windows-only |
| C | ORT CUDA / TensorRT | velocissimo su NVIDIA | inutile su AMD/Intel/iGPU; esclude lo sviluppatore stesso | scartata |
| D | CPU (ORT/Lanczos) | gira ovunque | minuti per carta a 1200 DPI (misurato: 1340 s per 84 asset in debug CPU) | resta come fallback |
| E | API cloud | zero integrazione | contro il principio local-first + costi/privacy | scartata |

Modelli (download on demand in `models/`, mai bundlati, verifica hash):
- `realesrgan-x4plus` — default (arte varia/foto)
- `realesrgan-x4plus-anime` — opzione (molte art MtG sono illustrative/anime)
- `realesr-general-x4v3` — qualità max (più lento)
- Licenze: exe MIT; **verificare i termini di ogni peso prima di
  distribuirne il download automatico** (uso personale playtest: ok).

## 3. Integrazione prevista (Rust)

- Nuovo `upscale_mode: "ai"` (+ `auto` = prova AI, fallback Lanczos senza errori);
  comando `upscale_status` riporta `ai_available`, modello, backend (vulkan/cpu).
- `upscale/ai.rs`: trait dietro feature o modulo sempre compilato che fa spawn
  del sidecar (`-i tmp -o tmp -n <modello> -s 4 -t auto -g auto`), con timeout,
  cancel via job, retry una volta, fallback Lanczos.
- Chiave cache: includere `model=<id>` (mai riusare Lanczos come fosse AI).
- VRAM guard: se GPU integrata o tiling fallito → `-t 200`; se fallisce tutto →
  Lanczos + flag `upscaled_ai: 0, upscaled: N` nel report (onesto).
- UI: selettore modello (x4plus/anime/v3), stato download modello con MB,
  stima tempi; default `ai` solo se sidecar+modello presenti, altrimenti `auto`.

## 4. Fasi

1. **Benchmark manuale**: scaricare exe+modelli, misurare 3 fixture
   (Scryfall 745px→3000px, MPC 2187px, token) su 6750 XT: tempi, VRAM, qualità
   visiva vs Lanczos. GO/NO-GO qui (criterio: <10 s/carta, niente artefatti).
2. Integrazione `upscale/ai.rs` + `decide` + cache-key + report.
3. UI (modello, download, stime) + test (mock sidecar) + fixture visive.
4. QA deck reale (Necron2) + doc utente.
5. (Opzionale, dopo) ORT DirectML come secondo backend Windows.

## 5. Rischi

Driver Vulkan vecchi (messaggio + link update se init fallisce); timeout su
CPU-only (mai AI di default lì); pesi ~60–70 MB a modello (download esplicito);
niente AI in preview/thumb (solo export, come oggi).
