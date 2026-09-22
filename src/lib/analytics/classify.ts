/**
 * Turning a raw request into the few coarse buckets analytics is allowed to keep (docs/ARCHITECTURE.md §30.2).
 *
 * THIS FILE IS THE PRIVACY BOUNDARY, and it is pure on purpose: every function takes a string and returns a
 * bucket, so what may be stored is decided by code that can be read in one sitting and tested without a database.
 *
 * The rule it enforces is REDUCTION. A User-Agent string is a fingerprint — dozens of bits, enough to single out
 * one person in a small country — so it is reduced to at most three short labels ("MOBILE", "Chrome", "Android")
 * and the original is discarded before anything is written. A referring URL carries a path and a query string,
 * which routinely hold search terms, campaign ids and sometimes names, so it is reduced to a host. A visited URL
 * carries ids that say WHICH profile or WHICH conversation somebody opened, so dynamic segments collapse to
 * `:id`. None of the originals is stored anywhere; there is no column to store them in.
 *
 * Browser and OS are deliberately FAMILIES, never versions. "Chrome 131.0.6778.86" is an identifying detail;
 * "Chrome" answers the only question an operator actually has, which is whether the site works for them.
 */

export type DeviceKind = "MOBILE" | "TABLET" | "DESKTOP" | "UNKNOWN";

export type TrafficSource =
  | "DIRECT"
  | "GOOGLE"
  | "INSTAGRAM"
  | "FACEBOOK"
  | "TIKTOK"
  | "TWITTER"
  | "SNAPCHAT"
  | "YOUTUBE"
  | "WHATSAPP"
  | "TELEGRAM"
  | "LINKEDIN"
  | "REDDIT"
  | "BING"
  | "EMAIL"
  | "OTHER";

/**
 * Host suffix → source. Matched on the registrable tail so `m.facebook.com`, `l.facebook.com` and
 * `web.facebook.com` all land on FACEBOOK without listing every subdomain any platform might invent.
 */
const SOURCE_HOSTS: readonly (readonly [string, TrafficSource])[] = [
  ["google.", "GOOGLE"],
  ["googleusercontent.com", "GOOGLE"],
  ["instagram.com", "INSTAGRAM"],
  ["facebook.com", "FACEBOOK"],
  ["fb.com", "FACEBOOK"],
  ["fb.me", "FACEBOOK"],
  ["messenger.com", "FACEBOOK"],
  ["tiktok.com", "TIKTOK"],
  ["twitter.com", "TWITTER"],
  ["x.com", "TWITTER"],
  ["t.co", "TWITTER"],
  ["snapchat.com", "SNAPCHAT"],
  ["youtube.com", "YOUTUBE"],
  ["youtu.be", "YOUTUBE"],
  ["whatsapp.com", "WHATSAPP"],
  ["wa.me", "WHATSAPP"],
  ["telegram.org", "TELEGRAM"],
  ["t.me", "TELEGRAM"],
  ["linkedin.com", "LINKEDIN"],
  ["lnkd.in", "LINKEDIN"],
  ["reddit.com", "REDDIT"],
  ["bing.com", "BING"],
  ["mail.google.com", "EMAIL"],
  ["outlook.", "EMAIL"],
  ["mail.yahoo.com", "EMAIL"],
];

export interface ReferrerAttribution {
  source: TrafficSource;
  /** Host only, lower-cased, `www.` stripped. Null whenever there is nothing legitimate to record. */
  host: string | null;
}

/**
 * Attributes a referrer, best-effort and never more.
 *
 * DIRECT is the honest answer to "we were told nothing", which covers a genuinely typed address AND every case
 * where the referrer was suppressed: an in-app webview, a privacy browser, an https→http hop, a `noreferrer`
 * link, or simply a platform that strips it. The Analytics screen says so rather than implying these visitors
 * arrived unprompted — over-claiming attribution is the usual way analytics starts lying.
 *
 * `ownHosts` are this deployment's own hostnames; a referrer from ourselves is an internal navigation, not an
 * acquisition, so it is DIRECT with no host recorded.
 */
export function attributeReferrer(referrer: string | null | undefined, ownHosts: readonly string[] = []): ReferrerAttribution {
  const raw = (referrer ?? "").trim();
  if (!raw) return { source: "DIRECT", host: null };

  let host: string;
  try {
    const url = new URL(raw);
    // Only real web referrers. An `android-app://` or `data:` referrer tells us nothing worth a row.
    if (url.protocol !== "https:" && url.protocol !== "http:") return { source: "DIRECT", host: null };
    host = url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { source: "DIRECT", host: null };
  }
  if (!host) return { source: "DIRECT", host: null };

  const own = ownHosts.map((h) => h.toLowerCase().replace(/^www\./, ""));
  if (own.includes(host)) return { source: "DIRECT", host: null };

  for (const [needle, source] of SOURCE_HOSTS) {
    // A trailing-dot needle ("google.") matches any TLD — google.mv, google.co.uk — without enumerating them.
    const hit = needle.endsWith(".") ? host === needle.slice(0, -1) || host.startsWith(needle) || host.includes(`.${needle}`) : host === needle || host.endsWith(`.${needle}`);
    if (hit) return { source, host };
  }
  return { source: "OTHER", host: host.slice(0, 120) };
}

