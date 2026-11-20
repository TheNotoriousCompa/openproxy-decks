import { test, expect } from "@playwright/test";

/** 1x1 PNG valido per le anteprime (niente rete reale). */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const printCard = (id: string, set: string, released: string, color: string) => ({
  id,
  name: "Swamp",
  set,
  set_name: `Set ${set}`,
  collector_number: "1",
  released_at: released,
  highres_image: true,
  prices: { usd: "0.10" },
  image_uris: {
    small: `https://img.test/${color}-small.png`,
    large: `https://img.test/${color}-large.png`,
    png: `https://img.test/${color}-png.png`,
  },
});

test("print-picker: 80% + Apply to all aggiorna tutte le copie omonime", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));

  // mock Scryfall: ricerca + stampe + immagini locali
  await page.route("https://img.test/**", (r) =>
    r.fulfill({ contentType: "image/png", body: PNG_1PX }),
  );
  await page.route("**/api.scryfall.com/cards/search**", (route) => {
    const url = route.request().url();
    const isPrints = url.includes("unique=prints");
    const data = isPrints
      ? [printCard("u-blue", "B1", "2024-01-01", "blue"), printCard("u-green", "G1", "2023-01-01", "green")]
      : [printCard("u-main", "M1", "2024-01-01", "blue")];
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data, has_more: false }),
    });
  });

  await page.addInitScript(() => {
    const manifest = {
      version: 1,
      deck: [
        { id: "sw-1", name: "Swamp", qty: 2, zone: "main", provider: "custom", hasBack: false, sortOrder: 0 },
        { id: "sw-2", name: "Swamp", qty: 1, zone: "side", provider: "custom", hasBack: false, sortOrder: 1 },
      ],
      print: {
        page: "a4", pageWmm: 210, pageHmm: 297, orientation: "portrait",
        card: "custom", cardWmm: 63, cardHmm: 88,
        marginMm: 3, spacingMm: 0, bleedMm: 0, dpi: 300, profile: "maximum",
        guides: { cropMarks: true, cornerMarks: false, cutLines: true },
        guideColor: "#ff0000", guideWidthPt: 0.4, guidePlacement: "outside",
        guideLengthMm: 3, guideStyle: "solid", guideCap: "square", guideExtent: "corners",
        duplex: "front_only", upscaleMode: "off",
      },
    };
    const project = {
      id: "proj-e2e", name: "E2E", created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z", manifest,
    };
    localStorage.setItem("proxxied.fallback.projects", JSON.stringify([project]));
    localStorage.setItem("proxxied.activeId", "proj-e2e");
  });

  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 30000 });

  // Studio è la tab di default: celle dei fogli pronte
  // (sw-1 ha qty 2 → due celle con lo stesso testid)
  const cellsSw1 = page.getByTestId("sheet-cell-sw-1");
  await expect(cellsSw1.first()).toBeVisible({ timeout: 15000 });
  await expect(cellsSw1).toHaveCount(2);

  // click cella → picker a schermo ~80% (preset MPC: passa a Scryfall mockato)
  await cellsSw1.first().click();
  const dialog = page.getByTestId("print-picker");
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await page.getByTestId("source-tab-scryfall").click();
  const vp = page.viewportSize() ?? { width: 1440, height: 900 };
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width / vp.width).toBeGreaterThan(0.75);
  expect(box!.height / vp.height).toBeGreaterThan(0.75);

  // Apply to all con conteggio copie (2 main + 1 side = 3)
  const applyAll = page.getByTestId("apply-all");
  await expect(applyAll).toBeVisible();
  await expect(page.getByText('Apply to all "Swamp" (3)')).toBeVisible();

  await page.screenshot({ path: "C:/Users/win7/AppData/Local/Temp/opencode/shots/e2e-picker-80.png" });

  // spunta apply-all e scegli la stampa blu (B1)
  await applyAll.check();
  await page.getByLabel(/Usa stampa Set B1/).click();
  await expect(dialog).toBeHidden({ timeout: 10000 });

  // tutte le celle (2× main sw-1 + 1× side sw-2) ora mostrano l'immagine scelta
  // (persistPrintOption preferisce imageFull = png; la cella è div[title], il
  // button testid è il sibling cliccabile sopra l'img)
  await expect(
    page.locator(
      '[aria-label="Anteprima fogli di stampa"] div[title="Swamp"] img[src="https://img.test/blue-png.png"]',
    ),
  ).toHaveCount(3);

  await page.screenshot({ path: "C:/Users/win7/AppData/Local/Temp/opencode/shots/e2e-picker-applied.png" });
  expect(errors, JSON.stringify(errors)).toEqual([]);
});
