import { invoke } from "@tauri-apps/api/core";
import type { Project, SummaryPage } from "@/types";

const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

function memKey(k: string): string {
  return `proxxied.fallback.${k}`;
}

function readLocal<T>(k: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(memKey(k));
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocal(k: string, v: unknown): void {
  try {
    localStorage.setItem(memKey(k), JSON.stringify(v));
  } catch {
    /* quota piena: ignora */
  }
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

const DEFAULT_PRINT = {
  page: "a4",
  pageWmm: 210,
  pageHmm: 297,
  orientation: "portrait",
  card: "magic",
  cardWmm: 63,
  cardHmm: 88,
  marginTopMm: 3,
  marginRightMm: 3,
  marginBottomMm: 3,
  marginLeftMm: 3,
  spacingRowMm: 0,
  spacingColMm: 0,
  bleedMm: 1,
  dpi: 1200,
  profile: "maximum",
  guides: { cropMarks: true, cornerMarks: false, cutLines: false, pageLines: false },
  guideColor: "#00ff00",
  guideWidthPt: 0.75,
  guidePlacement: "inside",
  guideLengthMm: 2,
  guideShape: "inside",
  guideOffsetMm: 0,
  guideStyle: "solid",
  guideCap: "square",
  duplex: "front_only",
  upscaleMode: "auto",
  brightnessPct: 0,
  includeConsidering: true,
} as const;

/** Wrapper backend: usa i comandi Tauri reali, con fallback localStorage per `vite dev` nel browser. */
export const backend = {
  isTauri,

  async listProjects(query?: string): Promise<Project[]> {
    if (isTauri) return invoke<Project[]>("list_projects", { query });
    const all = readLocal<Project[]>("projects", []);
    const q = (query ?? "").trim().toLowerCase();
    return q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all;
  },

  /** Lista paginata leggera (senza manifest): per molti progetti. */
  async listSummaries(query?: string, limit = 20, offset = 0): Promise<SummaryPage> {
    if (isTauri) return invoke<SummaryPage>("list_project_summaries", { query, limit, offset });
    const all = readLocal<Project[]>("projects", []);
    const q = (query ?? "").trim().toLowerCase();
    const filtered = q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all;
    const items = filtered.slice(offset, offset + limit).map((p) => ({
      id: p.id,
      name: p.name,
      created_at: p.created_at,
      updated_at: p.updated_at,
      deck_count: p.manifest.deck.length,
    }));
    return { total: filtered.length, items };
  },

  async getProject(id: string): Promise<Project> {
    if (isTauri) return invoke<Project>("get_project", { id });
    const found = readLocal<Project[]>("projects", []).find((p) => p.id === id);
    if (!found) throw new Error("progetto non trovato");
    return found;
  },

  async createProject(name: string): Promise<Project> {
    if (isTauri) return invoke<Project>("create_project", { name });
    const now = new Date().toISOString();
    const p: Project = {
      id: uid(),
      name,
      created_at: now,
      updated_at: now,
      manifest: { version: 1, deck: [], print: { ...DEFAULT_PRINT } },
    };
    const all = readLocal<Project[]>("projects", []);
    writeLocal("projects", [p, ...all]);
    return p;
  },

  async renameProject(id: string, name: string): Promise<Project> {
    if (isTauri) return invoke<Project>("rename_project", { id, name });
    const all = readLocal<Project[]>("projects", []);
    const next = all.map((p) =>
      p.id === id ? { ...p, name, updated_at: new Date().toISOString() } : p,
    );
    writeLocal("projects", next);
    const found = next.find((p) => p.id === id);
    if (!found) throw new Error("progetto non trovato");
    return found;
  },

  async deleteProject(id: string): Promise<void> {
    if (isTauri) {
      await invoke("delete_project", { id });
      return;
    }
    writeLocal(
      "projects",
      readLocal<Project[]>("projects", []).filter((p) => p.id !== id),
    );
  },

  async duplicateProject(id: string): Promise<Project> {
    if (isTauri) return invoke<Project>("duplicate_project", { id });
    const all = readLocal<Project[]>("projects", []);
    const src = all.find((p) => p.id === id);
    if (!src) throw new Error("progetto non trovato");
    const now = new Date().toISOString();
    const copy: Project = {
      ...structuredClone(src),
      id: uid(),
      name: `${src.name} (copia)`,
      created_at: now,
      updated_at: now,
    };
    writeLocal("projects", [copy, ...all]);
    return copy;
  },

  async saveManifest(project: Project): Promise<void> {
    const envelope = { at: new Date().toISOString(), manifest: project.manifest };
    // backup locale sempre (rescue al boot se il DB è più vecchio)
    writeLocal(`manifest.${project.id}`, envelope);
    if (isTauri) {
      await invoke("save_project_manifest", {
        id: project.id,
        manifest: JSON.stringify(project.manifest),
      });
      return;
    }
    const all = readLocal<Project[]>("projects", []);
    writeLocal(
      "projects",
      all.map((p) => (p.id === project.id ? project : p)),
    );
  },

  /** Cartelle del progetto (immagini locali + export PDF). Solo app desktop. */
  async projectFolders(projectId: string): Promise<{ assets: string; exports: string }> {
    return invoke<{ assets: string; exports: string }>("project_folders", { projectId });
  },

  /** Quanto occupano le immagini locali di un progetto. Solo app desktop. */
  async projectStorageInfo(projectId: string): Promise<{ asset_count: number; asset_bytes: number }> {
    return invoke<{ asset_count: number; asset_bytes: number }>("project_storage_info", { projectId });
  },

  /** Svuota le immagini locali di un progetto (il deck resta: nomi + stampe). Solo app desktop. */
  async clearProjectAssets(projectId: string): Promise<{ removed: number; freed_bytes: number }> {
    return invoke<{ removed: number; freed_bytes: number }>("clear_project_assets", { projectId });
  },
};

/** Backup locale del manifest con timestamp (per rescue post-crash/restart). */
export interface ManifestBackup {
  at: string;
  manifest: Project["manifest"];
}

export function readManifestBackup(projectId: string): ManifestBackup | null {
  try {
    const raw = localStorage.getItem(`proxxied.fallback.manifest.${projectId}`);
    if (!raw) return null;
    // formato nuovo {at, manifest} o legacy (manifest diretto)
    const v = JSON.parse(raw) as ManifestBackup | Project["manifest"];
    if (v && typeof v === "object" && "manifest" in v && "at" in v) {
      return v as ManifestBackup;
    }
    if (v && typeof v === "object" && "deck" in v) {
      return { at: "", manifest: v as Project["manifest"] };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Decide se il backup locale deve sostituire il manifest SQLite.
 * Regole: backup con timestamp > updated_at del progetto vince;
 * backup legacy senza timestamp vince solo se il DB è vuoto (rescue una-tantum).
 */
export function shouldRestoreBackup(projectUpdatedAt: string, projectDeckSize: number, backup: ManifestBackup | null): boolean {
  if (!backup) return false;
  const backupSize = backup.manifest.deck.length;
  if (backupSize === 0) return false;
  if (!backup.at) return projectDeckSize === 0;
  return backup.at > projectUpdatedAt;
}

export type Backend = typeof backend;
