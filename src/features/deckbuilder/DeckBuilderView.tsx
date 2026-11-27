import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArtworkImage } from "@/components/ArtworkImage";
import { GameChangerBadge } from "@/components/GameChangerBadge";
import { CardPreview } from "@/features/deckbuilder/CardPreview";
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
import { CATEGORY_LABELS, CATEGORY_ORDER, categoryOf } from "@/lib/cardtype";
import { fetchCommanderIdentity, type CardMeta, type SearchHit } from "@/services/cardfinder";
import { edhrecCardUrl, edhrecCommanderUrl } from "@/lib/edhrec";
import { openExternal } from "@/lib/external";
import { ZONE_ORDER, deckMacroZone, DECK_MACRO_ORDER, DECK_MACRO_LABELS } from "@/features/print/printModel";
import { isCommander, totalCopies, useDeck } from "@/stores/deck";
import { useProjects } from "@/stores/projects";
import { useUi } from "@/stores/ui";
import { useCollection } from "@/stores/collection";
import { deckEntryToItem, itemKey, mergeAdd, consolidateItems } from "@/lib/collection";
import { ZONE_LABELS, type CardEntry, type Zone } from "@/types";

type SortKey = "order" | "name" | "qty";

/** Risultato Scryfall → voce fittizia per l'anteprima (solo display). */
function hitAsEntry(h: SearchHit): CardEntry {
  return {
    id: h.id,
    name: h.name,
    qty: 1,
    zone: "main",
    provider: "scryfall",
    providerId: h.id,
    setCode: h.setCode,
    collectorNumber: h.collectorNumber,
    imageFront: h.imageLarge ?? h.thumb,
    hasBack: h.hasBack,
    sortOrder: 0,
  };
}

