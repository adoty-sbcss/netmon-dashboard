// DEV-ONLY: element-screenshot a /preview/kb-shots component to a PNG (system
// Chrome via playwright-core). Pair with a DB-free `next dev`:
//   node scripts/kb-shot.mjs <url> <cssSelector> <outPath>
import { chromium } from "playwright-core";

const url = process.argv[2] || "http://localhost:3000/preview/kb-shots";
const selector = process.argv[3] || "#kb-networks-card";
const out = process.argv[4] || "public/help/networks-card.png";

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  const el = page.locator(selector);
  await el.waitFor({ state: "visible", timeout: 30_000 });
  await el.screenshot({ path: out });
  console.log(`OK  ${selector} -> ${out}`);
} finally {
  await browser.close();
}
