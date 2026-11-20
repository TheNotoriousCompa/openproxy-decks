import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArtworkImage } from "@/components/ArtworkImage";
import { GameChangerBadge } from "@/components/GameChangerBadge";
import { TestHand } from "@/features/deckbuilder/TestHand";
import { DecklistModal } from "@/components/DecklistModal";
import { PrintPicker } from "@/components/PrintPicker";
import { PrintBusyToast } from "@/components/PrintBusyToast";
import { SearchPanel } from "@/features/deckbuilder/SearchPanel";
import { DeckTextEditor } from "@/features/deckbuilder/DeckTextEditor";
import { DeckStats } from "@/features/deckbuilder/DeckStats";
import { useChoosePrint } from "@/hooks/useChoosePrint";
import { useArtworkSrc } from "@/hooks/useArtwork";
import { useCardTypes, typeCacheKey } from "@/hooks/useCardTypes";
import { prettyManaCost } from "@/lib/scryart";
import { fetchCommanderIdentity } from "@/services/cardfinder";
import { CATEGORY_LABELS, CATEGORY_ORDER, categoryOf, type CardCategory } from "@/lib/cardtype";
import { edhrecCardUrl, edhrecCommanderUrl } from "@/lib/edhrec";
import { openExternal } from "@/lib/external";
import { ZONE_ORDER } from "@/features/print/printModel";
import { isCommander, totalCopies, useDeck } from "@/stores/deck";
import { useProjects } from "@/stores/projects";
import { useUi } from "@/stores/ui";
import { useCollection } from "@/stores/collection";
import { deckEntryToItem, itemKey, mergeAdd, consolidateItems } from "@/lib/collection";
import { ZONE_LABELS, type CardEntry, type Zone } from "@/types";

type SortKey = "order" | "name" | "qty";

/**
 * DeckBuilder: la stessa lista dello Studio vista come mazzo (stile
 * Archidekt/Moxfield) — griglia visuale su sfondo nero, quantità, zone,
 * comandante e collegamenti EDHREC. Stessa lista, niente duplicati:
 * quello che cambi qui lo ritrovi nei fogli di stampa.
 */
