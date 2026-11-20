import { test } from "@playwright/test";
import * as fs from "fs";

const DECK = [
  "1x Brainstorm [a25] 46",
  "1x Reliquary Tower [m19] 254",
  "1x Countersquall [ala] 142",
  "1x Dispel [roe] 61",
  "1x Victimize [mh2] 112",
  "1x Blasphemous Act [c13] 122",
  "1x Sulfurous Springs [dmr] 253",
  "1x Dark Ritual [mmq] 127",
  "1x Ensnaring Bridge [8ed] 295",
].join("\n");

test("proxxied.com E2E: deck -> processing -> PDF", async ({ page }) => {
  test.setTimeout(1500000);
  await page.goto("https://proxxied.com/deckbuilder", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(9000);
  await page.getByRole("button", { name: "Create Deck" }).click();
  await page.waitForTimeout(2000);
  await page.getByPlaceholder("Enter deck name...").fill("E2E Nine");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3000);
  await page.locator("textarea").first().fill(DECK);
  await page.getByRole("button", { name: "Fetch Cards" }).click();
  const fetched = await page.waitForFunction(
    () => document.body.innerText.includes("Mainboard: 9") || document.body.innerText.includes("9 cards"),
    { timeout: 480000, polling: 5000 },
  ).then(() => true).catch(() => false);
  console.log("FETCHED:", fetched);
  const sendBtn = page.getByRole("button", { name: "Send to Proxy Builder" });
  await sendBtn.first().waitFor({ timeout: 180000 }).catch(() => undefined);
  console.log("SEND COUNT:", await sendBtn.count());
  await sendBtn.first().click({ timeout: 120000 });
  await page.waitForURL("**/app**", { timeout: 120000 }).catch(() => undefined);
  // forza tutte le carte in viewport (processing lazy) + attesa vera
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(8000);
    const n = await page.evaluate(() => (document.body.innerText.match(/PROCESSING/g) ?? []).length);
    console.log(`scroll ${i}: PROCESSING x${n}`);
    if (n === 0) break;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(5000);
  await page.getByRole("button", { name: "File" }).click({ timeout: 60000 }).catch(() => undefined);
  await page.waitForTimeout(3000);
  const items = await page.evaluate(() =>
    [...document.querySelectorAll("button,[role=menuitem],[role=option],a")].map((b) => (b.textContent ?? "").trim().slice(0, 55)).filter((s) => /export|pdf|download|print|front/i.test(s)).slice(0, 25),
  );
  console.log("MENU:", JSON.stringify(items));
  const dlPromise = page.waitForEvent("download", { timeout: 600000 }).catch(() => null);
  const expBtn = page.getByRole("button", { name: /Export to PDF/i });
  if (await expBtn.count() > 0) {
    await expBtn.first().click({ timeout: 60000 });
    const dl = await dlPromise;
    if (dl) {
      const p = "C:/Users/win7/AppData/Local/Temp/opencode/px-nine.pdf";
      await dl.saveAs(p);
      console.log("SAVED PDF", p, fs.statSync(p).size);
    } else console.log("NO DOWNLOAD EVENT");
  } else console.log("NO EXPORT BTN");
});
