import { test, expect } from "@playwright/test";

/** 1x1 PNG valido per le anteprime (niente rete reale). */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const printSettings = {
  page: "a4",
  pageWmm: 210,
  pageHmm: 297,
  orientation: "portrait",
  card: "custom",
  cardWmm: 63,
  cardHmm: 88,
  marginMm: 3,
  spacingMm: 0,
  bleedMm: 0,
  dpi: 300,
  profile: "maximum",
  guides: { cropMarks: true, cornerMarks: false, cutLines: true },
  guideColor: "#ff0000",
  guideWidthPt: 0.4,
  guidePlacement: "outside",
  guideLengthMm: 3,
  guideStyle: "solid",
  guideCap: "square",
  guideExtent: "corners",
  duplex: "front_only",
  upscaleMode: "off",
};

const entry = (id: string, name: string, zone: string, sortOrder: number, extra: object = {}) => ({
  id,
  name,
  qty: 1,
  zone,
  provider: "custom",
  hasBack: false,
  sortOrder,
  ...extra,
});

function seedProject(project: unknown): void {
  localStorage.setItem("proxxied.fallback.projects", JSON.stringify([project]));
  localStorage.setItem("proxxied.activeId", "proj-scroll");
}

const seedDeck = [
  entry("cmd", "The Ur-Dragon", "main", 0, { commander: true }),
  ...Array.from({ length: 72 }, (_, i) => entry(`main-${i}`, `Carta ${i + 1}`, "main", i + 1)),
  ...Array.from({ length: 12 }, (_, i) => entry(`side-${i}`, `Side ${i + 1}`, "side", i)),
  ...Array.from({ length: 4 }, (_, i) => entry(`maybe-${i}`, `Maybe ${i + 1}`, "maybe", i)),
  ...Array.from({ length: 3 }, (_, i) => entry(`token-${i}`, `Token ${i + 1}`, "tokens", i)),
];

const seedProjectData = {
  id: "proj-scroll",
  name: "Scroll E2E",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  manifest: { version: 1, deck: seedDeck, print: printSettings },
};

const scryfallCard = (i: number) => ({
  id: `s-${i}`,
  name: `Risultato ${i + 1}`,
  set: "tst",
  set_name: "Test",
  collector_number: String(i + 1),
  rarity: "common",
  cmc: 2,
  type_line: "Creature — Dragon",
  colors: ["R"],
  color_identity: ["R"],
  edhrec_rank: 1000 + i,
  prices: { usd: "0.50" },
  image_uris: {
    small: `https://img.test/s-${i}-small.png`,
    large: `https://img.test/s-${i}-large.png`,
  },
});

test("deckbuilder: il mazzo e i risultati di ricerca scorrono", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));

  await page.route("https://img.test/**", (r) =>
    r.fulfill({ contentType: "image/png", body: PNG_1PX }),
  );
  await page.route("https://api.scryfall.com/**", (route) => {
    const url = route.request().url();
    if (url.includes("/cards/search")) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          object: "list",
          data: Array.from({ length: 60 }, (_, i) => scryfallCard(i)),
          has_more: false,
          total_cards: 60,
        }),
      });
    }
    if (url.includes("/cards/named")) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          object: "card",
          id: "ur-dragon",
          name: "The Ur-Dragon",
          set: "c17",
          collector_number: "48",
          type_line: "Legendary Creature — Dragon Avatar",
          color_identity: ["W", "U", "B", "R", "G"],
          colors: ["W", "U", "B", "R", "G"],
          cmc: 9,
        }),
      });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [] }) });
  });

  await page.addInitScript(seedProject, seedProjectData);
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 30000 });

  await page.getByRole("navigation", { name: "Sezioni principali" }).getByRole("button", { name: "DeckBuilder" }).click();
  await expect(page.getByTestId("db-zone-main")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("db-zone-side")).toBeVisible();

  // Il contenitore delle carte è vincolato e ha contenuto in eccesso.
  const deckScroll = page.getByTestId("db-cards-scroll");
  const before = await deckScroll.evaluate((el) => ({
    client: el.clientHeight,
    scroll: el.scrollHeight,
    top: el.scrollTop,
    doc: document.documentElement.scrollHeight,
  }));
  expect(before.client).toBeGreaterThan(300);
  expect(before.scroll).toBeGreaterThan(before.client + 200);
  expect(before.doc).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight));

  // La rotella scorre davvero la lista.
  await deckScroll.hover();
  await page.mouse.wheel(0, 1600);
  await expect
    .poll(async () => deckScroll.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(100);

  // Vista Cerca: i risultati stanno in un contenitore scrollabile.
  await page.getByTestId("db-mode-search").click();
  await page.getByTestId("cf-text").fill("dragon");
  await page.getByTestId("cf-search").click();
  await expect(page.getByTestId("hit-s-0")).toBeVisible({ timeout: 15000 });

  const searchScroll = page.getByTestId("search-scroll");
  const searchBefore = await searchScroll.evaluate((el) => ({
    client: el.clientHeight,
    scroll: el.scrollHeight,
  }));
  expect(searchBefore.client).toBeGreaterThan(300);
  expect(searchBefore.scroll).toBeGreaterThan(searchBefore.client + 200);

  await searchScroll.hover();
  await page.mouse.wheel(0, 1600);
  await expect
    .poll(async () => searchScroll.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(100);

  await page.screenshot({ path: "C:/Users/win7/AppData/Local/Temp/opencode/shots/e2e-scroll.png" });
  expect(errors, JSON.stringify(errors)).toEqual([]);
});
