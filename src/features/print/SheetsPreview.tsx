import { useEffect, useRef, useState, type RefObject } from "react";
import { ArtworkImage } from "@/components/ArtworkImage";
import { CellLoadingOverlay } from "@/components/PrintBusyToast";
import { CellStat, useCellQuality, type CellQuality } from "@/hooks/useCellQuality";
import { prefetchPrints } from "@/hooks/usePrints";
import { configuredServer } from "@/services/mpc";
import { useProjects } from "@/stores/projects";
import { useSettings } from "@/stores/settings";
import { cornerSegments, lineRect, pageLineEdges, type TrimRect } from "@/lib/guides";
import type { GuideShape } from "@/types";
import { ZONE_LABELS } from "@/types";
import type { PrintFlow, ZoneCopy } from "@/features/print/printModel";

/** Linee di taglio e di pagina: sempre nere (i segni d'angolo usano guideColor). */
const CUT_INK = "#000000";

/** mm per punto tipografico: i tratti della preview hanno la stessa larghezza del PDF. */
const MM_PER_PT = 25.4 / 72;

/**
 * Precarica le stampe di una carta (hover/focus cella) così l'apertura del
 * picker trova spesso i dati già in cache. Usa gli stessi default del picker
 * (preset MPC se configurato). Mai throw, mai rete se già fresh.
 */
export function prefetchCellPrints(cardName: string): void {
  const name = cardName.trim();
  if (!name) return;
  const mpcServer = useSettings.getState().mpcServerUrl;
  prefetchPrints({
    source: configuredServer() ? "mpc" : "scryfall",
    submitted: name,
    mpcServer,
    // stessa lingua del picker: la cache deve coincidere con quello che vedrai
    lang: useSettings.getState().cardLang,
    tags: [],
    // stesse fonti escluse del picker (altrimenti la chiave di cache non combacia)
    exclude: useSettings.getState().excluded,
  });
}

interface SheetsPreviewProps {
  /** flusso continuo di stampa: copie in ordine di zona + un solo layout */
  flow: PrintFlow;
  sheetError: string | null;
  pageWmm: number;
  pageHmm: number;
  cardWmm: number;
  cardHmm: number;
  targetDpi: number;
  scale?: number;
  /** true = la pagina riempie la larghezza disponibile (tutte le pagine scrollabili sotto) */
  fitWidth?: boolean;
  guides: { crop: boolean; cut: boolean; page: boolean; /** legacy, ignorato */ corner?: boolean };
  /** bleed in mm: il taglio è sul formato carta, rientrato dal bordo cella */
  bleedMm?: number;
  /** colore segni d'angolo (linee di taglio e di pagina restano nere) */
  guideColor: string;
  guideWidthPt: number;
  guidePlacement: "outside" | "inside" | "center";
  guideLengthMm: number;
  guideShape: GuideShape;
  guideOffsetMm: number;
  guideStyle: "solid" | "dashed";
  guideCap: "square" | "round";
  /** dorso applicato alle carte senza retro (anteprima e PDF) */
  defaultBack?: string;
  /** voci in aggiornamento: spinner sopra la cella invece di un overlay a tutto schermo */
  pendingEntryIds?: string[];
  onPickCopy: (entryId: string) => void;
  /** opzionale: menu contestuale per cella (non usato nel flusso solo-stampa) */
  onContextMenuCopy?: (entryId: string, x: number, y: number) => void;
}

/** Misura il container e calcola la scala per riempire la larghezza (fallback = scale). */
function useFitScale(pageWmm: number, fallback: number, enabled: boolean): { ref: RefObject<HTMLDivElement>; scale: number } {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, pageWmm]);

  if (!enabled || width <= 0 || pageWmm <= 0) return { ref, scale: fallback };
  // -32px padding, clamp per non esplodere su schermi enormi
  const scale = Math.min(Math.max((width - 32) / pageWmm, 0.5), 4);
  return { ref, scale };
}

