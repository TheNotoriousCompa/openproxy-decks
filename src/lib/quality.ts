import { effectiveDpi, requiredPixels } from "@/lib/units";
import type { QualityReport } from "@/types";

/** Mirror di processing::analyze_quality in Rust. */
export function analyzeQuality(
  srcW: number,
  srcH: number,
  targetWmm: number,
  targetHmm: number,
  targetDpi: number,
): QualityReport {
  const reqW = requiredPixels(targetWmm, targetDpi);
  const reqH = requiredPixels(targetHmm, targetDpi);
  const effW = effectiveDpi(srcW, targetWmm);
  const effH = effectiveDpi(srcH, targetHmm);
  const eff = Math.min(effW, effH);
  const sx = srcW === 0 ? Infinity : reqW / srcW;
  const sy = srcH === 0 ? Infinity : reqH / srcH;
  const scale = Math.max(sx, sy);
  let status: QualityReport["status"] = "green";
  if (srcW === 0 || srcH === 0) status = "red";
  else if (scale <= 1.0) status = "green";
  else if (scale <= 1.25) status = "blue";
  else if (scale <= 2.0) status = "yellow";
  else if (scale <= 3.5) status = "orange";
  else status = "red";
  return {
    srcW,
    srcH,
    reqW,
    reqH,
    effDpi: eff,
    targetDpi,
    scaleNeeded: Number.isFinite(scale) ? scale : 0,
    status,
  };
}

export const QUALITY_LABEL: Record<QualityReport["status"], string> = {
  green: "Sufficiente",
  blue: "Leggero upscale",
  yellow: "Upscale moderato",
  orange: "Heavy upscale",
  red: "Sorgente troppo piccola",
};