export function DeckBuilderView(): JSX.Element {
  const deck = useDeck((s) => s.deck);
  const setTab = useUi((s) => s.setTab);
  const projectName = useProjects((s) => s.projects.find((p) => p.id === s.activeId)?.name ?? null);
  const { picker, pickerBusy, printJob, openPicker, closePicker, choosePrint, chooseFacePrint } =
    useChoosePrint();
  const [showDecklist, setShowDecklist] = useState(false);
  const [query, setQuery] = useState("");
  const [zoneFilter, setZoneFilter] = useState<Zone | "all">("all");
  const [sort, setSort] = useState<SortKey>("order");
  const [view, setView] = useState<"grid" | "list" | "text">("grid");
  const [group, setGroup] = useState<"zone" | "type">("type");
  /** type_line Scryfall per voce (ID → nome+set → esatto → fuzzy, cache persistente) */
  const typeInfo = useCardTypes(
    deck.map((c) => ({ name: c.name, provider: c.provider, providerId: c.providerId, setCode: c.setCode })),
  );
  /** meta (tipo + costo + segnali bracket) di una voce: chiave esatta, poi alias per nome. */
  const metaOf = (c: CardEntry): {
    type?: string;
    mana?: string;
    gameChanger?: boolean;
    extraTurn?: boolean;
    massLandDenial?: boolean;
  } => {
    const ref = { name: c.name, provider: c.provider, providerId: c.providerId, setCode: c.setCode };
    const lower = c.name.trim().toLowerCase();
    const set = (c.setCode ?? "").toLowerCase();
    const m =
      typeInfo.meta.get(typeCacheKey(ref)) ??
      typeInfo.meta.get(`n:${lower}|`) ??
      typeInfo.meta.get(`n:${lower}|${set}`);
    return {
      type: m?.typeLine,
      mana: m?.manaCost,
      gameChanger: m?.gameChanger === true,
      extraTurn: m?.extraTurn === true,
      massLandDenial: m?.massLandDenial === true,
    };
  };
  /** type_line di una voce per il raggruppamento per tipo. */
  const typeOf = (c: CardEntry): string | undefined => metaOf(c).type;
  /** menu contestuale (tasto destro su carta): {id, x, y} o null */
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  /** zoom carta ingrandita (id voce o null) */
  const [zoomId, setZoomId] = useState<string | null>(null);
  /** dialogo "aggiungi mazzo alla collezione" */
  const [collectOpen, setCollectOpen] = useState(false);
  const [collectStatus, setCollectStatus] = useState("");
  /** mano di test (pesca simulata dalla mainboard) */
  const [handOpen, setHandOpen] = useState(false);
  const collectLoaded = useCollection((s) => s.loaded);
  const collectLoad = useCollection((s) => s.load);
  useEffect(() => {
    if (!collectLoaded) void collectLoad();
  }, [collectLoaded, collectLoad]);

  const openMenu = (e: React.MouseEvent, id: string): void => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ id, x: e.clientX, y: e.clientY });
  };

  const copies = totalCopies(deck);
  const commander = useMemo(() => deck.find((c) => isCommander(c)) ?? null, [deck]);
  /** identità di colore del comandante (pill header; cache condivisa coi Consigliati) */
  const cmdIdentity = useQuery({
    queryKey: ["commander-identity", commander?.name ?? ""],
    queryFn: ({ signal }) => fetchCommanderIdentity(commander?.name ?? "", signal),
    enabled: commander !== null,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
  const zonesPresent = useMemo(
    () => ZONE_ORDER.filter(({ zone }) => deck.some((c) => c.zone === zone)),
    [deck],
  );
  /** Riepilogo copie per zona ("99 Main Deck · 1 Commander · …"), in ordine UI. */
  const zoneBreakdown = useMemo(
    () =>
      zonesPresent.map(({ zone, label }) => ({
        zone,
        label,
        copies: deck.filter((c) => c.zone === zone).reduce((n, c) => n + c.qty, 0),
      })),
    [deck, zonesPresent],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = deck.filter(
      (c) =>
        (zoneFilter === "all" || c.zone === zoneFilter) &&
        (q === "" || c.name.toLowerCase().includes(q)),
    );
    out = [...out];
    if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "qty") out.sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
    else out.sort((a, b) => a.sortOrder - b.sortOrder);
    return out;
  }, [deck, query, zoneFilter, sort]);

  /** Sezioni per categoria di carta (Terre, Creature, …) sulle carte visibili.
   * Comandante, Maybeboard e Token restano gruppi a parte (non sparpagliati
   * per tipo): Comandante per primo, Maybeboard e Token in fondo. */
  const typeSections = useMemo(() => {
    const commanders = visible.filter((c) => isCommander(c));
    const maybe = visible.filter((c) => !isCommander(c) && c.zone === "maybe");
    const tokens = visible.filter((c) => !isCommander(c) && c.zone === "tokens");
    const rest = visible.filter((c) => !isCommander(c) && c.zone !== "maybe" && c.zone !== "tokens");
    return {
      commanders,
      maybe,
      tokens,
      byType: CATEGORY_ORDER.map((cat) => ({
        cat,
        cards: rest.filter((c) => categoryOf(typeOf(c)) === cat),
      })).filter((s) => s.cards.length > 0),
    };
    // typeOf() legge typeInfo.types dal render corrente: dipendenza dati sotto
  }, [visible, typeInfo.types]);

  if (deck.length === 0) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 bg-black p-6 text-center text-neutral-100"
        aria-label="DeckBuilder"
        data-testid="deckbuilder-view"
      >
        <p className="text-sm text-neutral-400">Nessuna carta nella lista.</p>
        <button
          type="button"
          onClick={() => setTab("studio")}
          className="rounded-lg bg-neutral-200 px-4 py-2 text-sm font-semibold text-black"
        >
          Vai in Studio per importare
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-black text-neutral-100" aria-label="DeckBuilder" data-testid="deckbuilder-view">
      {/* intestazione deck: nome, totali, pill comandante + EDHREC */}
      <div className="flex flex-wrap items-center gap-4 border-b thin-border px-5 py-4">
        <h2 className="text-xl font-bold">
          {projectName ?? "DeckBuilder"}
        </h2>
        <p className="text-xs text-neutral-400" aria-live="polite">
          <b className="font-semibold text-neutral-100" title="Carte fisiche totali (somma delle quantità)">
            {copies}
          </b>{" "}
          {copies === 1 ? "copia" : "copie"}
        </p>
        <p className="text-xs text-neutral-400" data-testid="db-zone-breakdown">
          {zoneBreakdown.map(({ zone, label, copies: n }) => (
            <span key={zone} className="mr-2">
              <b className="font-semibold text-neutral-100">{n}</b> {label}
            </span>
          ))}
        </p>
        {commander && (
          <CommanderPill
            commander={commander}
            identity={cmdIdentity.data ?? []}
            onEdhrec={() => void openExternal(edhrecCommanderUrl(commander.name))}
          />
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setHandOpen(true)}
            data-testid="db-test-hand"
            title="Pesca una mano di 7 dalla mainboard, con mulligan e pescata"
            className="rounded-lg thin-border panel-2 px-3.5 py-2 text-xs font-medium"
          >
            Mano di test
          </button>
          <button
            type="button"
            onClick={() => {
              setCollectStatus("");
              setCollectOpen(true);
            }}
            data-testid="db-collect-deck"
            title="Aggiungi tutte le carte del mazzo alla collezione (quantità sommate per stampa)"
            className="rounded-lg thin-border panel-2 px-3.5 py-2 text-xs font-medium"
            aria-label="Aggiungi mazzo alla collezione"
          >
            Collezione +
          </button>
          <button
            type="button"
            onClick={() => setShowDecklist(true)}
            className="rounded-lg thin-border panel-2 px-3.5 py-2 text-xs font-medium"
            aria-label="Visualizza decklist"
          >
            Decklist
          </button>
          <button
            type="button"
            onClick={() => setTab("studio")}
            className="rounded-lg bg-neutral-200 px-3.5 py-2 text-xs font-semibold text-black"
            title="Apri la stessa lista nei fogli di stampa"
          >
            Apri in Studio
          </button>
        </div>
      </div>

      {/* corpo: lista a sinistra, ricerca/consigliati a destra */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <DeckStats deck={deck} />
      {/* barra filtri stile mockup: pill zone, ricerca, icone vista */}
      <div className="flex flex-wrap items-center gap-2.5 border-b thin-border px-5 py-3">
        <div className="flex gap-0.5 rounded-[9px] panel-2 p-[3px]" role="group" aria-label="Filtra per zona">
          <ZoneChip active={zoneFilter === "all"} onClick={() => setZoneFilter("all")}>
            Tutte
          </ZoneChip>
          {zonesPresent.map(({ zone, label }) => (
            <ZoneChip key={zone} active={zoneFilter === zone} onClick={() => setZoneFilter(zone)}>
              {label}
            </ZoneChip>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtra per nome…"
          aria-label="Filtra carte per nome"
          data-testid="db-search"
          className="min-w-44 rounded-lg thin-border panel-2 px-3 py-2 text-xs placeholder:text-neutral-600 focus:outline-none"
        />
        <div className="ml-auto flex items-center gap-2">
          <div className="flex gap-0.5 rounded-[9px] panel-2 p-[3px]" role="group" aria-label="Raggruppa carte">
            {(["zone", "type"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setGroup(v)}
                aria-pressed={group === v}
                data-testid={`db-group-${v}`}
                title={v === "zone" ? "Raggruppa per zona" : "Raggruppa per tipo di carta"}
                className={`rounded-[7px] px-3 py-[7px] text-xs font-medium ${group === v ? "bg-neutral-200 font-semibold text-black" : "text-neutral-400"}`}
              >
                {v === "zone" ? "Zone" : "Tipo"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-[11px] text-neutral-400">
            <span className="sr-only">Ordina carte</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Ordina carte"
              data-testid="db-sort"
              className="rounded-lg thin-border panel-2 px-2 py-2 text-xs"
            >
              <option value="order">Inserimento</option>
              <option value="name">Nome</option>
              <option value="qty">Quantità</option>
            </select>
          </label>
          <div className="flex gap-1" role="group" aria-label="Vista">
            {(
              [
                ["grid", "▦", "Griglia"],
                ["list", "☰", "Lista"],
                ["text", "Aa", "Testo"],
              ] as const
            ).map(([v, glyph, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                aria-label={label}
                title={label}
                data-testid={`db-view-${v}`}
                className={`h-8 w-8 rounded-lg border text-[13px] ${
                  view === v
                    ? "thin-border panel-2 text-neutral-100"
                    : "thin-border panel-2 text-neutral-400"
                }`}
              >
                {glyph}
              </button>
            ))}
          </div>
        </div>
        {group === "type" && typeInfo.loaded < typeInfo.total && (
          <span className="w-full text-[11px] text-neutral-400" aria-live="polite" data-testid="db-types-progress">
            tipi {typeInfo.loaded}/{typeInfo.total}…
          </span>
        )}
      </div>

      {view === "text" ? (
        <div className="min-h-0 flex-1 overflow-auto px-5 pb-8">
          <DeckTextEditor />
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-auto px-5 pb-8">
        {group === "type"
          ? (
            <>
              {typeSections.commanders.length > 0 && (
                <TypeSection
                  cat="creatures"
                  labelOverride="Comandante"
                  testidOverride="db-cat-commander"
                  cards={typeSections.commanders}
                  view={view}
                  onPick={(c) => openPicker(c.id, c.name, c.providerId, "entry")}
                  onMenu={(e, c) => openMenu(e, c.id)}
                  metaOf={metaOf}
                />
              )}
              {typeSections.byType.map(({ cat, cards }) => (
                <TypeSection
                  key={cat}
                  cat={cat}
                  cards={cards}
                  view={view}
                  onPick={(c) => openPicker(c.id, c.name, c.providerId, "entry")}
                  onMenu={(e, c) => openMenu(e, c.id)}
                  metaOf={metaOf}
                  onRetry={typeInfo.retry}
                />
              ))}
              {typeSections.maybe.length > 0 && (
                <TypeSection
                  cat="other"
                  labelOverride="Maybeboard"
                  testidOverride="db-cat-maybeboard"
                  cards={typeSections.maybe}
                  view={view}
                  onPick={(c) => openPicker(c.id, c.name, c.providerId, "entry")}
                  onMenu={(e, c) => openMenu(e, c.id)}
                  metaOf={metaOf}
                />
              )}
              {typeSections.tokens.length > 0 && (
                <TypeSection
                  cat="other"
                  labelOverride="Token"
                  testidOverride="db-cat-tokens"
                  cards={typeSections.tokens}
                  view={view}
                  onPick={(c) => openPicker(c.id, c.name, c.providerId, "entry")}
                  onMenu={(e, c) => openMenu(e, c.id)}
                  metaOf={metaOf}
                />
              )}
            </>
          )
          : zonesPresent
              .filter(({ zone }) => zoneFilter === "all" || zoneFilter === zone)
              .map(({ zone, label }) => {
                const cards = visible.filter((c) => c.zone === zone);
                if (cards.length === 0) return null;
                const zoneCopies = cards.reduce((n, c) => n + c.qty, 0);
                return (
                  <section key={zone} aria-label={label} className="mb-5">
                    <SectionHead
                      testid={`db-zone-${zone}`}
                      tag={label}
                      count={`${cards.length} ${cards.length === 1 ? "carta" : "carte"} · ${zoneCopies} copie`}
                    />
                    <SectionCards
                      cards={cards}
                      view={view}
                      onPick={(c) => openPicker(c.id, c.name, c.providerId, "entry")}
                      onMenu={(e, c) => openMenu(e, c.id)}
                      metaOf={metaOf}
                    />
                  </section>
                );
              })}
        {visible.length === 0 && (
          <p className="text-sm text-neutral-500">Nessuna carta corrisponde al filtro.</p>
        )}
      </div>
      )}
        </div>
        <SearchPanel />
      </div>

      {menu && (
        <CardContextMenu
          entryId={menu.id}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onPick={(id, name, providerId) => {
            setMenu(null);
            openPicker(id, name, providerId, "entry");
          }}
          onZoom={(id) => {
            setMenu(null);
            setZoomId(id);
          }}
        />
      )}
      {zoomId && <CardZoomModal entryId={zoomId} onClose={() => setZoomId(null)} />}
      {handOpen && <TestHand onClose={() => setHandOpen(false)} />}
      {collectOpen && (
        <CollectDeckDialog
          onClose={() => setCollectOpen(false)}
          onDone={(msg) => {
            setCollectOpen(false);
            setCollectStatus(msg);
          }}
        />
      )}
      {collectStatus && (
        <p className="px-5 pb-2 text-xs text-green-400" role="status">
          {collectStatus}
        </p>
      )}
      {picker && (
        <PrintPicker
          cardName={picker.name}
          currentProviderId={picker.providerId}
          totalCopies={picker.totalCopies}
          onSelect={(opt, applyAll) => void choosePrint(opt, applyAll)}
          onSelectFace={(opt, face, applyAll) => void chooseFacePrint(opt, face, applyAll)}
          onClose={closePicker}
        />
      )}
      {pickerBusy && <span className="sr-only" aria-live="polite">Salvataggio stampa…</span>}
      <PrintBusyToast job={printJob} />
      {showDecklist && <DecklistModal onClose={() => setShowDecklist(false)} />}
    </div>
  );
}

/** Dialogo "aggiungi mazzo alla collezione": anteprima delta, poi un click. */
function CollectDeckDialog({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }): JSX.Element {
  const deck = useDeck((s) => s.deck);
  const entries = useCollection((s) => s.entries);
  const add = useCollection((s) => s.add);
  const [busy, setBusy] = useState(false);
  const items = useMemo(() => consolidateItems(deck.map(deckEntryToItem)), [deck]);
  const delta = useMemo(() => mergeAdd(entries, items), [entries, items]);
  const totalQty = items.reduce((n, i) => n + i.qty, 0);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    try {
      await add(items);
      onDone(
        delta.added.length + delta.updated.length === 0
          ? "Mazzo già tutto in collezione."
          : `Aggiunte ${delta.added.length} stampe nuove, +${delta.updated.reduce((n, u) => n + u.added, 0)} copie su esistenti.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div role="dialog" aria-modal="true" aria-label="Aggiungi mazzo alla collezione" data-testid="db-collect-dialog" className="panel thin-border w-full max-w-md rounded-lg p-4">
        <h2 className="mb-1 text-sm font-bold">Aggiungi mazzo alla collezione</h2>
        <p className="mb-3 text-xs text-neutral-400" data-testid="db-collect-summary">
          {totalQty} copie nel mazzo ·{" "}
          {delta.added.length === 0 && delta.updated.length === 0
            ? "hai già tutto"
            : `${delta.added.length} stampe nuove · ${delta.updated.length} già possedute (+${delta.updated.reduce((n, u) => n + u.added, 0)} copie)`}
        </p>
        {(delta.added.length > 0 || delta.updated.length > 0) && (
          <ul className="mb-3 max-h-56 space-y-1 overflow-auto text-xs" data-testid="db-collect-delta">
            {delta.added.map((a) => (
              <li key={a.key} className="flex justify-between gap-2">
                <span className="truncate">{a.name}</span>
                <span className="shrink-0 text-green-400">nuova +{a.qty}</span>
              </li>
            ))}
            {delta.updated.map((u) => (
              <li key={u.key} className="flex justify-between gap-2">
                <span className="truncate">{u.name}</span>
                <span className="shrink-0 text-neutral-400">
                  {u.total - u.added} → {u.total}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="panel-2 thin-border rounded px-3 py-1.5 text-xs">
            Annulla
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy || (delta.added.length === 0 && delta.updated.length === 0)}
            data-testid="db-collect-confirm"
            className="rounded bg-neutral-200 px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
          >
            {busy ? "Aggiungo…" : "Aggiungi"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Intestazione sezione sticky: tag + conteggio + linea. */
function SectionHead({ testid, tag, count }: { testid: string; tag: string; count: string }): JSX.Element {
  return (
    <div className="sticky top-0 z-[2] flex items-center gap-2.5 bg-black pb-2 pt-4">
      <span className="text-[11px] font-bold uppercase tracking-wide text-neutral-200" data-testid={testid}>
        {tag}
      </span>
      <span className="text-[11px] text-neutral-400">{count}</span>
      <span className="h-px flex-1 bg-[#262626]" aria-hidden="true" />
    </div>
  );
}

/** Sezione per categoria di carta (Terre, Creature, …) con conteggi.
 * `labelOverride`/`testidOverride`: gruppi speciali (Comandante, Maybeboard, Token). */
function TypeSection({
  cat,
  cards,
  view,
  onPick,
  onMenu,
  onRetry,
  labelOverride,
  testidOverride,
  metaOf,
}: {
  cat: CardCategory;
  cards: CardEntry[];
  view: "grid" | "list";
  onPick: (c: CardEntry) => void;
  onMenu: (e: React.MouseEvent, c: CardEntry) => void;
  onRetry?: () => void;
  labelOverride?: string;
  testidOverride?: string;
  metaOf: (c: CardEntry) => { type?: string; mana?: string };
}): JSX.Element {
  const copies = cards.reduce((n, c) => n + c.qty, 0);
  const label = labelOverride ?? CATEGORY_LABELS[cat];
  return (
    <section aria-label={label} className="mb-5">
      <SectionHead
        testid={testidOverride ?? `db-cat-${cat}`}
        tag={label}
        count={`${cards.length} ${cards.length === 1 ? "carta" : "carte"} · ${copies} copie`}
      />
      {cat === "unknown" && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mb-2 rounded-lg thin-border panel-2 px-2 py-1 text-[11px]"
          title="Riprova a risolvere i tipi su Scryfall"
          data-testid="db-types-retry"
        >
          Riprova tipi
        </button>
      )}
      <SectionCards cards={cards} view={view} onPick={onPick} onMenu={onMenu} metaOf={metaOf} />
    </section>
  );
}

/** Griglia o lista di carte (condivisa tra sezioni zona e tipo). */
function SectionCards({
  cards,
  view,
  onPick,
  onMenu,
  metaOf,
}: {
  cards: CardEntry[];
  view: "grid" | "list";
  onPick: (c: CardEntry) => void;
  onMenu: (e: React.MouseEvent, c: CardEntry) => void;
  metaOf: (c: CardEntry) => { type?: string; mana?: string };
}): JSX.Element {
  if (view === "grid") {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3.5 pb-1.5">
        {cards.map((c) => (
          <CardTile key={c.id} card={c} meta={metaOf(c)} onPick={() => onPick(c)} onMenu={(e) => onMenu(e, c)} />
        ))}
      </div>
    );
  }
  return (
    <ul className="divide-y divide-neutral-900 rounded-lg thin-border">
      {cards.map((c) => (
        <CardRow key={c.id} card={c} meta={metaOf(c)} onPick={() => onPick(c)} onMenu={(e) => onMenu(e, c)} />
      ))}
    </ul>
  );
}

const IDENTITY_CHIP: Record<string, string> = {
  W: "bg-[#cfc9a8] text-black",
  U: "bg-[#2b5fa1] text-neutral-100",
  B: "bg-[#2b2b2b] text-neutral-100",
  R: "bg-[#a13a2a] text-neutral-100",
  G: "bg-[#3a7a4a] text-neutral-100",
  C: "bg-[#555] text-neutral-100",
};

/** Pill comandante: arte tonda, nome, chip identità di colore, link EDHREC. */
function CommanderPill({
  commander,
  identity,
  onEdhrec,
}: {
  commander: CardEntry;
  identity: string[];
  onEdhrec: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-full thin-border panel-2 py-1 pl-1.5 pr-3">
      <span className="block h-[22px] w-[22px] shrink-0 overflow-hidden rounded-full bg-black">
        {commander.imageFront && (
          <ArtworkImage
            stored={commander.imageFront}
            name={commander.name}
            imgClassName="h-full w-full object-cover"
          />
        )}
      </span>
      <span className="max-w-48 truncate text-xs">{commander.name}</span>
      {identity.length > 0 && (
        <span className="flex gap-[3px]" aria-label={`Identità di colore ${identity.join("")}`}>
          {identity.map((c) => (
            <span
              key={c}
              className={`flex h-[13px] w-[13px] items-center justify-center rounded-full text-[8px] font-bold ${IDENTITY_CHIP[c] ?? IDENTITY_CHIP.C ?? ""}`}
            >
              {c}
            </span>
          ))}
        </span>
      )}
      <button
        type="button"
        onClick={onEdhrec}
        className="text-[11px] font-semibold text-neutral-400 hover:text-neutral-100"
        title={`Apri ${commander.name} su EDHREC`}
        aria-label={`Apri ${commander.name} su EDHREC`}
        data-testid="edhrec-commander"
      >
        EDHREC ↗
      </button>
    </div>
  );
}

function ZoneChip({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-[7px] px-3 py-[7px] text-xs font-medium ${
        active ? "bg-neutral-200 font-semibold text-black" : "text-neutral-400 hover:text-neutral-100"
      }`}
    >
      {children}
    </button>
  );
}

/** Menu tasto destro su carta: ingrandisci, sposta zona, comandante, stampa, EDHREC, rimuovi. */
function CardContextMenu({
  entryId,
  x,
  y,
  onClose,
  onPick,
  onZoom,
}: {
  entryId: string;
  x: number;
  y: number;
  onClose: () => void;
  onPick: (id: string, name: string, providerId?: string) => void;
  onZoom: (id: string) => void;
}): JSX.Element | null {
  const card = useDeck((s) => s.deck.find((c) => c.id === entryId) ?? null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!card) return null;
  const cmd = isCommander(card);
  // il menu resta dentro la viewport, con altezza reale misurata (il menu è
  // più alto di 320px: il vecchio clamp fisso lasciava "Rimuovi" fuori schermo)
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => ({
    left: Math.max(4, Math.min(x, window.innerWidth - 220)),
    top: Math.max(4, Math.min(y, window.innerHeight - 360)),
  }));
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const pad = 8;
    const rect = el.getBoundingClientRect();
    const w = Math.min(rect.width || 208, window.innerWidth - pad * 2);
    const h = Math.min(rect.height || 0, window.innerHeight - pad * 2);
    setPos({
      left: Math.max(pad, Math.min(x, window.innerWidth - w - pad)),
      top: Math.max(pad, Math.min(y, window.innerHeight - h - pad)),
    });
  }, [x, y]);

  const item =
    "block w-full rounded px-2 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-800";

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
        aria-hidden="true"
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label={`Azioni per ${card.name}`}
        data-testid="db-menu"
        className="panel-2 thin-border fixed z-50 w-52 overflow-y-auto overscroll-contain rounded p-1 shadow-xl"
        style={{ left: pos.left, top: pos.top, maxHeight: "calc(100vh - 16px)" }}
      >
        <p className="truncate px-2 py-1 text-[11px] font-bold text-neutral-400">{card.name}</p>
        <button
          type="button"
          role="menuitem"
          onClick={() => onZoom(card.id)}
          data-testid="db-menu-zoom"
          className={`${item} font-semibold`}
          aria-label={`Ingrandisci ${card.name}`}
        >
          🔍 Ingrandisci
        </button>
        <div className="thin-border my-1 border-t border-neutral-800" />
        <p className="px-2 pb-1 text-[10px] uppercase tracking-wide text-neutral-600">Sposta in</p>
        <div>
          {(Object.keys(ZONE_LABELS) as Zone[]).map((z) => (
            <button
              key={z}
              type="button"
              role="menuitem"
              onClick={() => {
                useDeck.getState().moveZone([card.id], z);
                onClose();
              }}
              data-testid={`db-menu-zone-${z}`}
              className={item}
              aria-label={`Sposta ${card.name} in ${ZONE_LABELS[z]}`}
            >
              {card.zone === z ? "✓ " : "　"}Zona · {ZONE_LABELS[z]}
            </button>
          ))}
        </div>
        <div className="thin-border my-1 border-t border-neutral-800" />
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            useDeck.getState().setCommander([card.id], !cmd);
            onClose();
          }}
          data-testid="db-menu-commander"
          className={item}
          aria-label={cmd ? `Togli ${card.name} da comandante` : `Segna ${card.name} come comandante`}
        >
          {cmd ? "☐ Togli comandante" : "★ Segna comandante"}
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => onPick(card.id, card.name, card.providerId)}
          data-testid="db-menu-print"
          className={item}
        >
          Cambia stampa…
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            void openExternal(edhrecCardUrl(card.name));
            onClose();
          }}
          data-testid="db-menu-edhrec"
          className={item}
        >
          Apri su EDHREC ↗
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            void useCollection.getState().add([deckEntryToItem(card)]);
            onClose();
          }}
          data-testid="db-menu-collect"
          className={item}
          aria-label={`Aggiungi ${card.name} alla collezione`}
        >
          Aggiungi alla collezione ＋
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            if (window.confirm(`Rimuovere ${card.name} dalla lista? (annullabile con Undo)`)) {
              useDeck.getState().remove(card.id);
            }
            onClose();
          }}
          data-testid="db-menu-remove"
          className={`${item} text-red-400 hover:bg-red-950`}
        >
          Rimuovi ✕
        </button>
      </div>
    </>
  );
}