/** Fogli di stampa in flusso continuo, con chip di zona e conteggi per zona. */
export function SheetsPreview({
  flow,
  sheetError,
  pageWmm,
  pageHmm,
  cardWmm,
  cardHmm,
  targetDpi,
  scale = 2.2,
  fitWidth = false,
  guides,
  bleedMm = 0,
  guideColor,
  guideWidthPt,
  guidePlacement,
  guideLengthMm,
  guideShape,
  guideOffsetMm,
  guideStyle,
  guideCap,
  defaultBack,
  pendingEntryIds,
  onPickCopy,
  onContextMenuCopy,
}: SheetsPreviewProps): JSX.Element {
  const copies = flow.copies;
  const totalPages = flow.layout.pages;
  const allSources = copies.flatMap((c) => [c.imageFront, c.imageBack]);
  const quality = useCellQuality(allSources, cardWmm, cardHmm, targetDpi);
  const fit = useFitScale(pageWmm, scale, fitWidth);
  const [zoomMult, setZoomMult] = useState(1);
  // Lato anteprima: retro DFC (o dorso di default) visibile dal toggle
  const [showBack, setShowBack] = useState(false);
  const hasAnyBack = Boolean(defaultBack) || copies.some((c) => c.hasBack && c.imageBack);
  const effScale = fit.scale * zoomMult;
  const projectName = useProjects((s) => s.projects.find((p) => p.id === s.activeId)?.name ?? null);

  return (
    <div ref={fit.ref} className="p-3" aria-label="Anteprima fogli di stampa">
      {sheetError && <p className="text-sm text-red-400">{sheetError}</p>}
      {projectName && (
        <h2 className="mb-1 text-center text-sm font-bold uppercase tracking-widest text-orange-400" data-testid="sheet-project">
          {projectName}
        </h2>
      )}
      {!sheetError && copies.length === 0 && (
        <p className="text-sm text-neutral-500">Aggiungi carte al deck per vedere i fogli di stampa.</p>
      )}
      {!sheetError && copies.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="text-xs text-neutral-400" aria-live="polite">
            {totalPages} {totalPages === 1 ? "pagina" : "pagine"} · {copies.length} copie
          </p>
          {/* riepilogo per zona, come il breakdown del DeckBuilder: solo informativo */}
          <p className="text-xs text-neutral-400" data-testid="sheet-zone-breakdown">
            {flow.counts.map(({ zone, label, copies: n }) => (
              <span key={zone} className="mr-2">
                <b className="font-semibold text-neutral-100">{n}</b> {label}
              </span>
            ))}
          </p>
          <p className="text-[11px] text-neutral-500">
            {flow.layout.cols}×{flow.layout.rows} per pagina
          </p>
          {hasAnyBack && (
            <div className="panel-2 thin-border flex rounded" role="group" aria-label="Lato anteprima">
              {(["front", "back"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  onClick={() => setShowBack(side === "back")}
                  aria-pressed={showBack === (side === "back")}
                  className={`rounded px-2 py-0.5 text-[11px] ${showBack === (side === "back") ? "bg-neutral-200 font-semibold text-black" : "text-neutral-400"}`}
                >
                  {side === "front" ? "Fronte" : "Retro"}
                </button>
              ))}
            </div>
          )}
          <label className="ml-auto flex items-center gap-1 text-[11px] text-neutral-500">
            Zoom
            <input
              type="range" min={0.5} max={3} step={0.1} value={zoomMult}
              onChange={(e) => setZoomMult(Number(e.target.value))}
              aria-label="Zoom anteprima fogli"
              className="w-28"
            />
            <span className="w-9 text-right">{Math.round(effScale * 100)}%</span>
          </label>
        </div>
      )}
      <div className="space-y-5">
        {Array.from({ length: totalPages }, (_, p) => (
          <div key={p} className="mb-4">
            <PagePreview
              page={p}
              scale={effScale}
              pageWmm={pageWmm}
              pageHmm={pageHmm}
              placements={flow.layout.placements.filter((x) => x.page === p)}
              copies={copies}
              quality={quality}
              targetDpi={targetDpi}
              showBack={showBack}
              guides={guides}
              bleedMm={bleedMm}
              guideColor={guideColor}
              guideWidthPt={guideWidthPt}
              guidePlacement={guidePlacement}
              guideLengthMm={guideLengthMm}
              guideShape={guideShape}
              guideOffsetMm={guideOffsetMm}
              guideStyle={guideStyle}
              guideCap={guideCap}
              defaultBack={defaultBack}
              pendingEntryIds={pendingEntryIds}
              onPickCopy={onPickCopy}
              onContextMenuCopy={onContextMenuCopy}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Guide di taglio in anteprima, calcolate con le stesse formule del PDF
 * (`lineRect`, `cornerSegments`, `pageLineEdges`): quello che vedi e' quello
 * che esce stampato. Renderizzate a livello PAGINA e non dentro le celle,
 * che con overflow hidden taglierebbero i tratti.
 * - segni d'angolo: bracci di `lengthMm` su ogni angolo del trim, forma
 *   croce / dentro / fuori, colore a scelta
 * - riquadro carta: rettangolo sul trim di ogni carta (nero)
 * - linee di pagina: gli stessi bordi prolungati a tutta pagina (nero), per
 *   far scorrere la taglierina
 * `placement` + `offsetMm` spostano il tratto rispetto al bordo carta
 * (dentro / sul bordo / fuori, con scostamento fine in mm).
 */
function PageGuides({
  placements,
  scale,
  color,
  widthPt,
  placement,
  lengthMm,
  shape,
  offsetMm,
  style,
  cap,
  crop,
  cut,
  page,
  bleedMm,
}: {
  placements: { xMm: number; yMm: number; wMm: number; hMm: number; index: number }[];
  scale: number;
  color: string;
  widthPt: number;
  placement: "outside" | "inside" | "center";
  lengthMm: number;
  shape: GuideShape;
  offsetMm: number;
  style: "solid" | "dashed";
  cap: "square" | "round";
  crop: boolean;
  cut: boolean;
  page: boolean;
  bleedMm: number;
}): JSX.Element | null {
  if (!crop && !cut && !page) return null;
  const segs: JSX.Element[] = [];
  let k = 0;
  const tPx = Math.max(1, widthPt * MM_PER_PT * scale);
  const radius = cap === "round" ? 2 : 0;
  const brush = (horizontal: boolean): React.CSSProperties =>
    style === "dashed"
      ? {
          backgroundImage: horizontal
            ? `repeating-linear-gradient(to right, ${color} 0 4px, transparent 4px 7px)`
            : `repeating-linear-gradient(to bottom, ${color} 0 4px, transparent 4px 7px)`,
        }
      : { backgroundColor: color };
  /** Tratto orizzontale/verticale, centrato sull'asse indicato (mm di layout). */
  const stroke = (ink: string, points: [number, number, number, number]): void => {
    const [x1, y1, x2, y2] = points;
    const horizontal = y1 === y2;
    const len = Math.abs(horizontal ? x2 - x1 : y2 - y1) * scale;
    const left = Math.min(x1, x2) * scale - (horizontal ? 0 : tPx / 2);
    const top = Math.min(y1, y2) * scale - (horizontal ? tPx / 2 : 0);
    segs.push(
      <div
        key={k++}
        className="pointer-events-none absolute"
        style={{
          left,
          top,
          width: horizontal ? len : tPx,
          height: horizontal ? tPx : len,
          borderRadius: radius,
          ...(ink === CUT_INK ? { backgroundColor: CUT_INK } : brush(horizontal)),
        }}
      />,
    );
  };

  const rects: TrimRect[] = placements.map((pl) => lineRect(pl, bleedMm, widthPt, placement, offsetMm));

  if (cut) {
    for (const r of rects) {
      segs.push(
        <div
          key={k++}
          className="pointer-events-none absolute"
          style={{
            left: r.xMm * scale,
            top: r.yMm * scale,
            width: r.wMm * scale,
            height: r.hMm * scale,
            outline: `${tPx}px ${style === "dashed" ? "dashed" : "solid"} ${CUT_INK}`,
          }}
        />,
      );
    }
  }

  if (page) {
    const { xs, ys } = pageLineEdges(rects);
    for (const x of xs) {
      segs.push(
        <div
          key={k++}
          className="pointer-events-none absolute top-0 bottom-0"
          style={{ left: x * scale - tPx / 2, width: tPx, backgroundColor: CUT_INK, opacity: 0.9 }}
        />,
      );
    }
    for (const y of ys) {
      segs.push(
        <div
          key={k++}
          className="pointer-events-none absolute left-0 right-0"
          style={{ top: y * scale - tPx / 2, height: tPx, backgroundColor: CUT_INK, opacity: 0.9 }}
        />,
      );
    }
  }

  if (crop) {
    for (const r of rects) {
      for (const seg of cornerSegments(r, lengthMm, shape)) {
        stroke(color, [seg.x1Mm, seg.y1Mm, seg.x2Mm, seg.y2Mm]);
      }
    }
  }

  // Alone bianco (solo anteprima: il PDF resta puro): i tratti neri restano
  // leggibili anche su artwork scuri.
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ filter: "drop-shadow(0 0 1.5px rgba(255,255,255,0.95))" }}
      aria-hidden="true"
    >
      {segs}
    </div>
  );
}

/**
 * Cella di stampa: la carta a MISURA (trim) centrata + banda di bleed
 * specchiata attorno, come compone il PDF (`compose_cell`: carta a misura,
 * banda = arte specchiata). Prima l'arte riempiva tutta la cella e la carta
 * sembrava ingrandita col bleed; ora carta e guide sono dove saranno stampate.
 */
function PrintCell({
  pl,
  copy,
  shown,
  measured,
  targetDpi,
  scale,
  bleedMm = 0,
  showBack,
  defaultBack,
  pendingEntryIds,
  zoneLabel,
  showZone,
  onPickCopy,
  onContextMenuCopy,
}: {
  pl: { xMm: number; yMm: number; wMm: number; hMm: number; index: number };
  copy: ZoneCopy;
  shown?: string;
  measured: CellQuality | undefined;
  targetDpi: number;
  scale: number;
  bleedMm?: number;
  showBack: boolean;
  defaultBack?: string;
  pendingEntryIds?: string[];
  /** etichetta della zona di stampa (chip solo a inizio gruppo) */
  zoneLabel?: string;
  /** true sulla prima copia di ogni gruppo di zona nel flusso */
  showZone?: boolean;
  onPickCopy: (entryId: string) => void;
  onContextMenuCopy?: (entryId: string, x: number, y: number) => void;
}): JSX.Element {
  const b = Math.max(0, bleedMm) * scale;
  const trimW = Math.max(1, pl.wMm * scale - b * 2);
  const trimH = Math.max(1, pl.hMm * scale - b * 2);
  return (
    <div
      title={copy.name}
      onContextMenu={
        onContextMenuCopy
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenuCopy(copy.entryId, e.clientX, e.clientY);
            }
          : undefined
      }
      className="absolute overflow-hidden bg-white group"
      style={{
        left: pl.xMm * scale,
        top: pl.yMm * scale,
        width: pl.wMm * scale,
        height: pl.hMm * scale,
      }}
    >
      {/* banda bleed specchiata (stessa regola del PDF per arte senza bleed) */}
      {b > 0.25 && shown && <BleedBands src={shown} b={b} trimW={trimW} trimH={trimH} />}
      {/* carta a misura sul trim */}
      <div className="absolute" style={{ left: b, top: b, width: trimW, height: trimH }}>
        {/* thumb via backend (mai rete WebView); placeholder+diagnostica se fallisce */}
        <ArtworkImage stored={shown} name={copy.name} />
      </div>
      <button
        type="button"
        onClick={() => onPickCopy(copy.entryId)}
        onMouseEnter={() => prefetchCellPrints(copy.name)}
        onFocus={() => prefetchCellPrints(copy.name)}
        aria-label={`Scegli stampa per ${copy.name}`}
        title="Scegli stampa"
        data-testid={`sheet-cell-${copy.entryId}`}
        className="absolute inset-0 cursor-pointer"
      />
      {pendingEntryIds?.includes(copy.entryId) && <CellLoadingOverlay label={`Preparazione stampa per ${copy.name}`} />}
      {/* stat DPI solo su hover cella (default nascosta per una griglia pulita) */}
      <span className="pointer-events-none absolute bottom-0.5 left-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <CellStat measured={measured} targetDpi={targetDpi} />
      </span>
      {/* chip di zona all'inizio di ogni gruppo + pill comandante: solo recap, non toccano il layout */}
      {(showZone || copy.commander) && (
        <span className="pointer-events-none absolute left-0.5 top-0.5 flex max-w-[calc(100%-4px)] gap-1">
          {showZone && (
            <span
              data-testid={`sheet-zone-${copy.zone}`}
              className="truncate rounded-full bg-black/60 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-neutral-100 ring-1 ring-white/25"
            >
              {zoneLabel}
            </span>
          )}
          {copy.commander && (
            <span className="rounded-full bg-red-700 px-1.5 py-px text-[9px] font-bold uppercase text-white">
              Comandante
            </span>
          )}
        </span>
      )}
      {showBack && (copy.hasBack || defaultBack) && (
        <span className="pointer-events-none absolute right-0.5 top-0.5 rounded bg-black/75 px-1 text-[9px] text-neutral-200">
          {copy.hasBack ? "2F" : "dorso"}
        </span>
      )}
    </div>
  );
}

