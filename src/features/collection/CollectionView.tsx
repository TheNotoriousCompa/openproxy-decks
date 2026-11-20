import { useEffect, useMemo, useState } from "react";
import { ArtworkImage } from "@/components/ArtworkImage";
import { ArtLightbox, type LightboxItem } from "@/components/ArtLightbox";
import { useCollection } from "@/stores/collection";
import { useProjects } from "@/stores/projects";
import { useCardMeta, typeCacheKey } from "@/hooks/useCardTypes";
import { prettyManaCost } from "@/lib/scryart";
import type { CardMeta } from "@/services/cardfinder";
import type { CollectionEntry, DeckUsage } from "@/lib/collection";
import {
  collectionUsage,
  deckEntryToItem,
  entryImageUrl,
  itemKey,
  missingForDeck,
  ownedByKey,
} from "@/lib/collection";

type SortKey = "type" | "price" | "cmc" | "name" | "qty" | "recent";

/**
 * Collection Manager: i proxy fisici posseduti, una voce per stampa
 * (nome + set + numero). Ricerca, stepper quantità, vista "mancanti" per
 * progetto (cosa stampare per completare un mazzo).
 */
export function CollectionView(): JSX.Element {
  const { entries, loaded, loading, load, add, clear } = useCollection();
  const projects = useProjects((s) => s.projects);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("type");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [missingProject, setMissingProject] = useState<string>("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [status, setStatus] = useState("");
  /** filtro utilizzo mainboard: tutte, in uso nei mazzi, orfane */
  const [useFilter, setUseFilter] = useState<"all" | "used" | "orphan">("all");
  /** lightbox tutto-schermo: indice nella lista visibile (ordina/cerca e segue) */
  const [lightIdx, setLightIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const owned = useMemo(() => ownedByKey(entries), [entries]);

  /** Uso in mainboard per stampa (main + comandante di ogni progetto). */
  const usage = useMemo(() => collectionUsage(projects), [projects]);

  /**
   * Artwork per voce (solo display, mai cambiabile da qui): la stampa che hai
   * già in un progetto caricato (stessa chiave nome+set+numero), altrimenti
   * la stampa ufficiale Scryfall come ripiego.
   */
  const artOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) {
      for (const c of p.manifest.deck) {
        if (!c.imageFront) continue;
        const key = itemKey(deckEntryToItem(c));
        if (!map.has(key)) map.set(key, c.imageFront);
      }
    }
    return (key: string, fallback: { name: string; setCode: string; collectorNumber: string }): string =>
      map.get(key) ?? entryImageUrl(fallback);
  }, [projects]);

  /** Meta Scryfall per voce (tipo, costo, cmc, prezzo), cache condivisa col DeckBuilder. */
  const typeRefs = useMemo(
    () => entries.map((e) => ({ name: e.name, provider: "scryfall", setCode: e.setCode || undefined })),
    [entries],
  );
  const { meta } = useCardMeta(typeRefs);

  const metaByKey = useMemo(() => {
    const m = new Map<string, CardMeta>();
    for (const e of entries) {
      const lower = e.name.trim().toLowerCase();
      const set = (e.setCode ?? "").toLowerCase();
      const found =
        meta.get(typeCacheKey({ name: e.name, provider: "scryfall", setCode: set || undefined })) ??
        meta.get(`n:${lower}|${set}`) ??
        meta.get(`n:${lower}|`);
      if (found) m.set(e.key, found);
    }
    return m;
  }, [entries, meta]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = [...entries];
    if (useFilter === "used") out = out.filter((e) => usage.has(e.key));
    else if (useFilter === "orphan") out = out.filter((e) => !usage.has(e.key));
    if (q) {
      out = out.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.setCode.toLowerCase().includes(q) ||
          e.collectorNumber.toLowerCase().includes(q),
      );
    }
    if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "qty") out.sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
    else if (sort === "price") {
      const price = (key: string): number => {
        const p = parseFloat(metaByKey.get(key)?.priceUsd ?? "");
        return Number.isFinite(p) ? p : -1;
      };
      out.sort((a, b) => price(b.key) - price(a.key) || a.name.localeCompare(b.name));
    } else if (sort === "cmc") {
      const cmc = (key: string): number => metaByKey.get(key)?.cmc ?? Number.POSITIVE_INFINITY;
      out.sort((a, b) => cmc(a.key) - cmc(b.key) || a.name.localeCompare(b.name));
    } else if (sort === "type") {
      // alfabeto per type line, sconosciuti in fondo (come Moxfield)
      out.sort((a, b) => {
        const ta = metaByKey.get(a.key)?.typeLine;
        const tb = metaByKey.get(b.key)?.typeLine;
        if (!ta && !tb) return a.name.localeCompare(b.name);
        if (!ta) return 1;
        if (!tb) return -1;
        return ta.localeCompare(tb) || a.name.localeCompare(b.name);
      });
    } else out.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return out;
  }, [entries, query, sort, metaByKey, usage, useFilter]);

  const totalCopies = entries.reduce((n, e) => n + e.qty, 0);
  const usedCount = useMemo(() => entries.filter((e) => usage.has(e.key)).length, [entries, usage]);

  const missingDeck = useMemo(() => {
    const p = projects.find((x) => x.id === missingProject);
    if (!p) return null;
    return { project: p, missing: missingForDeck(p.manifest.deck, owned) };
  }, [projects, missingProject, owned]);

  const addMissing = async (): Promise<void> => {
    if (!missingDeck || missingDeck.missing.length === 0) return;
    await add(
      missingDeck.missing.map((m) => ({
        name: m.name,
        setCode: m.setCode,
        collectorNumber: m.collectorNumber,
        qty: m.need,
      })),
    );
    setStatus(`${missingDeck.missing.length} stampe aggiunte alla collezione.`);
  };

  /** Voci visibili come item lightbox (la stampa resta quella posseduta). */
  const lightItems: LightboxItem[] = useMemo(
    () =>
      visible.map((e) => {
        const m = metaByKey.get(e.key);
        const u = usage.get(e.key);
        const sub = [
          `${e.qty}×`,
          m?.typeLine,
          setLabelOf(e),
          priceOf(m),
          u ? `in uso in ${u.decks.length}` : "orfana",
        ]
          .filter(Boolean)
          .join(" · ");
        return { src: artOf(e.key, e), name: e.name, sub };
      }),
    [visible, metaByKey, artOf, usage],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6" role="main" aria-label="Collezione">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold">Collezione</h1>
        <p className="text-xs text-neutral-400" aria-live="polite" data-testid="collection-totals">
          <b className="font-semibold text-neutral-100">{entries.length}</b> stampe ·{" "}
          <b className="font-semibold text-neutral-100">{totalCopies}</b> {totalCopies === 1 ? "proxy" : "proxy"}
        </p>
        <div className="ml-auto flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca nome, set, numero…"
            aria-label="Cerca nella collezione"
            data-testid="collection-search"
            className="panel-2 thin-border rounded px-2 py-1.5 text-sm"
          />
          <label className="text-sm">
            <span className="sr-only">Ordinamento</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Ordinamento collezione"
              data-testid="collection-sort"
              className="panel-2 thin-border rounded px-2 py-1.5"
            >
              <option value="type">Tipo</option>
              <option value="price">Prezzo</option>
              <option value="cmc">Costo mana</option>
              <option value="name">Nome</option>
              <option value="qty">Quantità</option>
              <option value="recent">Recenti</option>
            </select>
          </label>
          <div className="flex gap-1" role="group" aria-label="Vista collezione">
            {(
              [
                ["grid", "▦", "Griglia"],
                ["list", "☰", "Lista"],
              ] as const
            ).map(([v, glyph, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                aria-label={label}
                title={label}
                data-testid={`collection-view-${v}`}
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
          <div className="flex gap-0.5 rounded-[9px] panel-2 p-[3px]" role="group" aria-label="Filtra per utilizzo">
            {(
              [
                ["all", `Tutte (${entries.length})`],
                ["used", `In uso (${usedCount})`],
                ["orphan", `Orfane (${entries.length - usedCount})`],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setUseFilter(v)}
                aria-pressed={useFilter === v}
                data-testid={`collection-filter-${v}`}
                title={
                  v === "orphan"
                    ? "In collezione ma in nessuna mainboard: candidate al riuso prima di ristampare"
                    : v === "used"
                      ? "Giocate in almeno una mainboard (main + comandante)"
                      : "Tutta la collezione"
                }
                className={`rounded-[7px] px-3 py-[7px] text-xs font-medium ${useFilter === v ? "bg-neutral-200 font-semibold text-black" : "text-neutral-400"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="panel-2 thin-border space-y-2 rounded p-3" aria-label="Mancanti per mazzo">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Mancanti per mazzo</h2>
          <label className="text-sm">
            <span className="sr-only">Progetto</span>
            <select
              value={missingProject}
              onChange={(e) => setMissingProject(e.target.value)}
              data-testid="collection-missing-project"
              className="panel thin-border rounded px-2 py-1"
            >
              <option value="">Scegli progetto…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {missingDeck && missingDeck.missing.length > 0 && (
            <button
              type="button"
              onClick={() => void addMissing()}
              data-testid="collection-add-missing"
              className="ml-auto rounded bg-neutral-200 px-3 py-1 text-xs font-semibold text-black"
            >
              Aggiungi {missingDeck.missing.length} mancanti
            </button>
          )}
        </div>
        {missingDeck &&
          (missingDeck.missing.length === 0 ? (
            <p className="text-xs text-green-400" data-testid="collection-missing-done">
              {missingDeck.project.name} è completo: hai tutto.
            </p>
          ) : (
            <ul className="space-y-1" data-testid="collection-missing-list">
              {missingDeck.missing.map((m) => (
                <li key={`${m.name}‖${m.setCode}‖${m.collectorNumber}`} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    {m.name}
                    {m.setCode && <span className="text-neutral-500"> ({m.setCode.toUpperCase()})</span>}
                    {m.collectorNumber && <span className="text-neutral-500"> {m.collectorNumber}</span>}
                  </span>
                  <span className="shrink-0 text-neutral-400">
                    hai {m.have} · servono {m.have + m.need}
                  </span>
                </li>
              ))}
            </ul>
          ))}
      </section>

      {loading && <p className="text-sm text-neutral-500">Caricamento…</p>}
      {!loading && visible.length === 0 && (
        <p className="text-sm text-neutral-500">
          {entries.length === 0
            ? "Collezione vuota: aggiungi carte dal DeckBuilder o dopo un export."
            : "Nessun risultato."}
        </p>
      )}
      {view === "grid" ? (
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}
          data-testid="collection-grid"
        >
          {visible.map((e, i) => (
            <CollectionTile
              key={e.key}
              entry={e}
              art={artOf(e.key, e)}
              meta={metaByKey.get(e.key)}
              use={usage.get(e.key)}
              onZoom={() => setLightIdx(i)}
            />
          ))}
        </div>
      ) : (
        <ul className="space-y-1" data-testid="collection-list">
          {visible.map((e, i) => (
            <CollectionRow
              key={e.key}
              entry={e}
              art={artOf(e.key, e)}
              meta={metaByKey.get(e.key)}
              use={usage.get(e.key)}
              onZoom={() => setLightIdx(i)}
            />
          ))}
        </ul>
      )}
      {lightIdx !== null && lightItems[lightIdx] && (
        <ArtLightbox
          items={lightItems}
          index={lightIdx}
          onIndex={setLightIdx}
          onClose={() => setLightIdx(null)}
        />
      )}

      {entries.length > 0 && (
        <div>
          {!confirmClear ? (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="text-xs text-neutral-500 underline hover:text-red-300"
            >
              Svuota collezione
            </button>
          ) : (
            <p className="text-xs text-neutral-400">
              Svuotare davvero?{" "}
              <button
                type="button"
                onClick={() => {
                  void clear();
                  setConfirmClear(false);
                }}
                data-testid="collection-clear-confirm"
                className="font-semibold text-red-300 underline"
              >
                Sì, svuota
              </button>{" "}
              <button type="button" onClick={() => setConfirmClear(false)} className="underline">
                Annulla
              </button>
            </p>
          )}
        </div>
      )}
      {status && (
        <p className="text-xs text-green-400" role="status">
          {status}
        </p>
      )}
    </div>
  );
}

/** Prezzo formattato o stringa vuota (voci senza prezzo in fondo negli ordinamenti). */
function priceOf(meta?: CardMeta): string {
  const p = parseFloat(meta?.priceUsd ?? "");
  return Number.isFinite(p) ? `$${p.toFixed(2)}` : "";
}

function setLabelOf(e: { setCode: string; collectorNumber: string }): string {
  return [e.setCode.toUpperCase(), e.collectorNumber].filter(Boolean).join(" ");
}

/** Uso in mainboard: verde con mazzi, grigio "Orfana" se in nessun mazzo. */
function UsageLine({ entryKey, use }: { entryKey: string; use?: DeckUsage }): JSX.Element {
  if (!use) {
    return (
      <span className="text-[10px] text-neutral-600" data-testid={`collection-usage-${entryKey}`}>
        Orfana
      </span>
    );
  }
  const names = use.decks.map((d) => `${d.name} ×${d.copies}`);
  const short =
    use.decks.length <= 2 ? names.join(" · ") : `${names.slice(0, 2).join(" · ")} +${use.decks.length - 2}`;
  return (
    <span
      className="truncate text-[10px] font-medium text-green-400/90"
      title={`In mainboard in: ${names.join(", ")} (totale ${use.totalCopies} copie)`}
      data-testid={`collection-usage-${entryKey}`}
    >
      In uso · {short}
    </span>
  );
}

function QtyStepper({
  entryKey,
  name,
  qty,
  compact,
}: {
  entryKey: string;
  name: string;
  qty: number;
  compact?: boolean;
}): JSX.Element {
  const setQty = useCollection((s) => s.setQty);
  if (compact) {
    return (
      <span className="flex items-center overflow-hidden rounded-[7px] panel-2" role="group" aria-label={`Quantità di ${name}`}>
        <button
          type="button"
          onClick={() => void setQty(entryKey, qty - 1)}
          disabled={qty <= 1}
          aria-label={`Togli una copia di ${name}`}
          data-testid={`collection-dec-${entryKey}`}
          className="h-[22px] w-[22px] text-xs text-neutral-400 disabled:opacity-40"
        >
          −
        </button>
        <span className="w-4 text-center text-[11px]" data-testid={`collection-qty-${entryKey}`}>
          {qty}
        </span>
        <button
          type="button"
          onClick={() => void setQty(entryKey, qty + 1)}
          aria-label={`Aggiungi una copia di ${name}`}
          data-testid={`collection-inc-${entryKey}`}
          className="h-[22px] w-[22px] text-xs text-neutral-400"
        >
          +
        </button>
      </span>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`Quantità di ${name}`}>
      <button
        type="button"
        onClick={() => void setQty(entryKey, qty - 1)}
        disabled={qty <= 1}
        aria-label={`Togli una copia di ${name}`}
        data-testid={`collection-dec-${entryKey}`}
        className="panel thin-border rounded px-2 py-0.5 text-sm disabled:opacity-40"
      >
        −
      </button>
      <span className="w-8 text-center text-sm" data-testid={`collection-qty-${entryKey}`}>
        {qty}
      </span>
      <button
        type="button"
        onClick={() => void setQty(entryKey, qty + 1)}
        aria-label={`Aggiungi una copia di ${name}`}
        data-testid={`collection-inc-${entryKey}`}
        className="panel thin-border rounded px-2 py-0.5 text-sm"
      >
        +
      </button>
    </div>
  );
}

function RemoveButton({ entryKey, name }: { entryKey: string; name: string }): JSX.Element {
  const remove = useCollection((s) => s.remove);
  return (
    <button
      type="button"
      onClick={() => {
        if (window.confirm(`Rimuovere ${name} dalla collezione?`)) void remove(entryKey);
      }}
      aria-label={`Rimuovi ${name} dalla collezione`}
      data-testid={`collection-remove-${entryKey}`}
      className="shrink-0 rounded px-1 text-xs text-neutral-500 hover:text-red-300"
    >
      ✕
    </button>
  );
}

/** Tile griglia stile Moxfield: art grande, costo, prezzo, quantità. */
function CollectionTile({
  entry,
  art,
  meta,
  use,
  onZoom,
}: {
  entry: CollectionEntry;
  art: string;
  meta?: CardMeta;
  use?: DeckUsage;
  onZoom: () => void;
}): JSX.Element {
  const cost = prettyManaCost(meta?.manaCost);
  const price = priceOf(meta);
  return (
    <div
      className="overflow-hidden rounded-[10px] thin-border panel"
      data-testid={`collection-tile-${entry.key}`}
    >
      <button
        type="button"
        onClick={onZoom}
        aria-label={`Ingrandisci ${entry.name}`}
        title="Ingrandisci a tutto schermo"
        data-testid={`collection-zoom-${entry.key}`}
        className="relative block aspect-[63/88] w-full bg-black"
      >
        <ArtworkImage stored={art} name={entry.name} />
        {cost && (
          <span className="absolute right-1.5 top-1.5 rounded-[5px] bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold">
            {cost}
          </span>
        )}
        {price && (
          <span className="absolute bottom-1.5 left-1.5 rounded-[5px] bg-green-800 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {price}
          </span>
        )}
      </button>
      <div className="px-2.5 pb-2.5 pt-2">
        <p className="truncate text-xs font-semibold leading-tight" title={entry.name}>
          {entry.name}
        </p>
        <p className="truncate text-[10px] text-neutral-400" data-testid={`collection-type-${entry.key}`}>
          {meta?.typeLine ?? "tipo in risoluzione…"}
        </p>
        <p className="truncate text-[10px] text-neutral-500">{setLabelOf(entry) || "stampa senza set"}</p>
        <p className="mb-2 truncate">
          <UsageLine entryKey={entry.key} use={use} />
        </p>
        <div className="flex items-center justify-between">
          <QtyStepper entryKey={entry.key} name={entry.name} qty={entry.qty} compact />
          <RemoveButton entryKey={entry.key} name={entry.name} />
        </div>
      </div>
    </div>
  );
}

/** Riga compatta per la vista lista. */
function CollectionRow({
  entry,
  art,
  meta,
  use,
  onZoom,
}: {
  entry: CollectionEntry;
  art: string;
  meta?: CardMeta;
  use?: DeckUsage;
  onZoom: () => void;
}): JSX.Element {
  const sub = [meta?.typeLine ?? "tipo in risoluzione…", setLabelOf(entry), prettyManaCost(meta?.manaCost), priceOf(meta)]
    .filter(Boolean)
    .join(" · ");
  return (
    <li
      className="panel-2 thin-border flex items-center gap-2 rounded px-2 py-1.5"
      data-testid={`collection-row-${entry.key}`}
    >
      <button
        type="button"
        onClick={onZoom}
        aria-label={`Ingrandisci ${entry.name}`}
        title="Ingrandisci a tutto schermo"
        data-testid={`collection-zoom-${entry.key}`}
        className="h-12 w-9 shrink-0 overflow-hidden rounded bg-black"
      >
        <ArtworkImage stored={art} name={entry.name} imgClassName="h-full w-full object-cover" />
      </button>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{entry.name}</span>
        <span className="block truncate text-[11px] text-neutral-500" data-testid={`collection-type-${entry.key}`}>
          {sub}
        </span>
        <span className="block truncate">
          <UsageLine entryKey={entry.key} use={use} />
        </span>
      </span>
      <QtyStepper entryKey={entry.key} name={entry.name} qty={entry.qty} />
      <RemoveButton entryKey={entry.key} name={entry.name} />
    </li>
  );
}
