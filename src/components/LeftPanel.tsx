import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useCardSearch } from "@/hooks/useCardSearch";
import { useDeck } from "@/stores/deck";
import { useProjects } from "@/stores/projects";
import { useSettings } from "@/stores/settings";
import { useUi, type ImportTarget } from "@/stores/ui";
import { CARD_LANG_LABEL } from "@/lib/cardLang";
import { parseDeckList, parseMpcXml } from "@/lib/decklist";
import { detectDeckLink, detectMoxfieldUser, providerLabel } from "@/lib/deckUrl";
import { backend } from "@/services/backend";
import { enrichWithArtwork, type ArtworkPatch } from "@/services/artwork";
import { persistPatch } from "@/services/images";
import { driveDownloadUrl } from "@/services/mpc";
import { ArtworkImage } from "@/components/ArtworkImage";
import type { CardEntry, ProviderCard, Zone } from "@/types";

const VALID_ZONES: Zone[] = ["main", "side", "commander", "extra", "maybe", "considering", "tokens", "custom"];

/** Livelli del pannello import: un solo livello piatto, mai pannelli dentro pannelli. */
const IMPORT_TABS = [
  { id: "cerca", label: "Cerca" },
  { id: "testo", label: "Testo" },
  { id: "file", label: "File" },
  { id: "mpc", label: "MPC XML" },
  { id: "link", label: "Collegamento" },
] as const;

type ImportTab = (typeof IMPORT_TABS)[number]["id"];

