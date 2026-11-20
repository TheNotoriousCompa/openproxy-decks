/**
 * URL Google Drive per le art MPC (nessuna dipendenza: usabile ovunque).
 * Drive ID = base64url del file pubblico (dalle liste `(mpc:ID)` o dall'XML).
 */

/** Download full-res di un file Drive pubblico (usato dal backend fetch_artwork). */
export function driveDownloadUrl(identifier: string): string {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(identifier)}&export=download&confirm=t`;
}

/**
 * Anteprima Drive incorporabile in <img>: l'endpoint download risponde
 * `Content-Disposition: attachment` (la WebView lo scarica invece di
 * mostrarlo), mentre `thumbnail` serve l'immagine inline fino a ~2000px.
 * Stessa arte, solo per la visualizzazione: il backend scarica il full-res.
 */
export function driveThumbUrl(identifier: string, width = 1000): string {
  const w = Math.min(2000, Math.max(128, Math.round(width)));
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(identifier)}&sz=w${w}`;
}

/** Estrae il Drive ID da un URL download usercontent, se presente. */
export function driveIdFromUrl(url: string): string | null {
  const host = url.match(/drive\.usercontent\.google\.com\/download\?([^#]*)/);
  if (!host?.[1]) return null;
  const m = host[1].match(/(?:^|&)id=([^&]+)/);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}
