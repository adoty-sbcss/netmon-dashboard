// Headless phone-viewport screenshot of a URL, using the system Chrome (via
// playwright-core's `channel: "chrome"` — no Playwright browser download).
//
// Purpose: validate responsive / mobile layout without a physical device or a
// human in the loop. Pair it with `next dev` and the DB-free `/preview` design
// harness (mock Overview/School pages, no login):
//
//   AUTH_SECRET=dev DATABASE_URL=postgresql://localhost/none npm run dev
//   node scripts/mobile-shot.mjs http://localhost:3000/preview out.png
//
// Args: <url> [outPath] [width] [height]   (defaults: /preview, mobile-shot.png, 390x844)
import { chromium } from "playwright-core";

const url = process.argv[2] || "http://localhost:3000/preview";
const out = process.argv[3] || "mobile-shot.png";
const width = Number(process.argv[4] || 390);
const height = Number(process.argv[5] || 844);

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  await page.screenshot({ path: out, fullPage: true });
  console.log(`OK  ${width}x${height} -> ${out}  (${url})`);
} finally {
  await browser.close();
}
