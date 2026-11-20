import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { perfEnabled, perfMark, perfNow } from "@/lib/perf";

describe("perf util (flag-gated)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("spento di default: nessun log", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    expect(perfEnabled()).toBe(false);
    perfMark("x", perfNow());
    expect(spy).not.toHaveBeenCalled();
  });

  it("acceso via flag: logga label + durata", () => {
    localStorage.setItem("proxxied.perf", "1");
    const spy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    expect(perfEnabled()).toBe(true);
    perfMark("choose:close", perfNow() - 42);
    expect(spy).toHaveBeenCalledTimes(1);
    const msg = String(spy.mock.calls[0]?.[0] ?? "");
    expect(msg).toContain("[perf] choose:close");
    expect(msg).toMatch(/\+\d+ms/);
  });
});
