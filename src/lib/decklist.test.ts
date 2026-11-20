import { describe, expect, it } from "vitest";
import {
  extractMpcId,
  extractSetInfo,
  parseDeckList,
  parseMpcXml,
  serializeDeckList,
} from "@/lib/decklist";

describe("decklist parser", () => {
  it("qty + nome base", () => {
    const r = parseDeckList("4 Lightning Bolt\n2 Counterspell\n1 Sol Ring\n");
    expect(r.entries).toHaveLength(3);
    expect(r.entries[0]).toMatchObject({ qty: 4, name: "Lightning Bolt", zone: "main" });
    expect(r.unknown).toHaveLength(0);
  });
  it("sezioni, 4x, commenti, SB:", () => {
    const r = parseDeckList("# commento\n4x Forest\nSideboard\nSB: 2 Negate\n2 Negate\n");
    expect(r.entries.find((e) => e.name === "Forest")).toMatchObject({ qty: 4, zone: "main" });
    const neg = r.entries.find((e) => e.name === "Negate");
    expect(neg?.zone).toBe("side");
    expect(neg?.qty).toBe(4); // 2+2 consolidati
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it("set e numero", () => {
    const r = parseDeckList("1 Ragavan, Nimble Pilferer [MH2] 138\n");
    expect(r.entries[0]).toMatchObject({ setCode: "MH2", collectorNumber: "138" });
  });
  it("righe invalide → unknown, mai eliminate", () => {
    const r = parseDeckList("questa non è una carta\n4 Lightning Bolt\n");
    expect(r.unknown).toContain("questa non è una carta");
    expect(r.entries).toHaveLength(1);
  });
  it("roundtrip serialize", () => {
    const r = parseDeckList("4 Bolt\nSideboard\n2 Negate\n");
    const s = serializeDeckList(r.entries);
    expect(s).toContain("4 Bolt");
    expect(s).toContain("Sideboard");
  });
  it("roundtrip conserva set/numero", () => {
    const r = parseDeckList("1 Grima, Saruman's Footman (ltc) 57\n");
    const s = serializeDeckList(r.entries);
    expect(s).toContain("[LTC] 57");
    const r2 = parseDeckList(s);
    expect(r2.entries[0]).toMatchObject({ name: "Grima, Saruman's Footman", setCode: "LTC", collectorNumber: "57" });
  });
  it("MPC Art ID in coda: (mpc:ID), (ID), {ID}", () => {
    const id = "1Zf7lK3VDw-NfSfWq7kg-Pl6SdieTqS5Z";
    const r = parseDeckList(
      `1 Lightning Bolt [M11] 146 (${id})\n2 Counterspell (mpc:${id})\n1 Sol Ring {${id}}\n`,
    );
    expect(r.entries).toHaveLength(3);
    expect(r.entries[0]).toMatchObject({ name: "Lightning Bolt", setCode: "M11", collectorNumber: "146", mpcId: id });
    expect(r.entries[1]).toMatchObject({ name: "Counterspell", mpcId: id });
    expect(r.entries[2]).toMatchObject({ name: "Sol Ring", mpcId: id });
    // art diverse non si fondono
    const r2 = parseDeckList(`1 Bolt (${id})\n1 Bolt (AAAAAAAAAAAAAAAAAAAA)\n`);
    expect(r2.entries).toHaveLength(2);
  });
  it("niente falsi positivi MPC su set/numeri normali", () => {
    expect(extractMpcId("Lightning Bolt [M11] 146").mpcId).toBeUndefined();
    expect(extractMpcId("1996 World Champion").mpcId).toBeUndefined();
    expect(extractMpcId("Bolt (ltc) 57").mpcId).toBeUndefined();
  });
  it("serialize con MPC IDs e roundtrip", () => {
    const r = parseDeckList("1 Lightning Bolt [M11] 146 (1Zf7lK3VDw-NfSfWq7kg-Pl6SdieTqS5Z)\n");
    const plain = serializeDeckList(r.entries);
    expect(plain).not.toContain("1Zf7");
    const withIds = serializeDeckList(r.entries, { withMpcIds: true });
    expect(withIds).toContain("(1Zf7lK3VDw-NfSfWq7kg-Pl6SdieTqS5Z)");
    expect(parseDeckList(withIds).entries[0]).toMatchObject({ mpcId: "1Zf7lK3VDw-NfSfWq7kg-Pl6SdieTqS5Z" });
  });
  it("token t:Nome → zona tokens col nome pulito (lista reale MPC)", () => {
    const r = parseDeckList(
      "1x t:Insect (t40k) 22\n1x t:Necron Warrior (t40k) 14★\n1x t:Treasure (tfdn) 23\n",
    );
    expect(r.unknown).toHaveLength(0);
    expect(r.entries).toHaveLength(3);
    expect(r.entries[0]).toMatchObject({ name: "Insect", zone: "tokens", setCode: "T40K", collectorNumber: "22" });
    expect(r.entries[1]).toMatchObject({ name: "Necron Warrior", zone: "tokens", collectorNumber: "14★" });
    expect(r.entries[2]).toMatchObject({ name: "Treasure", zone: "tokens" });
  });
  it("MPC ID con _ e - della lista reale", () => {
    const r = parseDeckList(
      "1x Imotekh the Stormlord [mpc:1N_OuG-pbkB4BBlvToRjVpJo6HyZYEJF1]\n1x Defile [mpc:1mtjHzg-y69mi9ZyehHNk6PL7tbNw85Bq]\n",
    );
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]).toMatchObject({ name: "Imotekh the Stormlord", mpcId: "1N_OuG-pbkB4BBlvToRjVpJo6HyZYEJF1" });
    expect(r.entries[1]).toMatchObject({ name: "Defile", mpcId: "1mtjHzg-y69mi9ZyehHNk6PL7tbNw85Bq" });
  });
});

