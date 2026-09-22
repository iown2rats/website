import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { attributeReferrer, classifyBrowser, classifyDevice, classifyOs, isTrackablePath, normalizeCountry, normalizePath } from "@/lib/analytics/classify";
import { MAX_ANALYTICS_BODY_BYTES, parseAnalyticsBody } from "@/server/analytics/validate";

/*
 * The privacy boundary (docs/ARCHITECTURE.md §30.2).
 *
 * These are the tests that hold down what analytics is ALLOWED to keep. They are pure, so they say exactly what
 * the reduction rules are without a database in the way: a User-Agent becomes at most three short labels, a
 * referring URL becomes a host, and a visited URL loses its query string and its identifiers.
 */

describe("path normalisation", () => {
  it("drops the query string, which is where personal data hides", () => {
    expect(normalizePath("/community?q=aminath+phone&token=abc123")).toBe("/community");
    expect(normalizePath("https://www.mellocrush.com/settings?email=someone%40example.com")).toBe("/settings");
  });

  it("drops the fragment", () => {
    expect(normalizePath("/legal/privacy#section-9")).toBe("/legal/privacy");
  });

  it("collapses identifiers so a top-pages table never records who opened what", () => {
    expect(normalizePath("/chats/xpjkjp4162uhnfs6ot8c7fp9")).toBe("/chats/:id");
    expect(normalizePath("/community/abc123def456ghi789jkl")).toBe("/community/:id");
    expect(normalizePath("/profile/9thwzrru")).toBe("/profile/:id");
    expect(normalizePath("/settings/membership/order/01234567-89ab-cdef-0123-456789abcdef")).toBe("/settings/membership/order/:id");
  });

  it("keeps ordinary pages exactly as they are", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("/community")).toBe("/community");
    expect(normalizePath("/settings/membership")).toBe("/settings/membership");
  });

  it("refuses anything that is not a usable path rather than storing it badly", () => {
    expect(normalizePath("//evil.example.com")).toBeNull();
    expect(normalizePath("not a url")).toBeNull();
    expect(normalizePath("")).toBeNull();
    expect(normalizePath(null)).toBeNull();
  });

  it("bounds depth and length so a crafted URL cannot write an essay into the column", () => {
    const deep = normalizePath("/" + Array.from({ length: 40 }, (_, i) => `seg${i}`).join("/"));
    expect(deep!.split("/").filter(Boolean)).toHaveLength(6);
    expect(normalizePath(`/${"x".repeat(500)}`)!.length).toBeLessThanOrEqual(120);
  });

  it("never records the admin portal or the API surface", () => {
    expect(isTrackablePath("/admin")).toBe(false);
    expect(isTrackablePath("/admin/analytics")).toBe(false);
    expect(isTrackablePath("/api/analytics/collect")).toBe(false);
    expect(isTrackablePath("/community")).toBe(true);
  });
});

describe("referrer attribution", () => {
  it("recognises the platforms that matter here", () => {
    expect(attributeReferrer("https://www.instagram.com/p/xyz").source).toBe("INSTAGRAM");
    expect(attributeReferrer("https://l.facebook.com/l.php?u=…").source).toBe("FACEBOOK");
    expect(attributeReferrer("https://www.tiktok.com/@someone").source).toBe("TIKTOK");
    expect(attributeReferrer("https://t.co/abc").source).toBe("TWITTER");
    expect(attributeReferrer("https://www.google.mv/").source).toBe("GOOGLE");
    expect(attributeReferrer("https://www.google.com/search?q=dating+maldives").source).toBe("GOOGLE");
  });

  it("keeps only the host, never the path or the query", () => {
    const attributed = attributeReferrer("https://www.google.com/search?q=someone%27s+name+maldives");
    expect(attributed.host).toBe("google.com");
    expect(JSON.stringify(attributed)).not.toContain("search");
    expect(JSON.stringify(attributed)).not.toContain("name");
  });

  it("falls back to DIRECT when no referrer is offered — which is most of the time", () => {
    // Browsers, in-app webviews and privacy tools all suppress referrers; attribution is best-effort by nature.
    expect(attributeReferrer(null)).toEqual({ source: "DIRECT", host: null });
    expect(attributeReferrer("")).toEqual({ source: "DIRECT", host: null });
    expect(attributeReferrer("   ")).toEqual({ source: "DIRECT", host: null });
    expect(attributeReferrer("android-app://com.example.app")).toEqual({ source: "DIRECT", host: null });
    expect(attributeReferrer("garbage")).toEqual({ source: "DIRECT", host: null });
  });

  it("does not count our own pages as acquisition", () => {
    expect(attributeReferrer("https://www.mellocrush.com/community", ["www.mellocrush.com"])).toEqual({ source: "DIRECT", host: null });
    expect(attributeReferrer("https://mellocrush.com/", ["www.mellocrush.com"])).toEqual({ source: "DIRECT", host: null });
  });

  it("records an unrecognised site as OTHER plus its host", () => {
    expect(attributeReferrer("https://news.example.mv/article/1")).toEqual({ source: "OTHER", host: "news.example.mv" });
  });
});

