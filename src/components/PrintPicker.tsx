import { memo, useEffect, useMemo, useRef, useState } from "react";
import { MpcError, configuredServer } from "@/services/mpc";
import { usePrints } from "@/hooks/usePrints";
import { SourceFilterPanel } from "@/components/SourceFilterPanel";
import { exclusionChips, exclusionCount, removeExclusion, toggleSet, toggleSource } from "@/lib/exclusions";

/** Tile mostrate prima di "mostra altre": primo paint leggero anche con 100+ stampe. */
export const PRINTS_PAGE_SIZE = 24;
import { listFavorites, toggleFavorite, type Favorite } from "@/lib/favorites";
import { CARD_LANG_LABEL, CARD_LANG_OPTIONS, langAttempts, langName } from "@/lib/cardLang";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { ArtworkImage } from "@/components/ArtworkImage";
import type { CardLang, PrintOption, PrintSource } from "@/types";

interface PrintPickerProps {
  cardName: string;
  /** stampa attualmente applicata alla voce deck (evidenziata con anello) */
  currentProviderId?: string;
  /** copie totali della carta + omonime (>1 → mostra Apply to all) */
  totalCopies?: number;
  onSelect: (opt: PrintOption, applyAll: boolean) => void;
  /** faccia DFC indipendente (mix stampe); assente = solo stampa intera */
  onSelectFace?: (opt: PrintOption, face: "front" | "back", applyAll: boolean) => void;
  onClose: () => void;
}

type SortKey = "released" | "name" | "dpi";
type ViewKey = "grid" | "list";
type LangKey = CardLang;

