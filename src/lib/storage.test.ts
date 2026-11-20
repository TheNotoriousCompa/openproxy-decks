import { describe, expect, it } from "vitest";
import { formatBytes, totalBytes } from "@/lib/storage";

describe("formatBytes", () => {
  it("B, KB, MB, GB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 ** 2)).toBe("5.0 MB");
    expect(formatBytes(Math.round(11.6 * 1024 ** 3))).toBe("11.6 GB");
  });
});

describe("totalBytes", () => {
  it("somma le aree", () => {
    const u = {
      assets: { bytes: 100, files: 1 },
      exports: { bytes: 200, files: 1 },
      cache: { bytes: 300, files: 1 },
      tmp: { bytes: 400, files: 1 },
      models: { bytes: 500, files: 1 },
      database: { bytes: 600, files: 1 },
      projects: 2,
    };
    expect(totalBytes(u)).toBe(2100);
  });
});
