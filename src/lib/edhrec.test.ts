import { describe, expect, it } from "vitest";
import { edhrecSlug, edhrecCardUrl, edhrecCommanderUrl } from "@/lib/edhrec";

describe("edhrec slug", () => {
  it("nomi semplici", () => {
    expect(edhrecSlug("Sol Ring")).toBe("sol-ring");
    expect(edhrecSlug("Lightning Bolt")).toBe("lightning-bolt");
  });
  it("punteggiatura e doppie facce", () => {
    expect(edhrecSlug("Jodah, the Unifier")).toBe("jodah-the-unifier");
    expect(edhrecSlug("Fire // Ice")).toBe("fire-ice");
    expect(edhrecSlug("Y'shtola, Night's Blessed")).toBe("yshtola-nights-blessed");
  });
  it("accenti via diacritici", () => {
    expect(edhrecSlug("Séance")).toBe("seance");
    expect(edhrecSlug("Lim-Dûl")).toBe("lim-dul");
  });
  it("url carte (router ufficiale) e comandanti", () => {
    expect(edhrecCardUrl("Sol Ring")).toBe("https://edhrec.com/route/?cc=Sol%20Ring");
    expect(edhrecCardUrl("Fire // Ice")).toBe("https://edhrec.com/route/?cc=Fire%20%2F%2F%20Ice");
    expect(edhrecCommanderUrl("Atraxa, Praetors' Voice")).toBe(
      "https://edhrec.com/commanders/atraxa-praetors-voice",
    );
  });
});