/**
 * Banda di bleed specchiata (4 lati + 4 angoli) con le stesse regole del PDF
 * (`image::compose_cell`, ramo specchio): ogni pixel di banda rispecchia il
 * bordo carta adiacente. Solo anteprima: il PDF resta l'unica verità.
 */
function BleedBands({ src, b, trimW, trimH }: { src: string; b: number; trimW: number; trimH: number }): JSX.Element | null {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const strip = (
    key: string,
    box: React.CSSProperties,
    imgPos: React.CSSProperties,
    flip: string,
  ): JSX.Element => (
    <div key={key} className="absolute overflow-hidden" style={box} aria-hidden="true">
      <img
        src={src}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
        style={{ position: "absolute", width: trimW, height: trimH, transform: flip, ...imgPos }}
      />
    </div>
  );
  return (
    <div className="pointer-events-none absolute inset-0" data-testid="bleed-bands" aria-hidden="true">
      {strip("l", { left: 0, top: b, width: b, height: trimH }, { right: 0, top: 0 }, "scaleX(-1)")}
      {strip("r", { left: b + trimW, top: b, width: b, height: trimH }, { left: 0, top: 0 }, "scaleX(-1)")}
      {strip("t", { left: b, top: 0, width: trimW, height: b }, { left: 0, bottom: 0 }, "scaleY(-1)")}
      {strip("b", { left: b, top: b + trimH, width: trimW, height: b }, { left: 0, top: 0 }, "scaleY(-1)")}
      {strip("tl", { left: 0, top: 0, width: b, height: b }, { right: 0, bottom: 0 }, "scale(-1, -1)")}
      {strip("tr", { left: b + trimW, top: 0, width: b, height: b }, { left: 0, bottom: 0 }, "scale(-1, -1)")}
      {strip("bl", { left: 0, top: b + trimH, width: b, height: b }, { right: 0, top: 0 }, "scale(-1, -1)")}
      {strip("br", { left: b + trimW, top: b + trimH, width: b, height: b }, { left: 0, top: 0 }, "scale(-1, -1)")}
    </div>
  );
}