/** Zoom carta ingrandita ad alta risoluzione (mai la miniatura da griglia:
 * originale remoto o thumb backend fino a 1024px, con fallback diagnostico). */
function CardZoomModal({ entryId, onClose }: { entryId: string; onClose: () => void }): JSX.Element | null {
  const card = useDeck((s) => s.deck.find((c) => c.id === entryId) ?? null);
  const art = useArtworkSrc(card?.imageFront, { maxPx: 1024 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!card) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
      data-testid="card-zoom"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Ingrandimento di ${card.name}`}
        className="panel thin-border flex max-h-[90vh] flex-col items-center gap-2 rounded-lg p-3"
      >
        <div className="flex w-full items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{card.name}</p>
            <p className="truncate text-[11px] text-neutral-500">
              {[card.setCode, card.collectorNumber].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="panel-2 thin-border rounded px-2 py-1 text-xs"
            aria-label="Chiudi ingrandimento"
            data-testid="card-zoom-close"
          >
            ✕
          </button>
        </div>
        {art.status === "loading" && <p className="text-xs text-neutral-400">Caricamento alta risoluzione…</p>}
        {art.status === "ok" && art.src && (
          <img
            src={art.src}
            alt={card.name}
            className="max-h-[75vh] w-auto max-w-full rounded"
            draggable={false}
          />
        )}
        {art.status !== "loading" && (!art.src || art.status === "error") && (
          <p className="text-xs text-red-400" role="alert">
            {art.detail ?? "Nessuna immagine per questa carta."}
          </p>
        )}
      </div>
    </div>
  );
}

/** Tile visuale: artwork grande, badge quantità, nome, comandi riga. */
/** Badge "possedute" dalla collezione: ✓ se copre la qty, "hai X/Y" altrimenti. */
function OwnedBadge({ card }: { card: CardEntry }): JSX.Element | null {
  const owned =
    useCollection((s) => s.entries.find((e) => e.key === itemKey(deckEntryToItem(card)))?.qty) ?? 0;
  if (owned <= 0) return null;
  const full = owned >= card.qty;
  return (
    <span
      data-testid={`db-owned-${card.id}`}
      title={full ? "Possiedi tutte le copie del mazzo" : `Possiedi ${owned} su ${card.qty}`}
      className={`text-[10px] font-semibold ${full ? "text-green-400" : "text-neutral-400"}`}
    >
      {full ? "✓ collezione" : `${owned}/${card.qty}`}
    </span>
  );
}

/** Tile mockup: carta a rapporto corretto, badge costo, nome, tipo, stepper + kebab. */
function CardTile({
  card,
  meta,
  onPick,
  onMenu,
}: {
  card: CardEntry;
  meta: { type?: string; mana?: string; gameChanger?: boolean };
  onPick: () => void;
  onMenu: (e: React.MouseEvent) => void;
}): JSX.Element {
  const setQty = useDeck((s) => s.setQty);
  const cost = prettyManaCost(meta.mana);
  return (
    <div
      className="overflow-hidden rounded-[10px] thin-border panel transition-colors hover:border-neutral-100"
      data-testid={`db-card-${card.id}`}
      onContextMenu={onMenu}
    >
      <button
        type="button"
        onClick={onPick}
        aria-label={`Cambia stampa di ${card.name}`}
        title="Cambia stampa"
        className="relative block aspect-[63/88] w-full bg-black"
      >
        <ArtworkImage stored={card.imageFront} name={card.name} />
        {meta.gameChanger && (
          <span className="absolute left-1.5 top-1.5">
            <GameChangerBadge name={card.name} />
          </span>
        )}
        {cost && (
          <span className="absolute right-1.5 top-1.5 rounded-[5px] bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold">
            {cost}
          </span>
        )}
      </button>
      <div className="px-2.5 pb-2.5 pt-2">
        <p className="truncate text-xs font-semibold leading-tight" title={card.name}>{card.name}</p>
        <p className="mb-2 truncate text-[10px] text-neutral-400" title={meta.type ?? ""}>
          {meta.type ?? [card.setCode, card.collectorNumber].filter(Boolean).join(" · ") ?? "—"}
        </p>
        <MpcChip card={card} />
        <OwnedBadge card={card} />
        <div className="flex items-center justify-between">
          <span className="flex items-center overflow-hidden rounded-[7px] panel-2" role="group" aria-label={`Quantità di ${card.name}`}>
            <button
              type="button"
              onClick={() => setQty(card.id, card.qty - 1)}
              disabled={card.qty <= 1}
              aria-label={`Riduci quantità di ${card.name}`}
              data-testid={`db-dec-${card.id}`}
              className="h-[22px] w-[22px] text-xs text-neutral-400 disabled:opacity-40"
            >
              −
            </button>
            <span className="w-4 text-center text-[11px]" data-testid={`db-qty-${card.id}`}>{card.qty}</span>
            <button
              type="button"
              onClick={() => setQty(card.id, card.qty + 1)}
              aria-label={`Aumenta quantità di ${card.name}`}
              data-testid={`db-inc-${card.id}`}
              className="h-[22px] w-[22px] text-xs text-neutral-400"
            >
              +
            </button>
          </span>
          <button
            type="button"
            onClick={(e) => onMenu(e)}
            aria-label={`Azioni per ${card.name}`}
            title="Azioni"
            className="px-1.5 py-0.5 text-sm text-neutral-400"
          >
            ⋮
          </button>
        </div>
      </div>
    </div>
  );
}

/** Riga compatta per la vista lista. */
function CardRow({
  card,
  meta,
  onPick,
  onMenu,
}: {
  card: CardEntry;
  meta: { type?: string; mana?: string; gameChanger?: boolean };
  onPick: () => void;
  onMenu: (e: React.MouseEvent) => void;
}): JSX.Element {
  return (
    <li className="flex items-center gap-2 panel px-2 py-1.5" data-testid={`db-card-${card.id}`} onContextMenu={onMenu}>
      <button
        type="button"
        onClick={onPick}
        aria-label={`Cambia stampa di ${card.name}`}
        title="Cambia stampa"
        className="h-12 w-9 shrink-0 overflow-hidden rounded bg-black"
      >
        <ArtworkImage stored={card.imageFront} name={card.name} imgClassName="h-full w-full object-cover" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">
          {card.qty}× {card.name} <OwnedBadge card={card} />
          {meta.gameChanger && (
            <span className="ml-1 inline-flex align-middle">
              <GameChangerBadge name={card.name} />
            </span>
          )}
        </p>
        <p className="truncate text-[11px] text-neutral-500">
          {[card.setCode, card.collectorNumber].filter(Boolean).join(" · ") || "—"}
        </p>
        <MpcChip card={card} />
      </div>
      <CardControls card={card} compact={false} />
    </li>
  );
}

/** Chip MPC ID: mostra l'ID arte, click = copia. Solo voci provider mpc. */
function MpcChip({ card }: { card: CardEntry }): JSX.Element | null {
  const [copied, setCopied] = useState(false);
  if (card.provider !== "mpc" || !card.providerId) return null;
  const id = card.providerId;
  const short = id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
  return (
    <button
      type="button"
      onClick={() => {
        void copyMpcId(id).then((ok) => {
          if (ok) {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }
        });
      }}
      title={`MPC Art ID: ${id} (clic per copiare)`}
      aria-label={`MPC Art ID ${id}, clic per copiare`}
      data-testid={`db-mpc-${card.id}`}
      className="truncate font-mono text-[10px] text-neutral-400 hover:text-neutral-200"
    >
      {copied ? "copiato ✓" : `mpc:${short}`}
    </button>
  );
}

async function copyMpcId(id: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(id);
    return true;
  } catch {
    return false;
  }
}

/** Comandi riga: quantità, comandante, EDHREC, rimuovi. Stessi in tile e riga. */
function CardControls({ card, compact }: { card: CardEntry; compact: boolean }): JSX.Element {
  const setQty = useDeck((s) => s.setQty);
  const remove = useDeck((s) => s.remove);
  const setCommander = useDeck((s) => s.setCommander);
  const cmd = isCommander(card);
  return (
    <div className={`flex items-center gap-1 ${compact ? "mt-1" : ""}`}>
      <button
        type="button"
        onClick={() => setQty(card.id, card.qty - 1)}
        disabled={card.qty <= 1}
        aria-label={`Riduci quantità di ${card.name}`}
        data-testid={`db-dec-${card.id}`}
        className="panel thin-border rounded px-1.5 py-0.5 text-xs disabled:opacity-40"
      >
        −
      </button>
      <button
        type="button"
        onClick={() => setQty(card.id, card.qty + 1)}
        aria-label={`Aumenta quantità di ${card.name}`}
        data-testid={`db-inc-${card.id}`}
        className="panel thin-border rounded px-1.5 py-0.5 text-xs"
      >
        +
      </button>
      <button
        type="button"
        onClick={() => setCommander([card.id], !cmd)}
        aria-pressed={cmd}
        aria-label={cmd ? `Togli ${card.name} da comandante` : `Segna ${card.name} come comandante`}
        title="Comandante"
        className={`rounded px-1.5 py-0.5 text-xs ${cmd ? "bg-red-900 font-bold text-red-100" : "panel thin-border text-neutral-400"}`}
      >
        ★
      </button>
      <button
        type="button"
        onClick={() => void openExternal(edhrecCardUrl(card.name))}
        aria-label={`Apri ${card.name} su EDHREC`}
        title="Apri su EDHREC"
        data-testid={`db-edhrec-${card.id}`}
        className="panel thin-border rounded px-1.5 py-0.5 text-[11px] font-semibold text-neutral-300"
      >
        EDHREC ↗
      </button>
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Rimuovere ${card.name} dalla lista? (annullabile con Undo)`)) remove(card.id);
        }}
        aria-label={`Rimuovi ${card.name}`}
        className="ml-auto rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:text-red-400"
      >
        ✕
      </button>
    </div>
  );
}
