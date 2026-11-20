import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { backend } from "@/services/backend";
import { driveIdFromUrl, driveThumbUrl } from "@/lib/drive";
import type { ArtworkPatch } from "@/services/artwork";
import type { CardEntry, PrintOption } from "@/types";

export interface BackendAsset {
  id: string;
  project_id: string;
  kind: string;
  source_hash: string;
  path: string;
  width: number;
  height: number;
}

/**
 * Normalizza un riferimento immagine in `src` per `<img>`.
 * - URL remoti/blob:/data:/asset: → invariati, TRANNE i download Drive
 *   (`drive.usercontent…/download`, che rispondono attachment e la WebView non
 *   renderizza): diventano `thumbnail` inline alla stessa arte.
 * - path filesystem locali (solo app desktop) → `asset://` via convertFileSrc
 */
export function toDisplaySrc(stored: string | undefined): string | undefined {
  if (!stored) return undefined;
  const driveId = driveIdFromUrl(stored);
  if (driveId) return driveThumbUrl(driveId);
  if (
    stored.startsWith("asset://") ||
    stored.startsWith("blob:") ||
    stored.startsWith("data:") ||
    stored.startsWith("http://") ||
    stored.startsWith("https://") ||
    stored.startsWith("file://")
  ) {
    return stored;
  }
  if (!backend.isTauri) return stored;
  try {
    return convertFileSrc(stored);
  } catch {
    return stored;
  }
}

/** Scarica un artwork remoto in `assets/` del progetto. Ritorna il path locale grezzo. */
export async function fetchArtworkViaBackend(url: string, projectId: string): Promise<BackendAsset> {
  return invoke<BackendAsset>("fetch_artwork", { projectId, url });
}

/** Carica un File del picker nella cache progetto. Ritorna il path locale grezzo. */
export async function importFileViaBackend(file: File, projectId: string): Promise<BackendAsset> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return invoke<BackendAsset>("import_asset_bytes", {
    projectId,
    filename: file.name,
    bytes: Array.from(buf),
  });
}

/**
 * Rende persistente una patch artwork (URL remoti → file locali in assets/).
 * Fuori dall'app desktop o senza progetto: ritorna la patch invariata.
 * Non solleva mai: in caso di errore mantiene gli URL remoti (export riproverà).
 */
export async function persistPatch(
  patch: ArtworkPatch,
  projectId: string | null,
): Promise<ArtworkPatch> {
  if (!backend.isTauri || !projectId) return patch;
  const out: ArtworkPatch = { ...patch };
  for (const key of ["imageFront", "imageBack"] as const) {
    const url = patch[key];
    if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) continue;
    try {
      const asset = await fetchArtworkViaBackend(url, projectId);
      out[key] = asset.path;
    } catch {
      /* mantiene URL remoto */
    }
  }
  return out;
}

export interface PrintPatch {
  imageFront?: string;
  imageBack?: string;
  hasBack: boolean;
  provider: CardEntry["provider"];
  providerId: string;
  setCode: string;
  collectorNumber: string;
}

async function persistUrl(url: string | undefined, projectId: string | null): Promise<string | undefined> {
  if (!url || !backend.isTauri || !projectId) return url;
  if (!url.startsWith("http://") && !url.startsWith("https://")) return url;
  try {
    return (await fetchArtworkViaBackend(url, projectId)).path;
  } catch {
    return url; /* mantiene URL remoto: l'export riproverà il download */
  }
}

/**
 * Patch sincrona da una stampa (URL remoti, niente I/O): usata per l'apply
 * ottimistico — la UI si chiude subito, il download avviene dopo.
 */
export function printOptionToPatch(opt: PrintOption): PrintPatch {
  return {
    imageFront: opt.imageFull ?? opt.imageLarge ?? opt.thumb,
    imageBack: opt.imageBack,
    hasBack: opt.hasBack,
    provider: opt.source === "mpc" ? "mpc" : "scryfall",
    providerId: opt.id,
    setCode: opt.setCode,
    collectorNumber: opt.collectorNumber,
  };
}

/** Variante sincrona per UNA sola faccia DFC (mix di stampe). */
export function printFaceToPatch(opt: PrintOption, face: "front" | "back"): Partial<PrintPatch> {
  if (face === "front") {
    return {
      imageFront: opt.imageFull ?? opt.imageLarge ?? opt.thumb,
      provider: opt.source === "mpc" ? "mpc" : "scryfall",
      providerId: opt.id,
      setCode: opt.setCode,
      collectorNumber: opt.collectorNumber,
    };
  }
  return {
    imageBack: opt.imageBack ?? opt.imageFull ?? opt.imageLarge ?? opt.thumb,
    hasBack: true,
    provider: opt.source === "mpc" ? "mpc" : "scryfall",
    providerId: opt.id,
    setCode: opt.setCode,
    collectorNumber: opt.collectorNumber,
  };
}

/**
 * Patch per UNA sola faccia DFC (mix di stampe: fronte da A, retro da B).
 * Persiste (download) solo l'URL della faccia scelta; l'altra resta intatta.
 */
export async function persistPrintFace(
  opt: PrintOption,
  face: "front" | "back",
  projectId: string | null,
): Promise<Partial<PrintPatch>> {
  const base = printFaceToPatch(opt, face);
  if (face === "front") {
    return { ...base, imageFront: await persistUrl(base.imageFront, projectId) };
  }
  return { ...base, imageBack: await persistUrl(base.imageBack, projectId) };
}

/** Converte una stampa scelta nel picker in patch deck + download full-res via backend. */
export async function persistPrintOption(
  opt: PrintOption,
  projectId: string | null,
): Promise<PrintPatch> {
  const base = printOptionToPatch(opt);
  if (!backend.isTauri || !projectId) return base;
  const out: PrintPatch = { ...base };
  for (const key of ["imageFront", "imageBack"] as const) {
    const url = base[key];
    if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) continue;
    try {
      const asset = await fetchArtworkViaBackend(url, projectId);
      out[key] = asset.path;
    } catch {
      /* mantiene URL remoto: l'export riproverà il download */
    }
  }
  return out;
}
