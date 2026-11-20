import { test, expect } from "@playwright/test";

/** Sonda diagnostica: console error, DOM pronto, screenshot. */
test("probe: app renders without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on("requestfailed", (r) => errors.push(`reqfail: ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));

  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);

  const rootLen = await page.evaluate(() => document.getElementById("root")?.innerHTML.length ?? -1);
  const hasTabs = await page.getByRole("navigation").count();
  const bodyText = (await page.locator("body").innerText()).slice(0, 200);
  await page.screenshot({ path: "C:/Users/win7/AppData/Local/Temp/opencode/shots/web-01.png" });

  console.log(JSON.stringify({ rootLen, hasTabs, bodyText, errors }, null, 1));
  expect(rootLen).toBeGreaterThan(100);
  expect(errors, JSON.stringify(errors)).toEqual([]);
});
