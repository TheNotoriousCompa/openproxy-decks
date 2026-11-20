import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { backend } from "@/services/backend";
import { toDisplaySrc } from "@/services/images";

export type ArtStatus = "empty" | "loading" | "ok" | "error";

export interface ArtState {
  status: ArtStatus;
  /** src pronta per <img> (asset:// o remota) */
  src?: string;
  detail?: string;
}

export interface BackendArtStatus {
  kind: string;
  exists: boolean;
  decodes: boolean;
  width: number;
  height: number;
  bytes: number;
  detail: string;
}

const thumbCache = new Map<string, string>();
const thumbFlight = new Map<string, Promise<string>>();

/**
 * Thumb via backend come data: URL (niente asset-protocol/scope: rendering garantito).
 * Cache in memoria + dedup voli concorrenti. Esportata per il fallback di ArtworkImage.
 */
export function fetchBackendThumb(url: string, maxPx = 512): Promise<string> {
  const hit = thumbCache.get(url);
  if (hit) return Promise.resolve(hit);
  const flight = thumbFlight.get(url);
  if (flight) return flight;
  const p = invoke<{ data_url: string }>("thumb_data_url", { url, maxPx })
    .then((r) => {
      thumbCache.set(url, r.data_url);
      thumbFlight.delete(url);
      return r.data_url;
    })
    .catch((e) => {
      thumbFlight.delete(url);
      throw e;
    });
  thumbFlight.set(url, p);
  return p;
}

function backendThumb(url: string, maxPx: number): Promise<string> {
  return fetchBackendThumb(url, maxPx);
}

export function isBackendThumbable(src: string): boolean {
  return backend.isTauri && isRemoteHttp(src);
}

export async function queryArtworkStatus(src: string): Promise<BackendArtStatus> {
  if (!backend.isTauri) throw new Error("diagnostica solo nell'app desktop");
  return invoke<BackendArtStatus>("artwork_status", { src });
}

function isRemoteHttp(src: string): boolean {
  return (
    (src.startsWith("http://") || src.startsWith("https://")) &&
    !src.includes("asset.localhost")
  );
}

/**
 * Risolve un riferimento artwork in src visualizzabile + stato.
 * - vuoto → empty · blob: → error (sessione scaduta, da ricaricare)
 * - desktop → SEMPRE thumb via backend come data: URL (mai rete WebView,
 *   mai asset-protocol/scope: rendering garantito) → ok | error con dettaglio
 * - browser → diretto (remoto) o così com'è (locale/blob non disponibile)
 */
export function useArtworkSrc(
  stored: string | undefined,
  opts?: { maxPx?: number; backendThumb?: boolean },
): ArtState & { retry: () => void } {
  const maxPx = opts?.maxPx ?? 512;
  const wantBackend = opts?.backendThumb ?? true;
  const [state, setState] = useState<ArtState>(() => initial(stored));
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      if (!stored) {
        if (!cancelled && alive.current) setState({ status: "empty" });
        return;
      }
      if (stored.startsWith("blob:")) {
        if (!cancelled && alive.current) {
          setState({ status: "error", detail: "sessione scaduta: ricaricare il file (upload custom)" });
        }
        return;
      }
      if (stored.startsWith("data:")) {
        if (!cancelled && alive.current) setState({ status: "ok", src: stored });
        return;
      }
      if (backend.isTauri && wantBackend) {
        if (!cancelled && alive.current) setState({ status: "loading" });
        try {
          // data: URL dal backend: niente asset-protocol, rendering garantito.
          // Vale per remoti E per file locali (thumb_for_path valida anche quelli).
          const dataUrl = await backendThumb(stored, maxPx);
          if (!cancelled && alive.current) {
            setState({ status: "ok", src: dataUrl });
          }
        } catch (e) {
          if (!cancelled && alive.current) {
            // Fallback: remoto diretto mappato per <img> (drive→thumbnail inline;
            // può fallire in WebView → onError → error); per i locali nessun
            // fallback possibile: errore con dettaglio.
            if (isRemoteHttp(stored)) {
              setState({
                status: "ok",
                src: toDisplaySrc(stored),
                detail: `thumb backend fallita (${e instanceof Error ? e.message : String(e)}), provo diretto`,
              });
            } else {
              setState({
                status: "error",
                detail: `anteprima non generabile: ${e instanceof Error ? e.message : String(e)}`,
              });
            }
          }
        }
        return;
      }
      if (!cancelled && alive.current) setState({ status: "ok", src: toDisplaySrc(stored) });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [stored, maxPx, wantBackend, nonce]);

  const retry = useCallback(() => {
    if (stored && isRemoteHttp(stored)) thumbCache.delete(stored);
    setNonce((n) => n + 1);
  }, [stored]);

  return { ...state, retry };
}

function initial(stored: string | undefined): ArtState {
  if (!stored) return { status: "empty" };
  if (stored.startsWith("blob:")) {
    return { status: "error", detail: "sessione scaduta: ricaricare il file" };
  }
  if (stored.startsWith("data:")) return { status: "ok", src: stored };
  return { status: "loading" };
}
