import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArtworkImage } from "@/components/ArtworkImage";
import { openExternal } from "@/lib/external";
import { edhrecCommanderUrl } from "@/lib/edhrec";
import { isMassLandDenial, computeBracket, BRACKET_LABEL } from "@/lib/bracket";
import { findMeta } from "@/lib/cardmetaCache";
import { useCardMeta } from "@/hooks/useCardTypes";
import {
  buildSearchQuery,
  EMPTY_FILTERS,
  fetchCommanderIdentity,
  fetchRecs,
  searchCardsAdvanced,
  type FilterOp,
  type SearchDir,
  type SearchFilters,
  type SearchHit,
  type SearchOrder,
} from "@/services/cardfinder";
import { isCommander, useDeck } from "@/stores/deck";
import { ZONE_LABELS, type Zone } from "@/types";

export interface ActiveSearch {
  q: string;
  order: SearchOrder;
  dir: SearchDir;
}

/**
 * Ricerca stile Moxfield: barra rapida ("Cerca e aggiungi…", `/` per il focus)
 * + link Ricerca avanzata · Consigliati · Sintassi. La modale avanzata
 * compone sintassi Scryfall (nomi/set/testo/tipi/colori/identità/cmc/costo/
 * power/toughness/loyalty/rarità/ordinamento). I Consigliati sono la Top 100
 * per rank EDHREC nei colori del comandante, terre in fondo.
 */
export function SearchPanel({
  standalone = false,
  onHover,
}: {
  standalone?: boolean;
  onHover?: (hit: SearchHit) => void;
} = {}): JSX.Element {
  const [activeTab, setActiveTab] = useState<"recs" | "results" | "syntax">("results");
  const [quick, setQuick] = useState("");
  const [search, setSearch] = useState<ActiveSearch | null>(null);
  const [advOpen, setAdvOpen] = useState(false);
  const quickRef = useRef<HTMLInputElement>(null);

  // "/" focalizza la ricerca (come Moxfield), salvo mentre si digita altrove
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "/") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      e.preventDefault();
      setActiveTab("results");
      quickRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const runQuick = (): void => {
    const text = quick.trim();
    if (!text) return;
    setSearch({ q: `f:commander (${text})`, order: "edhrec", dir: "auto" });
    setActiveTab("results");
  };

  const stab = (id: "adv" | "recs" | "syntax", label: string, testid?: string): JSX.Element => {
    const active =
      (id === "recs" && activeTab === "recs") ||
      (id === "syntax" && activeTab === "syntax") ||
      (id === "adv" && activeTab === "results");
    return (
      <button
        key={id}
        type="button"
        onClick={() => {
          if (id === "adv") setAdvOpen(true);
          else setActiveTab(id);
        }}
        aria-selected={active}
        role="tab"
        data-testid={testid}
        className={`-mb-px border-b-2 pb-2 text-xs transition-colors ${active ? "border-neutral-200 text-neutral-100" : "border-transparent text-neutral-400 hover:text-neutral-200"}`}
      >
        {label}
      </button>
    );
  };

  return (
    <aside
      className={
        standalone
          ? "flex h-full min-h-0 w-full flex-col"
          : "flex min-h-0 w-80 shrink-0 flex-col border-l thin-border"
      }
      aria-label="Ricerca carte"
      data-testid="search-panel"
    >
      <div className="p-4 pb-0">
        <div className="flex items-center gap-1 rounded-lg thin-border panel-2 px-3 py-2">
          <input
            ref={quickRef}
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runQuick();
            }}
            placeholder="Cerca e aggiungi carte…"
            aria-label="Ricerca rapida carte"
            data-testid="cf-text"
            className="min-w-0 flex-1 bg-transparent text-xs placeholder:text-neutral-600 focus:outline-none"
          />
          <kbd className="hidden rounded thin-border px-1 text-[10px] text-neutral-400 sm:block" title="Premi / per cercare">/</kbd>
          <button
            type="button"
            onClick={runQuick}
            aria-label="Cerca"
            data-testid="cf-search"
            className="rounded bg-neutral-200 px-2 py-1 text-xs font-bold text-black"
          >
            🔍
          </button>
        </div>
        <div className="mt-4 flex gap-5 thin-border-b" role="tablist" aria-label="Pannello ricerca">
          {stab("adv", "Ricerca avanzata", "adv-open")}
          {stab("recs", "Consigliati")}
          {stab("syntax", "Sintassi")}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4 pt-3" data-testid="search-scroll">
        {activeTab === "recs" ? (
          <RecsTab large={standalone} onHover={onHover} />
        ) : activeTab === "syntax" ? (
          <SyntaxTab />
        ) : (
          <ResultsTab search={search} large={standalone} onHover={onHover} />
        )}
      </div>
      {advOpen && (
        <AdvancedModal
          onClose={() => setAdvOpen(false)}
          onSearch={(f) => {
            setSearch({ q: buildSearchQuery(f), order: f.order, dir: f.dir });
            setAdvOpen(false);
            setActiveTab("results");
          }}
        />
      )}
    </aside>
  );
}

