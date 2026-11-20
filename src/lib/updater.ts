import { backend } from "@/services/backend";
import type { Update } from "@tauri-apps/plugin-updater";

/**
 * Auto-update firmato (Tauri updater + GitHub Releases).
 * Fuori dall'app desktop (browser/dev) tutte le funzioni sono no-op: niente
 * errori, la UI mostra semplicemente che gli update sono solo desktop.
 */

export async function currentVersion(): Promise<string> {
  if (!backend.isTauri) return "dev";
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return "?";
  }
}

export async function checkForUpdate(): Promise<Update | null> {
  if (!backend.isTauri) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  return check();
}

export async function relaunchApp(): Promise<void> {
  if (!backend.isTauri) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** Link alla pagina release (per le note complete). */
export const RELEASES_URL = "https://github.com/TheNotoriousCompa/openproxy-decks/releases";