/** Meta nota dal risultato di ricerca, senza risolvere di nuovo la carta. */
function hitAsMeta(h: SearchHit): CardMeta {
  return {
    typeLine: h.typeLine,
    manaCost: h.manaCost,
    cmc: h.cmc,
    priceUsd: h.priceUsd,
    colorIdentity: h.colorIdentity,
  };
}

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
  const [sort, setSort] = useState<SortKey>("order");
  const [view, setView] = useState<"grid" | "list" | "text">("grid");
  /** vista principale: solo mazzo (default) oppure ricerca/consigliati a sé */
  const [mode, setMode] = useState<"deck" | "search">("deck");
  /** carta mostrata nell'anteprima grande (hover); resta sull'ultima vista */
  const [previewId, setPreviewId] = useState<string | null>(null);
  /** risultato di ricerca sotto il mouse nella scheda Cerca (preview a destra) */
  const [searchHit, setSearchHit] = useState<SearchHit | null>(null);
  /** type_line Scryfall per voce (ID → nome+set → esatto → fuzzy, cache persistente) */
  const typeInfo = useCardTypes(
    deck.map((c) => ({ name: c.name, provider: c.provider, providerId: c.providerId, setCode: c.setCode })),
  );
  /** Meta completo (con prezzo) di una voce: chiave esatta, poi alias per nome. */
  const rawMetaOf = (c: CardEntry): CardMeta | undefined => {
    const ref = { name: c.name, provider: c.provider, providerId: c.providerId, setCode: c.setCode };
    const lower = c.name.trim().toLowerCase();
    const set = (c.setCode ?? "").toLowerCase();
    return (
      typeInfo.meta.get(typeCacheKey(ref)) ??
      typeInfo.meta.get(`n:${lower}|`) ??
      typeInfo.meta.get(`n:${lower}|${set}`)
    );
  };
  /** meta (tipo + costo + segnali bracket) di una voce. */
  const metaOf = (c: CardEntry): {
    type?: string;
    mana?: string;
    gameChanger?: boolean;
    extraTurn?: boolean;
    massLandDenial?: boolean;
  } => {
    const m = rawMetaOf(c);
    return {
      type: m?.typeLine,
      mana: m?.manaCost,
      gameChanger: m?.gameChanger === true,
      extraTurn: m?.extraTurn === true,
      massLandDenial: m?.massLandDenial === true,
    };
  };
  /** type_line di una voce (sottosezioni per tipo dentro le macro-zone). */
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

  /** Cancella con Del la carta attualmente sotto il mouse (undo con Ctrl+Z). */
  const [removeMsg, setRemoveMsg] = useState("");
  /** ultima posizione del puntatore: dopo una rimozione la lista scala sotto il mouse */
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);
  useEffect(() => {
    if (!removeMsg) return;
    const t = window.setTimeout(() => setRemoveMsg(""), 2600);
    return () => window.clearTimeout(t);
  }, [removeMsg]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Delete" || e.repeat) return;
      // mai mentre si scrive (filtro, editor testuale, form) o con overlay aperti
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (!previewId || menu || zoomId || picker || handOpen || collectOpen) return;
      const entry = useDeck.getState().deck.find((c) => c.id === previewId);
      if (!entry) return;
      useDeck.getState().remove(entry.id);
      setRemoveMsg(`${entry.name} rimossa · Ctrl+Z per annullare`);
      // il mouse non si è mosso: la carta successiva è scorsa sotto il puntatore.
      // Rileggi il DOM dopo il render e aggancia quella, così un altro Del funziona.
      const pos = pointerRef.current;
      if (!pos || typeof document.elementFromPoint !== "function") {
        setPreviewId(null);
        return;
      }
      window.requestAnimationFrame(() => {
        if (typeof document.elementFromPoint !== "function") return;
        const under = document
          .elementFromPoint(pos.x, pos.y)
          ?.closest<HTMLElement>('[data-testid^="db-card-"]');
        const nextId = under?.getAttribute("data-testid")?.slice("db-card-".length) ?? null;
        setPreviewId(nextId && useDeck.getState().deck.some((c) => c.id === nextId) ? nextId : null);
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewId, menu, zoomId, picker, handOpen, collectOpen]);

  const copies = totalCopies(deck);
  const commander = useMemo(() => deck.find((c) => isCommander(c)) ?? null, [deck]);
  /** carta dell'anteprima: ultima passata col mouse, altrimenti comandante/prima carta */
  const previewEntry = useMemo(
    () => (previewId ? deck.find((c) => c.id === previewId) : undefined) ?? commander ?? deck[0] ?? null,
    [deck, previewId, commander],
  );
  const previewMeta = previewEntry ? rawMetaOf(previewEntry) : undefined;
  const previewZone = previewEntry ? ZONE_LABELS[previewEntry.zone] : undefined;
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
    const out = deck.filter((c) => q === "" || c.name.toLowerCase().includes(q));
    if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "qty") out.sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
    else out.sort((a, b) => a.sortOrder - b.sortOrder);
    return out;
  }, [deck, query, sort]);

  /** Sezioni SEMPRE per macro-zona, in ordine di gioco (niente vista mista). */
  const macroSections = useMemo(
    () =>
      DECK_MACRO_ORDER.map((zone) => ({
        zone,
        label: DECK_MACRO_LABELS[zone],
        cards: visible.filter((c) => deckMacroZone(c.zone) === zone),
      })).filter((s) => s.cards.length > 0),
    [visible],
  );

  if (deck.length === 0) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-black p-6 text-center text-neutral-100"
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
    <div className="relative flex min-h-0 flex-1 flex-col bg-black text-neutral-100" aria-label="DeckBuilder" data-testid="deckbuilder-view">
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
          <div className="flex gap-0.5 rounded-[9px] panel-2 p-[3px]" role="group" aria-label="Vista DeckBuilder">
            {(
              [
                ["deck", "Mazzo"],
                ["search", "Cerca"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setMode(v)}
                aria-pressed={mode === v}
                data-testid={`db-mode-${v}`}
                title={v === "deck" ? "Solo il mazzo" : "Cerca carte, consigliati EDHREC, sintassi"}
                className={`rounded-[7px] px-3 py-[7px] text-xs font-medium ${mode === v ? "bg-neutral-200 font-semibold text-black" : "text-neutral-400"}`}
              >
                {label}
              </button>
            ))}
          </div>
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

      {mode === "search" ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <SearchPanel standalone onHover={setSearchHit} />
          </div>
          <aside
            className="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto border-l thin-border p-3 [scrollbar-gutter:stable] 2xl:w-[380px]"
            aria-label="Anteprima ricerca"
            data-testid="db-search-preview"
          >
            <CardPreview
              entry={searchHit ? hitAsEntry(searchHit) : null}
              meta={searchHit ? hitAsMeta(searchHit) : undefined}
              hideQty
            />
          </aside>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* barra filtri: ricerca, ordine, vista (le zone sono sempre fisse) */}
      <div className="flex flex-wrap items-center gap-2.5 border-b thin-border px-5 py-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtra per nome…"
          aria-label="Filtra carte per nome"
          data-testid="db-search"
          className="min-w-44 rounded-lg thin-border panel-2 px-3 py-2 text-xs placeholder:text-neutral-600 focus:outline-none"
        />
        <span className="text-[11px] text-neutral-400" aria-live="polite" data-testid="db-count">
          {visible.length} {visible.length === 1 ? "voce" : "voci"}
        </span>
        <span className="hidden text-[10px] text-neutral-500 lg:inline" title="Passa il mouse su una carta e premi Canc">
          Del rimuove la carta sotto il mouse
        </span>
        <div className="ml-auto flex items-center gap-2">
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
      </div>

      {view === "text" ? (
        <div className="min-h-0 flex-1 overflow-auto px-5 pb-8">
          <DeckTextEditor />
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-auto px-5 pb-8">
        {macroSections.map(({ zone, label, cards }) => {
          const copies = cards.reduce((n, c) => n + c.qty, 0);
          // main e side: sottosezioni per tipo (come prima); maybe/token restano piatti
          const byType = zone === "main" || zone === "side";
          // il comandante resta NEL deck ma sempre in cima, fuori dai gruppi per tipo
          const commanders = byType ? cards.filter((c) => isCommander(c)) : [];
          const typeCards = byType ? cards.filter((c) => !isCommander(c)) : cards;
          return (
            <section key={zone} aria-label={label} className="mb-6 last:mb-0">
              <SectionHead
                testid={`db-zone-${zone}`}
                tag={label}
                count={`${cards.length} ${cards.length === 1 ? "carta" : "carte"} · ${copies} copie`}
              />
              {byType ? (
                <div className="space-y-5">
                  {commanders.length > 0 && (
                    <div data-testid={`db-type-${zone}-commander`}>
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-[11px] font-medium text-neutral-300">Comandante</span>
                        <span className="text-[10px] text-neutral-500">
                          {commanders.length} {commanders.length === 1 ? "carta" : "carte"}
                        </span>
                        <span className="h-px flex-1 bg-[#1a1a1a]" aria-hidden="true" />
                      </div>
                      <SectionCards
                        cards={commanders}
                        view={view}
                        onPick={(c) => openPicker(c.id, c.name, c.providerId, "entry")}
                        onMenu={(e, c) => openMenu(e, c.id)}
                        onPreview={(c) => setPreviewId(c.id)}
                        metaOf={metaOf}
                      />
                    </div>
                  )}
                  {CATEGORY_ORDER.map((cat) => {
                    const group = typeCards.filter((c) => categoryOf(typeOf(c)) === cat);
                    if (group.length === 0) return null;
                    const groupCopies = group.reduce((n, c) => n + c.qty, 0);
                    return (
                      <div key={cat} data-testid={`db-type-${zone}-${cat}`}>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-[11px] font-medium text-neutral-300">
                            {CATEGORY_LABELS[cat]}
                          </span>
                          <span className="text-[10px] text-neutral-500">
                            {group.length} {group.length === 1 ? "carta" : "carte"} · {groupCopies} copie
                          </span>
                          {cat === "unknown" && (
                            <button
                              type="button"
                              onClick={typeInfo.retry}
                              className="text-[10px] text-neutral-400 underline hover:text-neutral-100"
                              title="Riprova a risolvere i tipi su Scryfall"
                            >
                              Riprova tipi
                            </button>
                          )}
                          <span className="h-px flex-1 bg-[#1a1a1a]" aria-hidden="true" />
                        </div>
                        <SectionCards
                          cards={group}
                          view={view}
                          onPick={(c) => openPicker(c.id, c.name, c.providerId, "entry")}
                          onMenu={(e, c) => openMenu(e, c.id)}
                          onPreview={(c) => setPreviewId(c.id)}
                          metaOf={metaOf}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <SectionCards
                  cards={cards}
                  view={view}
                  onPick={(c) => openPicker(c.id, c.name, c.providerId, "entry")}
                  onMenu={(e, c) => openMenu(e, c.id)}
                  onPreview={(c) => setPreviewId(c.id)}
                  metaOf={metaOf}
                />
              )}
            </section>
          );
        })}
        {visible.length === 0 && (
          <p className="text-sm text-neutral-500">Nessuna carta corrisponde al filtro.</p>
        )}
      </div>
      )}
          </div>
          {/* isola sticky a destra: anteprima + statistiche */}
          <aside
            className="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto border-l thin-border p-3 [scrollbar-gutter:stable] 2xl:w-[380px]"
            aria-label="Riepilogo mazzo"
            data-testid="db-rail"
          >
            <CardPreview entry={previewEntry} meta={previewMeta} zoneLabel={previewZone} />
            <DeckStats deck={deck} />
          </aside>
        </div>
      )}

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
      {removeMsg && (
        <p
          role="status"
          data-testid="db-remove-toast"
          className="panel-2 thin-border absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs text-neutral-300 shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
        >
          {removeMsg}
        </p>
      )}
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

/** Sezione per macro-zona (Main Deck, Sideboard, …) con conteggi. */

/** Griglia o lista di carte (condivisa tra sezioni zona e tipo). */
function SectionCards({
  cards,
  view,
  onPick,
  onMenu,
  onPreview,
  metaOf,
}: {
  cards: CardEntry[];
  view: "grid" | "list";
  onPick: (c: CardEntry) => void;
  onMenu: (e: React.MouseEvent, c: CardEntry) => void;
  onPreview: (c: CardEntry) => void;
  metaOf: (c: CardEntry) => { type?: string; mana?: string; gameChanger?: boolean };
}): JSX.Element {
  if (view === "grid") {
    return (
      <div className="grid grid-cols-6 gap-3 pb-1.5">
        {cards.map((c) => (
          <CardTile
            key={c.id}
            card={c}
            meta={metaOf(c)}
            onPick={() => onPick(c)}
            onMenu={(e) => onMenu(e, c)}
            onHover={() => onPreview(c)}
          />
        ))}
      </div>
    );
  }
  return (
    <ul className="divide-y divide-neutral-900 rounded-lg thin-border">
      {cards.map((c) => (
        <CardRow
          key={c.id}
          card={c}
          meta={metaOf(c)}
          onPick={() => onPick(c)}
          onMenu={(e) => onMenu(e, c)}
          onHover={() => onPreview(c)}
        />
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
  onHover,
}: {
  card: CardEntry;
  meta: { type?: string; mana?: string; gameChanger?: boolean };
  onPick: () => void;
  onMenu: (e: React.MouseEvent) => void;
  onHover: () => void;
}): JSX.Element {
  const setQty = useDeck((s) => s.setQty);
  const cost = prettyManaCost(meta.mana);
  return (
    <div
      className="overflow-hidden rounded-[10px] thin-border panel transition-colors hover:border-neutral-100"
      data-testid={`db-card-${card.id}`}
      onContextMenu={onMenu}
      onMouseEnter={onHover}
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
  onHover,
}: {
  card: CardEntry;
  meta: { type?: string; mana?: string; gameChanger?: boolean };
  onPick: () => void;
  onMenu: (e: React.MouseEvent) => void;
  onHover: () => void;
}): JSX.Element {
  return (
    <li
      className="flex items-center gap-2 panel px-2 py-1.5"
      data-testid={`db-card-${card.id}`}
      onContextMenu={onMenu}
      onMouseEnter={onHover}
    >
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