/**
 * Device class from the User-Agent. Tablet is tested BEFORE mobile because every Android tablet also says
 * "Mobile"; an iPad since iPadOS 13 reports itself as a Mac and is indistinguishable here, which is a limitation
 * worth stating rather than a bug worth fingerprinting around.
 */
export function classifyDevice(userAgent: string | null | undefined): DeviceKind {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "UNKNOWN";
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua)) return "TABLET";
  if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/.test(ua)) return "MOBILE";
  if (/windows|macintosh|mac os x|linux|cros/.test(ua)) return "DESKTOP";
  return "UNKNOWN";
}

/** Browser family, never a version. Order matters: every Chromium browser also claims "Chrome". */
export function classifyBrowser(userAgent: string | null | undefined): string | null {
  const ua = userAgent ?? "";
  if (!ua) return null;
  if (/\bEdg[A-Z]?\//.test(ua)) return "Edge";
  if (/\bOPR\/|\bOpera\//.test(ua)) return "Opera";
  if (/\bSamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/\bFBAN\/|\bFBAV\//.test(ua)) return "Facebook";
  if (/\bInstagram\b/.test(ua)) return "Instagram";
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) return "Firefox";
  if (/\bCriOS\//.test(ua)) return "Chrome";
  if (/\bChrome\//.test(ua)) return "Chrome";
  if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return "Safari";
  return "Other";
}

/** Operating-system family, never a version. */
export function classifyOs(userAgent: string | null | undefined): string | null {
  const ua = userAgent ?? "";
  if (!ua) return null;
  if (/\bAndroid\b/.test(ua)) return "Android";
  if (/\biPhone\b|\biPad\b|\biPod\b/.test(ua)) return "iOS";
  if (/\bWindows\b/.test(ua)) return "Windows";
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return "macOS";
  if (/\bCrOS\b/.test(ua)) return "ChromeOS";
  if (/\bLinux\b/.test(ua)) return "Linux";
  return "Other";
}

/** Two-letter uppercase country, or null. Anything else the edge offers is discarded rather than trusted. */
export function normalizeCountry(value: string | null | undefined): string | null {
  const code = (value ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  // Vercel uses XX for "unknown"; storing it would imply a place.
  return code === "XX" || code === "T1" ? null : code;
}

/** Path segments that are identifiers rather than pages. Collapsed so analytics never records WHICH one. */
const DYNAMIC_PARENTS = new Set(["chats", "community", "profile", "payments", "orders", "order", "verifications", "users", "welcome-preview", "u"]);

const MAX_PATH_SEGMENTS = 6;
const MAX_PATH_LENGTH = 120;

/**
 * Normalises a URL or path to the page identity worth counting.
 *
 * Three reductions, each deliberate:
 *   - the QUERY STRING and FRAGMENT are dropped. They are where tokens, search terms and email addresses live,
 *     and "which page" never needs them;
 *   - DYNAMIC SEGMENTS collapse to `:id`, so `/chats/abc123` is recorded as `/chats/:id`. Without this, a
 *     "top pages" table would quietly become a log of who opened whose profile;
 *   - depth and length are bounded, so a crafted URL cannot write an essay into the column.
 *
 * Returns null for anything that is not a usable same-origin path, so a malformed or hostile value is simply not
 * recorded rather than recorded badly.
 */
export function normalizePath(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  let pathname: string;
  if (raw.startsWith("/")) {
    // A protocol-relative "//evil.com" is not a path; treat it as unusable.
    if (raw.startsWith("//")) return null;
    pathname = raw.split("?")[0]!.split("#")[0]!;
  } else {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      return null;
    }
  }

  const segments = pathname.split("/").filter(Boolean).slice(0, MAX_PATH_SEGMENTS);
  if (segments.length === 0) return "/";

  const out = segments.map((segment, i) => {
    const parent = i > 0 ? segments[i - 1]!.toLowerCase() : null;
    if (parent && DYNAMIC_PARENTS.has(parent)) return ":id";
    // A segment that looks like an identifier is one wherever it sits: a cuid, a uuid, or a long opaque token.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ":id";
    if (/^\d+$/.test(segment)) return ":id";
    if (segment.length >= 20 && /^[A-Za-z0-9_-]+$/.test(segment)) return ":id";
    return segment.toLowerCase().replace(/[^a-z0-9:._-]/g, "").slice(0, 40);
  });

  const path = `/${out.filter(Boolean).join("/")}`;
  return path.slice(0, MAX_PATH_LENGTH);
}

/**
 * Paths that are never recorded at all: the admin portal (staff traffic is not visitor traffic, and an operator's
 * movements are not analytics) and the API surface (not pages).
 */
export function isTrackablePath(path: string | null): boolean {
  if (!path) return false;
  return !path.startsWith("/admin") && !path.startsWith("/api") && !path.startsWith("/dev");
}
