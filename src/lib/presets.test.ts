import { describe, expect, it, beforeEach } from "vitest";
import {
  BUILT_IN_PRESETS,
  deletePreset,
  listPresets,
  printPresetSchema,
  savePreset,
} from "@/lib/presets";

describe("print presets", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("built-in validi secondo schema", () => {
    expect(BUILT_IN_PRESETS.length).toBeGreaterThanOrEqual(3);
    for (const p of BUILT_IN_PRESETS) {
      expect(printPresetSchema.safeParse(p).success).toBe(true);
    }
  });

  it("save/list/delete in fallback locale", async () => {
    expect(await listPresets()).toEqual([]);
    const base = BUILT_IN_PRESETS[0];
    if (!base) throw new Error("no builtin");
    const custom = { ...base, id: "custom-1", name: "Mio" };
    expect(await savePreset(custom)).toHaveLength(1);
    expect((await listPresets())[0]?.name).toBe("Mio");
    // sovrascrive stesso id
    expect(await savePreset({ ...custom, name: "Mio 2" })).toHaveLength(1);
    expect((await listPresets())[0]?.name).toBe("Mio 2");
    expect(await deletePreset("custom-1")).toHaveLength(0);
  });

  it("rifiuta preset invalidi", async () => {
    await expect(savePreset({ id: "", name: "", settings: {} } as never)).rejects.toThrow();
  });
});
