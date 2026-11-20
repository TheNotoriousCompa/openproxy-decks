import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { backend } from "@/services/backend";

export interface CellQuality {
  effDpi: number;
  status: "green" | "blue" | "yellow" | "orange" | "red";
}

interface AnalyzeResult {
  quality: { eff_dpi: number; status: CellQuality["status"] };
}

function isLocalFile(src: string): boolean {
  if (src.startsWith("blob:") || src.startsWith("data:")) return false;
  if (src.startsWith("http://") || src.startsWith("https://")) {
    return src.includes("asset.localhost");
  }
  return true;
}

/**
 * Qualità misurata per le sorgenti locali uniche (una analyze per file).
 * Remoti non scaricati e browser: nessuna voce (la cella mostra il DPI target).
 */
export function useCellQuality(
  sources: (string | undefined)[],
  cardWmm: number,
  cardHmm: number,
  targetDpi: number,
): Map<string, CellQuality> {
  const [map, setMap] = useState<Map<string, CellQuality>>(new Map());

  useEffect(() => {
    if (!backend.isTauri) return;
    const uniq = [
      ...new Set(
        sources.filter((s): s is string => s !== undefined && s !== "" && isLocalFile(s)),
      ),
    ];
    if (uniq.length === 0) return;
    let cancelled = false;
    void (async () => {
      const next = new Map<string, CellQuality>();
      // sequenziale: analyze legge da disco, leggero ma senza tempeste
      for (const src of uniq) {
        if (cancelled) break;
        try {
          const r = await invoke<AnalyzeResult>("analyze_image", {
            path: src,
            target_w_mm: cardWmm,
            target_h_mm: cardHmm,
            target_dpi: targetDpi,
          });
          next.set(src, { effDpi: Math.round(r.quality.eff_dpi), status: r.quality.status });
        } catch {
          /* senza voce: chip target */
        }
      }
      if (!cancelled) setMap(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [sources.join("|"), cardWmm, cardHmm, targetDpi]);

  return map;
}

const DOT: Record<CellQuality["status"], string> = {
  green: "bg-green-500",
  blue: "bg-sky-500",
  yellow: "bg-yellow-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
};

/** Mini chip stat per cella: DPI originali misurati → target preset (es. "854 → 1200"). */
export function CellStat({ measured, targetDpi }: { measured?: CellQuality; targetDpi: number }): JSX.Element {
  if (!measured) {
    return (
      <span className="rounded bg-black/75 px-1 text-[10px] text-neutral-300" title={`DPI target ${targetDpi} (originali non misurati)`}>
        →{targetDpi}
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-1 rounded bg-black/75 px-1 text-[10px] text-neutral-100"
      title={`DPI originali misurati: ${measured.effDpi} → target preset ${targetDpi} (upscale solo in export)`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[measured.status]}`} />
      {measured.effDpi}→{targetDpi}
    </span>
  );
}
