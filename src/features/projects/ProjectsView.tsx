import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useProjects } from "@/stores/projects";
import { useDeck } from "@/stores/deck";
import { usePrint } from "@/stores/print";
import { useUi } from "@/stores/ui";
import { backend } from "@/services/backend";
import { MoxfieldProfileImport } from "@/components/LeftPanel";
import { batchCounts, buildMergedCards, exportMergedPdf } from "@/features/print/batchExport";
import { useExportJob } from "@/stores/exportJob";
import { open as openPath } from "@tauri-apps/plugin-shell";
import { consolidateItems } from "@/lib/collection";
import type { CollectionItem } from "@/lib/collection";
import { ensureActiveTokenBoardFixed } from "@/hooks/useTokenBoardFix";
import { fixProjectsTokensBoard } from "@/services/zonefix";
import type { Project } from "@/types";

const schema = z.object({ name: z.string().trim().min(1, "Nome richiesto").max(120) });
type Form = z.infer<typeof schema>;

const COPY_OPTIONS = [1, 2, 4];

export function ProjectsView(): JSX.Element {
  const search = useProjects((s) => s.search);
  const setSearch = useProjects((s) => s.setSearch);
  const summaries = useProjects((s) => s.summaries);
  const sumTotal = useProjects((s) => s.sumTotal);
  const sumLoading = useProjects((s) => s.sumLoading);
  const loading = useProjects((s) => s.loading);
  const error = useProjects((s) => s.error);
  const loadSummaries = useProjects((s) => s.loadSummaries);
  const loadMore = useProjects((s) => s.loadMore);
  const create = useProjects((s) => s.create);
  const rename = useProjects((s) => s.rename);
  const duplicate = useProjects((s) => s.duplicate);
  const remove = useProjects((s) => s.remove);
  const activeId = useProjects((s) => s.activeId);
  const setActive = useProjects((s) => s.setActive);
  const getFull = useProjects((s) => s.getFull);
  const hydrate = useDeck((s) => s.hydrate);
  const hydratePrint = usePrint((s) => s.hydrate);
  const goStudio = useUi((s) => s.setTab);
  const { register, handleSubmit, reset, formState } = useForm<Form>({ resolver: zodResolver(schema) });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copies, setCopies] = useState(1);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchStatus, setBatchStatus] = useState("");
  const [batchDir, setBatchDir] = useState("");
  const exportJob = useExportJob((s) => s.job);

  useEffect(() => {
    void loadSummaries(true);
  }, [loadSummaries]);

  // La selezione segue la lista: id spariti (ricerca/eliminati) escono da soli.
  useEffect(() => {
    setSelected((prev) => {
      const alive = new Set(summaries.map((p) => p.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [summaries]);

  const open = async (id: string): Promise<void> => {
    try {
      const p = await getFull(id);
      setActive(id);
      hydrate(p.manifest.deck);
      hydratePrint(p.manifest.print);
      goStudio("studio");
    } catch {
      /* errore già in store */
    }
  };

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * Ripulisce il board Token dei progetti indicati: Moxfield ci aggancia anche
   * i token-copia come carte vere, che così non finiscono nel PDF.
   * Una volta per progetto; il progetto attivo passa dal deck live.
   */
  const fixTokensOf = async (
    ids: string[],
  ): Promise<{ fixed: Project[]; removed: number; touched: number }> => {
    await ensureActiveTokenBoardFixed();
    const activeIdNow = useProjects.getState().activeId;
    const fulls = await Promise.all(ids.map((id) => getFull(id)));
    const fixed = await fixProjectsTokensBoard(fulls, activeIdNow);
    let removed = 0;
    const changed: Project[] = [];
    fixed.forEach((p, i) => {
      const before = fulls[i];
      if (before && p !== before) {
        removed += before.manifest.deck.length - p.manifest.deck.length;
        changed.push(p);
      }
    });
    if (changed.length > 0) {
      const byId = new Map(changed.map((p) => [p.id, p]));
      useProjects.setState((s) => ({
        projects: s.projects.map((p) => byId.get(p.id) ?? p),
      }));
    }
    return { fixed, removed, touched: changed.length };
  };

  const runBatch = async (): Promise<void> => {
    const ids = summaries.filter((p) => selected.has(p.id)).map((p) => p.id);
    if (ids.length === 0 || batchBusy) return;
    if (useExportJob.getState().job?.state === "running") {
      setBatchStatus("Export già in corso: segui l'avanzamento nella finestrella in basso a sinistra.");
      return;
    }
    setBatchBusy(true);
    setBatchDir("");
    setBatchStatus(`Unisco ${ids.length} ${ids.length === 1 ? "progetto" : "progetti"}…`);
    try {
      // Board Token ripulito prima dell'unione (una volta per progetto)
      const { fixed } = await fixTokensOf(ids);
      const values = usePrint.getState();
      const { cards, noArt } = buildMergedCards(fixed, {
        includeConsidering: values.includeConsidering ?? true,
        copies,
        backImage: values.backImage,
      });
      if (cards.length === 0) {
        setBatchStatus("Nessuna carta con artwork nei progetti selezionati.");
        return;
      }
      const counts = batchCounts(fixed);
      const detail = counts.map((c) => `${c.name} (${c.copies})`).join(" + ");
      const ej = useExportJob.getState();
      ej.begin("batch", `PDF unito · ${ids.length} ${ids.length === 1 ? "progetto" : "progetti"}`);
      const { res, dir, verify } = await exportMergedPdf({
        values,
        cards,
        dirProjectId: ids[0] as string,
        filename: `unito-${Date.now()}.pdf`,
      });
      setBatchDir(dir);
      ej.finish({
        detail: `${res.pages} pagine · ${res.total_copies} copie · ${(res.bytes / 1024).toFixed(0)} KB`,
        pdfPath: res.path,
        dir,
      });
      // "Vuoi aggiungere alla collezione?": le carte davvero stampate
      // (con artwork, flag considering e moltiplicatore copie rispettati).
      const includeConsidering = values.includeConsidering ?? true;
      const mult = Math.min(99, Math.max(1, Math.round(copies)));
      const raw: CollectionItem[] = [];
      for (const p of fixed) {
        for (const c of p.manifest.deck) {
          if (!includeConsidering && c.zone === "considering") continue;
          if (!c.imageFront) continue;
          raw.push({
            name: c.name,
            setCode: c.setCode,
            collectorNumber: c.collectorNumber,
            qty: Math.min(99, Math.max(1, Math.round(c.qty)) * mult),
          });
        }
      }
      ej.setCollectItems(consolidateItems(raw));
      setBatchStatus(
        `PDF unito [${detail}]: ${res.pages} pagine · ${res.total_copies} copie · ${(res.bytes / 1024).toFixed(0)} KB → ${res.path}` +
          (verify ? (verify.pass ? ` · misure OK (${verify.worst_dev_pct.toFixed(1)}%)` : " · FUORI TOLLERANZA") : " · verifica non disponibile") +
          (res.skipped > 0 ? ` — ${res.skipped} copie saltate` : "") +
          (noArt.length > 0 ? ` — senza artwork: ${noArt.slice(0, 5).join("; ")}${noArt.length > 5 ? ` (+${noArt.length - 5})` : ""}` : ""),
      );
    } catch (e) {
      const msg = `Export unito fallito: ${e instanceof Error ? e.message : String(e)}`;
      useExportJob.getState().fail(msg);
      setBatchStatus(msg);
    } finally {
      setBatchBusy(false);
    }
  };

  /** Pulizia esplicita del board Token sui progetti selezionati. */
  const cleanTokens = async (): Promise<void> => {
    const ids = summaries.filter((p) => selected.has(p.id)).map((p) => p.id);
    if (ids.length === 0 || batchBusy) return;
    setBatchBusy(true);
    setBatchStatus(`Controllo board Token di ${ids.length} ${ids.length === 1 ? "progetto" : "progetti"}…`);
    try {
      const { removed, touched } = await fixTokensOf(ids);
      setBatchStatus(
        removed === 0
          ? "Board Token già a posto: nessuna carta da togliere."
          : `${removed} ${removed === 1 ? "carta non-token rimossa" : "carte non-token rimosse"} in ${touched} ${touched === 1 ? "progetto" : "progetti"}.`,
      );
    } catch (e) {
      setBatchStatus(`Pulizia fallita: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBatchBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8" role="main" aria-label="Progetti">
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-bold">Progetti</h1>
          <p className="mt-1 text-sm text-neutral-400" aria-live="polite">
            {sumTotal} {sumTotal === 1 ? "progetto" : "progetti"} · seleziona e unisci in un unico PDF (token in fondo)
          </p>
        </div>
      </div>

      <div className="mb-5 grid gap-2 sm:grid-cols-[1fr_240px]">
        <form
          onSubmit={handleSubmit(async (v) => {
            const p = await create(v.name);
            hydrate([]);
            setActive(p.id);
            goStudio("studio");
            reset();
          })}
          className="flex gap-2"
        >
          <input
            {...register("name")}
            placeholder="Nuovo progetto…"
            aria-label="Nome nuovo progetto"
            className="panel-2 thin-border min-w-0 flex-1 rounded-lg px-3 py-2.5 text-sm"
          />
          <button type="submit" className="shrink-0 rounded-lg bg-neutral-200 px-5 py-2.5 text-sm font-semibold text-black">
            Crea
          </button>
        </form>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cerca progetti…"
          aria-label="Cerca progetti"
          className="panel-2 thin-border rounded-lg px-3 py-2.5 text-sm"
        />
      </div>
      {formState.errors.name && <p className="mb-3 text-xs text-red-400">{formState.errors.name.message}</p>}

      <section aria-label="Importa da profilo Moxfield" className="panel-2 thin-border mb-5 rounded-xl p-4">
        <h2 className="mb-2 text-sm font-bold">Da profilo Moxfield</h2>
        <MoxfieldProfileImport />
      </section>

      <section aria-label="Export in blocco" className="panel-2 thin-border mb-5 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold" data-testid="batch-count" aria-live="polite">
            {selected.size === 0 ? "Nessun progetto selezionato" : `${selected.size} selezionati`}
          </span>
          <button
            type="button"
            onClick={() => setSelected(new Set(summaries.map((p) => p.id)))}
            className="panel thin-border rounded-lg px-3 py-1.5 text-xs"
          >
            Tutti
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="panel thin-border rounded-lg px-3 py-1.5 text-xs"
          >
            Nessuno
          </button>
          <div className="flex items-center gap-1" role="group" aria-label="Copie per carta">
            <span className="text-xs text-neutral-400">Copie:</span>
            {COPY_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCopies(n)}
                aria-pressed={copies === n}
                aria-label={`${n} ${n === 1 ? "copia" : "copie"} per carta`}
                className={`rounded-lg px-2.5 py-1.5 text-xs ${copies === n ? "bg-neutral-200 font-bold text-black" : "panel thin-border text-neutral-400"}`}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void cleanTokens()}
            disabled={selected.size === 0 || batchBusy}
            data-testid="batch-clean-tokens"
            title="Toglie dal board Token le carte che non sono token (i token-copia che Moxfield importa come carte vere)"
            className="panel thin-border rounded-lg px-3 py-1.5 text-xs disabled:opacity-40"
          >
            Pulisci token
          </button>
          <button
            type="button"
            onClick={() => void runBatch()}
            disabled={selected.size === 0 || batchBusy}
            data-testid="batch-export"
            title="Un unico PDF con tutti i progetti selezionati (impostazioni Studio correnti, token in fondo)"
            className="ml-auto rounded-lg bg-neutral-200 px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {batchBusy ? "Unione…" : "PDF unito"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-neutral-400">
          Usa le impostazioni di stampa correnti dello Studio · un solo layout per tutto il PDF
        </p>
        {batchStatus && (
          <p className="mt-2 break-all text-xs text-neutral-300" aria-live="polite" data-testid="batch-status">
            {batchStatus}
          </p>
        )}
        {batchBusy && exportJob?.state === "running" && exportJob.kind === "batch" && (
          <div className="mt-2" data-testid="batch-progress">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
              <div
                className="h-full rounded-full bg-neutral-200 transition-[width] duration-200"
                style={{ width: `${Math.round(exportJob.frac * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-neutral-400" aria-live="polite">
              {exportJob.phase} · {Math.round(exportJob.frac * 100)}%
            </p>
          </div>
        )}
        {batchDir && !batchBusy && (
          <button
            type="button"
            onClick={() => void openPath(batchDir).catch(() => undefined)}
            data-testid="batch-open-dir"
            className="panel thin-border mt-2 rounded-lg px-3 py-1.5 text-xs"
            title={batchDir}
          >
            Apri cartella PDF
          </button>
        )}
      </section>

      {loading && <p className="text-sm text-neutral-500">Caricamento…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {summaries.map((p) => {
          const active = activeId === p.id;
          const checked = selected.has(p.id);
          return (
            <li
              key={p.id}
              className={`panel-2 thin-border rounded-xl p-5 ${active ? "ring-2 ring-neutral-100" : ""} ${checked ? "border-neutral-400" : ""}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(p.id)}
                  aria-label={`Seleziona ${p.name}`}
                  data-testid={`project-select-${p.id}`}
                  className="mt-1 h-4 w-4 shrink-0 accent-neutral-200"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-base font-semibold">{p.name}</span>
                    {active && (
                      <span className="rounded bg-neutral-200 px-1.5 py-px text-[10px] font-bold uppercase text-black">
                        Attivo
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-400">
                    {p.deck_count} voci · agg. {new Date(p.updated_at).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => void open(p.id)} className="rounded-lg bg-neutral-200 px-3 py-1.5 text-xs font-semibold text-black">
                  Apri
                </button>
                <button
                  onClick={() => {
                    const n = window.prompt("Rinomina progetto", p.name);
                    if (n) void rename(p.id, n);
                  }}
                  className="panel thin-border rounded-lg px-3 py-1.5 text-xs"
                >
                  Rinomina
                </button>
                <button onClick={() => void duplicate(p.id)} className="panel thin-border rounded-lg px-3 py-1.5 text-xs">
                  Duplica
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Eliminare "${p.name}"?`)) void remove(p.id);
                  }}
                  className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-1.5 text-xs text-red-200"
                >
                  Elimina
                </button>
              </div>
              <ProjectAssetsRow id={p.id} name={p.name} />
            </li>
          );
        })}
      </ul>
      {sumLoading && <p className="mt-3 text-xs text-neutral-500">Caricamento…</p>}
      {summaries.length < sumTotal && (
        <button
          onClick={() => void loadMore()}
          disabled={sumLoading}
          className="panel-2 thin-border mt-4 w-full rounded-lg px-3 py-2.5 text-sm disabled:opacity-50"
        >
          Mostra altri ({summaries.length}/{sumTotal})
        </button>
      )}
      {summaries.length === 0 && !loading && !sumLoading && (
        <p className="mt-4 text-sm text-neutral-500">Nessun progetto — creane uno per iniziare.</p>
      )}
    </div>
  );
}

/** Vero se il riferimento è un file locale (non URL remoto). */
function isLocalImage(s: string | undefined): boolean {
  if (!s) return false;
  return !/^(https?:|blob:|data:|asset:)/i.test(s);
}

function formatBytes(b: number): string {
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
}

/**
 * Riga spazio-immagini per progetto (solo app desktop): quanto occupano gli
 * artwork locali + bottone per svuotarli. Il deck resta intatto (nomi, zone,
 * stampe scelte): per ristampare basta re-importare gli artwork.
 */
function ProjectAssetsRow({ id, name }: { id: string; name: string }): JSX.Element | null {
  const [info, setInfo] = useState<{ asset_count: number; asset_bytes: number } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const activeId = useProjects((s) => s.activeId);
  const getFull = useProjects((s) => s.getFull);
  const loadSummaries = useProjects((s) => s.loadSummaries);

  useEffect(() => {
    if (!backend.isTauri) return;
    let live = true;
    backend
      .projectStorageInfo(id)
      .then((r) => {
        if (live) setInfo(r);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);

  if (!backend.isTauri) return null;

  const empty = info !== null && info.asset_count === 0;

  const svuota = async (): Promise<void> => {
    if (busy) return;
    const size = info ? ` (${info.asset_count} file, ${formatBytes(info.asset_bytes)})` : "";
    if (!window.confirm(`Svuotare le immagini locali di "${name}"${size}?\nNomi e stampe restano, ma servirà riscaricare gli artwork per ristampare.`)) {
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const full: Project = await getFull(id);
      const res = await backend.clearProjectAssets(id);
      // Stacca i path locali dal manifest (i remoti restano: l'export li riscarica).
      const deck = full.manifest.deck.map((c) => {
        const frontLocal = isLocalImage(c.imageFront);
        const backLocal = isLocalImage(c.imageBack);
        if (!frontLocal && !backLocal) return c;
        return {
          ...c,
          imageFront: frontLocal ? undefined : c.imageFront,
          imageBack: backLocal ? undefined : c.imageBack,
          hasBack: backLocal ? false : c.hasBack,
        };
      });
      await backend.saveManifest({
        ...full,
        updated_at: new Date().toISOString(),
        manifest: { ...full.manifest, deck },
      });
      if (activeId === id) useDeck.getState().hydrate(deck);
      setInfo({ asset_count: 0, asset_bytes: 0 });
      setStatus(`Svuotato: ${res.removed} file, liberati ${formatBytes(res.freed_bytes)}. Riscarica con Importa (Scarica artwork).`);
      void loadSummaries(true);
    } catch (e) {
      setStatus(`Svuotamento fallito: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t thin-border pt-3" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-neutral-500"
        >
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
        </svg>
        <span className="text-[11px] text-neutral-400">
          Immagini locali:{" "}
          {info === null ? (
            "…"
          ) : empty ? (
            "nessuna"
          ) : (
            <>
              <b className="font-semibold text-neutral-200">{info.asset_count} file</b>
              {" · "}
              <b className="font-semibold text-neutral-200">{formatBytes(info.asset_bytes)}</b>
            </>
          )}
        </span>
        <button
          type="button"
          onClick={() => void svuota()}
          disabled={busy || empty}
          title="Cancella i file immagine locali (nomi e stampe restano nel deck)"
          className="ml-auto rounded-lg bg-neutral-800 px-3 py-1.5 text-[11px] font-medium text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
        >
          {busy ? "Svuotamento…" : "Svuota immagini"}
        </button>
      </div>
      {status && <span className="mt-1.5 block text-[11px] text-neutral-400">{status}</span>}
    </div>
  );
}
