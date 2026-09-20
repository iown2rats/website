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
 *   node scripts/responsive-audit.mjs --focus              # also probe with each field focused and filled
 *   node scripts/responsive-audit.mjs --no-mobile          # lay phone widths out as a desktop window instead
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
 * Screens reachable only through a state transition, not by typing a URL.
 *
 * /auth/verify-email is the whole reason this exists: it renders for exactly one session state — signed in with
 * an unconfirmed email address — so neither the signed-out nor the signed-in context can ever load it, and every
 * run before this reported it as "redirected away" rather than checking it. Reaching it means registering.
 *
 * That makes flows the only part of this script that writes anything, so they are refused off localhost. An audit
 * must never create accounts in a real database, and a throwaway address is still an account.
 */
const FLOWS = [
  {
    name: "Verify email",
    path: "/auth/verify-email",
    reach: async (p) => {
      await p.goto(`${BASE}/auth/register`, { waitUntil: "domcontentloaded" });
      const email = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
      await p.locator('input[name="email"]').fill(email);
      await p.locator('input[name="password"]').fill("Auditpass123!");
      await p.locator('input[name="confirmPassword"]').fill("Auditpass123!").catch(() => {});
      await p.getByRole("button", { name: /create account|register|sign up|continue/i }).first().click();
      await p.waitForURL(/verify-email/, { timeout: 20000 });
    },
  },
];

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);

/*
 * The in-page probe. Runs in the browser, so it must be self-contained.
 *
 * Three clauses, in the order they matter:
 *
 *   1. `scrollWidth > clientWidth` on the document. The contract itself.
 *   2. Every visible editable control computes at 16px or more. Below that, iOS Safari zooms the page on focus
 *      and leaves it pannable sideways on every screen — a horizontal-drag bug that clause 1 cannot see, because
 *      the document is not the thing that overflowed. This is the clause that actually catches the reported bug.
 *   3. visualViewport scale and offset. Honest limitation: Chromium does not implement iOS focus-zoom, so this
 *      clause CANNOT fail here and proves nothing about Safari. It is recorded so a WebKit run (which this
 *      sandbox cannot install) checks it, and so clause 2 is never mistaken for a direct measurement of it.
 *
 * The element walk exists to make clause 1 actionable. Naming an ancestor is not actionable, so it reports the
 * deepest offending node — including text that spills out of a box whose own rect still fits, which is the common
 * case for an unbroken token and the case the first version of this script got wrong.
 */
const PROBE = `(() => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const TOL = 1; // sub-pixel layout rounding
  const FIELD_FLOOR = 16; // iOS Safari zooms a focused control below this

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
  const sel = (el) => {
    const cls = (el.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean);
    return el.tagName.toLowerCase()
      + (el.id ? "#" + el.id : "")
      + (cls.length ? "." + cls.slice(0, 4).join(".") : "");
  };
  // The chain up to the nearest thing a person can search the codebase for.
  const ancestry = (el) => {
    const out = [];
    for (let e = el.parentElement; e && e !== de && out.length < 4; e = e.parentElement) out.push(sel(e));
    return out;
  };
  const describe = (el, kind) => {
    const r = el.getBoundingClientRect();
    const cls = (el.getAttribute("class") || "").trim().replace(/\\s+/g, " ");
    return {
      kind,
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      testid: el.getAttribute("data-testid") || null,
      selector: sel(el),
      path: ancestry(el),
      cls: cls.length > 160 ? cls.slice(0, 160) + "\\u2026" : cls,
      text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 60),
      left: Math.round(r.left),
      right: Math.round(r.right),
      width: Math.round(r.width),
    };
  };

  // --- clause 1: who crosses the viewport edge -------------------------------------------------------
  const offenders = new Map(); // element -> kind, so a node is never reported twice
  const range = document.createRange();
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") continue;
    if (isAbsorbed(el)) continue;
    const r = el.getBoundingClientRect();
    const boxOut = (r.width || r.height) && (r.right > vw + TOL || r.left < -TOL);
    if (boxOut) { offenders.set(el, "box"); continue; }
    // A box can fit while its own text runs past the edge; the box is still the element to fix, and its rect
    // gives no hint, so measure the text directly. This is what the outermost-rect filter used to miss.
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !node.nodeValue.trim()) continue;
      range.selectNodeContents(node);
      for (const tr of range.getClientRects()) {
        if (tr.right > vw + TOL || tr.left < -TOL) { offenders.set(el, "text"); break; }
      }
      if (offenders.has(el)) break;
    }
  }
  // Report the deepest offenders: a wrapper is dragged out by its child, and the child is the fix.
  const els = [...offenders.keys()];
  const leaves = els.filter((el) => !els.some((other) => other !== el && el.contains(other)));
  const culprits = leaves.slice(0, 8).map((el) => describe(el, offenders.get(el)));

  // --- clause 2: the iOS field floor ----------------------------------------------------------------
  const IGNORED = ["hidden", "checkbox", "radio", "range", "file", "submit", "button", "image", "reset"];
  const smallFields = [];
  for (const el of document.querySelectorAll("input, textarea, select")) {
    if (IGNORED.includes(el.type)) continue;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") continue;
    const px = parseFloat(s.fontSize);
    if (px < FIELD_FLOOR) smallFields.push({ selector: sel(el), name: el.name || el.id || el.getAttribute("aria-label") || el.placeholder || null, px });
  }

  // --- clause 3: the visual viewport (recorded, not proven — see the note above) ---------------------
  const vv = window.visualViewport
    ? { scale: window.visualViewport.scale, offsetLeft: Math.round(window.visualViewport.offsetLeft), width: Math.round(window.visualViewport.width) }
    : null;

  return {
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    overflows: de.scrollWidth > de.clientWidth,
    by: de.scrollWidth - de.clientWidth,
    culprits,
    culpritCount: offenders.size,
    smallFields,
    fieldCount: document.querySelectorAll("input, textarea, select").length,
    vv,
  };
})()`;

