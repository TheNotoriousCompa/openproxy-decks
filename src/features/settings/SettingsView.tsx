import { useEffect, useState } from "react";
import { useSettings } from "@/stores/settings";
import { CARD_LANG_OPTIONS } from "@/lib/cardLang";
import { checkMpcHealth, normalizeServer, type MpcStatus } from "@/services/mpc";
import { DEFAULT_MPC_SERVER } from "@/lib/constants";
import { invoke } from "@tauri-apps/api/core";
import { SourceFilterPanel } from "@/components/SourceFilterPanel";
import { clearTmp, fetchStorageUsage, formatBytes, totalBytes, type StorageUsage } from "@/lib/storage";
import { currentVersion, RELEASES_URL } from "@/lib/updater";
import { useUpdater } from "@/stores/updater";
import { openExternal } from "@/lib/external";

export function SettingsView(): JSX.Element {
  const { dpi, upscaleMode, cacheMb, mpcServerUrl, cardLang, loaded, set, load } = useSettings();
  const [mpcDraft, setMpcDraft] = useState<string | null>(null);
  const [mpcStatus, setMpcStatus] = useState<MpcStatus | null>(null);
  const [mpcBusy, setMpcBusy] = useState(false);
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageMsg, setStorageMsg] = useState("");
  const [version, setVersion] = useState("");
  const upd = useUpdater();

  useEffect(() => {
    void currentVersion().then(setVersion);
  }, []);

  useEffect(() => {
    void load();
  }, []);

  const refreshStorage = async (): Promise<void> => {
    setStorageBusy(true);
    setStorageMsg("");
    try {
      setStorage(await fetchStorageUsage());
    } catch {
      setStorage(null);
      setStorageMsg("Disponibile solo nell'app desktop.");
    } finally {
      setStorageBusy(false);
    }
  };

  useEffect(() => {
    void refreshStorage();
  }, []);

  const purgeTmp = async (): Promise<void> => {
    setStorageBusy(true);
    try {
      const freed = await clearTmp();
      setStorageMsg(`Temporanei puliti: liberati ${formatBytes(freed)}.`);
      setStorage(await fetchStorageUsage());
    } catch {
      setStorageMsg("Disponibile solo nell'app desktop.");
    } finally {
      setStorageBusy(false);
    }
  };

  const clear = async (what: string): Promise<void> => {
    try {
      await invoke("clear_caches", { what });
      alert("Cache svuotata.");
    } catch {
      alert("Disponibile solo nell'app desktop.");
    }
  };

  const verifyMpc = async (): Promise<void> => {
    const url = normalizeServer(mpcDraft ?? mpcServerUrl);
    if (!url) {
      setMpcStatus({ ok: false, reason: "not-configured", detail: "inserisci un URL https valido" });
      return;
    }
    setMpcBusy(true);
    setMpcStatus(null);
    const ctrl = new AbortController();
    try {
      const st = await checkMpcHealth(url, ctrl.signal);
      setMpcStatus(st);
      if (st.ok) set({ mpcServerUrl: url });
    } finally {
      setMpcBusy(false);
    }
  };

  if (!loaded) return <p className="p-6 text-sm text-neutral-500">Caricamento…</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6" role="main" aria-label="Impostazioni">
      <h1 className="text-lg font-bold">Settings</h1>

      <label className="block text-sm">DPI default
        <select value={dpi} onChange={(e) => set({ dpi: Number(e.target.value) })}
          className="panel-2 thin-border mt-1 w-full rounded px-2 py-1.5">
          {[150, 300, 450, 600, 900, 1200].map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>

      <label className="block text-sm">Lingua preferita delle carte
        <select value={cardLang} onChange={(e) => set({ cardLang: e.target.value as typeof cardLang })}
          className="panel-2 thin-border mt-1 w-full rounded px-2 py-1.5"
          data-testid="settings-card-lang">
          {CARD_LANG_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <span className="mt-1 block text-xs text-neutral-500">
          Usata da ricerca, stampe e import: se la carta non esiste in quella lingua, si passa all'inglese.
        </span>
      </label>

      <label className="block text-sm">Modalità upscale (CPU, DPI nativi con Off)
        <select value={upscaleMode} onChange={(e) => set({ upscaleMode: e.target.value as typeof upscaleMode })}
          className="panel-2 thin-border mt-1 w-full rounded px-2 py-1.5">
          <option value="off">Off (DPI nativi)</option>
          <option value="ask">Ask</option>
          <option value="auto">Automatic</option>
          <option value="always">Sempre</option>
        </select>
      </label>

      <label className="block text-sm">Budget cache (MB)
        <input type="number" value={cacheMb} min={128} max={32768} step={128}
          onChange={(e) => set({ cacheMb: Number(e.target.value) })}
          className="panel-2 thin-border mt-1 w-full rounded px-2 py-1.5" />
      </label>

      <fieldset className="panel-2 thin-border rounded p-3">
        <legend className="px-1 text-sm">Server MPC Autofill (tab stampe community)</legend>
        <p className="mb-2 text-xs text-neutral-500">
          URL base di un backend compatibile (default verificato: {DEFAULT_MPC_SERVER}).
          Vuoto = tab MPC disabilitata. Nessun dato inviato altrove senza tua azione.
        </p>
        <div className="flex gap-2">
          <input
            value={mpcDraft ?? mpcServerUrl}
            onChange={(e) => setMpcDraft(e.target.value)}
            placeholder="https://…"
            inputMode="url"
            aria-label="URL server MPC Autofill"
            className="panel thin-border flex-1 rounded px-2 py-1.5 text-sm"
          />
          <button
            onClick={() => void verifyMpc()}
            disabled={mpcBusy}
            className="rounded bg-neutral-200 px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
          >
            {mpcBusy ? "Verifica…" : "Verifica e salva"}
          </button>
          {mpcServerUrl && (
            <button
              onClick={() => {
                set({ mpcServerUrl: "" });
                setMpcDraft("");
                setMpcStatus(null);
              }}
              className="panel thin-border rounded px-3 py-1.5 text-sm"
            >
              Rimuovi
            </button>
          )}
          {mpcServerUrl !== DEFAULT_MPC_SERVER && (
            <button
              onClick={() => {
                set({ mpcServerUrl: DEFAULT_MPC_SERVER });
                setMpcDraft(DEFAULT_MPC_SERVER);
                setMpcStatus(null);
              }}
              className="panel thin-border rounded px-3 py-1.5 text-sm"
            >
              Ripristina default
            </button>
          )}
        </div>
        {mpcStatus && (
          <p className={`mt-2 text-xs ${mpcStatus.ok ? "text-green-400" : "text-yellow-400"}`} aria-live="polite">
            {mpcStatus.ok
              ? "Server compatibile, motore di ricerca attivo."
              : `Non utilizzabile (${mpcStatus.reason}${mpcStatus.detail ? `: ${mpcStatus.detail}` : ""}).`}
          </p>
        )}
        {!mpcStatus && mpcServerUrl && (
          <p className="mt-2 text-xs text-neutral-500">Configurato: {mpcServerUrl} (non ancora riverificato in questa sessione).</p>
        )}
      </fieldset>

      <section className="space-y-2" aria-label="Fonti escluse dal picker">
        <h2 className="text-sm font-semibold">Fonti escluse</h2>
        <p className="text-xs text-neutral-500">
          Stampe che non vuoi vedere quando scegli l'artwork: drive MPC (es. Trix Are For Scoot),
          tag MPC (es. AI Art) e set MTG. Restano nascoste per tutte le carte e si riattivano
          con un click; «mostra escluse» nel picker le fa ricomparire senza cambiarle.
        </p>
        <div className="panel-2 thin-border rounded">
          <SourceFilterPanel server={mpcServerUrl} />
        </div>
      </section>

      <section className="space-y-2" aria-label="Spazio disco">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Spazio disco</h2>
          <button
            type="button"
            onClick={() => void refreshStorage()}
            disabled={storageBusy}
            data-testid="storage-refresh"
            className="panel-2 thin-border ml-auto rounded px-2 py-0.5 text-xs disabled:opacity-50"
          >
            {storageBusy ? "…" : "Aggiorna"}
          </button>
        </div>
        {!storage && !storageMsg && <p className="text-xs text-neutral-500">Misuro…</p>}
        {storageMsg && (
          <p className="text-xs text-neutral-500" role="status">
            {storageMsg}
          </p>
        )}
        {storage && (
          <>
            <ul className="space-y-1 text-xs" data-testid="storage-rows">
              <StorageRow label={`Artwork progetti (${storage.projects})`} area={storage.assets} hint="full-res scaricati, mai toccati dalle pulizie" />
              <StorageRow label="Cache stampa" area={storage.cache} hint="JPEG + thumb ricostruibili" />
              <StorageRow label="PDF esportati" area={storage.exports} hint="crescono a ogni export" />
              <StorageRow label="Temporanei" area={storage.tmp} hint="scarti di lavorazione" />
              <StorageRow label="Modelli" area={storage.models} />
              <StorageRow label="Database" area={storage.database} />
              <li className="flex justify-between gap-2 border-t thin-border pt-1 font-semibold">
                <span>Totale</span>
                <span data-testid="storage-total">{formatBytes(totalBytes(storage))}</span>
              </li>
            </ul>
            {storage.tmp.bytes > 0 && (
              <button
                type="button"
                onClick={() => void purgeTmp()}
                disabled={storageBusy}
                data-testid="storage-clear-tmp"
                title="Rimuove gli scarti di lavorazione più vecchi di un'ora (mai quelli di un export in corso)"
                className="panel-2 thin-border rounded px-3 py-1.5 text-xs disabled:opacity-50"
              >
                Pulisci temporanei ({formatBytes(storage.tmp.bytes)})
              </button>
            )}
          </>
        )}
      </section>

      <section className="space-y-2" aria-label="Aggiornamenti">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Aggiornamenti</h2>
          <span className="text-xs text-neutral-500" data-testid="updater-version">
            {version ? `v${version}` : "…"}
          </span>
          <button
            type="button"
            onClick={() => void upd.check()}
            disabled={upd.status === "checking" || upd.status === "downloading" || version === "dev"}
            data-testid="updater-check"
            className="panel-2 thin-border ml-auto rounded px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {upd.status === "checking" ? "Controllo…" : "Controlla aggiornamenti"}
          </button>
        </div>
        <p className="text-xs text-neutral-400" role="status" data-testid="updater-status">
          {version === "dev" && "Disponibile solo nell'app desktop installata."}
          {version !== "dev" && upd.status === "idle" && "Controllo automatico all'avvio; puoi controllare anche qui."}
          {upd.status === "checking" && "Controllo le release firmate su GitHub…"}
          {upd.status === "uptodate" && "Sei alla versione più recente."}
          {upd.status === "available" && `Versione ${upd.version} disponibile.`}
          {upd.status === "downloading" &&
            `Scarico… ${upd.progress !== null ? `${Math.round(upd.progress * 100)}%` : "in corso"}`}
          {upd.status === "ready" && "Aggiornamento installato: riavvia per completare."}
          {upd.status === "error" && `Errore: ${upd.error}`}
        </p>
        <div className="flex flex-wrap gap-2">
          {upd.status === "available" && (
            <button
              type="button"
              onClick={() => void upd.install()}
              data-testid="updater-install"
              className="rounded bg-neutral-200 px-3 py-1.5 text-xs font-semibold text-black"
            >
              Aggiorna a {upd.version}
            </button>
          )}
          {upd.status === "ready" && (
            <button
              type="button"
              onClick={() => void upd.relaunch()}
              data-testid="updater-relaunch"
              className="rounded bg-neutral-200 px-3 py-1.5 text-xs font-semibold text-black"
            >
              Riavvia ora
            </button>
          )}
          <button
            type="button"
            onClick={() => void openExternal(RELEASES_URL)}
            className="text-xs text-neutral-400 underline hover:text-neutral-100"
          >
            Note della release
          </button>
        </div>
        {upd.notes && upd.status !== "idle" && (
          <details className="text-xs text-neutral-400">
            <summary className="cursor-pointer">Cosa cambia</summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5">
              {upd.notes}
            </pre>
          </details>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => void clear("images")} className="panel-2 thin-border rounded px-3 py-1.5 text-sm">Clear image cache</button>
        <button onClick={() => void clear("processing")} className="panel-2 thin-border rounded px-3 py-1.5 text-sm">Clear processing cache</button>
        <button onClick={() => void clear("database")} className="panel-2 thin-border rounded px-3 py-1.5 text-sm">Clear database cache</button>
        <button
          onClick={() => {
            if (window.confirm("Resettare l'app (cache + impostazioni)?")) void invoke("reset_app").catch(() => alert("Solo app desktop."));
          }}
          className="rounded bg-red-800 px-3 py-1.5 text-sm text-white"
        >
          Reset app
        </button>
      </div>

      <p className="text-xs text-neutral-500">
        Upscale solo CPU (Lanczos3 HQ). Con Off le carte escono ai DPI nativi, senza ingrandimenti.
      </p>
    </div>
  );
}

function StorageRow({ label, area, hint }: { label: string; area: { bytes: number; files: number }; hint?: string }): JSX.Element {
  return (
    <li className="flex justify-between gap-2" title={hint}>
      <span className="text-neutral-400">{label}</span>
      <span>
        {formatBytes(area.bytes)}{" "}
        <span className="text-neutral-500">· {area.files} file</span>
      </span>
    </li>
  );
}
