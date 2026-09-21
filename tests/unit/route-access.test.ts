import { describe, expect, it } from "vitest";
import { classifyRoute, resolveAccess, resolveProxyAccess, safeInternalPath } from "@/server/auth/route-access";
import { authKindForUser } from "@/server/auth/session";

describe("route access rules", () => {
  it("classifies routes", () => {
    expect(classifyRoute("/")).toBe("public");
    expect(classifyRoute("/auth/error")).toBe("auth");
    expect(classifyRoute("/auth/google/callback")).toBe("auth");
    expect(classifyRoute("/onboarding/name")).toBe("onboarding");
    expect(classifyRoute("/discover")).toBe("app");
    expect(classifyRoute("/chats/abc")).toBe("app");
    expect(classifyRoute("/_next/static/x.js")).toBe("system");
    expect(classifyRoute("/api/photos")).toBe("system");
  });

  it("unauthenticated users are redirected away from the app and onboarding, but may see welcome and auth", () => {
    expect(resolveAccess("anonymous", "/discover")).toEqual({ allow: false, redirectTo: "/" });
    expect(resolveAccess("anonymous", "/onboarding/photos")).toEqual({ allow: false, redirectTo: "/" });
    expect(resolveAccess("anonymous", "/")).toEqual({ allow: true });
    expect(resolveAccess("anonymous", "/auth/error")).toEqual({ allow: true });
    expect(resolveAccess("anonymous", "/auth/google/start")).toEqual({ allow: true });
    expect(resolveAccess("anonymous", "/auth/deleted")).toEqual({ allow: true });
  });

  it("incomplete users are sent to onboarding from app and auth routes", () => {
    expect(resolveAccess("onboarding", "/discover")).toEqual({ allow: false, redirectTo: "/onboarding" });
    expect(resolveAccess("onboarding", "/auth/deleted")).toEqual({ allow: false, redirectTo: "/onboarding" });
    expect(resolveAccess("onboarding", "/auth/error")).toEqual({ allow: true }); // a failed re-authentication must be explainable
    expect(resolveAccess("onboarding", "/onboarding/name")).toEqual({ allow: true });
    expect(resolveAccess("onboarding", "/auth/logout")).toEqual({ allow: true });
    expect(resolveAccess("onboarding", "/auth/google/start")).toEqual({ allow: true }); // the handler sends them on
  });

  it("complete users can use the app and never return to auth or onboarding", () => {
    expect(resolveAccess("active", "/discover")).toEqual({ allow: true });
    expect(resolveAccess("active", "/chats")).toEqual({ allow: true });
    expect(resolveAccess("active", "/auth/deleted")).toEqual({ allow: false, redirectTo: "/discover" });
    expect(resolveAccess("active", "/auth/error")).toEqual({ allow: true });
    expect(resolveAccess("active", "/auth/google/start")).toEqual({ allow: true }); // re-authentication for destructive actions
    expect(resolveAccess("active", "/auth/google/callback")).toEqual({ allow: true });
    expect(resolveAccess("active", "/onboarding/name")).toEqual({ allow: false, redirectTo: "/discover" });
    expect(resolveAccess("active", "/")).toEqual({ allow: false, redirectTo: "/discover" });
  });

  it("never loops: every redirect target is allowed for the same state", () => {
    for (const kind of ["anonymous", "onboarding", "active"] as const) {
      for (const path of ["/", "/auth/error", "/auth/deleted", "/onboarding/name", "/discover", "/profile", "/settings"]) {
        const d = resolveAccess(kind, path);
        if (!d.allow) expect(resolveAccess(kind, d.redirectTo)).toEqual({ allow: true });
      }
    }
  });

  it("the proxy only acts on missing cookies", () => {
    expect(resolveProxyAccess(false, "/discover")).toEqual({ allow: false, redirectTo: "/" });
    expect(resolveProxyAccess(true, "/discover")).toEqual({ allow: true });
    expect(resolveProxyAccess(true, "/auth/error")).toEqual({ allow: true }); // layouts decide
  });

  it("rejects open redirects", () => {
    expect(safeInternalPath("//evil.example", "/discover")).toBe("/discover");
    expect(safeInternalPath("https://evil.example", "/discover")).toBe("/discover");
    expect(safeInternalPath("/\\evil", "/discover")).toBe("/discover");
    expect(safeInternalPath("/chats/abc", "/discover")).toBe("/chats/abc");
  });

  it("classifies account state", () => {
    expect(authKindForUser({ status: "ONBOARDING", onboardingCompletedAt: null })).toBe("onboarding");
    expect(authKindForUser({ status: "ACTIVE", onboardingCompletedAt: new Date() })).toBe("active");
    expect(authKindForUser({ status: "ACTIVE", onboardingCompletedAt: null })).toBe("onboarding");
    expect(authKindForUser({ status: "SUSPENDED", onboardingCompletedAt: new Date() })).toBe("blocked");
    expect(authKindForUser({ status: "BANNED", onboardingCompletedAt: new Date() })).toBe("blocked");
  });
});

