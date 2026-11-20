import type { QualityReport } from "@/types";
import { QUALITY_LABEL } from "@/lib/quality";

const COLOR: Record<QualityReport["status"], string> = {
  green: "bg-green-600",
  blue: "bg-sky-600",
  yellow: "bg-yellow-500",
  orange: "bg-orange-600",
  red: "bg-red-600",
};

export function QualityBadge({ report }: { report: QualityReport }): JSX.Element {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold text-white ${COLOR[report.status]}`}
      title={`${QUALITY_LABEL[report.status]} — ${Math.round(report.effDpi)} DPI effettivi su ${report.targetDpi} richiesti (scala ×${report.scaleNeeded.toFixed(2)})`}
      aria-label={`Qualità: ${QUALITY_LABEL[report.status]}`}
    >
      {Math.round(report.effDpi)} DPI
    </span>
  );
}
