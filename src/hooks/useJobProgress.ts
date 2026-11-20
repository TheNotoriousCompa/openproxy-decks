import { useEffect, useRef, useState } from "react";

export interface JobProgress {
  /** 0..1 */
  frac: number;
  /** fase leggibile in italiano */
  phase: string;
}

/** Fase del job backend → testo UI. */
export function phaseOf(status: string): string {
  if (status.includes("layout")) return "Impaginazione…";
  if (status.includes("done")) return "Scrittura PDF…";
  return "Elaborazione immagini…";
}

/**
 * Ascolta `job://progress` del backend (stesso evento usato dallo Studio)
 * per mostrare un avanzamento reale anche negli export in blocco.
 * In browser/dev non c'è Tauri: start() non fa nulla e progress resta null.
 */
export function useJobProgress(): {
  progress: JobProgress | null;
  start: () => Promise<void>;
  stop: () => void;
} {
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const unlisten = useRef<(() => void) | null>(null);

  const stop = (): void => {
    unlisten.current?.();
    unlisten.current = null;
  };

  useEffect(() => stop, []);

  const start = async (): Promise<void> => {
    stop();
    setProgress({ frac: 0, phase: "Preparazione…" });
    try {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten.current = await listen<{ progress: number; status: string }>(
        "job://progress",
        (e) => {
          setProgress({
            frac: Math.max(0, Math.min(1, e.payload.progress)),
            phase: phaseOf(e.payload.status),
          });
        },
      );
    } catch {
      // browser/dev: nessun evento disponibile
    }
  };

  return { progress, start, stop };
}
