import { useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { ArtworkImage } from "@/components/ArtworkImage";
import { BUILT_IN_PRESETS } from "@/lib/presets";
import { PAGE_PRESETS_MM, VISIBLE_CARD_PRESETS } from "@/lib/units";
import { backend } from "@/services/backend";
import { importFileViaBackend } from "@/services/images";
import { useProjects } from "@/stores/projects";
import type { GuideShape, PrintSettings } from "@/types";
import type { PrintBuilderApi } from "@/features/print/usePrintBuilder";

/** Default guide: segni d'angolo verdi da 2mm (usati anche dal Ripristina). */
export const GUIDE_DEFAULTS = {
  guides: { cropMarks: true, cornerMarks: false, cutLines: false, pageLines: false },
  guideColor: "#00ff00",
  guideWidthPt: 0.75,
  guidePlacement: "inside",
  guideLengthMm: 2,
  guideShape: "inside",
  guideOffsetMm: 0,
  guideStyle: "solid",
  guideCap: "square",
} as const;

/** Livelli del pannello stampa: un solo livello piatto, mai sezioni dentro sezioni. */
const LEVELS = [
  { id: "formato", label: "1 · Formato" },
  { id: "griglia", label: "2 · Griglia" },
  { id: "qualita", label: "3 · Qualità" },
  { id: "guide", label: "4 · Guide" },
  { id: "esporta", label: "5 · Esporta" },
] as const;

type Level = (typeof LEVELS)[number]["id"];

/** Form impostazioni stampa (modello + 5 livelli + export). Tutto in italiano. */
export function PrintForm({ pb }: { pb: PrintBuilderApi }): JSX.Element {
  const { register, handleSubmit, setValue, formState } = pb;
  const [level, setLevel] = useState<Level>("griglia");

  const resetGuides = (): void => {
    setValue("guides", { ...GUIDE_DEFAULTS.guides }, { shouldDirty: true });
    setValue("guideColor", GUIDE_DEFAULTS.guideColor, { shouldDirty: true });
    setValue("guideWidthPt", GUIDE_DEFAULTS.guideWidthPt, { shouldDirty: true });
    setValue("guidePlacement", GUIDE_DEFAULTS.guidePlacement, { shouldDirty: true });
    setValue("guideLengthMm", GUIDE_DEFAULTS.guideLengthMm, { shouldDirty: true });
    setValue("guideShape", GUIDE_DEFAULTS.guideShape, { shouldDirty: true });
    setValue("guideOffsetMm", GUIDE_DEFAULTS.guideOffsetMm, { shouldDirty: true });
    setValue("guideStyle", GUIDE_DEFAULTS.guideStyle, { shouldDirty: true });
    setValue("guideCap", GUIDE_DEFAULTS.guideCap, { shouldDirty: true });
    void handleSubmit(pb.apply)();
  };

  return (
    <form onSubmit={handleSubmit(pb.apply)} className="panel shrink-0 border-b thin-border p-3 text-xs">
      <h2 className="mb-2 text-sm font-bold">Stampa</h2>

      <label className="mb-1 block text-neutral-400" htmlFor="pb-preset">Modello</label>
      <div className="mb-2 flex gap-1">
        <select
          id="pb-preset"
          value={pb.presetId}
          onChange={(e) => pb.applyPreset(e.target.value)}
          className="panel-2 thin-border min-w-0 flex-1 rounded px-2 py-1"
          aria-label="Modello di layout"
          data-testid="print-preset"
        >
          <optgroup label="Integrati">
            {BUILT_IN_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </optgroup>
          {pb.customPresets.length > 0 && (
            <optgroup label="Personali">
              {pb.customPresets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          )}
        </select>
        <button type="button" onClick={() => void pb.saveCurrentAsPreset()}
          className="panel-2 thin-border shrink-0 rounded px-2 py-1" title="Salva impostazioni come modello">
          Salva
        </button>
        {pb.customPresets.some((p) => p.id === pb.presetId) && (
          <button type="button" onClick={() => void pb.removePreset(pb.presetId)}
            className="shrink-0 rounded bg-red-800 px-2 py-1 text-white" title="Elimina modello personale">
            ✕
          </button>
        )}
      </div>

      {/* Livelli: passi in fila che vanno a capo, niente righe dimezzate */}
      <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="Livelli impostazioni">
        {LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            role="tab"
            aria-selected={level === l.id}
            onClick={() => setLevel(l.id)}
            className={`min-w-[80px] flex-1 whitespace-nowrap rounded px-1 py-1.5 text-[11px] ${
              level === l.id ? "bg-neutral-200 font-semibold text-black" : "panel-2 thin-border text-neutral-300"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {level === "formato" && (
        <section aria-label="Livello formato">
          <label className="mb-1 block text-neutral-400" htmlFor="pb-page">Pagina</label>
          <select
            id="pb-page"
            value={pb.values.page}
            onChange={(e) => {
              const id = e.target.value as PrintSettings["page"];
              setValue("page", id);
              const p = PAGE_PRESETS_MM[id];
              if (p && id !== "custom") {
                setValue("pageWmm", p.w);
                setValue("pageHmm", p.h);
              }
            }}
            className="panel-2 thin-border mb-2 w-full rounded px-2 py-1"
          >
            {Object.entries(PAGE_PRESETS_MM).map(([id, p]) => (
              <option key={id} value={id}>{p.label}</option>
            ))}
          </select>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <Num register={register("pageWmm", { valueAsNumber: true })} label="Pagina largh. (mm)" />
            <Num register={register("pageHmm", { valueAsNumber: true })} label="Pagina alt. (mm)" />
          </div>
          <label className="mb-1 block text-neutral-400" htmlFor="pb-card">Carta</label>
          <select
            id="pb-card"
            value={pb.values.card}
            onChange={(e) => {
              const id = e.target.value as PrintSettings["card"];
              setValue("card", id);
              const p = VISIBLE_CARD_PRESETS.find(([pid]) => pid === id)?.[1];
              if (p && id !== "custom") {
                setValue("cardWmm", p.w);
                setValue("cardHmm", p.h);
              }
            }}
            className="panel-2 thin-border mb-2 w-full rounded px-2 py-1"
          >
            {VISIBLE_CARD_PRESETS.map(([id, p]) => (
              <option key={id} value={id}>{p.label}</option>
            ))}
          </select>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <Num register={register("cardWmm", { valueAsNumber: true })} label="Carta largh. (mm)" />
            <Num register={register("cardHmm", { valueAsNumber: true })} label="Carta alt. (mm)" />
          </div>
          <label className="block">Orientamento
            <select {...register("orientation")} className="panel-2 thin-border mt-1 w-full rounded px-2 py-1">
              <option value="portrait">Verticale</option>
              <option value="landscape">Orizzontale</option>
            </select>
          </label>
        </section>
      )}

      {level === "griglia" && (
        <section aria-label="Livello griglia">
          <h3 className="mb-1 text-[11px] font-semibold uppercase text-neutral-400">Margini (mm)</h3>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <Num register={register("marginTopMm", { valueAsNumber: true })} label="Alto" />
            <Num register={register("marginBottomMm", { valueAsNumber: true })} label="Basso" />
            <Num register={register("marginLeftMm", { valueAsNumber: true })} label="Sinistro" />
            <Num register={register("marginRightMm", { valueAsNumber: true })} label="Destro" />
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-1" role="group" aria-label="Margini rapidi">
            <span className="text-[11px] text-neutral-400">Rapidi:</span>
            {[0, 3, 5, 10].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setValue("marginTopMm", m, { shouldDirty: true });
                  setValue("marginRightMm", m, { shouldDirty: true });
                  setValue("marginBottomMm", m, { shouldDirty: true });
                  setValue("marginLeftMm", m, { shouldDirty: true });
                }}
                aria-label={`Margini ${m}mm su tutti i lati`}
                title={`${m} mm su tutti i lati`}
                className="panel-2 thin-border rounded px-2 py-0.5 text-[11px]"
              >
                {m}mm
              </button>
            ))}
          </div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase text-neutral-400">Spazio tra carte (mm)</h3>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <Num register={register("spacingRowMm", { valueAsNumber: true })} label="Tra righe" />
            <Num register={register("spacingColMm", { valueAsNumber: true })} label="Tra colonne" />
          </div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase text-neutral-400">Bleed</h3>
          <div className="mb-2 grid grid-cols-3 gap-2">
            <Num register={register("bleedMm", { valueAsNumber: true })} label="Bleed (mm)" />
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-1" role="group" aria-label="Bleed rapido">
            <span className="text-[11px] text-neutral-400">Bleed rapido:</span>
            {[0, 1, 2, 3.175].map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setValue("bleedMm", b, { shouldDirty: true })}
                aria-pressed={pb.values.bleedMm === b}
                title={b === 0 ? "Nessun bleed" : b === 3.175 ? "Standard TCG 1/8 di pollice (come proxxied.com)" : `Bleed ${b} mm per lato`}
                className={`rounded px-2 py-0.5 text-[11px] ${pb.values.bleedMm === b ? "bg-neutral-200 font-semibold text-black" : "panel-2 thin-border"}`}
              >
                {b === 0 ? "0" : b === 3.175 ? "1/8″" : `${b}mm`}
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-neutral-400">
            La griglia si centra nell'area utile (margini minimi garantiti). Il bleed allarga ogni cella:
            la striscia in più è margine di stampa e non si taglia. Con spazio 0 le celle restano attaccate
            e il canaletto di bleed finisce tra le due linee di taglio.
          </p>
        </section>
      )}

      {level === "qualita" && (
        <section aria-label="Livello qualità">
          <div className="mb-2 grid grid-cols-2 gap-2">
            <label className="block">DPI
              <select {...register("dpi", { valueAsNumber: true })} className="panel-2 thin-border mt-1 w-full rounded px-2 py-1">
                {[150, 300, 450, 600, 900, 1200].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="block">Qualità file
              <select {...register("profile")} className="panel-2 thin-border mt-1 w-full rounded px-2 py-1">
                <option value="minimum">Minima</option>
                <option value="balanced">Bilanciata</option>
                <option value="high">Alta</option>
                <option value="maximum">Massima</option>
              </select>
            </label>
          </div>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <label className="block">Miglioramento
              <select {...register("upscaleMode")} className="panel-2 thin-border mt-1 w-full rounded px-2 py-1">
                <option value="off">Spento</option>
                <option value="ask">Chiedi</option>
                <option value="auto">Automatico</option>
                <option value="always">Sempre</option>
              </select>
            </label>
            <label className="block">Fronte-retro
              <select {...register("duplex")} className="panel-2 thin-border mt-1 w-full rounded px-2 py-1">
                <option value="front_only">Solo fronte</option>
                <option value="back_only">Solo retro</option>
                <option value="separate">Separati</option>
                <option value="duplex_long">Lato lungo</option>
                <option value="duplex_short">Lato corto</option>
              </select>
            </label>
          </div>
          <p className="text-[11px] text-neutral-400">
            “Spento” stampa ai DPI nativi senza ingrandire; “Automatico” ingrandisce solo se serve davvero.
          </p>
          <Slider
            label="Luminosità stampa"
            display={`${(pb.values.brightnessPct ?? 0) > 0 ? "+" : ""}${pb.values.brightnessPct ?? 0}%`}
            min={-50}
            max={50}
            step={1}
            value={pb.values.brightnessPct ?? 0}
            onChange={(v) => setValue("brightnessPct", v, { shouldDirty: true })}
            ariaLabel="Luminosità stampa"
            title="Le stampe casalinghe escono più scure dello schermo: +5…+10% compensa"
          />
          <DefaultBackPicker
            value={pb.values.backImage}
            onChange={(v) => setValue("backImage", v, { shouldDirty: true })}
          />
        </section>
      )}

      {level === "guide" && (
        <section aria-label="Livello guide di taglio">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-neutral-400">Linee sul formato carta (il bleed resta fuori dal taglio)</span>
            <button
              type="button"
              onClick={resetGuides}
              className="panel thin-border shrink-0 rounded px-2 py-1 text-xs"
              title="Ripristina solo le guide ai valori iniziali"
              aria-label="Ripristina guide di taglio"
            >
              Ripristina guide
            </button>
          </div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase text-neutral-400">Tipo</h3>
          <div className="mb-2 flex flex-col gap-1">
            <label className="flex cursor-pointer items-center gap-2" title="Bracci corti agli angoli di ogni carta"><input type="checkbox" className="accent-neutral-200" {...register("guides.cropMarks")} /> Segni d'angolo</label>
            <label className="flex cursor-pointer items-center gap-2" title="Riquadro completo sul formato carta"><input type="checkbox" className="accent-neutral-200" {...register("guides.cutLines")} /> Riquadro carta</label>
            <label className="flex cursor-pointer items-center gap-2" title="Bordi di taglio prolungati a tutta pagina (taglierina)"><input type="checkbox" className="accent-neutral-200" {...register("guides.pageLines")} /> Linee pagina</label>
          </div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase text-neutral-400">Segni d'angolo</h3>
          <div className="mb-2 flex gap-1" role="group" aria-label="Forma dei segni d'angolo">
            {(([
              ["inside", "Dentro"],
              ["cross", "Croce"],
              ["outside", "Fuori"],
            ]) as [GuideShape, string][]).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setValue("guideShape", v, { shouldDirty: true })}
                aria-pressed={pb.values.guideShape === v}
                title={v === "cross" ? "Bracci dentro e fuori l'angolo" : v === "outside" ? "Bracci verso il bleed" : "Bracci verso l'interno della carta"}
                className={`flex-1 rounded px-2 py-1 ${pb.values.guideShape === v ? "bg-neutral-200 font-semibold text-black" : "panel-2 thin-border"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <Slider
            label="Lunghezza segni"
            display={`${pb.values.guideLengthMm.toFixed(2)} mm`}
            min={1}
            max={10}
            step={0.25}
            value={pb.values.guideLengthMm}
            onChange={(v) => setValue("guideLengthMm", v, { shouldDirty: true })}
            ariaLabel="Lunghezza segni"
          />
          <h3 className="mb-1 text-[11px] font-semibold uppercase text-neutral-400">Posizione sul bordo</h3>
          <div className="mb-2 flex gap-1" role="group" aria-label="Posizione della linea">
            {([
              ["inside", "Dentro"],
              ["center", "Sul bordo"],
              ["outside", "Fuori"],
            ] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setValue("guidePlacement", v, { shouldDirty: true })}
                aria-pressed={pb.values.guidePlacement === v}
                title="Dove appoggia il tratto rispetto al bordo carta (lo spessore viene compensato)"
                className={`flex-1 rounded px-2 py-1 ${pb.values.guidePlacement === v ? "bg-neutral-200 font-semibold text-black" : "panel-2 thin-border"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <Slider
            label="Scostamento"
            display={`${pb.values.guideOffsetMm.toFixed(2)} mm`}
            min={-2}
            max={2}
            step={0.05}
            value={pb.values.guideOffsetMm}
            onChange={(v) => setValue("guideOffsetMm", v, { shouldDirty: true })}
            ariaLabel="Scostamento linea"
            title="Positivo = verso l'interno della carta, negativo = verso il bleed"
          />
          <h3 className="mb-1 text-[11px] font-semibold uppercase text-neutral-400">Aspetto</h3>
          <div className="mb-2 flex gap-1" role="group" aria-label="Tratto linea">
            {([
              ["solid", "Continuo"],
              ["dashed", "Tratteggiato"],
            ] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setValue("guideStyle", v, { shouldDirty: true })}
                aria-pressed={pb.values.guideStyle === v}
                className={`flex-1 rounded px-2 py-1 ${pb.values.guideStyle === v ? "bg-neutral-200 font-semibold text-black" : "panel-2 thin-border"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mb-2 flex gap-1" role="group" aria-label="Estremità linea">
            {([
              ["square", "Squadrate"],
              ["round", "Arrotondate"],
            ] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setValue("guideCap", v, { shouldDirty: true })}
                aria-pressed={pb.values.guideCap === v}
                className={`flex-1 rounded px-2 py-1 ${pb.values.guideCap === v ? "bg-neutral-200 font-semibold text-black" : "panel-2 thin-border"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <Slider
            label="Spessore"
            display={`${pb.values.guideWidthPt.toFixed(2)} pt`}
            min={0.25}
            max={3}
            step={0.25}
            value={pb.values.guideWidthPt}
            onChange={(v) => setValue("guideWidthPt", v, { shouldDirty: true })}
            ariaLabel="Spessore linea guide"
          />
          <label className="flex items-center gap-2">Colore segni d'angolo
            <input
              type="color"
              {...register("guideColor")}
              aria-label="Colore segni d'angolo"
              className="h-6 w-10 cursor-pointer rounded border thin-border bg-black p-0.5"
            />
            <span className="flex gap-1.5" role="group" aria-label="Colori rapidi">
              {["#00ff00", "#000000", "#ffffff", "#ff0000"].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setValue("guideColor", c, { shouldDirty: true })}
                  aria-label={`Colore ${c}`}
                  aria-pressed={pb.values.guideColor === c}
                  title={c}
                  className={`h-6 w-6 rounded border thin-border ${pb.values.guideColor === c ? "ring-2 ring-neutral-200" : ""}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </span>
          </label>
          <p className="mt-1 text-[11px] text-neutral-400">Segni colorati, linee di taglio sempre nere.</p>
        </section>
      )}

      {level === "esporta" && (
        <section aria-label="Livello esportazione">
          {Object.keys(formState.errors).length > 0 && (
            <p className="mb-2 text-red-400">Controlla i valori (fuori range).</p>
          )}
          <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs" title="Le carte in zona Considering entrano nei fogli e nel PDF">
            <input type="checkbox" className="accent-neutral-200" {...register("includeConsidering")} data-testid="print-include-considering" />
            Considera carte Considering
          </label>
          <div className="flex gap-2">
            <button type="submit" className="rounded bg-neutral-200 px-3 py-1.5 font-semibold text-black">
              Applica
            </button>
            <button type="button" onClick={() => void pb.exportPdf()}
              className="panel-2 thin-border rounded px-3 py-1.5">
              Esporta PDF
            </button>
          </div>
          {pb.progress !== null && <p className="mt-1">Elaborazione…</p>}
          {pb.status && <p className="mt-2 break-all" aria-live="polite">{pb.status}</p>}
          {pb.lastPdf && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => pb.openPath(pb.lastPdf?.path ?? "")}
                className="panel-2 thin-border rounded px-3 py-1.5"
              >
                Apri PDF
              </button>
              <button
                type="button"
                onClick={() => pb.openPath(pb.lastPdf?.dir ?? "")}
                className="panel-2 thin-border rounded px-3 py-1.5"
              >
                Apri cartella
              </button>
              <button
                type="button"
                onClick={() => void pb.reverify()}
                disabled={pb.verifyBusy}
                className="panel-2 thin-border rounded px-3 py-1.5 disabled:opacity-50"
                title="Ricontrolla dimensioni reali vs nominale + simulazione stampante"
              >
                {pb.verifyBusy ? "Verifica…" : "Riverifica misure"}
              </button>
            </div>
          )}
          {pb.verify && (
            <div
              className={`mt-2 rounded border p-2 text-[11px] ${pb.verify.pass ? "border-green-800 bg-green-950/40 text-green-200" : "border-red-800 bg-red-950/40 text-red-200"}`}
              aria-live="polite"
              data-testid="verify-report"
            >
              <p className="font-semibold">
                {pb.verify.pass ? "Misure OK al 100%" : "FUORI TOLLERANZA"} · scalo peggiore {pb.verify.worst_dev_pct.toFixed(1)}% (tol ±{pb.verify.tol_pct}%)
              </p>
              <p className="mt-0.5 break-words">{pb.verify.summary}</p>
              <p className="mt-0.5 text-neutral-400">
                Nominale {(pb.verify.nominal_w_mm).toFixed(1)}×{(pb.verify.nominal_h_mm).toFixed(1)}mm (carta+bleed) · sim. stampa ±0.3% inclusa
              </p>
            </div>
          )}
        </section>
      )}
    </form>
  );
}

function Num({ register, label }: { register: UseFormRegisterReturn; label: string }): JSX.Element {
  return (
    <label className="block text-neutral-400">{label}
      <input type="number" step="any" {...register} className="panel-2 thin-border mt-1 w-full rounded px-2 py-1 text-neutral-100 tabular-nums" />
    </label>
  );
}

/** Riga slider con valore a destra in pill mono (stesso pattern ovunque). */
function Slider({
  label,
  display,
  min,
  max,
  step,
  value,
  onChange,
  ariaLabel,
  title,
}: {
  label: string;
  display: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  ariaLabel: string;
  title?: string;
}): JSX.Element {
  return (
    <label className="mb-2 block">
      <span className="mb-1 flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="rounded bg-neutral-800 px-1.5 py-px font-mono text-[11px] text-neutral-200 tabular-nums">
          {display}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel}
        title={title}
        className="w-full accent-neutral-200"
      />
    </label>
  );
}

/** Sceglie il dorso di default per le carte senza retro: facoltativo, mai automatico. */
function DefaultBackPicker({
  value,
  onChange,
}: {
  value?: string;
  onChange: (v: string | undefined) => void;
}): JSX.Element {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const onFile = async (f: File | undefined): Promise<void> => {
    if (!f || busy) return;
    setBusy(true);
    setMsg("");
    try {
      if (backend.isTauri) {
        const projectId = useProjects.getState().activeId;
        if (!projectId) {
          setMsg("Apri un progetto per salvare il dorso negli asset.");
          return;
        }
        onChange((await importFileViaBackend(f, projectId)).path);
      } else {
        // anteprima nel browser: data URL in memoria, l'export resta desktop
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("lettura del file fallita"));
          reader.readAsDataURL(f);
        });
        onChange(dataUrl);
      }
    } catch (e) {
      setMsg(`Import non riuscito: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <h3 className="mb-1 text-[11px] font-semibold uppercase text-neutral-400">Dorso di default (facoltativo)</h3>
      <p className="mb-1 text-[11px] text-neutral-400">
        Usato solo dalle carte senza retro, e solo nei modi di stampa che stampano il retro. Vuoto = nessun dorso.
      </p>
      <div className="flex items-center gap-2">
        <label className="panel-2 thin-border cursor-pointer rounded px-2 py-1 text-xs">
          {busy ? "Importo…" : "Scegli immagine"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
        {value ? (
          <>
            <span className="h-9 w-7 shrink-0 overflow-hidden rounded bg-black" title="Dorso scelto">
              <ArtworkImage stored={value} name="Dorso" imgClassName="h-full w-full object-cover" />
            </span>
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="panel thin-border rounded px-2 py-1 text-xs"
              aria-label="Rimuovi dorso di default"
            >
              Rimuovi
            </button>
          </>
        ) : (
          <span className="text-[11px] text-neutral-400">Nessun dorso</span>
        )}
      </div>
      {msg && <p className="mt-1 text-[11px] text-yellow-400">{msg}</p>}
    </div>
  );
}
