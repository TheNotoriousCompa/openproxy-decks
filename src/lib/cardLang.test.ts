import { describe, expect, it } from "vitest";
import { CARD_LANG_LABEL, CARD_LANG_OPTIONS, isLangFallback, langAttempts, langName } from "@/lib/cardLang";

describe("preferenza di lingua delle carte", () => {
  it("catena di tentativi: preferita → inglese → qualsiasi", () => {
    expect(langAttempts("it")).toEqual(["it", "en", undefined]);
    expect(langAttempts("en")).toEqual(["en", undefined]);
    expect(langAttempts("any")).toEqual([undefined]);
    // dati vecchi/assenti non rompono nulla
    expect(langAttempts(undefined)).toEqual([undefined]);
  });

  it("etichette leggibili", () => {
    expect(CARD_LANG_LABEL.it).toBe("Italiano");
    expect(langName("it")).toBe("italiano");
    expect(langName("en")).toBe("inglese");
    expect(langName(undefined)).toBe("qualsiasi lingua");
    expect(CARD_LANG_OPTIONS.map((o) => o.id)).toEqual(["any", "it", "en"]);
  });

  it("riconosce il ripiego solo quando la preferita non c'era", () => {
    expect(isLangFallback("it", "it")).toBe(false);
    expect(isLangFallback("it", "en")).toBe(true);
    expect(isLangFallback("it", undefined)).toBe(true);
    expect(isLangFallback("en", "en")).toBe(false);
    // "qualsiasi" non è mai un ripiego
    expect(isLangFallback("any", undefined)).toBe(false);
    expect(isLangFallback("any", "it")).toBe(false);
  });
});