/** Modale scelta stampa: griglia versioni da Scryfall o MPC Autofill (server configurabile). */
export function PrintPicker({ cardName, currentProviderId, totalCopies = 1, onSelect, onSelectFace, onClose }: PrintPickerProps): JSX.Element {
  // Preset: stampe community MPC full-art quando il server è configurato, altrimenti Scryfall.
  const [source, setSource] = useState<PrintSource>(() => (configuredServer() ? "mpc" : "scryfall"));
  const [query, setQuery] = useState(cardName);
  const [submitted, setSubmitted] = useState(cardName);
  const [setFilter, setSetFilter] = useState<string>("any");
  const [sort, setSort] = useState<SortKey>("released");
  const [view, setView] = useState<ViewKey>("grid");
  const [zoom, setZoom] = useState(1);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [applyAll, setApplyAll] = useState(false);
  /** filtro lingua stampe: parte dalla preferenza salvata nelle Impostazioni */
  const [lang, setLang] = useState<LangKey>(() => useSettings.getState().cardLang);
  /** mostra solo preferiti */
  const [favOnly, setFavOnly] = useState(false);
  const [favs, setFavs] = useState<Favorite[]>([]);
  /** tag MPC separati da virgola (includesTags nativo); client filtra il resto */
  const [mpcTags, setMpcTags] = useState("");
  const [showCount, setShowCount] = useState(PRINTS_PAGE_SIZE);
  const excluded = useSettings((s) => s.excluded);
  const setExcluded = useSettings((s) => s.setExcluded);
  /** «mostra escluse»: guarda tutto senza toccare le preferenze salvate. */
  const [showExcluded, setShowExcluded] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  // Ogni cambio filtro/ricerca/sorgente riparte dalle prime tile.
  useEffect(() => {
    setShowCount(PRINTS_PAGE_SIZE);
  }, [source, submitted, setFilter, sort, favOnly, lang, mpcTags, showExcluded, excluded]);
  const searchRef = useRef<HTMLInputElement>(null);
  const setTab = useUi((s) => s.setTab);

  useEffect(() => {
    void listFavorites().then(setFavs).catch(() => undefined);
  }, []);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mpcServer = useSettings((s) => s.mpcServerUrl);

  const mpcTagList = useMemo(
    () => [...new Set(mpcTags.split(",").map((t) => t.trim()).filter((t) => t.length > 0))],
    [mpcTags],
  );

  const printsQuery = usePrints({
    source,
    submitted,
    mpcServer,
    lang,
    tags: mpcTagList,
    exclude: showExcluded ? null : excluded,
  });
  const prints = { ...printsQuery, data: printsQuery.data?.options };
  /** la lingua preferita non aveva stampe: stiamo mostrando il ripiego */
  const langFellBack =
    printsQuery.data !== undefined && printsQuery.data.langUsed !== langAttempts(lang)[0];

  const favIds = useMemo(() => new Set(favs.map((f) => f.id)), [favs]);
  const onFav = (opt: PrintOption): void => {
    void toggleFavorite(opt, favs).then(setFavs).catch(() => undefined);
  };

  const excludedTotal = exclusionCount(excluded);
  const chips = useMemo(() => exclusionChips(excluded), [excluded]);

  /**
   * Esclude la fonte della stampa: drive MPC per le community render, set per
   * Scryfall. Un click, reversibile dai chip — non tocca la carta nel mazzo.
   */
  const excludeOf = (opt: PrintOption): void => {
    if (opt.source === "mpc") {
      const drive = (opt.setName || opt.sourceLabel || "").trim();
      if (drive) setExcluded(toggleSource(useSettings.getState().excluded, drive));
      return;
    }
    if (opt.setCode) setExcluded(toggleSet(useSettings.getState().excluded, opt.setCode));
  };

  const sets = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of prints.data ?? []) {
      const code = p.setCode || "(MPC)";
      if (!map.has(code)) map.set(code, p.setName || p.sourceLabel || code);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [prints.data]);

  const visible = useMemo(() => {
    const list = (prints.data ?? []).filter(
      (p) =>
        (setFilter === "any" || (p.setCode || "(MPC)") === setFilter) &&
        (!favOnly || favIds.has(p.id)),
    );
    switch (sort) {
      case "name":
        return [...list].sort((a, b) => a.setName.localeCompare(b.setName) || a.name.localeCompare(b.name));
      case "dpi":
        return [...list].sort((a, b) => (b.dpi ?? -1) - (a.dpi ?? -1));
      default:
        return [...list].sort((a, b) => (b.releasedAt ?? "").localeCompare(a.releasedAt ?? ""));
    }
  }, [prints.data, setFilter, sort, favOnly, favIds]);

  const choose = (opt: PrintOption): void => {
    if (selecting) return;
    setSelecting(opt.id);
    try {
      onSelect(opt, applyAll);
    } finally {
      // la chiusura è gestita dal genitore dopo il persist
      setSelecting(null);
    }
  };

  /** Faccia DFC indipendente (mix stampe: fronte da A, retro da B). */
  const chooseFace = (opt: PrintOption, face: "front" | "back"): void => {
    if (selecting || !onSelectFace) return;
    setSelecting(`${opt.id}:${face}`);
    try {
      onSelectFace(opt, face, applyAll);
    } finally {
      setSelecting(null);
    }
  };

  const mpcNeedsSetup =
    prints.isError && prints.error instanceof MpcError && prints.error.reason === "not-configured";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Scegli stampa per ${submitted}`}
        data-testid="print-picker"
        className="panel thin-border flex h-[85vh] w-[80vw] max-w-[1500px] flex-col overflow-hidden rounded-lg"
      >
        {/* barra filtri */}
        <div className="flex flex-wrap items-center gap-2 border-b thin-border p-2 text-xs">
          <span className="font-semibold" aria-live="polite">
            {submitted}
          </span>
          {totalCopies > 1 && (
            <label
              className="panel-2 thin-border flex items-center gap-1.5 rounded px-2 py-1"
              title={`Spuntato: applica a tutte le ${totalCopies} copie di "${submitted}". Non spuntato: cambia solo 1 copia.`}
            >
              <input
                type="checkbox"
                checked={applyAll}
                onChange={(e) => setApplyAll(e.target.checked)}
                data-testid="apply-all"
                aria-label={`Applica a tutte le ${totalCopies} copie di ${submitted}`}
              />
              Apply to all "{submitted}" ({totalCopies})
            </label>
          )}
          <label>Set
            <select
              value={setFilter}
              onChange={(e) => setSetFilter(e.target.value)}
              className="panel-2 thin-border ml-1 rounded px-1 py-0.5"
              aria-label="Filtra per set"
              data-testid="prints-set-filter"
            >
              <option value="any">Any</option>
              {sets.map(([code, name]) => (
                <option key={code} value={code}>{name} ({code})</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setFavOnly((v) => !v)}
            aria-pressed={favOnly}
            aria-label="Mostra solo preferiti"
            data-testid="prints-fav-only"
            title="Mostra solo le stampe preferite (cuore)"
            className={`panel-2 thin-border rounded px-2 py-0.5 ${favOnly ? "bg-neutral-200 font-bold text-black" : "text-neutral-400"}`}
          >
            ★{favs.length > 0 ? ` ${favs.length}` : ""}
          </button>
          <label title="Lingua delle stampe: se non esiste si passa all'inglese">Lingua
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as LangKey)}
              className="panel-2 thin-border ml-1 rounded px-1 py-0.5"
              aria-label="Filtra per lingua"
              data-testid="prints-lang"
            >
              {CARD_LANG_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          <label>Ordina
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="panel-2 thin-border ml-1 rounded px-1 py-0.5"
              aria-label="Ordinamento"
              data-testid="prints-sort"
            >
              <option value="released">Release Date</option>
              <option value="name">Set / Nome</option>
              <option value="dpi">DPI</option>
            </select>
          </label>
          {source === "mpc" && (
            <label>Tag
              <input
                value={mpcTags}
                onChange={(e) => setMpcTags(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (query.trim()) {
                      setSubmitted(query.trim());
                      setSetFilter("any");
                    }
                  }
                }}
                placeholder="extended, fullart…"
                aria-label="Filtra per tag MPC (virgole)"
                data-testid="prints-mpc-tags"
                className="panel-2 thin-border ml-1 w-28 rounded px-1 py-0.5"
              />
            </label>
          )}
          <button
            type="button"
            onClick={() => setManageOpen((v) => !v)}
            aria-expanded={manageOpen}
            aria-controls="print-exclusions-panel"
            title="Gestisci le fonti escluse: drive MPC, tag MPC, set MTG"
            data-testid="prints-exclusions"
            className={`panel-2 thin-border rounded px-2 py-0.5 ${manageOpen ? "bg-neutral-200 font-bold text-black" : "text-neutral-400"}`}
          >
            Esclusi{excludedTotal > 0 ? ` ${excludedTotal}` : ""}
          </button>
          <label
            className={`panel-2 thin-border flex items-center gap-1.5 rounded px-2 py-0.5 ${excludedTotal === 0 ? "text-neutral-500" : "text-neutral-400"}`}
            title="Mostra anche le stampe delle fonti escluse, senza riattivarle"
          >
            <input
              type="checkbox"
              checked={showExcluded}
              disabled={excludedTotal === 0}
              onChange={(e) => setShowExcluded(e.target.checked)}
              data-testid="prints-show-excluded"
              aria-label="Mostra anche le fonti escluse"
            />
            mostra escluse
          </label>
          <div className="flex rounded panel-2 thin-border" role="group" aria-label="Vista anteprime">
            {(["grid", "list"] as ViewKey[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                aria-label={v === "grid" ? "Vista griglia" : "Vista elenco"}
                data-testid={`prints-view-${v}`}
                className={`rounded px-2 py-0.5 ${view === v ? "bg-neutral-200 text-black" : "text-neutral-400"}`}
              >
                {v === "grid" ? "▦" : "☰"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1">Zoom
            <input
              type="range" min={0.6} max={1.6} step={0.1} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="Zoom anteprime"
            />
          </label>
          <span
            className="panel-2 thin-border ml-auto rounded px-2 py-0.5 text-neutral-300"
            data-testid="prints-count"
            aria-live="polite"
          >
            {prints.data ? visible.length : "…"}
          </span>
          <button onClick={onClose} className="panel-2 thin-border rounded px-2 py-1" aria-label="Chiudi">
            ✕
          </button>
        </div>

        {/* gestione fonti escluse: pannello inline, mai un modale annidato */}
        {manageOpen && (
          <div id="print-exclusions-panel" className="border-b thin-border">
            <SourceFilterPanel server={mpcServer} onClose={() => setManageOpen(false)} compact />
          </div>
        )}

        {/* chips delle escluse: stato sempre leggibile, ✕ per riattivare */}
        {!manageOpen && excludedTotal > 0 && (
          <div
            className="flex flex-wrap items-center gap-1.5 border-b thin-border px-3 py-1.5 text-[11px]"
            data-testid="prints-excluded-chips"
          >
            <span className="text-neutral-400">Escluse</span>
            {chips.slice(0, 8).map((c) => (
              <span
                key={`${c.kind}:${c.value}`}
                className="panel-2 thin-border flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1"
              >
                <span className="text-neutral-300">{c.label}</span>
                <button
                  type="button"
                  onClick={() => setExcluded(removeExclusion(useSettings.getState().excluded, c.kind, c.value))}
                  aria-label={`Riattiva ${c.label}`}
                  title={`Riattiva ${c.label}`}
                  data-testid={`prints-excluded-${c.kind}-${c.value}`}
                  className="rounded px-0.5 text-neutral-400 hover:text-neutral-100"
                >
                  ✕
                </button>
              </span>
            ))}
            {chips.length > 8 && (
              <button
                type="button"
                onClick={() => setManageOpen(true)}
                className="panel-2 thin-border rounded-full px-2 py-0.5 text-neutral-400"
              >
                +{chips.length - 8}
              </button>
            )}
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className="ml-auto text-neutral-400 underline hover:text-neutral-100"
            >
              Gestisci
            </button>
          </div>
        )}

        {/* stampe */}
        <div className="min-h-0 flex-1 overflow-auto p-3" aria-label="Stampe disponibili" data-testid="prints-grid">
          {langFellBack && !prints.isLoading && (
            <p className="px-4 pt-2 text-xs text-yellow-400" data-testid="prints-lang-fallback">
              Nessuna stampa in {CARD_LANG_LABEL[lang]}: mostro il ripiego in {langName(printsQuery.data?.langUsed)}.
            </p>
          )}
          {prints.isLoading && <p className="p-4 text-sm text-neutral-500">Caricamento stampe…</p>}
          {prints.isError && (
            <div className="p-4" role="alert" data-testid="prints-error">
              <p className="max-w-prose text-sm text-yellow-400">
                {prints.error instanceof Error ? prints.error.message : String(prints.error)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(!(prints.error instanceof MpcError) || prints.error.reason === "unreachable") && (
                  <button
                    type="button"
                    onClick={() => void prints.refetch()}
                    data-testid="prints-retry"
                    className="rounded bg-neutral-200 px-3 py-1.5 text-xs font-bold text-black"
                  >
                    Riprova
                  </button>
                )}
                {source === "mpc" && (
                  <button
                    type="button"
                    onClick={() => {
                      setSource("scryfall");
                      setSetFilter("any");
                    }}
                    data-testid="prints-use-scryfall"
                    className="panel-2 thin-border rounded px-3 py-1.5 text-xs"
                  >
                    Usa Scryfall
                  </button>
                )}
                {mpcNeedsSetup && (
                  <button
                    onClick={() => {
                      onClose();
                      setTab("settings");
                    }}
                    data-testid="mpc-settings-link"
                    className="panel-2 thin-border rounded px-3 py-1.5 text-xs"
                  >
                    Vai alle impostazioni
                  </button>
                )}
              </div>
            </div>
          )}
          {!prints.isLoading && !prints.isError && visible.length === 0 && (
            <p className="p-4 text-sm text-neutral-500">Nessuna stampa trovata. Prova a modificare la ricerca sotto.</p>
          )}
          {view === "grid" ? (
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(170 * zoom)}px, 1fr))` }}
            >
              {visible.slice(0, showCount).map((p) => (
                <PrintTile
                  key={`${p.source}:${p.id}`}
                  opt={p}
                  current={p.id === currentProviderId}
                  fav={favIds.has(p.id)}
                  onFav={() => onFav(p)}
                  onExclude={() => excludeOf(p)}
                  onChoose={() => choose(p)}
                  onChooseFace={onSelectFace ? (face) => chooseFace(p, face) : undefined}
                />
              ))}
            </div>
          ) : (
            <ul className="space-y-1">
              {visible.slice(0, showCount).map((p) => (
                <li key={`${p.source}:${p.id}`} className={`panel-2 thin-border flex w-full items-center gap-2 rounded p-1.5 ${p.id === currentProviderId ? "border-green-500 ring-2 ring-green-500" : ""}`}>
                  <button
                    onClick={() => choose(p)}
                    data-testid="print-tile"
                    aria-label={`Usa stampa ${p.setName || p.sourceLabel || ""} ${p.collectorNumber}`}
                    aria-current={p.id === currentProviderId || undefined}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded text-left hover:border-neutral-100"
                  >
                    {p.thumb ? (
                      <span className="relative block h-10 w-7 shrink-0 overflow-hidden rounded bg-black">
                        <ArtworkImage stored={p.thumb} name={p.name} backendThumb={false} imgClassName="h-full w-full object-cover" />
                      </span>
                    ) : (
                      <span className="flex h-10 w-7 items-center justify-center rounded bg-neutral-800 text-[10px]">—</span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {p.setName || p.sourceLabel || p.name}
                        {p.id === currentProviderId && <span className="ml-1 text-[10px] text-green-400">· in uso</span>}
                      </span>
                      <span className="block text-[11px] text-neutral-500">
                        {[p.setCode || "MPC", p.collectorNumber, p.dpi ? `${p.dpi} DPI` : p.highres ? "HD" : "SD", p.priceUsd ? `$${p.priceUsd}` : ""].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onFav(p)}
                    aria-pressed={favIds.has(p.id)}
                    aria-label={favIds.has(p.id) ? `Rimuovi ${p.name} dai preferiti` : `Aggiungi ${p.name} ai preferiti`}
                    data-testid="fav-toggle"
                    title="Preferito"
                    className={`shrink-0 rounded px-1 text-sm ${favIds.has(p.id) ? "text-yellow-400" : "text-neutral-600 hover:text-neutral-300"}`}
                  >
                    ★
                  </button>
                  <button
                    type="button"
                    onClick={() => excludeOf(p)}
                    aria-label={
                      p.source === "mpc"
                        ? `Escludi il drive ${p.setName || p.sourceLabel}`
                        : `Escludi il set ${p.setCode.toUpperCase()}`
                    }
                    data-testid="print-exclude-source"
                    title={p.source === "mpc" ? "Escludi questo drive MPC dal picker" : "Escludi questo set dal picker"}
                    className="shrink-0 rounded px-1 text-[10px] text-neutral-400 hover:text-red-300"
                  >
                    {p.source === "mpc" ? "escludi fonte" : "escludi set"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {visible.length > showCount && (
            <button
              type="button"
              onClick={() => setShowCount((n) => n + PRINTS_PAGE_SIZE)}
              data-testid="prints-more"
              className="panel-2 thin-border mt-2 w-full rounded px-2 py-1.5 text-xs text-neutral-300"
            >
              Mostra altre ({visible.length - showCount} rimanenti)
            </button>
          )}
        </div>

        {/* barra sorgente + ricerca */}
        <div className="flex gap-2 border-t thin-border p-2">
          <div className="panel-2 thin-border flex rounded" role="group" aria-label="Sorgente stampe">
            {(["scryfall", "mpc"] as PrintSource[]).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSource(s);
                  setSetFilter("any");
                }}
                aria-pressed={source === s}
                data-testid={`source-tab-${s}`}
                className={`rounded px-4 py-1.5 text-xs ${source === s ? "bg-neutral-100 font-bold text-black" : "text-neutral-400"}`}
              >
                {s === "scryfall" ? "Scryfall" : "MPC Autofill"}
              </button>
            ))}
          </div>
          <form
            className="flex flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) {
                setSubmitted(query.trim());
                setSetFilter("any");
              }
            }}
          >
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a different card…"
              aria-label="Cerca un'altra carta"
              data-testid="prints-search"
              className="panel-2 thin-border flex-1 rounded px-3 py-1.5 text-sm"
            />
            <button type="submit" data-testid="prints-search-go"
              className="rounded bg-neutral-100 px-6 py-1.5 text-xs font-bold text-black">
              Cerca
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