function PagePreview({ page, pageWmm, pageHmm, placements, copies, quality, targetDpi, scale, showBack, guides, bleedMm = 0, guideColor, guideWidthPt, guidePlacement, guideLengthMm, guideShape, guideOffsetMm, guideStyle, guideCap, defaultBack, pendingEntryIds, onPickCopy, onContextMenuCopy }: {
  page: number;
  pageWmm: number;
  pageHmm: number;
  placements: { xMm: number; yMm: number; wMm: number; hMm: number; index: number }[];
  copies: ZoneCopy[];
  quality: Map<string, { effDpi: number; status: "green" | "blue" | "yellow" | "orange" | "red" }>;
  targetDpi: number;
  scale: number;
  showBack: boolean;
  guides: { crop: boolean; cut: boolean; page: boolean };
  /** bleed in mm: linee di taglio sul trim, non sul bordo cella */
  bleedMm?: number;
  guideColor: string;
  guideWidthPt: number;
  guidePlacement: "outside" | "inside" | "center";
  guideLengthMm: number;
  guideShape: GuideShape;
  guideOffsetMm: number;
  guideStyle: "solid" | "dashed";
  guideCap: "square" | "round";
  /** dorso di default per le carte senza retro */
  defaultBack?: string;
  /** voci con immagine in download: spinner sopra la cella */
  pendingEntryIds?: string[];
  onPickCopy: (entryId: string) => void;
  /** opzionale: menu contestuale per cella (non usato nel flusso solo-stampa) */
  onContextMenuCopy?: (entryId: string, x: number, y: number) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center">
      <p className="mb-1 self-start text-xs text-neutral-500">Pagina {page + 1}</p>
      <div
        className="relative border border-neutral-300 bg-white"
        style={{ width: pageWmm * scale, height: pageHmm * scale, overflow: "visible" }}
      >
        {placements.map((pl) => {
          const copy = copies[pl.index];
          if (!copy) return null;
          // Lato anteprima: retro proprio, altrimenti dorso di default, altrimenti fronte
          const shown = showBack ? (copy.imageBack ?? defaultBack ?? copy.imageFront) : copy.imageFront;
          const measured = shown ? quality.get(shown) : undefined;
          // il flusso è contiguo per zona: il chip segna solo l'inizio di ogni gruppo
          const prev = pl.index > 0 ? copies[pl.index - 1] : undefined;
          const zoneStart = !prev || prev.zone !== copy.zone;
          return (
            <PrintCell
              key={pl.index}
              pl={pl}
              copy={copy}
              shown={shown}
              measured={measured}
              targetDpi={targetDpi}
              scale={scale}
              bleedMm={bleedMm}
              showBack={showBack}
              defaultBack={defaultBack}
              pendingEntryIds={pendingEntryIds}
              zoneLabel={ZONE_LABELS[copy.zone]}
              showZone={zoneStart}
              onPickCopy={onPickCopy}
              onContextMenuCopy={onContextMenuCopy}
            />
          );
        })}
        {/* guide a livello pagina: sopra le carte, mai clippate dalle celle */}
        <PageGuides
          placements={placements}
          scale={scale}
          color={guideColor}
          widthPt={guideWidthPt}
          placement={guidePlacement}
          lengthMm={guideLengthMm}
          shape={guideShape}
          offsetMm={guideOffsetMm}
          style={guideStyle}
          cap={guideCap}
          crop={guides.crop}
          cut={guides.cut}
          page={guides.page}
          bleedMm={bleedMm}
        />
      </div>
    </div>
  );
}
