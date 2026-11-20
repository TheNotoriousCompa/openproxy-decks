import { describe, expect, it } from "vitest";
import { prettyManaCost } from "@/lib/scryart";

describe("scryart", () => {
  it("costo compatto per badge", () => {
    expect(prettyManaCost("{3}{B}{R}{U}")).toBe("3BRU");
    expect(prettyManaCost("{X}{G}")).toBe("XG");
    expect(prettyManaCost(undefined)).toBe("");
  });
});