/** Aggiunta rapida alla lista (zona scelta, stampa Scryfall a risoluzione piena). */
function useQuickAdd(): { add: (hit: SearchHit, zone?: Zone) => void; justAdded: string | null } {
  const [justAdded, setJustAdded] = useState<string | null>(null);
  return {
    justAdded,
    add: (hit, zone = "main") => {
      useDeck.getState().add({
        name: hit.name,
        qty: 1,
        zone,
        provider: "scryfall",
        providerId: hit.id,
        setCode: hit.setCode,
        collectorNumber: hit.collectorNumber,
        imageFront: hit.imageFull ?? hit.imageLarge ?? hit.thumb,
        imageBack: hit.imageBack,
        hasBack: hit.hasBack,
      });
      setJustAdded(hit.id);
      window.setTimeout(() => {
        setJustAdded((cur) => (cur === hit.id ? null : cur));
      }, 1200);
    },
  };
}

/** Zone in cui puoi aggiungere un risultato, nell'ordine del deck. */
const ADD_ZONES: Zone[] = ["main", "side", "commander", "maybe", "tokens", "extra", "considering", "custom"];

/** Menu contestuale del "+": scelta della zona di destinazione. */
function ZoneAddMenu({
  name,
  x,
  y,
  onPick,
  onClose,
}: {
  name: string;
  x: number;
  y: number;
  onPick: (zone: Zone) => void;
  onClose: () => void;
}): JSX.Element {
  const left = Math.max(4, Math.min(x, window.innerWidth - 184));
  const top = Math.max(4, Math.min(y, window.innerHeight - 300));
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const item = "block w-full rounded px-2 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800";
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        role="menu"
        aria-label={`Aggiungi ${name} a…`}
        data-testid="hit-add-menu"
        className="panel-2 thin-border fixed z-50 w-44 rounded p-1 shadow-xl"
        style={{ left, top }}
      >
        <p className="truncate px-2 py-1 text-[11px] font-bold text-neutral-400">Aggiungi a…</p>
        {ADD_ZONES.map((z) => (
          <button
            key={z}
            type="button"
            role="menuitem"
            onClick={() => onPick(z)}
            data-testid={`hit-add-zone-${z}`}
            className={item}
          >
            {ZONE_LABELS[z]}
          </button>
        ))}
      </div>
    </>
  );
}

