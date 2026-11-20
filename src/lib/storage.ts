import { invoke } from "@tauri-apps/api/core";

/** Uso disco per area (bytes + file). Solo app desktop. */
export interface AreaUsage {
  bytes: number;
  files: number;
}

export interface StorageUsage {
  /** artwork full-res scaricati, per progetto */
  assets: AreaUsage;
  /** PDF esportati */
  exports: AreaUsage;
  /** JPEG di stampa + thumb (ricostruibili) */
  cache: AreaUsage;
  /** scarti di lavorazione */
  tmp: AreaUsage;
  models: AreaUsage;
  database: AreaUsage;
  projects: number;
}

export function formatBytes(bytes: number): string {
  const b = Math.max(0, Math.floor(bytes));
  if (b < 1024) return `${b} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = b / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

export function totalBytes(u: StorageUsage): number {
  return u.assets.bytes + u.exports.bytes + u.cache.bytes + u.tmp.bytes + u.models.bytes + u.database.bytes;
}

export async function fetchStorageUsage(): Promise<StorageUsage> {
  return invoke<StorageUsage>("storage_usage");
}

/** Pulisce i tmp orfani (>1h). Ritorna i byte liberati. */
export async function clearTmp(): Promise<number> {
  return invoke<number>("clear_tmp");
}
