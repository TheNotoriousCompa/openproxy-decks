import { useCallback, useEffect, useMemo, useState } from "react";
import { getMpcSources, getMpcTags, type MpcSource, type MpcTag } from "@/services/mpc";
import { listScryfallSets, type ScryfallSet } from "@/services/cardfinder";
import { useSettings } from "@/stores/settings";
import {
  AI_TAG,
  AI_TAG_HINT,
  toggleSet,
  toggleSource,
  toggleTag,
  type Exclusions,
} from "@/lib/exclusions";

type Tab = "sources" | "tags" | "sets";

/** Righe visibili per tab: il resto si raggiunge con la ricerca. */
const ROW_CAP = 300;

interface Row {
  key: string;
  label: string;
  meta?: string;
  title?: string;
}

interface Loaded<T> {
  rows: T[];
  loading: boolean;
  error: string | null;
}

/** Carica una lista quando `enabled`, abortendo al cambio tab/smontaggio. */
function useLoaded<T>(
  enabled: boolean,
  reload: number,
  load: (signal: AbortSignal) => Promise<T[]>,
): Loaded<T> {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    load(ctrl.signal)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e) => {
        if (!cancelled && !ctrl.signal.aborted) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [enabled, reload, load]);
  return { rows, loading, error };
}

const TAB_LABEL: Record<Tab, string> = {
  sources: "Drive MPC",
  tags: "Tag MPC",
  sets: "Set MTG",
};

const TAB_EMPTY: Record<Tab, string> = {
  sources: "Nessun drive dal server MPC.",
  tags: "Nessun tag dal server MPC.",
  sets: "Nessun set Scryfall.",
};

const TAB_PLACEHOLDER: Record<Tab, string> = {
  sources: "Cerca un drive (es. Trix Are For Scoot)…",
  tags: "Cerca un tag (es. AI Art)…",
  sets: "Cerca un set (nome o codice, es. ltr)…",
};

interface SourceFilterPanelProps {
  /** server MPC configurato (i drive/tag arrivano da lì) */
  server: string;
  /** chiude il pannello: presente solo nel picker (niente modali annidati) */
  onClose?: () => void;
  /** altezza ridotta: il pannello vive dentro il picker */
  compact?: boolean;
}

/**
 * Gestione delle fonti escluse dal print-picker: drive MPC, tag MPC e set
 * Scryfall. Stesso componente nelle Impostazioni (pagina intera) e nel picker
 * (pannello inline): una sola lista, un solo salvataggio.
 *
 * Le modifiche sono immediate e valgono per tutte le carte: la lista è una
 * preferenza, non un filtro temporaneo.
 */