const PrintTile = memo(function PrintTile({ opt, current, fav, onFav, onExclude, onChoose, onChooseFace }: {
  opt: PrintOption;
  current: boolean;
  fav: boolean;
  onFav: () => void;
  onExclude: () => void;
  onChoose: () => void;
  onChooseFace?: (face: "front" | "back") => void;
}): JSX.Element {
  const dfc = Boolean(opt.hasBack && opt.imageBack && onChooseFace);
  const faceFn = onChooseFace;
  return (
    <div
      className={`panel-2 thin-border group rounded p-1.5 ${current ? "border-green-500 ring-2 ring-green-500" : ""}`}
      style={{ contentVisibility: "auto", containIntrinsicSize: "170px 260px" }}
    >
      <button
        onClick={onChoose}
        data-testid="print-tile"
        aria-label={`Usa stampa ${opt.setName || opt.sourceLabel || ""} ${opt.collectorNumber}`}
        aria-current={current || undefined}
        className="block w-full rounded text-left hover:border-neutral-100"
      >
        <span className="relative mb-1 block aspect-[63/88] w-full overflow-hidden rounded bg-black">
          <ArtworkImage stored={opt.preview ?? opt.thumb} name={opt.name} backendThumb={false} />
          <span className="absolute left-1 top-1 rounded bg-black/75 px-1 text-[10px] font-bold">
            {opt.setCode || "MPC"}
          </span>
          <span className="absolute right-1 top-1 rounded bg-black/75 px-1 text-[10px]">
            {opt.dpi ? `${opt.dpi} DPI` : opt.highres ? "HD" : "SD"}
          </span>
          {opt.priceUsd && (
            <span className="absolute bottom-1 right-1 rounded bg-green-800 px-1 text-[10px] text-white">
              ${opt.priceUsd}
            </span>
          )}
          {current && (
            <span className="absolute bottom-1 left-1 rounded bg-green-700 px-1 text-[10px] font-bold text-white">
              In uso
            </span>
          )}
        </span>
      </button>
      <span className="flex items-center gap-1">
        <button
          type="button"
          onClick={onFav}
          aria-pressed={fav}
          aria-label={fav ? `Rimuovi ${opt.name} dai preferiti` : `Aggiungi ${opt.name} ai preferiti`}
          data-testid="fav-toggle"
          title="Preferito"
          className={`shrink-0 rounded px-0.5 text-sm leading-none ${fav ? "text-yellow-400" : "text-neutral-600 hover:text-neutral-300"}`}
        >
          ★
        </button>
        <span className="block min-w-0 flex-1 truncate text-[11px] text-neutral-400">
          {[opt.setName || opt.sourceLabel, opt.collectorNumber].filter(Boolean).join(" · ")}
        </span>
        <button
          type="button"
          onClick={onExclude}
          aria-label={
            opt.source === "mpc"
              ? `Escludi il drive ${opt.setName || opt.sourceLabel}`
              : `Escludi il set ${opt.setCode.toUpperCase()}`
          }
          data-testid="print-exclude-source"
          title={opt.source === "mpc" ? "Escludi questo drive MPC dal picker" : "Escludi questo set dal picker"}
          className="shrink-0 rounded px-0.5 text-[10px] text-neutral-400 hover:text-red-300"
        >
          escludi
        </button>
      </span>
      {dfc && faceFn && (
        <span className="mt-1 flex gap-1" role="group" aria-label={`Facce indipendenti di ${opt.name}`}>
          {(["front", "back"] as const).map((face) => (
            <button
              key={face}
              type="button"
              onClick={() => faceFn(face)}
              data-testid={`print-face-${face}`}
              aria-label={`Usa solo ${face === "front" ? "fronte" : "retro"} di ${opt.name}`}
              title={face === "front" ? "Usa solo il fronte (mix stampe)" : "Usa solo il retro (mix stampe)"}
              className="panel thin-border flex-1 rounded px-1 py-0.5 text-[10px] text-neutral-300 hover:border-neutral-100"
            >
              {face === "front" ? "Fronte" : "Retro"}
            </button>
          ))}
        </span>
      )}
    </div>
  );
});
