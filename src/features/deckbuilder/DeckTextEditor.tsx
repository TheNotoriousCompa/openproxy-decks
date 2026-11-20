import { useState } from "react";
import { copyText } from "@/lib/clipboard";
import { parseDeckList, serializeDeckList } from "@/lib/decklist";
import { enrichWithArtwork, type ArtworkPatch } from "@/services/artwork";
import { driveDownloadUrl } from "@/services/mpc";
import { persistPatch } from "@/services/images";
import { useDeck } from "@/stores/deck";
import { useProjects } from "@/stores/projects";
import { useSettings } from "@/stores/settings";
import type { CardEntry, Zone } from "@/types";

type ApplyMode = "merge" | "replace";

/**
 * Lista testuale con MPC ID, modificabile: incolla un'altra lista (con o
 * senza `(mpc:ID)` in coda riga) e Unisci o Sostituisci. Le righe con MPC ID
 * puntano subito all'arte Drive; le altre vengono arricchite in background
 * come nell'import. Un solo passo undo per applicazione.
 */
export function DeckTextEditor(): JSX.Element {
  const deck = useDeck((s) => s.deck);
  const [text, setText] = useState(() => serializeCurrent(deck));
  const [mode, setMode] = useState<ApplyMode>("merge");
  const [report, setReport] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const reload = (): void => {
    setText(serializeCurrent(useDeck.getState().deck));
    setReport("");
  };

  const copy = async (): Promise<void> => {
    const r = await copyText(text);
    if (r.ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  };

  const apply = (): void => {
    if (busy) return;
    const parsed = parseDeckList(text);
    if (parsed.entries.length === 0) {
      setReport(
        parsed.unknown.length > 0
          ? `Nessuna riga valida (${parsed.unknown.length} non riconosciute).`
          : "Nessuna riga da applicare.",
      );
      return;
    }
    const projectId = useProjects.getState().activeId;
    const lang = useSettings.getState().cardLang;
    const st = useDeck.getState();

    if (mode === "replace") {
      const { next, toEnrich } = buildReplacement(parsed.entries);
      st.push(() => next);
      const msg = `Lista sostituita: ${next.length} voci` + unknownSuffix(parsed.unknown.length);
      if (toEnrich.length === 0) {
        setReport(msg);
        return;
      }
      setBusy(true);
      setReport(`${msg} — artwork in corso…`);
      void enrichEntries(toEnrich, projectId, lang).then((done) => {
        setBusy(false);
        setReport(`${msg} — ${done}`);
      });
      return;
    }

    // merge: aggiorna omonime (nome+zona), aggiungi le nuove, un solo undo
    const next = st.deck.map((c) => ({ ...c }));
    const nextByKey = new Map(next.map((c) => [mergeKey(c.name, c.zone, mpcOf(c)), c]));
    const toEnrich: { id: string; name: string }[] = [];
    let updated = 0;
    let added = 0;
    // id stabili per le nuove voci (sortOrder in coda)
    let order = next.length;
    const newId = (): string =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${order}-${Math.floor(Math.random() * 1e9)}`;
    for (const e of parsed.entries) {
      // aggancio: stesso MPC ID, altrimenti stessa nome+zona (la voce esistente
      // viene aggiornata col nuovo MPC ID quando la riga ce l'ha)
      const hit =
        nextByKey.get(mergeKey(e.name, e.zone, e.mpcId)) ??
        nextByKey.get(mergeKey(e.name, e.zone, undefined));
      if (hit) {
        hit.qty = Math.min(99, Math.max(1, e.qty));
        if (e.mpcId && mpcOf(hit) !== e.mpcId) {
          hit.provider = "mpc";
          hit.providerId = e.mpcId;
          hit.imageFront = driveDownloadUrl(e.mpcId);
        }
        if (e.setCode) hit.setCode = e.setCode;
        if (e.collectorNumber) hit.collectorNumber = e.collectorNumber;
        updated += 1;
      } else {
        const id = newId();
        const entry = entryFromParsed(id, e, order);
        order += 1;
        next.push(entry);
        nextByKey.set(mergeKey(entry.name, entry.zone, mpcOf(entry)), entry);
        if (!entry.imageFront) toEnrich.push({ id, name: entry.name });
        added += 1;
      }
    }
    st.push(() => next);
    const msg =
      `Unione: ${updated} aggiornate, ${added} nuove` + unknownSuffix(parsed.unknown.length);
    if (toEnrich.length === 0) {
      setReport(msg);
      return;
    }
    setBusy(true);
    setReport(`${msg} — artwork in corso…`);
    void enrichEntries(toEnrich, projectId, lang).then((done) => {
      setBusy(false);
      setReport(`${msg} — ${done}`);
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="deck-text-editor">
      <div className="flex flex-wrap items-center gap-2">
        <div className="panel-2 thin-border flex rounded" role="group" aria-label="Modo applicazione">
          {(
            [
              ["merge", "Unisci"],
              ["replace", "Sostituisci"],
            ] as [ApplyMode, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setMode(v)}
              aria-pressed={mode === v}
              title={
                v === "merge"
                  ? "Aggiorna quantità/zone delle omonime, aggiungi le nuove"
                  : "Rimpiazza l'intera lista col testo"
              }
              className={`rounded px-2 py-1 text-xs ${mode === v ? "bg-neutral-200 font-semibold text-black" : "text-neutral-400"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={apply}
          disabled={busy}
          className="rounded bg-neutral-200 px-3 py-1 text-xs font-semibold text-black disabled:opacity-50"
          data-testid="deck-text-apply"
        >
          {busy ? "Elaborazione…" : "Applica"}
        </button>
        <button
          type="button"
          onClick={reload}
          className="panel-2 thin-border rounded px-2 py-1 text-xs"
          title="Ricarica il testo dalla lista attuale"
        >
          Ricarica
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          className="panel-2 thin-border rounded px-2 py-1 text-xs"
          aria-live="polite"
        >
          {copied ? "Copiata ✓" : "Copia"}
        </button>
        <span className="text-[11px] text-neutral-600">qty Nome [SET] n (mpc:ID) · zone da intestazioni</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label="Lista testuale con MPC ID"
        data-testid="deck-text-area"
        className="panel-2 thin-border min-h-0 flex-1 rounded p-2 font-mono text-xs text-neutral-100"
      />
      {report && (
        <p className="text-xs text-neutral-400" aria-live="polite" data-testid="deck-text-report">
          {report}
        </p>
      )}
    </div>
  );
}

function mpcOf(c: Pick<CardEntry, "provider" | "providerId">): string | undefined {
  return c.provider === "mpc" ? c.providerId : undefined;
}

function mergeKey(name: string, zone: Zone, mpcId?: string): string {
  return `${zone}|${name.trim().toLowerCase()}|${mpcId ?? ""}`;
}

function unknownSuffix(n: number): string {
  return n > 0 ? ` — ${n} righe non riconosciute` : "";
}

function serializeCurrent(deck: CardEntry[]): string {
  return serializeDeckList(
    deck.map((c) => ({
      qty: c.qty,
      name: c.name,
      zone: c.zone,
      setCode: c.setCode,
      collectorNumber: c.collectorNumber,
      mpcId: mpcOf(c),
    })),
    { withMpcIds: true },
  );
}

function entryFromParsed(
  id: string,
  e: { name: string; qty: number; zone: Zone; setCode?: string; collectorNumber?: string; mpcId?: string },
  sortOrder: number,
): CardEntry {
  if (e.mpcId) {
    return {
      id,
      name: e.name,
      qty: Math.min(99, Math.max(1, e.qty)),
      zone: e.zone,
      provider: "mpc",
      providerId: e.mpcId,
      setCode: e.setCode,
      collectorNumber: e.collectorNumber,
      imageFront: driveDownloadUrl(e.mpcId),
      hasBack: false,
      sortOrder,
    };
  }
  return {
    id,
    name: e.name,
    qty: Math.min(99, Math.max(1, e.qty)),
    zone: e.zone,
    provider: "custom",
    setCode: e.setCode,
    collectorNumber: e.collectorNumber,
    hasBack: false,
    sortOrder,
  };
}

function buildReplacement(
  entries: { name: string; qty: number; zone: Zone; setCode?: string; collectorNumber?: string; mpcId?: string }[],
): { next: CardEntry[]; toEnrich: { id: string; name: string }[] } {
  const next: CardEntry[] = [];
  const toEnrich: { id: string; name: string }[] = [];
  entries.forEach((e, i) => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `t-${Date.now()}-${i}`;
    const entry = entryFromParsed(id, e, i);
    next.push(entry);
    if (!entry.imageFront) toEnrich.push({ id, name: entry.name });
  });
  return { next, toEnrich };
}

async function enrichEntries(
  items: { id: string; name: string }[],
  projectId: string | null,
  lang: ReturnType<typeof useSettings.getState>["cardLang"],
): Promise<string> {
  const ctrl = new AbortController();
  const collected: { id: string; patch: ArtworkPatch }[] = [];
  const out = await enrichWithArtwork(items, {
    signal: ctrl.signal,
    lang,
    apply: async (item, patch) => {
      collected.push({ id: item.id, patch: await persistPatch(patch, projectId) });
    },
  });
  useDeck.getState().applyPatches(collected);
  return `artwork: ${out.enriched} trovate, ${out.missing.length} mancanti`;
}