describe("device, browser and OS reduction", () => {
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Mobile Safari/537.36";
  const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/604.1";

  it("classifies the device coarsely", () => {
    expect(classifyDevice(IPHONE)).toBe("MOBILE");
    expect(classifyDevice(ANDROID)).toBe("MOBILE");
    expect(classifyDevice(DESKTOP)).toBe("DESKTOP");
    expect(classifyDevice(IPAD)).toBe("TABLET");
    expect(classifyDevice(null)).toBe("UNKNOWN");
  });

  it("keeps the browser family and throws the version away", () => {
    expect(classifyBrowser(ANDROID)).toBe("Chrome");
    expect(classifyBrowser(IPHONE)).toBe("Safari");
    expect(classifyBrowser("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120.0.0.0")).toBe("Edge");
    // The version is the fingerprinting bit; none of these answers contains a digit.
    for (const ua of [ANDROID, IPHONE, DESKTOP]) expect(classifyBrowser(ua)).not.toMatch(/\d/);
  });

  it("keeps the OS family and throws the version away", () => {
    expect(classifyOs(ANDROID)).toBe("Android");
    expect(classifyOs(IPHONE)).toBe("iOS");
    expect(classifyOs(DESKTOP)).toBe("macOS");
    for (const ua of [ANDROID, IPHONE, DESKTOP]) expect(classifyOs(ua)).not.toMatch(/\d/);
  });

  it("reduces a long User-Agent to at most three short labels", () => {
    // 130-odd identifying characters in, three coarse buckets out. That reduction IS the privacy guarantee.
    const reduced = [classifyDevice(ANDROID), classifyBrowser(ANDROID), classifyOs(ANDROID)].join("|");
    expect(reduced).toBe("MOBILE|Chrome|Android");
    expect(reduced.length).toBeLessThan(40);
    expect(ANDROID).not.toContain(reduced);
  });
});

describe("country", () => {
  it("accepts only a two-letter code", () => {
    expect(normalizeCountry("mv")).toBe("MV");
    expect(normalizeCountry("GB")).toBe("GB");
    expect(normalizeCountry("MDV")).toBeNull();
    expect(normalizeCountry("")).toBeNull();
    expect(normalizeCountry(null)).toBeNull();
    expect(normalizeCountry("4.175,73.509")).toBeNull();
  });

  it("treats the edge's unknown markers as unknown rather than as a place", () => {
    expect(normalizeCountry("XX")).toBeNull();
    expect(normalizeCountry("T1")).toBeNull();
  });
});

describe("what the ingest endpoint accepts", () => {
  const valid = (over: Record<string, unknown> = {}) => JSON.stringify({ eventKey: randomUUID(), type: "PAGE_VIEW", path: "/community", ...over });

  it("accepts a well-formed body", () => {
    const parsed = parseAnalyticsBody(valid());
    expect(parsed?.type).toBe("PAGE_VIEW");
    expect(parsed?.path).toBe("/community");
  });

  it("refuses an event key that is not a UUID", () => {
    // The key is the primary key of the duplicate rule. A caller who could choose an arbitrary one could pick
    // somebody else's and, because the insert does nothing on conflict, silently suppress their event.
    for (const key of ["", "abc", "1", "../../etc/passwd", "a".repeat(64), "01234567-89ab-cdef-0123-456789abcde"]) {
      expect(parseAnalyticsBody(valid({ eventKey: key }))).toBeNull();
    }
  });

  it("refuses an event type outside the closed set", () => {
    expect(parseAnalyticsBody(valid({ type: "DROP_TABLE" }))).toBeNull();
    expect(parseAnalyticsBody(valid({ type: "" }))).toBeNull();
  });

  it("refuses anything that is not JSON, and anything oversized", () => {
    expect(parseAnalyticsBody("not json")).toBeNull();
    expect(parseAnalyticsBody("")).toBeNull();
    expect(parseAnalyticsBody(valid({ path: "/" + "x".repeat(MAX_ANALYTICS_BODY_BYTES) }))).toBeNull();
  });

  it("ignores fields a caller invents, so no extra value can reach the database", () => {
    const parsed = parseAnalyticsBody(valid({ userId: "someone-else", visitorId: "forged", ip: "1.2.3.4", excluded: false }));
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed!).sort()).toEqual(["eventKey", "path", "type"]);
  });
});
