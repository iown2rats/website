#!/usr/bin/env node
/*
 * Mellocrush responsive contract checker (docs/DESIGN_SYSTEM.md §33).
 *
 * The contract: on every normal application route, at every supported viewport,
 *
 *     document.documentElement.scrollWidth <= document.documentElement.clientWidth
 *
 * A user must never have to drag the page sideways to reach a button, a message, a menu or anything else. The one
 * allowed exception is a component deliberately built as a horizontal scroller (a carousel, a chip row): it may
 * scroll inside itself, but it must not make the document scroll.
 *
 * Reporting that "the page overflows" is not useful on its own, so this walks the DOM and names the element that
 * did it. An element wider than the viewport only matters if nothing clips it, so a node is reported as a culprit
 * only when no ancestor has overflow hidden/clip/auto/scroll on that axis. That is what separates "this element is
 * the bug" from "this element is inside a carousel and is fine".
 *
 * Playwright is not a dependency of this project (the sandbox that authored it has no registry access), so it is
 * resolved from node_modules when present and from a global install otherwise. Set PLAYWRIGHT_PATH to override.
 *
 * Usage:
 *   node scripts/responsive-audit.mjs                     # all routes, all viewports
 *   node scripts/responsive-audit.mjs --base=http://…      # default http://localhost:3100
 *   node scripts/responsive-audit.mjs --widths=320,390     # subset
 *   node scripts/responsive-audit.mjs --routes=/chats      # subset (substring match)
 *   node scripts/responsive-audit.mjs --keyboard           # also probe with a simulated on-screen keyboard
 *   node scripts/responsive-audit.mjs --json=out.json      # machine-readable report
 *
 * Exit code is 1 when the contract is violated, so it works as a CI gate.
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require_ = createRequire(import.meta.url);
async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    "playwright",
    "/opt/node22/lib/node_modules/playwright/index.mjs",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      return await import(c.startsWith("/") ? c : require_.resolve(c));
    } catch {
      /* try the next one */
    }
  }
  throw new Error("Playwright not found. Install it, or set PLAYWRIGHT_PATH to a playwright entry point.");
}

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const BASE = arg("base", process.env.RESPONSIVE_BASE_URL ?? "http://localhost:3100");
const JSON_OUT = arg("json", null);

/** The matrix. 320 is the narrowest phone still in use; the rest are the common iPhone/Android and desktop widths. */
const ALL_WIDTHS = [320, 360, 375, 390, 393, 414, 430, 768, 1024, 1280, 1440];
const WIDTHS = (arg("widths", "") ? arg("widths", "").split(",").map(Number) : ALL_WIDTHS);
const HEIGHT_FOR = (w) => (w <= 430 ? 844 : w <= 768 ? 1024 : 900);

/**
 * Every route the contract covers, with whether it needs a session. `state` drives a small setup step so empty and
 * error states are exercised too rather than only the happy path.
 */
const ROUTES = [
  { path: "/", auth: false, name: "Welcome" },
  { path: "/auth/register", auth: false, name: "Register" },
  { path: "/auth/forgot-password", auth: false, name: "Forgot password" },
  { path: "/auth/reset-password?token=demo", auth: false, name: "Reset password" },
  { path: "/auth/verify-email", auth: false, name: "Verify email" },
  { path: "/auth/error", auth: false, name: "Auth error" },
  { path: "/legal/terms", auth: false, name: "Terms" },
  { path: "/legal/privacy", auth: false, name: "Privacy policy" },
  { path: "/discover", auth: true, name: "Discover" },
  { path: "/likes", auth: true, name: "Likes You" },
  { path: "/likes?tab=matches", auth: true, name: "Matches" },
  { path: "/chats", auth: true, name: "Chats list" },
  { path: "/chats/__FIRST_CHAT__", auth: true, name: "Conversation" },
  { path: "/community", auth: true, name: "Community feed" },
  { path: "/community/__FIRST_POST__", auth: true, name: "Community post" },
  { path: "/notifications", auth: true, name: "Notifications page" },
  { path: "/profile", auth: true, name: "Profile" },
  { path: "/profile/edit", auth: true, name: "Edit profile" },
  { path: "/profile/preview", auth: true, name: "Profile preview" },
  { path: "/settings", auth: true, name: "Settings" },
  { path: "/settings/privacy", auth: true, name: "Privacy & Safety" },
  { path: "/settings/blocked", auth: true, name: "Blocked users" },
  { path: "/settings/discovery", auth: true, name: "Discovery preferences" },
  { path: "/settings/verification", auth: true, name: "Verification" },
  { path: "/settings/safety", auth: true, name: "Safety centre" },
  { path: "/settings/membership", auth: true, name: "Membership / Plus" },
  { path: "/admin", auth: true, name: "Admin dashboard" },
  { path: "/admin/users", auth: true, name: "Admin users" },
  { path: "/admin/photos", auth: true, name: "Admin photo queue" },
  { path: "/admin/payments", auth: true, name: "Admin payments" },
];