describe("staff accounts and the admin portal", () => {
  // Browser verification found the welcome page letting a staff session through, because "/" is the one member
  // route with no shared layout guard above it. These assertions pin the rule for every state.
  it("sends a staff account to the portal from every member route, including the welcome page", () => {
    for (const path of ["/", "/discover", "/likes", "/chats", "/community", "/profile", "/settings", "/onboarding", "/legal/terms", "/auth/register"]) {
      expect(resolveAccess("staff", path), path).toEqual({ allow: false, redirectTo: "/admin" });
    }
  });

  it("lets every state reach the portal, because the portal decides for itself", () => {
    for (const path of ["/admin", "/admin/login", "/admin/staff", "/admin/set-password", "/admin/reset-password"]) {
      for (const kind of ["anonymous", "onboarding", "active", "staff"] as const) {
        expect(resolveAccess(kind, path), `${kind} ${path}`).toEqual({ allow: true });
      }
    }
  });

  it("still refuses an unconfirmed email account everywhere, portal included", () => {
    expect(resolveAccess("unverified", "/admin")).toEqual({ allow: false, redirectTo: "/auth/verify-email" });
    expect(resolveAccess("unverified", "/admin/login")).toEqual({ allow: false, redirectTo: "/auth/verify-email" });
    expect(resolveAccess("unverified", "/auth/verify-email")).toEqual({ allow: true });
  });

  it("classifies the portal as its own group", () => {
    expect(classifyRoute("/admin")).toBe("staff");
    expect(classifyRoute("/admin/staff")).toBe("staff");
    expect(classifyRoute("/admin-setup")).toBe("staff");
    expect(classifyRoute("/discover")).toBe("app");
  });

  it("an anonymous visitor is not bounced away from the portal by the proxy", () => {
    // The proxy only sees cookie presence. Before the staff group existed it sent /admin to the dating welcome
    // page, which would have made the portal login unreachable while signed out.
    expect(resolveProxyAccess(false, "/admin")).toEqual({ allow: true });
    expect(resolveProxyAccess(false, "/admin/login")).toEqual({ allow: true });
    expect(resolveProxyAccess(false, "/discover")).toEqual({ allow: false, redirectTo: "/" });
  });
});

describe("the public legal documents", () => {
  const LEGAL = ["/terms", "/privacy", "/community-guidelines"];

  it("is its own group, not the welcome page's", () => {
    for (const path of LEGAL) expect(classifyRoute(path), path).toBe("legal");
    // The old addresses still classify as public; they are redirects now, not documents.
    expect(classifyRoute("/legal/terms")).toBe("public");
  });

  it("is readable while signed out — nothing about it is behind authentication", () => {
    for (const path of LEGAL) {
      expect(resolveAccess("anonymous", path), path).toEqual({ allow: true });
      expect(resolveProxyAccess(false, path), path).toEqual({ allow: true });
    }
  });

  it("is readable by a signed-in member, so the safety screens can link to the Guidelines", () => {
    for (const path of LEGAL) expect(resolveAccess("active", path), path).toEqual({ allow: true });
  });

  it("is readable part-way through onboarding, where the terms are being agreed to", () => {
    for (const path of LEGAL) expect(resolveAccess("onboarding", path), path).toEqual({ allow: true });
  });

  it("leaves the two strictest rules exactly as they were", () => {
    // An unconfirmed email account still reaches exactly one screen...
    for (const path of LEGAL) expect(resolveAccess("unverified", path), path).toEqual({ allow: false, redirectTo: "/auth/verify-email" });
    // ...and a staff account still goes to the portal, member domain or not.
    for (const path of LEGAL) expect(resolveAccess("staff", path), path).toEqual({ allow: false, redirectTo: "/admin" });
  });

  it("matches the legal paths exactly, so a member route with a similar name cannot become public", () => {
    expect(classifyRoute("/terms-and-matches")).toBe("app");
    expect(classifyRoute("/privacy-settings")).toBe("app");
    expect(classifyRoute("/community")).toBe("app");
    expect(classifyRoute("/community-guidelines/extra")).toBe("app");
  });
});
