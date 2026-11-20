import { describe, expect, it } from "vitest";
import { detectDeckLink, detectMoxfieldUser } from "@/lib/deckUrl";

describe("detectDeckLink", () => {
  it("moxfield URL completi + slug/query", () => {
    expect(detectDeckLink("https://www.moxfield.com/decks/abcDEF1234/nome-mazzo")).toEqual({
      provider: "moxfield",
      id: "abcDEF1234",
    });
    expect(detectDeckLink("moxfield.com/decks/abcDEF1234")).toEqual({
      provider: "moxfield",
      id: "abcDEF1234",
    });
    expect(detectDeckLink("https://www.moxfield.com/decks/abcDEF1234?utm=x")).toEqual({
      provider: "moxfield",
      id: "abcDEF1234",
    });
    expect(detectDeckLink("  https://moxfield.com/decks/aB1-_x9Q/  ")).toEqual({
      provider: "moxfield",
      id: "aB1-_x9Q",
    });
  });

  it("archidekt URL completi + slug", () => {
    expect(detectDeckLink("https://archidekt.com/decks/123456")).toEqual({
      provider: "archidekt",
      id: "123456",
    });
    expect(detectDeckLink("https://www.archidekt.com/decks/123456/nome-mazzo")).toEqual({
      provider: "archidekt",
      id: "123456",
    });
    expect(detectDeckLink("archidekt.com/decks/42/")).toEqual({
      provider: "archidekt",
      id: "42",
    });
  });

  it("API URL diretti", () => {
    expect(detectDeckLink("https://api.moxfield.com/v2/decks/all/abcDEF1234")).toEqual({
      provider: "moxfield",
      id: "abcDEF1234",
    });
    expect(detectDeckLink("https://archidekt.com/api/decks/123456/")).toEqual({
      provider: "archidekt",
      id: "123456",
    });
  });

  it("ID nudi con prefisso esplicito", () => {
    expect(detectDeckLink("moxfield: abcDEF1234")).toEqual({
      provider: "moxfield",
      id: "abcDEF1234",
    });
    expect(detectDeckLink("archidekt: 123456")).toEqual({
      provider: "archidekt",
      id: "123456",
    });
  });

  it("non confonde nomi carte con link", () => {
    expect(detectDeckLink("Lightning Bolt")).toBeNull();
    expect(detectDeckLink("Counterspell")).toBeNull();
    expect(detectDeckLink("123456")).toBeNull();
    expect(detectDeckLink("https://example.com/decks/123")).toBeNull();
    expect(detectDeckLink("")).toBeNull();
  });
});

describe("detectMoxfieldUser", () => {
  it("nickname nudo e link profilo", () => {
    expect(detectMoxfieldUser("Necron_fan-99")).toBe("Necron_fan-99");
    expect(detectMoxfieldUser("https://www.moxfield.com/users/Necron_fan-99")).toBe("Necron_fan-99");
    expect(detectMoxfieldUser("moxfield.com/users/AbC/")).toBe("AbC");
    expect(detectMoxfieldUser("  xy  ")).toBe("xy");
  });
  it("rifiuta deck-link, domini e spazzatura", () => {
    expect(detectMoxfieldUser("https://www.moxfield.com/decks/abcDEF1234/nome")).toBeNull();
    expect(detectMoxfieldUser("moxfield.com")).toBeNull();
    expect(detectMoxfieldUser("Lightning Bolt")).toBeNull();
    expect(detectMoxfieldUser("a")).toBeNull();
    expect(detectMoxfieldUser("")).toBeNull();
  });
});