/*
 * Focus each field in turn and re-check the contract.
 *
 * Chromium will not reproduce iOS focus-zoom, so this is not a test of that. It is a test of everything else that
 * focusing a field does to a layout and that Chromium models faithfully: the browser scrolling the control into
 * view, a sticky composer or action bar moving, `field-sizing-content` growing a textarea, a floating label
 * reflowing a row. Any of those can push the document past the viewport edge, and none of them show up in a probe
 * that only ever measures a page nobody has touched.
 */
async function focusPass(page) {
  const count = await page.locator("input:visible, textarea:visible, select:visible").count().catch(() => 0);
  const results = [];
  for (let i = 0; i < Math.min(count, 12); i++) {
    const field = page.locator("input:visible, textarea:visible, select:visible").nth(i);
    const type = await field.getAttribute("type").catch(() => null);
    if (["hidden", "checkbox", "radio", "range", "file", "submit", "button"].includes(type ?? "")) continue;
    const ok = await field.focus({ timeout: 2000 }).then(() => true).catch(() => false);
    if (!ok) continue;
    await field.fill("Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").catch(() => {});
    await page.waitForTimeout(150);
    const r = await page.evaluate(PROBE);
    const label = (await field.getAttribute("aria-label").catch(() => null)) ?? (await field.getAttribute("name").catch(() => null)) ?? `field ${i + 1}`;
    if (r.overflows || r.culprits.length || r.smallFields.length) results.push({ label, ...r });
  }
  return results;
}

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

/*
 * Context options.
 *
 * Without `isMobile`, Chromium lays a page out as a narrow desktop window: it ignores the meta viewport tag
 * entirely and there is no layout-viewport/visual-viewport split. That is not the mode any phone browser uses, so
 * every run before this measured a rendering mode no user has. `--mobile` turns on the emulation phone Chrome
 * actually does — meta viewport honoured, touch, a real device pixel ratio — and is the default at phone widths.
 */
function contextOpts(width, height) {
  const phone = width <= 430 && !flag("no-mobile");
  return phone
    ? {
        viewport: { width, height },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
      }
    : { viewport: { width, height }, deviceScaleFactor: 1 };
}

/** The contract, in one place: the document must not scroll sideways, nothing may escape it, no field may sit below the iOS floor. */
function violates(r) {
  return r.overflows || r.culprits.length > 0 || r.smallFields.length > 0 || (r.vv && (r.vv.scale !== 1 || r.vv.offsetLeft !== 0));
}

