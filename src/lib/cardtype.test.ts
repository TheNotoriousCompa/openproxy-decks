import { describe, expect, it } from "vitest";
import { categoryOf } from "@/lib/cardtype";

describe("categoryOf", () => {
  it("tipi base", () => {
    expect(categoryOf("Basic Land — Swamp")).toBe("lands");
    expect(categoryOf("Creature — Necron Warrior")).toBe("creatures");
    expect(categoryOf("Artifact")).toBe("artifacts");
    expect(categoryOf("Enchantment")).toBe("enchantments");
    expect(categoryOf("Instant")).toBe("instants");
    expect(categoryOf("Sorcery")).toBe("sorceries");
    expect(categoryOf("Legendary Planeswalker")).toBe("planeswalkers");
    expect(categoryOf("Battle — Siege")).toBe("battles");
  });
  it("priorità: artefatto creatura → creature, terra artefatto → terre", () => {
    expect(categoryOf("Artifact Creature — Myr")).toBe("creatures");
    expect(categoryOf("Artifact Land")).toBe("lands");
    expect(categoryOf("Legendary Artifact Creature — Construct")).toBe("creatures");
  });
  it("doppie facce e casi strani", () => {
    expect(categoryOf("Creature — Insect // Creature — Wurm")).toBe("creatures");
    expect(categoryOf("Token Creature — Treasure")).toBe("creatures");
    expect(categoryOf(undefined)).toBe("unknown");
    expect(categoryOf("")).toBe("unknown");
    expect(categoryOf("Kindred Sorcery — Eldrazi")).toBe("sorceries");
  });
});
