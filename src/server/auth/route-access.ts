/**
 * Route access rules (docs/ARCHITECTURE.md §4.2; Phase 5 §21). Pure and unit-tested; used by proxy.ts
 * (cookie presence only) and by the server layouts (full session state).
 */
export type AuthKind = "anonymous" | "onboarding" | "active";

export type RouteGroup = "public" | "auth" | "onboarding" | "app" | "system";

export const ROUTES = {
  welcome: "/",
  phone: "/auth/phone",
  verify: "/auth/verify",
  logout: "/auth/logout",
  onboarding: "/onboarding",
  home: "/discover",
} as const;

export function classifyRoute(pathname: string): RouteGroup {
  if (pathname === "/" || pathname.startsWith("/legal")) return "public";
  if (pathname.startsWith("/auth")) return "auth";
  if (pathname.startsWith("/onboarding")) return "onboarding";
  if (pathname.startsWith("/_next") || pathname.startsWith("/api") || pathname.startsWith("/dev") || /\.[a-z0-9]+$/i.test(pathname)) return "system";
  return "app";
}

export type AccessDecision = { allow: true } | { allow: false; redirectTo: string };

/**
 * Decides whether `kind` may see `pathname`. Each state redirects to exactly one destination group,
 * and that destination always allows the state, so loops are impossible:
 *   anonymous  → app/onboarding blocked → /auth/phone
 *   onboarding → app/auth/public blocked → /onboarding (logout is always allowed)
 *   active     → auth/onboarding/public blocked → /discover
 */
export function resolveAccess(kind: AuthKind, pathname: string): AccessDecision {
  const group = classifyRoute(pathname);
  if (group === "system") return { allow: true };
  if (pathname === ROUTES.logout) return { allow: true };
  switch (kind) {
    case "anonymous":
      return group === "public" || group === "auth" ? { allow: true } : { allow: false, redirectTo: ROUTES.phone };
    case "onboarding":
      return group === "onboarding" ? { allow: true } : { allow: false, redirectTo: ROUTES.onboarding };
    case "active":
      return group === "app" ? { allow: true } : { allow: false, redirectTo: ROUTES.home };
  }
}

/**
 * For the proxy, which can only see whether a session cookie is present: anonymous requests to
 * onboarding/app routes are redirected immediately; everything else defers to the layouts.
 */
export function resolveProxyAccess(hasCookie: boolean, pathname: string): AccessDecision {
  if (hasCookie) return { allow: true };
  return resolveAccess("anonymous", pathname);
}

/** Only same-origin absolute paths are ever used as post-login destinations (no open redirects). */
export function safeInternalPath(candidate: string | null | undefined, fallback: string): string {
  if (!candidate) return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\") || /[\r\n]/.test(candidate)) return fallback;
  return candidate;
}
