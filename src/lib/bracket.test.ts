import { describe, expect, it } from "vitest";
import { computeBracket, isExtraTurn, isMassLandDenial, BRACKET_LABEL } from "@/lib/bracket";

const card = (name: string, over: Partial<{ qty: number; gameChanger: boolean; extraTurn: boolean; massLandDenial: boolean }> = {}) => ({
  name,
  qty: 1,
  ...over,
});

describe("segnali bracket", () => {
  it("mass land denial: nomi noti e pattern oracle", () => {
    expect(isMassLandDenial("Armageddon")).toBe(true);
    expect(isMassLandDenial("Blood Moon")).toBe(true);
    expect(isMassLandDenial("Boom // Bust")).toBe(true);
    expect(isMassLandDenial("Unknown Card", "Destroy all lands.")).toBe(true);
    expect(isMassLandDenial("Unknown Card", "Nonbasic lands are Mountains.")).toBe(true);
    expect(isMassLandDenial("Sol Ring", "{T}: Add {C}{C}.")).toBe(false);
    expect(isMassLandDenial("Rampant Growth", "Search your library for a basic land card.")).toBe(false);
  });

  it("turni extra: testo esatto, anche multipli", () => {
    expect(isExtraTurn("Take an extra turn after this one.")).toBe(true);
    expect(isExtraTurn("Take two extra turns after this one.")).toBe(true);
    expect(isExtraTurn("Target player takes an extra turn after this one.")).toBe(true);
    expect(isExtraTurn("Draw a card.")).toBe(false);
    expect(isExtraTurn(undefined)).toBe(false);
  });
});

describe("computeBracket", () => {
  it("0 Game Changer → Bracket 2", () => {
    const r = computeBracket([card("Sol Ring"), card("Counterspell")]);
    expect(r.bracket).toBe(2);
    expect(r.gcCount).toBe(0);
    expect(r.reasons[0]).toContain("0 Game Changer");
  });

  it("1–3 Game Changer → Bracket 3", () => {
    const r = computeBracket([card("Rhystic Study", { gameChanger: true }), card("Sol Ring")]);
    expect(r.bracket).toBe(3);
    expect(r.gcCount).toBe(1);
    expect(r.gameChangers).toEqual([{ name: "Rhystic Study", qty: 1 }]);
  });

  it("3 Game Changer ancora Bracket 3, 4 → Bracket 4", () => {
    const three = computeBracket([
      card("A", { gameChanger: true }),
      card("B", { gameChanger: true }),
      card("C", { gameChanger: true }),
    ]);
    expect(three.bracket).toBe(3);
    const four = computeBracket([
      card("A", { gameChanger: true }),
      card("B", { gameChanger: true }),
      card("C", { gameChanger: true }),
      card("D", { gameChanger: true }),
    ]);
    expect(four.bracket).toBe(4);
    expect(four.reasons[0]).toContain("massimo 3");
  });

  it("mass land denial → Bracket 4 anche senza Game Changer", () => {
    const r = computeBracket([card("Armageddon", { massLandDenial: true })]);
    expect(r.bracket).toBe(4);
    expect(r.reasons[0]).toContain("Armageddon");
  });

  it("turni extra: segnalati ma non cambiano il numero", () => {
    const r = computeBracket([card("Time Warp", { extraTurn: true })]);
    expect(r.bracket).toBe(2);
    expect(r.extraTurns).toEqual([{ name: "Time Warp", qty: 1 }]);
    expect(r.reasons.some((x) => x.includes("Turni extra"))).toBe(true);
  });

  it("Game Changer contati per carta, non per copia (singleton)", () => {
    const r = computeBracket([
      card("A", { gameChanger: true, qty: 2 }),
      card("B", { gameChanger: true, qty: 2 }),
    ]);
    expect(r.gcCount).toBe(2);
    expect(r.bracket).toBe(3);
  });

  it("note: B1/B5 non calcolabili e combo non rilevabili", () => {
    const r = computeBracket([]);
    expect(r.notes.join(" ")).toContain("Bracket 1");
    expect(r.notes.join(" ")).toContain("combo");
    expect(BRACKET_LABEL[2]).toBe("Core");
    expect(BRACKET_LABEL[3]).toBe("Upgraded");
    expect(BRACKET_LABEL[4]).toBe("Optimized");
  });
});
