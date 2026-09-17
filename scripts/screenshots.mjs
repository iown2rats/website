/**
 * Development tooling: captures the app at the target phone widths, tablet and desktop, light and dark,
 * for visual comparison against docs/prototype-reference. Requires a running server (default :3100) and
 * Playwright (global install path resolved below or via PLAYWRIGHT_MODULE).
 *
 *   node scripts/screenshots.mjs [baseUrl] [outDir]
 *
 * Use the same hostname the dev server is bound to (localhost): Next 16 blocks dev resources, including the
 * HMR socket, for other origins, and the page will not hydrate.
 */
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3100";
const out = process.argv[3] ?? path.resolve("screenshots");
const pwPath = process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright/index.mjs";
const { chromium } = await import(pwPath);

fs.mkdirSync(out, { recursive: true });

const viewports = [
  { name: "375x812", width: 375, height: 812, mobile: true },
  { name: "390x844", width: 390, height: 844, mobile: true },
  { name: "430x932", width: 430, height: 932, mobile: true },
  { name: "834x1112", width: 834, height: 1112, mobile: true },
  { name: "1280x820", width: 1280, height: 820, mobile: false },
];
const routes = ["/", "/discover", "/likes", "/chats", "/community", "/profile", "/dev/design-system"];

const browser = await chromium.launch();
for (const vp of viewports) {
  for (const dark of [false, true]) {
    if (dark && vp.name !== "390x844" && vp.name !== "1280x820") continue;
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      colorScheme: dark ? "dark" : "light",
    });
    for (const route of routes) {
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + route, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      const name = `${route === "/" ? "welcome" : route.slice(1).replace(/\//g, "-")}--${vp.name}${dark ? "--dark" : ""}`;
      await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: route.startsWith("/dev") });
      if (overflow) console.log(`HORIZONTAL OVERFLOW: ${name}`);
      if (errors.length) console.log(`ERRORS ${name}: ${errors.join(" | ")}`);
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
console.log("done", fs.readdirSync(out).length, "files in", out);
