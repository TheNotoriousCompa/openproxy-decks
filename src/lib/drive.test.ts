import { describe, expect, it } from "vitest";
import { driveDownloadUrl, driveIdFromUrl, driveThumbUrl } from "@/lib/drive";

describe("drive urls", () => {
  it("download full-res + thumb inline + estrazione ID", () => {
    const id = "1N_OuG-pbkB4BBlvToRjVpJo6HyZYEJF1";
    expect(driveDownloadUrl(id)).toContain("drive.usercontent.google.com/download");
    expect(driveDownloadUrl(id)).toContain(`id=${id}`);
    expect(driveThumbUrl(id)).toBe(`https://drive.google.com/thumbnail?id=${id}&sz=w1000`);
    expect(driveThumbUrl(id, 5000)).toContain("sz=w2000");
    expect(driveThumbUrl(id, 10)).toContain("sz=w128");
    expect(driveIdFromUrl(driveDownloadUrl(id))).toBe(id);
    expect(driveIdFromUrl("https://img/x.jpg")).toBeNull();
    expect(driveIdFromUrl("https://drive.google.com/thumbnail?id=ABC&sz=w1000")).toBeNull();
  });
});
