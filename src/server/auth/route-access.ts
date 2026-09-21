/**
 * Route access rules (docs/ARCHITECTURE.md §4.2; Phase 5 §21). Pure and unit-tested; used by proxy.ts
 * (cookie presence only) and by the server layouts (full session state).
 */
export type AuthKind = "anonymous" | "onboarding" | "active" | "unverified" | "staff";

export type RouteGroup = "public" | "legal" | "auth" | "onboarding" | "app" | "system" | "staff";

export const ROUTES = {
  welcome: "/",
  /** Starts Google sign-in (route handler). `?purpose=reauth` re-authenticates the current session instead. */
  signIn: "/auth/google/start",
  callback: "/auth/google/callback",
  /** The same two endpoints for Telegram (docs/ARCHITECTURE.md §4.1). */
  telegramSignIn: "/auth/telegram/start",
  telegramCallback: "/auth/telegram/callback",
  deleted: "/auth/deleted",
  authError: "/auth/error",
  /** Email + password (docs/ARCHITECTURE.md §4.1b). */
  register: "/auth/register",
  verifyEmail: "/auth/verify-email",
  verifyEmailToken: "/auth/verify",
  forgotPassword: "/auth/forgot-password",
  resetPassword: "/auth/reset-password",
  /** Where the Android shell redeems a one-time handoff code for a session (docs/ARCHITECTURE.md §4.1c). */
  handoff: "/auth/handoff",
  logout: "/auth/logout",
  onboarding: "/onboarding",
  home: "/discover",
  /** The admin portal (docs/ARCHITECTURE.md §22.1). Staff land here; members never do. */
  staffHome: "/admin",
  staffSignIn: "/admin/login",
  /** The public legal documents (docs/ARCHITECTURE.md §27). Root-level: these addresses go on listings and forms. */
  terms: "/terms",
  privacy: "/privacy",
  communityGuidelines: "/community-guidelines",
} as const;

/**
 * The legal documents, readable by everyone. Kept as a set rather than a prefix so that adding a member route
 * called, say, /terms-of-a-match could never accidentally become public.
 */
const LEGAL_PATHS: ReadonlySet<string> = new Set([ROUTES.terms, ROUTES.privacy, ROUTES.communityGuidelines]);

export function classifyRoute(pathname: string): RouteGroup {
  // Its own group, because a public document is not the same thing as the signed-out welcome screen: a member who
  // is already signed in must still be able to read the terms they agreed to, and the safety screens link to the
  // Community Guidelines from inside the app.
  if (LEGAL_PATHS.has(pathname)) return "legal";
  if (pathname === "/" || pathname.startsWith("/legal")) return "public";
  if (pathname.startsWith("/auth")) return "auth";
  if (pathname.startsWith("/onboarding")) return "onboarding";
  // The admin portal is its own group with its own sign-in. It must be reachable while signed out, or the portal
  // login could never be shown; the pages themselves establish who is really staff.
  if (pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/admin-setup")) return "staff";
  if (pathname.startsWith("/_next") || pathname.startsWith("/api") || pathname.startsWith("/dev") || /\.[a-z0-9]+$/i.test(pathname)) return "system";
  return "app";
}

export type AccessDecision = { allow: true } | { allow: false; redirectTo: string };

/** `/auth/<provider>/start` for whichever provider a button belongs to. */
export function signInRoute(provider: "google" | "telegram"): string {
  return provider === "telegram" ? ROUTES.telegramSignIn : ROUTES.signIn;
}

/**
 * The provider flow endpoints decide for themselves (sign-in for anonymous users, re-authentication for signed-in
 * ones), and the error screen must be visible to a signed-in user whose re-authentication failed.
 */
function isAuthFlowEndpoint(pathname: string): boolean {
  return (
    pathname === ROUTES.signIn ||
    pathname === ROUTES.callback ||
    pathname === ROUTES.telegramSignIn ||
    pathname === ROUTES.telegramCallback ||
    pathname === ROUTES.verifyEmailToken ||
    // Reachable in every state for the same reason as the callbacks: the WebView may still be carrying a stale or
    // half-finished session when the app comes back from the browser, and the endpoint itself decides.
    pathname === ROUTES.handoff ||
    pathname === ROUTES.logout ||
    pathname === ROUTES.authError
  );
}

/**
 * Decides whether `kind` may see `pathname`. Each state redirects to exactly one destination group,
 * and that destination always allows the state, so loops are impossible:
 *   anonymous  → app/onboarding blocked → / (welcome, "Continue with Google")
 *   onboarding → app/auth/public blocked → /onboarding
 *   active     → auth/onboarding/public blocked → /discover
 *   staff      → everything outside the portal blocked → /admin
 * The sign-in start/callback, logout and error endpoints are allowed for every state, and the whole `staff` group
 * is allowed for every state because the portal's own pages decide who may see them (§22.1).
 */
export function resolveAccess(kind: AuthKind, pathname: string): AccessDecision {
  const group = classifyRoute(pathname);
  if (group === "system") return { allow: true };
  if (isAuthFlowEndpoint(pathname)) return { allow: true };
  // Checked before the portal allowance below, because it is the strictest rule in the app: an email account that
  // has not confirmed its address reaches exactly one screen. Member routes, onboarding, the admin portal and
  // every server action are refused regardless of what any UI offers.
  if (kind === "unverified") {
    return pathname === ROUTES.verifyEmail ? { allow: true } : { allow: false, redirectTo: ROUTES.verifyEmail };
  }
  // The portal decides for itself who may see what: anonymous visitors need the sign-in screen, a member needs the
  // same 404 a missing page gives, and a staff account needs the dashboard. None of that is expressible as one
  // redirect, and guessing here would either hide the login or leak that the portal exists.
  if (group === "staff") return { allow: true };
  // An operational account has no member app to be sent to. Everything outside the portal goes to the portal.
  if (kind === "staff") return { allow: false, redirectTo: ROUTES.staffHome };
  // A member who is signed in, or halfway through onboarding, must be able to read the documents they are being
  // asked to agree to, and the Community Guidelines are linked from the in-app safety surfaces. This adds a group;
  // it does not loosen any existing one. The two strictest rules are deliberately left above and untouched: an
  // unconfirmed email account still reaches exactly one screen, and a staff account still goes to the portal.
  if (group === "legal") return { allow: true };
  switch (kind) {
    case "anonymous":
      return group === "public" || group === "auth" ? { allow: true } : { allow: false, redirectTo: ROUTES.welcome };
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