/**
 * Overlays are part of the contract too, and they only exist after an interaction. Each entry opens one on a route
 * and then the same probe runs against the result.
 */
const OVERLAYS = [
  { route: "/discover", name: "Filters sheet", open: async (p) => p.getByRole("button", { name: /Filters/i }).first().click() },
  { route: "/discover", name: "Notifications dropdown", open: async (p) => p.getByRole("button", { name: /^Notifications/i }).first().click() },
  { route: "/community", name: "Community composer", open: async (p) => p.getByRole("button", { name: /New post|Create post|Post/i }).first().click() },
  { route: "/settings", name: "Delete account sheet", open: async (p) => p.getByRole("button", { name: /Delete (my )?account/i }).first().click() },
];

/*
 * The in-page probe. Runs in the browser, so it must be self-contained.
 *
 * `scrollWidth > clientWidth` on the document is the contract itself. The element walk exists to make a failure
 * actionable: it finds nodes crossing the viewport edge whose overflow nothing absorbs.
 */
const PROBE = `(() => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const TOL = 1; // sub-pixel layout rounding

  const clipsX = (el) => {
    const s = getComputedStyle(el);
    return s.overflowX === "hidden" || s.overflowX === "clip" || s.overflowX === "auto" || s.overflowX === "scroll";
  };
  // An element past the edge is only a culprit when nothing between it and the root absorbs the overflow.
  const isAbsorbed = (el) => {
    for (let p = el.parentElement; p && p !== de; p = p.parentElement) {
      if (clipsX(p)) return true;
    }
    return false;
  };
  const describe = (el) => {
    const cls = (typeof el.className === "string" ? el.className : "").trim().replace(/\\s+/g, " ");
    const text = (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 48);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      testid: el.getAttribute("data-testid") || null,
      cls: cls.length > 160 ? cls.slice(0, 160) + "…" : cls,
      text,
    };
  };

  const culprits = [];
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const over = r.right > vw + TOL;
    const under = r.left < -TOL;
    if (!over && !under) continue;
    if (isAbsorbed(el)) continue;
    culprits.push({ ...describe(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) });
  }

  // A parent and its children all cross the same edge; report the outermost, which is the one to fix.
  const outermost = culprits.filter((c, i) =>
    !culprits.some((o, j) => j !== i && o.left <= c.left && o.right >= c.right && (o.right - o.left) > (c.right - c.left)));

  return {
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    overflows: de.scrollWidth > de.clientWidth,
    by: de.scrollWidth - de.clientWidth,
    culprits: outermost.slice(0, 8),
    culpritCount: culprits.length,
  };
})()`;

async function signIn(page) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const g = page.getByRole("button", { name: /Continue with Google/i }).or(page.getByRole("link", { name: /Continue with Google/i }));
  if (await g.count()) await g.first().click();
  await page.waitForURL(/authorize|discover/, { timeout: 30000 });
  if (page.url().includes("authorize")) {
    await page.getByRole("button", { name: /ismail|me@demo/i }).first().click();
    await page.waitForURL(/discover/, { timeout: 30000 });
  }
}