/** Tile risultato: artwork, rank, prezzo, quick-add; il + sceglie la zona. */
function HitTile({
  hit,
  onHover,
  onAdd,
  onAddMenu,
  added,
}: {
  hit: SearchHit;
  onHover: () => void;
  onAdd: () => void;
  onAddMenu: (e: React.MouseEvent) => void;
  added: boolean;
}): JSX.Element {
  return (
    <div className="overflow-hidden rounded-lg thin-border panel" data-testid={`hit-${hit.id}`}>
      <div className="relative">
        <button
          type="button"
          onMouseEnter={onHover}
          onFocus={onHover}
          onClick={onAdd}
          aria-label={`Aggiungi ${hit.name} alla lista`}
          title={`${hit.name} — clic per aggiungere al Main`}
          className="group relative block aspect-[63/88] w-full bg-black"
        >
          <ArtworkImage stored={hit.imageLarge ?? hit.thumb} name={hit.name} />
          {/* overlay su hover con invito */}
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-neutral-200/0 transition-colors duration-150 group-hover:bg-neutral-200/20"
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          >
            <span className="rounded-full bg-neutral-200 px-3 py-1 text-sm font-bold text-black shadow-lg">+</span>
          </span>
          {hit.edhrecRank !== undefined && (
            <span
              className="absolute left-1 top-1 rounded bg-black/80 px-1 py-px text-[10px] font-bold text-amber-300"
              title={`Rank EDHREC #${hit.edhrecRank}`}
            >
              #{hit.edhrecRank}
            </span>
          )}
        </button>
        {/* + separato: apre il menu delle zone (il click sull'arte resta quick-add) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddMenu(e);
          }}
          aria-label={`Scegli dove aggiungere ${hit.name}`}
          title="Aggiungi a…"
          data-testid={`hit-add-menu-${hit.id}`}
          className="absolute bottom-1 right-1 z-10 rounded bg-neutral-200 px-1.5 py-px text-[11px] font-bold text-black hover:bg-white"
        >
          +
        </button>
        {added && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 rounded bg-green-700 px-1 py-px text-[10px] font-bold text-white"
          >
            ✓
          </span>
        )}
      </div>
      <div className="px-2 py-[7px]">
        <p className="truncate text-[11px] font-semibold" title={hit.name}>{hit.name}</p>
        <p className="truncate text-[9px] text-neutral-400">
          {[hit.setCode, hit.priceUsd ? `$${hit.priceUsd}` : null].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
    </div>
  );
}

/** Preview rapida stile mockup: riga compatta con + Aggiungi. */
function HitPreview({ hit }: { hit: SearchHit | null }): JSX.Element | null {
  const { add, justAdded } = useQuickAdd();
  if (!hit) return <p className="text-[11px] text-neutral-400">Passa sopra una carta per l'anteprima.</p>;
  return (
    <div className="mb-4 flex gap-3 rounded-[10px] thin-border panel p-2.5" data-testid="hit-preview">
      <div className="aspect-[63/88] w-28 shrink-0 overflow-hidden rounded-md bg-black">
        <ArtworkImage stored={hit.imageLarge} name={hit.name} imgClassName="h-full w-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{hit.name}</p>
        <p className="text-[11px] text-neutral-400">{hit.typeLine}</p>
        {hit.oracleText && <p className="line-clamp-4 text-[11px] text-neutral-400">{hit.oracleText}</p>}
        <p className="mt-1 text-[11px] text-neutral-400">
          {[hit.setCode, hit.rarity, hit.priceUsd ? `$${hit.priceUsd}` : null, hit.edhrecRank ? `#${hit.edhrecRank}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <button
          type="button"
          onClick={() => add(hit)}
          className="mt-1.5 rounded-lg bg-neutral-200 px-3 py-1 text-xs font-semibold text-black"
          aria-label={`Aggiungi ${hit.name} alla lista`}
        >
          {justAdded === hit.id ? "Aggiunta ✓" : "+ Aggiungi"}
        </button>
      </div>
    </div>
  );
}

function ResultsGrid({
  hits,
  total,
  hasMore,
  emptyHint,
  large = false,
  onHover,
}: {
  hits: SearchHit[];
  total: number;
  hasMore: boolean;
  emptyHint: string;
  /** sezione Cerca a tutta pagina: 4 colonne e preview nell'isola a destra */
  large?: boolean;
  onHover?: (hit: SearchHit) => void;
}): JSX.Element {
  const { add, justAdded } = useQuickAdd();
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [addMenu, setAddMenu] = useState<{ hit: SearchHit; x: number; y: number } | null>(null);
  const hovered = hits.find((h) => h.id === hoverId) ?? hits[0] ?? null;
  const firstId = hits[0]?.id;
  // nella scheda Cerca mostra subito il primo risultato nell'isola a destra
  useEffect(() => {
    if (large && hits[0]) onHover?.(hits[0]);
  }, [firstId, large, onHover, hits]);
  if (hits.length === 0) return <p className="text-xs text-neutral-400">{emptyHint}</p>;
  return (
    <div>
      {!large && <HitPreview hit={hovered} />}
      <p className="mb-2.5 text-[11px] text-neutral-400" aria-live="polite">
        {total > 0 ? `${total} risultati` : `${hits.length} carte`}{hasMore ? " — primi per rank" : ""}
      </p>
      <div className={large ? "grid grid-cols-4 gap-3" : "grid grid-cols-2 gap-2.5"}>
        {hits.map((h) => (
          <HitTile
            key={h.id}
            hit={h}
            onHover={() => {
              setHoverId(h.id);
              onHover?.(h);
            }}
            added={justAdded === h.id}
            onAdd={() => add(h)}
            onAddMenu={(e) => setAddMenu({ hit: h, x: e.clientX, y: e.clientY })}
          />
        ))}
      </div>
      {addMenu && (
        <ZoneAddMenu
          name={addMenu.hit.name}
          x={addMenu.x}
          y={addMenu.y}
          onPick={(zone) => {
            add(addMenu.hit, zone);
            setAddMenu(null);
          }}
          onClose={() => setAddMenu(null)}
        />
      )}
    </div>
  );
}

function ResultsTab({
  search,
  large,
  onHover,
}: {
  search: ActiveSearch | null;
  large?: boolean;
  onHover?: (hit: SearchHit) => void;
}): JSX.Element {
  const result = useQuery({
    queryKey: ["cardfinder", search?.q ?? "", search?.order ?? "", search?.dir ?? ""],
    queryFn: ({ signal }) =>
      searchCardsAdvanced(
        search?.q ?? "",
        { order: search?.order ?? "edhrec", dir: search?.dir ?? "auto" },
        signal,
      ),
    enabled: search !== null && search.q.trim().length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });

  if (!search) {
    return (
      <p className="text-xs text-neutral-400">
        Cerca per nome qui sopra, oppure apri la ricerca avanzata per filtrare tutto il database.
      </p>
    );
  }
  if (result.isLoading) return <p className="text-xs text-neutral-400">Ricerca…</p>;
  if (result.isError) return <p className="text-xs text-red-400">Ricerca fallita — riprova.</p>;
  return (
    <ResultsGrid
      hits={result.data?.hits ?? []}
      total={result.data?.total ?? 0}
      hasMore={result.data?.hasMore ?? false}
      emptyHint="Nessun risultato con questi filtri."
      large={large}
      onHover={onHover}
    />
  );
}

function RecsTab({
  large,
  onHover,
}: {
  large?: boolean;
  onHover?: (hit: SearchHit) => void;
}): JSX.Element {
  const deck = useDeck((s) => s.deck);
  const commander = deck.find((c) => isCommander(c)) ?? null;
  const exclude = new Set(deck.map((c) => c.name.trim().toLowerCase()));
  const [bracketSafe, setBracketSafe] = useState(false);

  /** Bracket del mazzo (main + comandante) per filtrare i consigliati. */
  const deckMeta = useCardMeta(
    deck.map((c) => ({ name: c.name, provider: c.provider, providerId: c.providerId, setCode: c.setCode })),
  ).meta;
  const bracket = useMemo(
    () =>
      computeBracket(
        deck
          .filter((c) => c.zone === "main" || c.zone === "commander")
          .map((c) => {
            const m = findMeta(deckMeta, {
              name: c.name,
              provider: c.provider,
              providerId: c.providerId,
              setCode: c.setCode,
            });
            return { name: c.name, qty: c.qty, gameChanger: m?.gameChanger, massLandDenial: m?.massLandDenial };
          }),
      ),
    [deck, deckMeta],
  );

  const identity = useQuery({
    queryKey: ["commander-identity", commander?.name ?? ""],
    queryFn: ({ signal }) => fetchCommanderIdentity(commander?.name ?? "", signal),
    enabled: commander !== null,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  const recs = useQuery({
    queryKey: ["recs", commander?.name ?? "", (identity.data ?? []).join("")],
    queryFn: ({ signal }) => fetchRecs(identity.data ?? [], exclude, signal, 100),
    enabled: identity.data !== undefined && identity.data !== null,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const hiddenGc = recs.data?.filter((h) => h.gameChanger).length ?? 0;
  const hiddenMld = recs.data?.filter((h) => isMassLandDenial(h.name, h.oracleText)).length ?? 0;
  const shown = useMemo(() => {
    if (!recs.data) return undefined;
    if (!bracketSafe) return recs.data;
    // "dentro il bracket": niente Game Changer; mass land denial solo se il mazzo è sotto il B4
    return recs.data.filter(
      (h) => !h.gameChanger && (bracket.bracket >= 4 || !isMassLandDenial(h.name, h.oracleText)),
    );
  }, [recs.data, bracketSafe, bracket.bracket]);
  const hidden = recs.data && shown ? recs.data.length - shown.length : 0;

  if (!commander) {
    return (
      <p className="text-xs text-neutral-400">
        Segna un comandante con ★ nella lista per vedere qui la Top 100 nei suoi colori.
      </p>
    );
  }
  const letters = [...(identity.data ?? [])].sort().join("").toUpperCase();

  return (
    <div>
      <p className="mb-1 text-[11px] text-neutral-400">
        Top 100 per <span className="font-bold text-neutral-200">{commander.name}</span>
        {letters ? ` · identità ${letters}` : ""} · terre in fondo
      </p>
      <p className="mb-2 text-[11px] text-neutral-400">
        Rank EDHREC nei tuoi colori.{" "}
        <button
          type="button"
          onClick={() => void openExternal(edhrecCommanderUrl(commander.name))}
          className="underline hover:text-neutral-300"
        >
          Pagina EDHREC completa ↗
        </button>
      </p>

      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg panel-2 thin-border px-2 py-1.5">
        <label
          className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-200"
          title="Esclude le Game Changer e, sotto il Bracket 4, il mass land denial. Le combo a 2 carte non sono rilevabili dai metadati."
        >
          <input
            type="checkbox"
            checked={bracketSafe}
            onChange={(e) => setBracketSafe(e.target.checked)}
            data-testid="recs-bracket-safe"
          />
          Solo carte dentro il bracket
        </label>
        <span className="text-[10px] text-neutral-400">
          {BRACKET_LABEL[bracket.bracket]} ·{" "}
          {hiddenGc > 0 ? `${hiddenGc} Game Changer nella lista` : "nessuna Game Changer nella lista"}
          {bracket.bracket < 4 && hiddenMld > 0 ? ` · ${hiddenMld} mass land denial` : ""}
        </span>
      </div>
      {bracketSafe && hidden > 0 && (
        <p className="mb-2 text-[10px] text-neutral-500" data-testid="recs-bracket-hidden">
          {hidden} {hidden === 1 ? "carta nascosta" : "carte nascoste"} dal filtro bracket.
        </p>
      )}

      {identity.isLoading && <p className="text-xs text-neutral-400">Comandante…</p>}
      {identity.data === null && (
        <p className="text-xs text-yellow-400">Comandante non trovato su Scryfall — consigliati non disponibili.</p>
      )}
      {recs.isLoading && <p className="text-xs text-neutral-400">Carico consigliati…</p>}
      {recs.isError && <p className="text-xs text-red-400">Consigliati non disponibili — riprova.</p>}
      {shown && (
        <ResultsGrid
          hits={shown}
          total={shown.length}
          hasMore={false}
          emptyHint={
            bracketSafe
              ? "Nessun consigliato dentro il bracket: togli il filtro per vedere la lista completa."
              : "Nessun consigliato fuori dalla tua lista."
          }
          large={large}
          onHover={onHover}
        />
      )}
    </div>
  );
}

/** Tab Sintassi: promemoria campi supportati (offline) + doc completa. */
function SyntaxTab(): JSX.Element {
  const rows: [string, string][] = [
    ["nome", "testo libero o nome esatto"],
    ["t:", "tipo — es. t:creature"],
    ["o:", "testo oracolo — o:\"draw a card\""],
    ["c: / id:", "colori / identità — c:r, id<=rg"],
    ["e:", "set — es. e:40k"],
    ["mv: / pow: / tou: / loy:", "numeri con = ≤ ≥"],
    ["mana:", "costo esatto — mana:{2}{G}"],
    ["r:", "rarità — common, uncommon, rare, mythic"],
    ["f:", "formato — f:commander"],
  ];
  return (
    <div>
      <p className="mb-2 text-[11px] leading-relaxed text-neutral-400">
        La ricerca usa la sintassi Scryfall. Campi principali:
      </p>
      <ul className="mb-3 space-y-1">
        {rows.map(([k, v]) => (
          <li key={k} className="flex gap-2 text-[11px]">
            <code className="shrink-0 rounded panel-2 px-1 font-mono text-neutral-200">{k}</code>
            <span className="text-neutral-400">{v}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => void openExternal("https://scryfall.com/docs/syntax")}
        className="rounded-lg bg-neutral-200 px-3 py-1.5 text-[11px] font-semibold text-black"
      >
        Documentazione completa ↗
      </button>
    </div>
  );
}

const TYPE_SUGGESTIONS = ["creature", "instant", "sorcery", "artifact", "enchantment", "planeswalker", "land"];

const ORDER_OPTIONS: { v: SearchOrder; l: string }[] = [
  { v: "edhrec", l: "Pertinenza EDHREC" },
  { v: "name", l: "Nome" },
  { v: "cmc", l: "Costo di mana" },
  { v: "usd", l: "Prezzo" },
];

const COLOR_BUTTONS: [string, string][] = [
  ["W", "Bianco"],
  ["U", "Blu"],
  ["B", "Nero"],
  ["R", "Rosso"],
  ["G", "Verde"],
];

/** Modale ricerca avanzata (come Moxfield): compone sintassi Scryfall. */
function AdvancedModal({
  onClose,
  onSearch,
}: {
  onClose: () => void;
  onSearch: (f: SearchFilters) => void;
}): JSX.Element {
  const [f, setF] = useState<SearchFilters>({ ...EMPTY_FILTERS });
  const set = (patch: Partial<SearchFilters>): void => setF((prev) => ({ ...prev, ...patch }));

  const toggleIn = (key: "colors" | "identity", c: string): void =>
    setF((prev) => {
      const arr = prev[key];
      const next = arr.includes(c) ? arr.filter((x) => x !== c) : [...arr, c];
      return { ...prev, [key]: next };
    });

  const num = (v: string): number | null => {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const colorRow = (
    key: "colors" | "identity",
    modeKey: "colorMode" | "identityMode",
    label: string,
    testPrefix: string,
  ): JSX.Element => (
    <div className="mb-2">
      <p className="mb-1 text-xs text-neutral-400">{label}</p>
      <div className="flex items-center gap-1">
        {COLOR_BUTTONS.map(([v, l]) => (
          <button
            key={v}
            type="button"
            onClick={() => toggleIn(key, v)}
            aria-pressed={f[key].includes(v)}
            aria-label={`${label} ${l}`}
            data-testid={`${testPrefix}-${v}`}
            className={`h-6 w-6 rounded-full text-[11px] font-bold ${
              f[key].includes(v) ? "bg-neutral-200 text-black" : "thin-border panel-2 text-neutral-400"
            }`}
          >
            {v}
          </button>
        ))}
        <button
          type="button"
          onClick={() => toggleIn(key, "C")}
          aria-pressed={f[key].includes("C")}
          aria-label={`${label} incolore`}
          data-testid={`${testPrefix}-C`}
          className={`h-6 w-6 rounded-full text-[11px] font-bold ${
            f[key].includes("C") ? "bg-neutral-200 text-black" : "thin-border panel-2 text-neutral-400"
          }`}
        >
          C
        </button>
        <select
          value={f[modeKey]}
          onChange={(e) => set({ [modeKey]: e.target.value } as Partial<SearchFilters>)}
          aria-label={`${label}: tutte o una qualsiasi`}
          className="thin-border panel-2 ml-1 rounded px-1 py-1 text-[11px] text-neutral-200"
        >
          <option value="all">Tutte selezionate</option>
          <option value="any">Una qualsiasi</option>
        </select>
      </div>
    </div>
  );

  const opNum = (
    opKey: "mvOp" | "powOp" | "touOp" | "loyOp",
    valKey: "mv" | "pow" | "tou" | "loy",
    label: string,
  ): JSX.Element => (
    <label className="block text-xs text-neutral-400">
      {label}
      <span className="mt-0.5 flex gap-1">
        <select
          value={f[opKey]}
          onChange={(e) => set({ [opKey]: e.target.value as FilterOp } as Partial<SearchFilters>)}
          aria-label={`${label}: confronto`}
          className="thin-border panel-2 rounded px-1 py-1 text-xs text-neutral-200"
        >
          <option value="=">=</option>
          <option value="<=">≤</option>
          <option value=">=">≥</option>
        </select>
        <input
          type="number"
          min={0}
          max={99}
          value={f[valKey] ?? ""}
          onChange={(e) => set({ [valKey]: num(e.target.value) } as Partial<SearchFilters>)}
          aria-label={label}
          className="thin-border panel-2 min-w-0 flex-1 rounded px-2 py-1 text-xs text-neutral-200"
        />
      </span>
    </label>
  );

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
        aria-label="Ricerca avanzata"
        data-testid="adv-modal"
        className="max-h-[85vh] w-full max-w-md overflow-auto rounded-lg thin-border panel p-3"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold">Ricerca avanzata</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi ricerca avanzata"
            className="thin-border panel-2 rounded px-2 py-1 text-xs"
          >
            ✕
          </button>
        </div>
        <label className="mb-2 block text-xs text-neutral-400">Nome carta
          <input
            value={f.text}
            onChange={(e) => set({ text: e.target.value })}
            placeholder="es. dragon"
            aria-label="Nome carta"
            data-testid="adv-text"
            className="thin-border panel-2 mt-0.5 w-full rounded px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-600"
          />
        </label>
        <label className="mb-2 block text-xs text-neutral-400">Set / Espansione (codice)
          <input
            value={f.set}
            onChange={(e) => set({ set: e.target.value })}
            placeholder="es. 40k (vuoto = qualsiasi)"
            aria-label="Set"
            className="thin-border panel-2 mt-0.5 w-full rounded px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-600"
          />
        </label>
        <label className="mb-2 block text-xs text-neutral-400">Testo oracolo
          <input
            value={f.oracle}
            onChange={(e) => set({ oracle: e.target.value })}
            placeholder="Per frasi esatte usa le virgolette"
            aria-label="Testo oracolo"
            className="thin-border panel-2 mt-0.5 w-full rounded px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-600"
          />
        </label>
        <label className="mb-2 block text-xs text-neutral-400">Tipo carta
          <input
            value={f.type}
            onChange={(e) => set({ type: e.target.value })}
            placeholder="es. creature (suggeriti sotto)"
            aria-label="Tipo carta"
            data-testid="adv-type"
            list="adv-types"
            className="thin-border panel-2 mt-0.5 w-full rounded px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-600"
          />
          <datalist id="adv-types">
            {TYPE_SUGGESTIONS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        {colorRow("colors", "colorMode", "Colori", "adv-color")}
        {colorRow("identity", "identityMode", "Identità di colore", "adv-identity")}
        <div className="mb-2 grid grid-cols-2 gap-2">
          {opNum("mvOp", "mv", "Costo di mana (CMC)")}
          <label className="block text-xs text-neutral-400">Costo di mana
            <input
              value={f.manaCost}
              onChange={(e) => set({ manaCost: e.target.value })}
              placeholder="es. {2}{G}{G}"
              aria-label="Costo di mana"
              className="thin-border panel-2 mt-0.5 w-full rounded px-2 py-1 font-mono text-xs text-neutral-100 placeholder:text-neutral-600"
            />
          </label>
        </div>
        <div className="mb-2 grid grid-cols-3 gap-2">
          {opNum("powOp", "pow", "Forza")}
          {opNum("touOp", "tou", "Costituzione")}
          {opNum("loyOp", "loy", "Fedeltà")}
        </div>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <label className="block text-xs text-neutral-400">Rarità
            <select
              value={f.rarity}
              onChange={(e) => set({ rarity: e.target.value })}
              aria-label="Rarità"
              className="thin-border panel-2 mt-0.5 w-full rounded px-1 py-1 text-xs text-neutral-200"
            >
              <option value="">Qualsiasi</option>
              <option value="common">Comune</option>
              <option value="uncommon">Non comune</option>
              <option value="rare">Rara</option>
              <option value="mythic">Mitica</option>
            </select>
          </label>
          <label className="block text-xs text-neutral-400">Ordine
            <select
              value={f.order}
              onChange={(e) => set({ order: e.target.value as SearchOrder })}
              aria-label="Ordine risultati"
              className="thin-border panel-2 mt-0.5 w-full rounded px-1 py-1 text-xs text-neutral-200"
            >
              {ORDER_OPTIONS.map((o) => (
                <option key={o.v} value={o.v}>{o.l}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="block text-xs text-neutral-400">Direzione
            <select
              value={f.dir}
              onChange={(e) => set({ dir: e.target.value as SearchDir })}
              aria-label="Direzione ordinamento"
              className="thin-border panel-2 mt-0.5 w-full rounded px-1 py-1 text-xs text-neutral-200"
            >
              <option value="auto">Automatica</option>
              <option value="asc">Crescente</option>
              <option value="desc">Decrescente</option>
            </select>
          </label>
          <label className="flex items-end gap-2 pb-1 text-xs text-neutral-300">
            <input
              type="checkbox"
              checked={f.commanderLegal}
              onChange={(e) => set({ commanderLegal: e.target.checked })}
            />
            Legali Commander
          </label>
        </div>
        <label className="mb-3 flex items-center gap-2 text-xs text-neutral-300" title="Utile per cercare comandanti">
          <input
            type="checkbox"
            checked={f.legendaryOnly}
            onChange={(e) => set({ legendaryOnly: e.target.checked })}
          />
          Solo leggendari
        </label>
        <p className="mb-2 text-[11px] text-neutral-400">
          La ricerca viene convertita in sintassi Scryfall.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="thin-border panel-2 rounded px-3 py-1.5 text-xs"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={() => onSearch(f)}
            data-testid="adv-search"
            className="rounded bg-neutral-200 px-4 py-1.5 text-xs font-bold text-black"
          >
            Cerca
          </button>
        </div>
      </div>
    </div>
  );
}