export function SourceFilterPanel({ server, onClose, compact = false }: SourceFilterPanelProps): JSX.Element {
  const excluded = useSettings((s) => s.excluded);
  const setExcluded = useSettings((s) => s.setExcluded);
  const [tab, setTab] = useState<Tab>(server.trim() ? "sources" : "sets");
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);

  const loadSources = useCallback((signal: AbortSignal) => getMpcSources(server, signal), [server]);
  const loadTags = useCallback((signal: AbortSignal) => getMpcTags(server, signal), [server]);
  const loadSets = useCallback((signal: AbortSignal) => listScryfallSets(signal), []);

  const hasServer = server.trim().length > 0;
  const sources = useLoaded<MpcSource>(tab === "sources" && hasServer, reload, loadSources);
  const tags = useLoaded<MpcTag>(tab === "tags" && hasServer, reload, loadTags);
  const sets = useLoaded<ScryfallSet>(tab === "sets", reload, loadSets);

  const current = tab === "sources" ? sources : tab === "tags" ? tags : sets;

  const rows = useMemo<Row[]>(() => {
    if (tab === "sources") {
      return sources.rows.map((s) => ({ key: s.name, label: s.name, meta: "drive" }));
    }
    if (tab === "tags") {
      return tags.rows.map((t) => ({
        key: t.name,
        label: t.name,
        meta: t.parent ? `in ${t.parent}` : "gruppo",
        title: t.aliases.length > 0 ? `Alias: ${t.aliases.join(", ")}` : undefined,
      }));
    }
    return sets.rows.map((s) => ({
      key: s.code,
      label: `${s.name} (${s.code.toUpperCase()})`,
      meta: [s.setType, s.releasedAt?.slice(0, 4)].filter(Boolean).join(" · "),
    }));
  }, [tab, sources.rows, tags.rows, sets.rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.label.toLowerCase().includes(q) || (r.title ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const shown = filtered.slice(0, ROW_CAP);

  const isOn = (row: Row): boolean => {
    if (tab === "sources") return excluded.sources.some((s) => s.toLowerCase() === row.key.toLowerCase());
    if (tab === "tags") return excluded.tags.some((s) => s.toLowerCase() === row.key.toLowerCase());
    return excluded.sets.some((s) => s.toLowerCase() === row.key.toLowerCase());
  };

  const toggleRow = (row: Row): void => {
    let next: Exclusions;
    if (tab === "sources") next = toggleSource(excluded, row.key);
    else if (tab === "tags") next = toggleTag(excluded, row.key);
    else next = toggleSet(excluded, row.key);
    setExcluded(next);
  };

  const clearTab = (): void => {
    const next: Exclusions =
      tab === "sources"
        ? { ...excluded, sources: [] }
        : tab === "tags"
          ? { ...excluded, tags: [] }
          : { ...excluded, sets: [] };
    setExcluded(next);
  };

  const excludedInTab =
    tab === "sources" ? excluded.sources.length : tab === "tags" ? excluded.tags.length : excluded.sets.length;

  return (
    <section
      aria-label="Fonti escluse"
      data-testid="source-filter-panel"
      className="p-2 text-xs"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {compact && <span className="font-semibold">Fonti escluse</span>}
        <span className="text-neutral-400" data-testid="source-filter-summary">
          {excludedInTab > 0
            ? `${excludedInTab} in questa lista`
            : "nascoste dal picker, sempre riattivabili"}
        </span>
        <div className="ml-auto flex rounded panel-2 thin-border" role="tablist" aria-label="Tipo di fonte">
          {(["sources", "tags", "sets"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => {
                setTab(t);
                setQuery("");
              }}
              data-testid={`source-filter-tab-${t}`}
              className={`rounded px-2 py-0.5 ${tab === t ? "bg-neutral-200 font-bold text-black" : "text-neutral-400"}`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="panel-2 thin-border rounded px-2 py-0.5 text-neutral-400"
            aria-label="Chiudi la gestione delle fonti escluse"
            data-testid="source-filter-close"
          >
            ✕
          </button>
        )}
      </div>

      {!hasServer && tab !== "sets" ? (
        <p className="px-1 py-2 text-neutral-400">
          Configura l'URL del server MPC nelle Impostazioni per vedere drive e tag del server.
        </p>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={TAB_PLACEHOLDER[tab]}
            aria-label={`Cerca tra ${TAB_LABEL[tab]}`}
            data-testid="source-filter-search"
            className="panel-2 thin-border mb-2 w-full rounded px-2 py-1"
          />

          {tab === "tags" && !excluded.tags.some((t) => t.toLowerCase() === AI_TAG.toLowerCase()) && (
            <div className="panel-2 thin-border mb-2 flex flex-wrap items-center gap-2 rounded px-2 py-1.5">
              <span className="min-w-0 flex-1 text-neutral-400">
                <strong className="font-semibold text-neutral-200">{AI_TAG}</strong>: {AI_TAG_HINT}
              </span>
              <button
                type="button"
                onClick={() => setExcluded(toggleTag(excluded, AI_TAG))}
                data-testid="source-filter-suggest-ai"
                className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-200"
              >
                Escludi «{AI_TAG}»
              </button>
            </div>
          )}

          <div
            role="group"
            aria-label={`Elenco ${TAB_LABEL[tab]}`}
            className={`${compact ? "max-h-[26vh]" : "max-h-[48vh]"} overflow-auto rounded border border-neutral-800`}
          >
            {current.loading && <p className="px-2 py-3 text-neutral-400">Carico…</p>}
            {!current.loading && current.error && (
              <p className="px-2 py-3 text-yellow-400">
                {current.error}{" "}
                <button type="button" onClick={() => setReload((n) => n + 1)} className="underline">
                  Riprova
                </button>
              </p>
            )}
            {!current.loading && !current.error && shown.length === 0 && (
              <p className="px-2 py-3 text-neutral-400">{rows.length === 0 ? TAB_EMPTY[tab] : "Nessun risultato."}</p>
            )}
            {shown.map((row) => {
              const on = isOn(row);
              return (
                <label
                  key={row.key}
                  title={row.title}
                  className={`flex cursor-pointer items-center gap-2 border-b border-neutral-900 px-2 py-1 last:border-b-0 ${
                    on ? "bg-white/[0.03]" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleRow(row)}
                    aria-label={`Escludi ${row.label}`}
                    data-testid={`source-filter-row-${row.key}`}
                  />
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  {row.meta && <span className="shrink-0 text-[10px] text-neutral-400">{row.meta}</span>}
                </label>
              );
            })}
            {filtered.length > shown.length && (
              <p className="px-2 py-2 text-neutral-400">
                Mostro {shown.length} di {filtered.length}: restringi la ricerca.
              </p>
            )}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <span className="text-neutral-400" data-testid="source-filter-count">
              {excludedInTab > 0 ? `${excludedInTab} esclusi` : "Nessuna esclusione"}
            </span>
            {excludedInTab > 0 && (
              <button
                type="button"
                onClick={clearTab}
                data-testid="source-filter-clear"
                className="ml-auto rounded border border-neutral-700 px-2 py-0.5 text-neutral-200"
              >
                Ripristina {TAB_LABEL[tab].toLowerCase()}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