export function LeftPanel(): JSX.Element {
  const [tab, setTab] = useState<ImportTab>("cerca");
  const importer = useDecklistImporter();
  const importTarget = useUi((s) => s.importTarget);
  const setImportTarget = useUi((s) => s.setImportTarget);

  return (
    <div className="flex h-full flex-col gap-2 p-3" role="complementary" aria-label="Importazione carte">
      <h2 className="text-sm font-bold">Importazione</h2>
      {/* Destinazione: la lista è condivisa, dopo l'import si apre qui */}
      <div className="flex items-center gap-1" role="group" aria-label="Destinazione import">
        <span className="text-[11px] text-neutral-500">Importa in:</span>
        {(
          [
            ["studio", "Studio"],
            ["deckbuilder", "DeckBuilder"],
          ] as [ImportTarget, string][]
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setImportTarget(v)}
            aria-pressed={importTarget === v}
            data-testid={`import-target-${v}`}
            className={`flex-1 rounded px-2 py-1 text-[11px] ${
              importTarget === v ? "bg-neutral-200 font-semibold text-black" : "panel-2 thin-border text-neutral-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Livello unico: 5 modi affiancati, niente sezioni dentro sezioni */}
      <div className="panel-2 thin-border flex rounded" role="tablist" aria-label="Modo di import">
        {IMPORT_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded px-1 py-1 text-[11px] ${
              tab === t.id ? "bg-neutral-200 font-semibold text-black" : "text-neutral-400"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "cerca" && <SearchTab />}
      {tab === "testo" && (
        <TextTab
          text={importer.text}
          setText={importer.setText}
          report={importer.report}
          busy={importer.busy}
          fetchArt={importer.fetchArt}
          setFetchArt={importer.setFetchArt}
          onImport={importer.doImport}
        />
      )}
      {tab === "file" && (
        <FileTab
          report={importer.report}
          busy={importer.busy}
          fetchArt={importer.fetchArt}
          setFetchArt={importer.setFetchArt}
          onFile={(f) => void importer.onFile(f)}
          onXml={(f) => void importer.onXml(f)}
        />
      )}
      {tab === "mpc" && (
        <MpcTab
          report={importer.report}
          busy={importer.busy}
          onXml={(f) => void importer.onXml(f)}
        />
      )}
      {tab === "link" && <LinkTab />}
    </div>
  );
}

/** Livello 1 — ricerca singola carta (Scryfall) con aggiunta immediata. */
function SearchTab(): JSX.Element {
  const [q, setQ] = useState("");
  const detected = useMemo(() => detectDeckLink(q), [q]);
  // Quando è un link, non interrogare Scryfall (stessa barra, due modalità).
  const search = useCardSearch(detected ? "" : q);
  const add = useDeck((s) => s.add);

  const pick = (c: ProviderCard): void => {
    add({
      name: c.name,
      qty: 1,
      zone: "main",
      provider: c.id.startsWith("local-") ? "local" : "scryfall",
      providerId: c.id,
      setCode: c.setCode,
      collectorNumber: c.collectorNumber,
      imageFront: c.imageFront,
      imageBack: c.imageBack,
      hasBack: c.hasBack,
    });
  };

  return (
    <section aria-label="Ricerca carte">
      <label htmlFor="card-search" className="mb-1 block text-xs text-neutral-400">
        Cerca carte (Scryfall) o incolla un link Moxfield / Archidekt
      </label>
      <input
        id="card-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="es. Lightning Bolt o https://www.moxfield.com/decks/…"
        className="panel-2 thin-border w-full rounded px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600"
        autoComplete="off"
      />
      {detected && (
        <DeckLinkImport
          provider={detected.provider}
          id={detected.id}
          onDone={() => setQ("")}
        />
      )}
      {!detected && search.data?.offline && (
        <p className="mt-1 text-xs text-yellow-400">Offline — catalogo locale</p>
      )}
      {!detected && (
        <ul className="mt-2 max-h-64 overflow-auto" aria-label="Risultati ricerca">
          {search.isLoading && <li className="text-xs text-neutral-500">Ricerca…</li>}
          {search.isError && <li className="text-xs text-red-400">Errore di rete — riprova</li>}
          {(search.data?.cards ?? []).map((c) => (
            <li key={c.id} className="thin-border mb-1 flex items-center gap-2 rounded p-1.5">
              <div className="h-10 w-7 shrink-0 overflow-hidden rounded bg-black">
                <ArtworkImage stored={c.imageFront} name={c.name} imgClassName="h-full w-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{c.name}</div>
                <div className="text-[11px] text-neutral-500">
                  {c.setCode} · {c.collectorNumber}
                </div>
              </div>
              <button
                onClick={() => pick(c)}
                className="rounded bg-neutral-200 px-2 py-1 text-xs font-semibold text-black"
                aria-label={`Aggiungi ${c.name}`}
              >
                +
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Livello 2 — incolla la lista testuale (qty + nome, intestazioni di zona, ID MPC in coda). */
function TextTab({
  text, setText, report, busy, fetchArt, setFetchArt, onImport,
}: {
  text: string;
  setText: (t: string) => void;
  report: string;
  busy: boolean;
  fetchArt: boolean;
  setFetchArt: (v: boolean) => void;
  onImport: () => void;
}): JSX.Element {
  return (
    <section aria-label="Importa da testo">
      <label htmlFor="decklist-text" className="mb-1 block text-xs text-neutral-400">
        Incolla decklist (qty + nome; header Sideboard/Commander/…; # commenti; MPC ID in coda)
      </label>
      <textarea
        id="decklist-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        className="panel-2 thin-border w-full rounded p-2 font-mono text-xs"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onImport}
          disabled={busy}
          className="rounded bg-neutral-200 px-3 py-1 text-xs font-semibold text-black disabled:opacity-50"
        >
          {busy ? "Elaborazione…" : "Importa"}
        </button>
        <ArtworkToggle checked={fetchArt} onChange={setFetchArt} />
      </div>
      {report && <p className="mt-1 text-xs text-neutral-400">{report}</p>}
    </section>
  );
}

/** Livello 3 — importa da file (TXT/CSV/JSON/DEC). */
function FileTab({
  report, busy, fetchArt, setFetchArt, onFile, onXml,
}: {
  report: string;
  busy: boolean;
  fetchArt: boolean;
  setFetchArt: (v: boolean) => void;
  onFile: (f: File | undefined) => void;
  onXml: (f: File | undefined) => void;
}): JSX.Element {
  void onXml;
  return (
    <section aria-label="Importa da file">
      <p className="mb-2 text-xs text-neutral-400">
        File di lista (TXT/CSV/JSON/DEC, notazioni <span className="font-mono">[SET] n</span>,{" "}
        <span className="font-mono">(set) n</span>). Il contenuto finisce nel livello “Testo”: premi lì Importa.
        Per l&apos;XML di MPC Autofill usa il livello “MPC XML”.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="panel-2 thin-border cursor-pointer rounded px-3 py-1 text-xs">
          Apri TXT/CSV
          <input
            type="file"
            accept=".txt,.csv,.json,.dec"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        <ArtworkToggle checked={fetchArt} onChange={setFetchArt} />
      </div>
      {busy && <p className="mt-1 text-xs text-neutral-500">Elaborazione…</p>}
      {report && <p className="mt-1 text-xs text-neutral-400">{report}</p>}
    </section>
  );
}

/** Livello 4 — importa XML di MPC Autofill (fronti per slot + retri abbinati per slot). */
function MpcTab({
  report, busy, onXml,
}: {
  report: string;
  busy: boolean;
  onXml: (f: File | undefined) => void;
}): JSX.Element {
  return (
    <section aria-label="Importa MPC XML">
      <p className="mb-2 text-xs text-neutral-400">
        File XML di MPC Autofill: i fronti entrano per slot, i retri si abbinano per slot sovrapposti
        (le immagini arrivano dirette dal Drive, senza ricerca).
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="panel-2 thin-border cursor-pointer rounded px-3 py-1 text-xs" title="Importa XML MPC Autofill (fronts/backs con Art ID)">
          Apri MPC XML
          <input
            type="file"
            accept=".xml"
            className="hidden"
            onChange={(e) => onXml(e.target.files?.[0])}
          />
        </label>
      </div>
      {busy && <p className="mt-1 text-xs text-neutral-500">Elaborazione…</p>}
      {report && <p className="mt-1 text-xs text-neutral-400">{report}</p>}
    </section>
  );
}

/** Livello 5 — incolla un link diretto (stesso motore della ricerca). */
function LinkTab(): JSX.Element {
  const [url, setUrl] = useState("");
  const detected = useMemo(() => detectDeckLink(url), [url]);
  return (
    <section aria-label="Importa da collegamento">
      <label htmlFor="decklink-url" className="mb-1 block text-xs text-neutral-400">
        Incolla un link Moxfield o Archidekt (il mazzo deve essere pubblico)
      </label>
      <input
        id="decklink-url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://www.moxfield.com/decks/…"
        className="panel-2 thin-border w-full rounded px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600"
        autoComplete="off"
      />
      {detected ? (
        <DeckLinkImport provider={detected.provider} id={detected.id} onDone={() => setUrl("")} />
      ) : (
        url.trim() !== "" && (
          <p className="mt-1 text-xs text-yellow-400">Link non riconosciuto — controlla l’indirizzo.</p>
        )
      )}
    </section>
  );
}

/**
 * Interruttore “Scarica artwork”: attivo di default perché i fogli di stampa e
 * il PDF hanno bisogno delle immagini ad alta risoluzione. Spento = import
 * veloce dei soli nomi (le immagini si recuperano dopo).
 */
function ArtworkToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <label
      className="flex items-center gap-1 text-xs text-neutral-400"
      title="Attivo: scarica subito le immagini di stampa. Spento: importa solo i nomi, più veloce."
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label="Scarica artwork" />
      Scarica artwork
    </label>
  );
}

interface RemoteDeckEntry {
  qty: number;
  name: string;
  zone: string;
  set_code?: string;
  collector_number?: string;
}

interface RemoteDeckResult {
  name: string;
  provider: string;
  entries: RemoteDeckEntry[];
  unknown: string[];
  warnings: string[];
}

/** Import da link Moxfield/Archidekt. */
function DeckLinkImport({ provider, id, onDone }: { provider: "moxfield" | "archidekt"; id: string; onDone: () => void }): JSX.Element {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [fetchArt, setFetchArt] = useState(true);
  const add = useDeck((s) => s.add);
  const label = providerLabel(provider);
  const cmd = provider === "moxfield" ? "fetch_moxfield_deck" : "fetch_archidekt_deck";

  const doFetch = async (): Promise<void> => {
    if (busy) return;
    if (!backend.isTauri) {
      setStatus("Import da link disponibile solo nell'app desktop (manca il proxy anti-CORS). Incolla la decklist sotto come fallback.");
      return;
    }
    setBusy(true);
    setStatus(`Recupero mazzo da ${label}…`);
    try {
      const res = await invoke<RemoteDeckResult>(cmd, { id });
      const added: { id: string; name: string }[] = [];
      for (const e of res.entries) {
        const zone: Zone = (VALID_ZONES as string[]).includes(e.zone) ? (e.zone as Zone) : "main";
        const newId = add({
          name: e.name,
          qty: Math.min(Math.max(e.qty, 1), 99),
          zone,
          provider: "custom",
          setCode: e.set_code,
          collectorNumber: e.collector_number,
          hasBack: false,
        });
        added.push({ id: newId, name: e.name });
      }
      const base =
        `${label}: "${res.name}" — importate ${added.length} voci` +
        (res.unknown.length ? ` — ${res.unknown.length} ignorate` : "") +
        (res.warnings.length ? ` (${res.warnings[0]})` : "");
      setStatus(base);
      if (added.length > 0) {
        const ui = useUi.getState();
        ui.setTab(ui.importTarget);
      }
      if (!fetchArt || added.length === 0) {
        return;
      }
      const ctrl = new AbortController();
      const projectId = useProjects.getState().activeId;
      const lang = useSettings.getState().cardLang;
      const collected: { id: string; patch: ArtworkPatch }[] = [];
      const out = await enrichWithArtwork(added, {
        signal: ctrl.signal,
        lang,
        onProgress: (p) => setStatus(`${base} — artwork ${p.done}/${p.total}: ${p.current}`),
        apply: async (item, patch) => {
          collected.push({ id: item.id, patch: await persistPatch(patch, projectId) });
        },
      });
      useDeck.getState().applyPatches(collected);
      setStatus(`${base} — ${artworkSummary(out, added.length, lang)}`);
    } catch (e) {
      setStatus(`Import fallito: ${e instanceof Error ? e.message : String(e)} — se il mazzo è privato, rendilo pubblico o incolla la decklist sotto.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-2 thin-border mt-2 rounded p-2" aria-label={`Import da ${label}`} data-testid="decklink-import">
      <p className="text-xs text-neutral-300">
        Link {label} rilevato <span className="font-mono text-neutral-500">({id})</span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void doFetch()}
          disabled={busy}
          className="rounded bg-neutral-200 px-3 py-1 text-xs font-semibold text-black disabled:opacity-50"
        >
          {busy ? "Recupero…" : `Importa mazzo da ${label}`}
        </button>
        <ArtworkToggle checked={fetchArt} onChange={setFetchArt} />
        <button
          type="button"
          onClick={onDone}
          className="panel thin-border rounded px-2 py-1 text-xs"
          aria-label="Pulisci ricerca"
        >
          Pulisci
        </button>
      </div>
      {status && <p className="mt-1 text-xs text-neutral-400" aria-live="polite">{status}</p>}
    </div>
  );
}

export interface MoxfieldUserDeck {
  public_id: string;
  name: string;
  format: string;
  main_count: number;
  total_count: number;
  updated_at?: string;
}

interface MoxfieldUserDecks {
  user: string;
  decks: MoxfieldUserDeck[];
  total: number;
}

function newEntryId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/**
 * Import deck da profilo Moxfield: nickname o link → lista dei deck pubblici
 * → un progetto per deck selezionato (stesse zone dell'import da link).
 * Solo deck pubblici: i privati richiedono login e restano fuori portata.
 */
export function MoxfieldProfileImport(): JSX.Element {
  const [input, setInput] = useState("");
  const user = useMemo(() => detectMoxfieldUser(input), [input]);
  const [result, setResult] = useState<MoxfieldUserDecks | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [fetchArt, setFetchArt] = useState(true);
  const [busyList, setBusyList] = useState(false);
  const [busyImport, setBusyImport] = useState(false);
  const [status, setStatus] = useState("");

  const listDecks = async (): Promise<void> => {
    if (!user || busyList) return;
    if (!backend.isTauri) {
      setStatus("Elenco deck disponibile solo nell'app desktop (manca il proxy anti-CORS).");
      return;
    }
    setBusyList(true);
    setStatus(`Cerco i deck di ${user}…`);
    try {
      const r = await invoke<MoxfieldUserDecks>("fetch_moxfield_user_decks", { user });
      setResult(r);
      setChecked(new Set(r.decks.map((d) => d.public_id)));
      setStatus(
        r.decks.length === 0
          ? "Nessun deck pubblico trovato."
          : `${r.decks.length} deck pubblici di ${r.user} — seleziona e importa.`,
      );
    } catch (e) {
      setResult(null);
      setStatus(`Elenco fallito: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyList(false);
    }
  };

  const toggle = (id: string): void => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const importSelected = async (): Promise<void> => {
    if (!result || busyImport) return;
    const picked = result.decks.filter((d) => checked.has(d.public_id));
    if (picked.length === 0) {
      setStatus("Seleziona almeno un deck.");
      return;
    }
    setBusyImport(true);
    const ctrl = new AbortController();
    const lang = useSettings.getState().cardLang;
    const done: string[] = [];
    try {
      for (let i = 0; i < picked.length; i++) {
        const deck = picked[i] as MoxfieldUserDeck;
        setStatus(`"${deck.name}" (${i + 1}/${picked.length}): scarico lista…`);
        const res = await invoke<RemoteDeckResult>("fetch_moxfield_deck", { id: deck.public_id });
        const entries: CardEntry[] = [];
        const toEnrich: { id: string; name: string }[] = [];
        res.entries.forEach((e, idx) => {
          const zone: Zone = (VALID_ZONES as string[]).includes(e.zone) ? (e.zone as Zone) : "main";
          const id = newEntryId();
          entries.push({
            id,
            name: e.name,
            qty: Math.min(Math.max(e.qty, 1), 99),
            zone,
            provider: "custom",
            setCode: e.set_code,
            collectorNumber: e.collector_number,
            hasBack: false,
            sortOrder: idx,
          });
          toEnrich.push({ id, name: e.name });
        });
        const project = await backend.createProject(res.name || deck.name);
        await backend.saveManifest({
          ...project,
          updated_at: new Date().toISOString(),
          manifest: { ...project.manifest, deck: entries },
        });
        if (fetchArt && toEnrich.length > 0) {
          const collected: { id: string; patch: ArtworkPatch }[] = [];
          const out = await enrichWithArtwork(toEnrich, {
            signal: ctrl.signal,
            lang,
            onProgress: (p) => setStatus(`"${deck.name}" (${i + 1}/${picked.length}): artwork ${p.done}/${p.total}`),
            apply: async (item, patch) => {
              collected.push({ id: item.id, patch: await persistPatch(patch, project.id) });
            },
          });
          if (collected.length > 0) {
            const byId = new Map(collected.map((c) => [c.id, c.patch]));
            const enriched = entries.map((c) => {
              const patch = byId.get(c.id);
              return patch ? { ...c, ...patch } : c;
            });
            await backend.saveManifest({
              ...project,
              updated_at: new Date().toISOString(),
              manifest: { ...project.manifest, deck: enriched },
            });
          }
          void out;
        }
        done.push(res.name || deck.name);
        setStatus(`"${deck.name}" (${i + 1}/${picked.length}): progetto creato.`);
      }
      setStatus(`Importati ${done.length} ${done.length === 1 ? "progetto" : "progetti"}: ${done.join(" · ")} — aprili dalla vista Progetti.`);
    } catch (e) {
      setStatus(
        `Import interrotto dopo ${done.length} ${done.length === 1 ? "progetto" : "progetti"}: ${e instanceof Error ? e.message : String(e)}` +
          (done.length > 0 ? ` (completati: ${done.join(" · ")})` : ""),
      );
    } finally {
      setBusyImport(false);
    }
  };

  return (
    <div aria-label="Importa deck da profilo Moxfield" data-testid="mox-profile">
      <label htmlFor="mox-profile-input" className="mb-1 block text-xs text-neutral-400">
        Nickname o link del profilo Moxfield (solo deck pubblici)
      </label>
      <div className="flex gap-2">
        <input
          id="mox-profile-input"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setResult(null);
            setStatus("");
          }}
          placeholder="es. Necron_fan-99 o https://www.moxfield.com/users/…"
          aria-label="Nickname o link profilo Moxfield"
          className="panel-2 thin-border min-w-0 flex-1 rounded px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => void listDecks()}
          disabled={!user || busyList}
          className="shrink-0 rounded bg-neutral-200 px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
        >
          {busyList ? "Cerco…" : "Mostra deck"}
        </button>
      </div>
      {input.trim() !== "" && !user && (
        <p className="mt-1 text-xs text-yellow-400">Nickname o link profilo non riconosciuto.</p>
      )}
      {result && result.decks.length > 0 && (
        <div className="panel-2 thin-border mt-2 rounded p-2">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-300">
              {result.decks.length} deck di {result.user}
            </span>
            <button
              type="button"
              onClick={() => setChecked(new Set(result.decks.map((d) => d.public_id)))}
              className="panel thin-border rounded px-2 py-0.5 text-[11px]"
            >
              Tutti
            </button>
            <button
              type="button"
              onClick={() => setChecked(new Set())}
              className="panel thin-border rounded px-2 py-0.5 text-[11px]"
            >
              Nessuno
            </button>
          </div>
          <ul className="max-h-48 space-y-1 overflow-auto" aria-label="Deck del profilo">
            {result.decks.map((d) => (
              <li key={d.public_id} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-neutral-900">
                <input
                  type="checkbox"
                  checked={checked.has(d.public_id)}
                  onChange={() => toggle(d.public_id)}
                  aria-label={`Seleziona deck ${d.name}`}
                  className="h-4 w-4 shrink-0 accent-neutral-200"
                />
                <span className="min-w-0 flex-1 truncate text-xs">
                  {d.name}
                  <span className="ml-1 text-[11px] text-neutral-500">
                    {[d.format, d.total_count > 0 ? `${d.total_count} carte` : ""].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void importSelected()}
              disabled={busyImport || checked.size === 0}
              data-testid="mox-profile-import"
              className="rounded bg-neutral-200 px-3 py-1 text-xs font-semibold text-black disabled:opacity-50"
            >
              {busyImport ? "Importo…" : `Importa selezionati (${checked.size})`}
            </button>
            <ArtworkToggle checked={fetchArt} onChange={setFetchArt} />
          </div>
        </div>
      )}
      {status && <p className="mt-1 text-xs text-neutral-400" aria-live="polite" data-testid="mox-profile-status">{status}</p>}
    </div>
  );
}

/** Stato condiviso tra i livelli Testo/File/MPC (stesso report, niente duplicati). */
function useDecklistImporter(): {
  text: string;
  setText: (t: string) => void;
  report: string;
  busy: boolean;
  fetchArt: boolean;
  setFetchArt: (v: boolean) => void;
  doImport: () => void;
  onFile: (f: File | undefined) => Promise<void>;
  onXml: (f: File | undefined) => Promise<void>;
} {
  const [text, setText] = useState("4 Lightning Bolt\n2 Counterspell\n1 Sol Ring\n");
  const [report, setReport] = useState("");
  const [busy, setBusy] = useState(false);
  const [fetchArt, setFetchArt] = useState(true);
  const add = useDeck((s) => s.add);

  const doImport = (): void => {
    if (busy) return;
    const parsed = parseDeckList(text);
    const ctrl = new AbortController();
    // Aggiungi subito (con o senza artwork), poi arricchisci in background.
    // Voci con MPC Art ID: provider mpc + URL Drive diretto, niente ricerca.
    const added: { id: string; name: string }[] = [];
    for (const e of parsed.entries) {
      if (e.mpcId) {
        add({
          name: e.name,
          qty: e.qty,
          zone: e.zone,
          provider: "mpc",
          providerId: e.mpcId,
          setCode: e.setCode,
          collectorNumber: e.collectorNumber,
          imageFront: driveDownloadUrl(e.mpcId),
          hasBack: false,
        });
        continue;
      }
      const id = add({
        name: e.name,
        qty: e.qty,
        zone: e.zone,
        provider: "custom",
        setCode: e.setCode,
        collectorNumber: e.collectorNumber,
        hasBack: false,
      });
      added.push({ id, name: e.name });
    }
    const base =
      `Importate ${parsed.entries.length} righe` +
      (parsed.unknown.length ? ` — ${parsed.unknown.length} non riconosciute (conservate)` : "");
    setReport(base);
    // la lista è condivisa: dopo l'import si apre la destinazione scelta
    if (parsed.entries.length > 0) {
      const ui = useUi.getState();
      ui.setTab(ui.importTarget);
    }
    if (!fetchArt || added.length === 0) return;
    setBusy(true);
    // Fase 1: URL remoti (veloce) → Fase 2: file locali via backend (un solo snapshot undo).
    const projectId = useProjects.getState().activeId;
    const lang = useSettings.getState().cardLang;
    const collected: { id: string; patch: ArtworkPatch }[] = [];
    void enrichWithArtwork(added, {
      signal: ctrl.signal,
      lang,
      onProgress: (p) => setReport(`${base} — artwork ${p.done}/${p.total}: ${p.current}`),
      apply: async (item, patch) => {
        collected.push({ id: item.id, patch: await persistPatch(patch, projectId) });
      },
    }).then((out) => {
      useDeck.getState().applyPatches(collected);
      setBusy(false);
      setReport(`${base} — ${artworkSummary(out, added.length, lang)}`);
    });
  };

  const onFile = async (f: File | undefined): Promise<void> => {
    if (!f) return;
    const content = await f.text();
    setText(content);
    const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "").length;
    setReport(`File "${f.name}" caricato (${lines} righe) — premi Importa nel livello Testo.`);
  };

  /** Import MPC Autofill XML: front per slot + retro abbinato per slot sovrapposti. */
  const onXml = async (f: File | undefined): Promise<void> => {
    if (!f || busy) return;
    setBusy(true);
    try {
      const parsed = parseMpcXml(await f.text());
      // slot → id retro (il primo che lo reclama vince)
      const backBySlot = new Map<string, string>();
      for (const b of parsed.backs) {
        for (const s of b.slots) {
          if (!backBySlot.has(s)) backBySlot.set(s, b.mpcId);
        }
      }
      let n = 0;
      for (const front of parsed.fronts) {
        const backId = front.slots.map((s) => backBySlot.get(s)).find((v) => v !== undefined);
        add({
          name: front.name,
          qty: front.qty,
          zone: "main",
          provider: "mpc",
          providerId: front.mpcId,
          imageFront: driveDownloadUrl(front.mpcId),
          imageBack: backId ? driveDownloadUrl(backId) : undefined,
          hasBack: backId !== undefined,
        });
        n += 1;
      }
      setReport(
        `MPC XML: ${n} fronti importati` +
          (parsed.backs.length ? `, ${parsed.backs.length} retri abbinati per slot` : "") +
          (parsed.unknownCards ? ` — ${parsed.unknownCards} carte senza ID ignorate` : ""),
      );
      if (n > 0) {
        const ui = useUi.getState();
        ui.setTab(ui.importTarget);
      }
    } catch (e) {
      setReport(`XML non valido: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return { text, setText, report, busy, fetchArt, setFetchArt, doImport, onFile, onXml };
}

/** Riepilogo artwork con lingua richiesta, ripieghi e mancanti (mai silenzioso). */
function artworkSummary(
  out: { enriched: number; missing: string[]; fellBack: number },
  total: number,
  lang: string,
): string {
  const pref = lang === "any" ? "" : ` (preferita: ${CARD_LANG_LABEL[lang as "it" | "en"]})`;
  return (
    `artwork trovati per ${out.enriched}/${total}${pref}` +
    (out.fellBack > 0 ? ` — ${out.fellBack} in inglese (nessuna stampa ${lang === "it" ? "italiana" : "nella lingua scelta"})` : "") +
    (out.missing.length ? ` — mancanti: ${out.missing.slice(0, 5).join(", ")}${out.missing.length > 5 ? "…" : ""}` : "")
  );
}