async function main() {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const failures = [];
  const checked = [];
  const redirected = [];

  for (const width of WIDTHS) {
    const height = HEIGHT_FOR(width);
    const ctx = await browser.newContext(contextOpts(width, height));
    const page = await ctx.newPage();
    await signIn(page);
    const dynamic = await resolveDynamicRoutes(page);

    /*
     * Signed-out routes need a signed-out browser. Probing /auth/register from a signed-in context does not check
     * the register screen: route access bounces it to /discover, the probe measures Discover, and the run reports
     * a pass for a page it never loaded. That is how a earlier version of this script "checked" eight auth and
     * legal routes without ever rendering one of them, and it is why every navigation below is verified to have
     * landed where it was sent.
     */
    const anon = await browser.newContext(contextOpts(width, height));
    const anonPage = await anon.newPage();

    const routeFilter = arg("routes", "");
    for (const route of ROUTES) {
      let path = route.path;
      for (const [k, v] of Object.entries(dynamic)) path = path.replace(k, v);
      if (path.includes("__")) continue; // no data for this placeholder in this environment
      if (routeFilter && !path.includes(routeFilter)) continue;

      const target = route.auth ? page : anonPage;
      await target.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" }).catch(() => {});
      await target.waitForTimeout(700);

      // Landed somewhere else? Then this route was not checked, and saying it passed would be a lie.
      const landed = new URL(target.url()).pathname;
      const wanted = new URL(path, BASE).pathname;
      if (landed !== wanted) {
        redirected.push({ width, route: route.name, wanted, landed, auth: route.auth });
        continue;
      }

      const r = await target.evaluate(PROBE);
      checked.push({ width, route: route.name, path });
      if (violates(r)) failures.push({ width, route: route.name, path, ...r });

      // Same route, every field focused and filled.
      if (flag("focus") && r.fieldCount) {
        for (const f of await focusPass(target)) {
          failures.push({ width, route: `${route.name} (focus: ${f.label})`, path, ...f });
        }
      }
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
      if (violates(r)) failures.push({ width, route: `${ov.name} (overlay)`, path: ov.route, ...r });
    }

    // Keyboard: a focused composer on a short viewport is where sticky bars and safe areas usually break.
    if (flag("keyboard") && width <= 430 && dynamic.__FIRST_CHAT__) {
      const short = await browser.newContext(contextOpts(width, Math.round(height * 0.55)));
      const kp = await short.newPage();
      await signIn(kp);
      await kp.goto(`${BASE}/chats/${dynamic.__FIRST_CHAT__}`, { waitUntil: "domcontentloaded" });
      await kp.waitForTimeout(900);
      await kp.locator("#composer").focus().catch(() => {});
      await kp.locator("#composer").fill("keyboard open").catch(() => {});
      await kp.waitForTimeout(400);
      const r = await kp.evaluate(PROBE);
      checked.push({ width, route: "Conversation (keyboard open)", path: "/chats/…" });
      if (violates(r)) failures.push({ width, route: "Conversation (keyboard open)", path: "/chats/…", ...r });
      await short.close();
    }

    await anon.close();
    await ctx.close();
  }

  /*
   * Flows run once, not once per width.
   *
   * Registering is rate limited — correctly, it is an anti-abuse guard on a real signup form — so reaching this
   * state eleven times gets refused after the second and reports nine widths as unreachable. Reaching it once and
   * resizing covers every width off one throwaway account, which is also simply the right amount of signup
   * traffic for a layout check to generate.
   */
  if (FLOWS.length) {
    const routeFilter = arg("routes", "");
    for (const flow of FLOWS) {
      if (routeFilter && !flow.path.includes(routeFilter)) continue;
      if (!LOCAL) {
        redirected.push({ width: 0, route: flow.name, wanted: flow.path, landed: "(skipped: flows only run against localhost)", auth: true });
        continue;
      }
      const fctx = await browser.newContext(contextOpts(WIDTHS[0], HEIGHT_FOR(WIDTHS[0])));
      const fp = await fctx.newPage();
      const reached = await flow.reach(fp).then(() => true).catch(() => false);
      if (!reached) {
        // Say what actually stopped it. "Could not reach" on its own sent me looking for a layout bug.
        const alerts = await fp.locator('[role="alert"]').allInnerTexts().catch(() => []);
        const why = alerts.filter(Boolean).join(" / ") || new URL(fp.url()).pathname;
        redirected.push({ width: 0, route: flow.name, wanted: flow.path, landed: `(could not reach: ${why})`, auth: true });
        await fctx.close();
        continue;
      }
      for (const width of WIDTHS) {
        await fp.setViewportSize({ width, height: HEIGHT_FOR(width) });
        await fp.waitForTimeout(400);
        const r = await fp.evaluate(PROBE);
        checked.push({ width, route: flow.name, path: flow.path });
        if (violates(r)) failures.push({ width, route: flow.name, path: flow.path, ...r });
      }
      await fctx.close();
    }
  }

  await browser.close();

  console.log(`\nResponsive contract: ${checked.length} route×viewport checks across ${WIDTHS.length} widths\n`);
  if (redirected.length) {
    console.log(`NOT CHECKED — ${redirected.length} route×viewport pair(s) redirected away and were not measured:\n`);
    for (const r of redirected) console.log(`  ${r.width ? String(r.width).padStart(4) + "px" : "  all "}  ${r.route}: ${r.wanted} → ${r.landed}`);
    console.log("");
  }
  if (!failures.length) {
    console.log("PASS — no route makes the document scroll horizontally, and nothing escapes the viewport.\n");
  } else {
    console.log(`FAIL — ${failures.length} violation(s):\n`);
    for (const f of failures) {
      console.log(`  ${String(f.width).padStart(4)}px  ${f.route}  (${f.path})`);
      if (f.overflows) {
        console.log(`        document scrolls sideways: ${f.scrollWidth} > ${f.clientWidth} (by ${f.by}px)`);
      }
      for (const c of f.culprits) {
        const why = c.kind === "text" ? "text spills past the edge" : "box crosses the edge";
        console.log(`        → ${c.selector}`);
        console.log(`          ${why}: ${c.left}..${c.right} (w=${c.width}), viewport 0..${f.clientWidth}`);
        if (c.path.length) console.log(`          inside: ${c.path.join(" < ")}`);
        if (c.text) console.log(`          text: "${c.text}"`);
      }
      for (const sf of f.smallFields) {
        console.log(`        → ${sf.selector}${sf.name ? ` (${sf.name})` : ""} is ${sf.px}px`);
        console.log(`          below the 16px iOS floor: focusing this zooms Safari and makes the page pannable`);
      }
      if (f.vv && (f.vv.scale !== 1 || f.vv.offsetLeft !== 0)) {
        console.log(`        → visual viewport scale ${f.vv.scale}, offsetLeft ${f.vv.offsetLeft}`);
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
