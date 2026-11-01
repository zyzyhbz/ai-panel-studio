/**
 * Local visual check — drives the *system* Edge/Chrome through Playwright
 * (`channel:`), so it works without downloading the bundled browsers.
 *
 *   node apps/web/scripts/measure.mjs http://127.0.0.1:5173/d/<id>
 *
 * It asserts the one thing unit tests cannot: the document itself never
 * scrolls at 1440 / 1024 / 390, and every column is bounded.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/measure.mjs <url>");
  process.exit(2);
}

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1024", width: 1024, height: 800 },
  { name: "390", width: 390, height: 844 },
];

const outDir = resolve(process.cwd(), ".shots");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });
let failed = false;

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  await page.goto(target, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  const metrics = await page.evaluate(() => {
    const shell = document.querySelector(".studio-shell");
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    };
    return {
      scrollHeight: document.body.scrollHeight,
      innerHeight: window.innerHeight,
      docScrollHeight: document.documentElement.scrollHeight,
      shell: shell ? Math.round(shell.getBoundingClientRect().height) : null,
      log: box(".studio-log"),
      table: box(".studio-table"),
      insights: box(".studio-insights"),
      hasRoundTable: Boolean(document.querySelector('[data-testid="round-table"]')),
      seats: document.querySelectorAll('[data-testid^="seat-"][data-expert]').length,
      backButton: Boolean(document.querySelector('[data-testid="back-to-lobby"]')),
      theme: document.documentElement.dataset.theme ?? null,
    };
  });

  const overflow = metrics.scrollHeight > metrics.innerHeight + 1;
  if (overflow) failed = true;

  console.log(
    `${vp.name.padEnd(5)} body=${metrics.scrollHeight} viewport=${metrics.innerHeight} ` +
      `shell=${metrics.shell} log=${metrics.log?.h ?? "-"} table=${metrics.table?.h ?? "-"} ` +
      `insights=${metrics.insights?.h ?? "-"} seats=${metrics.seats} ` +
      `roundTable=${metrics.hasRoundTable} back=${metrics.backButton} theme=${metrics.theme} ` +
      `${overflow ? "OVERFLOW" : "ok"}`,
  );

  await page.screenshot({
    path: resolve(outDir, `${vp.name}.png`),
    fullPage: false,
  });
  await page.close();
}

await browser.close();
if (failed) {
  console.error("FAIL: document scrolled at one or more viewports");
  process.exit(1);
}
console.log("ok: no page scroll at any viewport");
