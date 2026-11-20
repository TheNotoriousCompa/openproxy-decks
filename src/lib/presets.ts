import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import { backend } from "@/services/backend";
import { printSettingsSchema } from "@/lib/schemas";
import { DEFAULT_PRINT } from "@/stores/print";

export const printPresetSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  settings: printSettingsSchema,
});

export type PrintPreset = z.infer<typeof printPresetSchema>;

export const BUILT_IN_PRESETS: PrintPreset[] = [
  {
    id: "builtin-a4-tcg-1200",
    name: "A4 · 63×88 · 1200 · Maximum",
    settings: { ...DEFAULT_PRINT, guides: { ...DEFAULT_PRINT.guides } },
  },
  {
    id: "builtin-letter-tcg-1200",
    name: "Letter · 63×88 · 1200 · Maximum",
    settings: { ...DEFAULT_PRINT, page: "letter", pageWmm: 215.9, pageHmm: 279.4, guides: { ...DEFAULT_PRINT.guides } },
  },
  {
    id: "builtin-a4-tcg-600",
    name: "A4 · 63×88 · 600 · High",
    settings: { ...DEFAULT_PRINT, dpi: 600, profile: "high", guides: { ...DEFAULT_PRINT.guides } },
  },
];

const LS_KEY = "proxxied.presets";

function readLocal(): PrintPreset[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = z.array(printPresetSchema).safeParse(JSON.parse(raw));
    return arr.success ? arr.data : [];
  } catch {
    return [];
  }
}

function writeLocal(list: PrintPreset[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    /* quota: ignora */
  }
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `p-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** Preset custom salvati (validati, max 50). */
export async function listPresets(): Promise<PrintPreset[]> {
  if (backend.isTauri) {
    try {
      const raw = await invoke<unknown>("list_print_presets");
      const parsed = z.array(printPresetSchema).safeParse(raw);
      if (parsed.success) return parsed.data;
    } catch {
      /* fallback locale sotto */
    }
  }
  return readLocal();
}

export function newPresetId(): string {
  return `custom-${uid()}`;
}

export async function savePreset(preset: PrintPreset): Promise<PrintPreset[]> {
  const valid = printPresetSchema.parse(preset);
  if (backend.isTauri) {
    try {
      const raw = await invoke<unknown>("save_print_preset", { preset: valid });
      const parsed = z.array(printPresetSchema).safeParse(raw);
      if (parsed.success) return parsed.data;
    } catch {
      /* fallback locale sotto */
    }
  }
  const list = readLocal().filter((p) => p.id !== valid.id);
  list.push(valid);
  writeLocal(list);
  return list;
}

export async function deletePreset(id: string): Promise<PrintPreset[]> {
  if (backend.isTauri) {
    try {
      const raw = await invoke<unknown>("delete_print_preset", { id });
      const parsed = z.array(printPresetSchema).safeParse(raw);
      if (parsed.success) return parsed.data;
    } catch {
      /* fallback locale sotto */
    }
  }
  const list = readLocal().filter((p) => p.id !== id);
  writeLocal(list);
  return list;
}