describe("parseMpcXml", () => {
  const XML = `<?xml version="1.0"?>
<order><details><quantity>3</quantity></details>
<fronts>
<card><id>AAA111AAA111AAA111AAA111AAA111AAAA</id><slots>0</slots><name>Lightning Bolt</name></card>
<card><id>BBB222BBB222BBB222BBB222BBB222BBBB</id><slots>1,2</slots><name>Counterspell</name></card>
<card><name>Senza ID</name><slots>3</slots></card>
</fronts>
<backs>
<card><id>CCC333CCC333CCC333CCC333CCC333CCCC</id><slots>1</slots><name>Counterspell Back</name></card>
</backs></order>`;
  it("fronts con qty da slot + backs + unknown senza id", () => {
    const r = parseMpcXml(XML);
    expect(r.fronts).toHaveLength(2);
    expect(r.fronts[0]).toMatchObject({ qty: 1, name: "Lightning Bolt", mpcId: "AAA111AAA111AAA111AAA111AAA111AAAA", back: false });
    expect(r.fronts[1]).toMatchObject({ qty: 2, mpcId: "BBB222BBB222BBB222BBB222BBB222BBBB" });
    expect(r.backs).toHaveLength(1);
    expect(r.backs[0]).toMatchObject({ qty: 1, back: true });
    expect(r.unknownCards).toBe(1);
  });
  it("vuoto/corrotto → liste vuote, mai throw", () => {
    expect(parseMpcXml("")).toEqual({ fronts: [], backs: [], unknownCards: 0 });
    expect(parseMpcXml("<order></order>").fronts).toEqual([]);
  });
});

describe("extractSetInfo", () => {
  it("parentesi minuscole (ltc) 57", () => {
    expect(extractSetInfo("Grima, Saruman's Footman (ltc) 57")).toEqual({
      name: "Grima, Saruman's Footman",
      setCode: "LTC",
      collectorNumber: "57",
    });
  });
  it("parentesi senza numero", () => {
    expect(extractSetInfo("Mauhûr, Uruk-hai Captain (ltr)")).toEqual({
      name: "Mauhûr, Uruk-hai Captain",
      setCode: "LTR",
      collectorNumber: undefined,
    });
  });
  it("forma nuda maiuscola LTC 665", () => {
    expect(extractSetInfo("Mauhûr, Uruk-hai Captain LTC 665")).toMatchObject({
      name: "Mauhûr, Uruk-hai Captain",
      setCode: "LTC",
      collectorNumber: "665",
    });
  });
  it("forma con trattino ltc-57", () => {
    expect(extractSetInfo("Sauron, the Dark Lord ltc-131")).toMatchObject({
      name: "Sauron, the Dark Lord",
      setCode: "LTC",
      collectorNumber: "131",
    });
  });
  it("non tocca i nomi veri", () => {
    expect(extractSetInfo("1996 World Champion").name).toBe("1996 World Champion");
    expect(extractSetInfo("Lightning Bolt").name).toBe("Lightning Bolt");
    expect(extractSetInfo("Fire & Ice").name).toBe("Fire & Ice");
  });
  it("suffissi collector ★/lettere", () => {
    expect(extractSetInfo("Ragavan, Nimble Pilferer [MH2] 138")).toMatchObject({
      collectorNumber: "138",
    });
    expect(extractSetInfo("Card Name (set) 12a")).toMatchObject({ collectorNumber: "12a" });
  });
});
