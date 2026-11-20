/** Apri un link esterno: shell Tauri se disponibile, altrimenti nuova scheda. */
export async function openExternal(url: string): Promise<void> {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}
