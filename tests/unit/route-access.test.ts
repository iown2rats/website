import { describe, expect, it } from "vitest";
import { classifyRoute, resolveAccess, resolveProxyAccess, safeInternalPath } from "@/server/auth/route-access";
import { authKindForUser } from "@/server/auth/session";

describe("route access rules", () => {
  it("classifies routes", () => {
    expect(classifyRoute("/")).toBe("public");
    expect(classifyRoute("/auth/phone")).toBe("auth");
    expect(classifyRoute("/onboarding/name")).toBe("onboarding");
    expect(classifyRoute("/discover")).toBe("app");
    expect(classifyRoute("/chats/abc")).toBe("app");
    expect(classifyRoute("/_next/static/x.js")).toBe("system");
    expect(classifyRoute("/api/photos")).toBe("system");
  });

  it("unauthenticated users are redirected away from the app and onboarding, but may see welcome and auth", () => {
    expect(resolveAccess("anonymous", "/discover")).toEqual({ allow: false, redirectTo: "/auth/phone" });
    expect(resolveAccess("anonymous", "/onboarding/photos")).toEqual({ allow: false, redirectTo: "/auth/phone" });
    expect(resolveAccess("anonymous", "/")).toEqual({ allow: true });
    expect(resolveAccess("anonymous", "/auth/verify")).toEqual({ allow: true });
  });

  it("incomplete users are sent to onboarding from app and auth routes", () => {
    expect(resolveAccess("onboarding", "/discover")).toEqual({ allow: false, redirectTo: "/onboarding" });
    expect(resolveAccess("onboarding", "/auth/phone")).toEqual({ allow: false, redirectTo: "/onboarding" });
    expect(resolveAccess("onboarding", "/onboarding/name")).toEqual({ allow: true });
    expect(resolveAccess("onboarding", "/auth/logout")).toEqual({ allow: true });
  });

  it("complete users can use the app and never return to auth or onboarding", () => {
    expect(resolveAccess("active", "/discover")).toEqual({ allow: true });
    expect(resolveAccess("active", "/chats")).toEqual({ allow: true });
    expect(resolveAccess("active", "/auth/phone")).toEqual({ allow: false, redirectTo: "/discover" });
    expect(resolveAccess("active", "/onboarding/name")).toEqual({ allow: false, redirectTo: "/discover" });
    expect(resolveAccess("active", "/")).toEqual({ allow: false, redirectTo: "/discover" });
  });

  it("never loops: every redirect target is allowed for the same state", () => {
    for (const kind of ["anonymous", "onboarding", "active"] as const) {
      for (const path of ["/", "/auth/phone", "/onboarding/name", "/discover", "/profile"]) {
        const d = resolveAccess(kind, path);
        if (!d.allow) expect(resolveAccess(kind, d.redirectTo)).toEqual({ allow: true });
      }
    }
  });

  it("the proxy only acts on missing cookies", () => {
    expect(resolveProxyAccess(false, "/discover")).toEqual({ allow: false, redirectTo: "/auth/phone" });
    expect(resolveProxyAccess(true, "/discover")).toEqual({ allow: true });
    expect(resolveProxyAccess(true, "/auth/phone")).toEqual({ allow: true }); // layouts decide
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