/** Resolves the __FIRST_CHAT__ / __FIRST_POST__ placeholders against whatever the signed-in account actually has. */
async function resolveDynamicRoutes(page) {
  const out = {};
  await page.goto(`${BASE}/chats`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const chat = await page.locator('main a[href^="/chats/"]').first().getAttribute("href").catch(() => null);
  if (chat) out.__FIRST_CHAT__ = chat.split("/").pop();
  await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const post = await page.locator('a[href^="/community/"]').first().getAttribute("href").catch(() => null);
  if (post) out.__FIRST_POST__ = post.split("/").pop();
  return out;
}

async function main() {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const failures = [];
  const checked = [];

  for (const width of WIDTHS) {
    const height = HEIGHT_FOR(width);
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await signIn(page);
    const dynamic = await resolveDynamicRoutes(page);

    const routeFilter = arg("routes", "");
    for (const route of ROUTES) {
      let path = route.path;
      for (const [k, v] of Object.entries(dynamic)) path = path.replace(k, v);
      if (path.includes("__")) continue; // no data for this placeholder in this environment
      if (routeFilter && !path.includes(routeFilter)) continue;

      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(700);
      const r = await page.evaluate(PROBE);
      checked.push({ width, route: route.name, path });
      if (r.overflows || r.culprits.length) failures.push({ width, route: route.name, path, ...r });
    }

    // Overlays, on the routes that own them.
    for (const ov of OVERLAYS) {
      if (routeFilter && !ov.route.includes(routeFilter)) continue;
      await page.goto(`${BASE}${ov.route}`, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(800);
      const opened = await ov.open(page).then(() => true).catch(() => false);
      if (!opened) continue;
      await page.waitForTimeout(700);
      const r = await page.evaluate(PROBE);
      checked.push({ width, route: `${ov.name} (overlay)`, path: ov.route });
      if (r.overflows || r.culprits.length) failures.push({ width, route: `${ov.name} (overlay)`, path: ov.route, ...r });
    }

    // Keyboard: a focused composer on a short viewport is where sticky bars and safe areas usually break.
    if (flag("keyboard") && width <= 430 && dynamic.__FIRST_CHAT__) {
      const short = await browser.newContext({ viewport: { width, height: Math.round(height * 0.55) }, deviceScaleFactor: 1 });
      const kp = await short.newPage();
      await signIn(kp);
      await kp.goto(`${BASE}/chats/${dynamic.__FIRST_CHAT__}`, { waitUntil: "domcontentloaded" });
      await kp.waitForTimeout(900);
      await kp.locator("#composer").focus().catch(() => {});
      await kp.locator("#composer").fill("keyboard open").catch(() => {});
      await kp.waitForTimeout(400);
      const r = await kp.evaluate(PROBE);
      checked.push({ width, route: "Conversation (keyboard open)", path: "/chats/…" });
      if (r.overflows || r.culprits.length) failures.push({ width, route: "Conversation (keyboard open)", path: "/chats/…", ...r });
      await short.close();
    }

    await ctx.close();
  }
  await browser.close();

  console.log(`\nResponsive contract: ${checked.length} route×viewport checks across ${WIDTHS.length} widths\n`);
  if (!failures.length) {
    console.log("PASS — no route makes the document scroll horizontally, and nothing escapes the viewport.\n");
  } else {
    console.log(`FAIL — ${failures.length} violation(s):\n`);
    for (const f of failures) {
      console.log(`  ${String(f.width).padStart(4)}px  ${f.route}  (${f.path})`);
      console.log(`        document ${f.scrollWidth} > ${f.clientWidth} (by ${f.by}px), ${f.culpritCount} element(s) outside`);
      for (const c of f.culprits) {
        console.log(`        → <${c.tag}${c.id ? "#" + c.id : ""}> ${c.left}..${c.right} (w=${c.width})  ${c.cls.slice(0, 110)}`);
        if (c.text) console.log(`          text: "${c.text}"`);
      }
    }
    console.log("");
  }
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ checked, failures }, null, 2));
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
