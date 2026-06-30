// DEV-ONLY: shot of the Add-user form in its Viewer state, with anonymized
// (Bart Simpson) data. Fills the fields + selects role=Viewer, then captures
// just the "Add a user" card. Pair with a DB-free `next dev`.
import { chromium } from "playwright-core";

const url = process.argv[2] || "http://localhost:3000/preview/kb-shots";
const out = process.argv[3] || "public/help/users-add-viewer.png";

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  const scope = page.locator("#kb-add-user");
  await scope.locator("#email").fill("bart.simpson@springfieldEl.org");
  await scope.locator("#displayName").fill("Bart Simpson");
  await scope.locator("#role").selectOption("viewer");
  await page.waitForTimeout(500); // let the Viewer scope picker render
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }); // drop the focus ring so the shot reads cleanly
  const card = scope.locator('[data-slot="card"]').first();
  await card.waitFor({ state: "visible", timeout: 30_000 });
  await card.screenshot({ path: out });
  console.log(`OK  add-user (Viewer) -> ${out}`);
} finally {
  await browser.close();
}
