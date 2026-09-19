/**
 * Request-scoped authentication state for server components, layouts and actions.
 * Every protected operation derives the acting user from here; nothing accepts a userId from the client.
 */
import { cache } from "react";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { readSessionToken } from "@/lib/session-cookie";
import type { Actor } from "@/server/actor";
import { ROUTES, type AuthKind } from "./route-access";
import { authKindForUser, resolveSession, type SessionUser } from "./session";

export type AuthState =
  | { kind: "anonymous" }
  /** An email account holding a session but no member functionality until its address is confirmed (§4.1b). */
  | { kind: "unverified"; user: SessionUser; sessionId: string }
  | { kind: "onboarding"; user: SessionUser; sessionId: string }
  | { kind: "active"; user: SessionUser; sessionId: string }
  /**
   * An operational account (docs/ARCHITECTURE.md §22.1). It is never "active": every member guard below refuses
   * it, and every member route sends it to the admin portal instead of into the dating app.
   */
  | { kind: "staff"; user: SessionUser; sessionId: string };

/** Where a staff account goes whenever it touches the member side of the app. */
export const STAFF_HOME = "/admin";

/** Memoised per request. Suspended/banned/deleted accounts behave as anonymous (the session is dropped). */
export const getAuthState = cache(async (): Promise<AuthState> => {
  const token = await readSessionToken();
  if (!token) return { kind: "anonymous" };
  const db = getDb();
  // The sliding session refresh runs after the response is sent (Next `after`), never on the request's critical path.
  const resolved = await resolveSession(db, token, new Date(), (work) => after(() => work().catch((e) => console.warn("[auth] session refresh failed:", e instanceof Error ? e.message : e))));
  if (!resolved) return { kind: "anonymous" };
  const { user } = resolved;
  const kind = authKindForUser(user);
  if (kind === "blocked") {
    await db.session.deleteMany({ where: { id: resolved.sessionId } });
    return { kind: "anonymous" };
  }
  return { kind, user, sessionId: resolved.sessionId };
});

export function authKind(state: AuthState): AuthKind {
  return state.kind;
}

/** For app routes: anonymous → welcome, staff → the admin portal, unverified → the verification screen, incomplete → onboarding. */
export async function requireActiveUser(): Promise<Actor & { user: SessionUser }> {
  const state = await getAuthState();
  if (state.kind === "anonymous") redirect(ROUTES.welcome);
  if (state.kind === "staff") redirect(STAFF_HOME);
  if (state.kind === "unverified") redirect(ROUTES.verifyEmail);
  if (state.kind === "onboarding") redirect(ROUTES.onboarding);
  return { userId: state.user.id, user: state.user };
}

/**
 * For onboarding routes: anonymous → welcome; staff → the admin portal; unverified → verify first; completed →
 * Discover. A staff account must never start dating onboarding, which is why it is turned away here rather than
 * allowed to fall through to the "incomplete" case (§13).
 */
export async function requireOnboardingUser(): Promise<Actor & { user: SessionUser }> {
  const state = await getAuthState();
  if (state.kind === "anonymous") redirect(ROUTES.welcome);
  if (state.kind === "staff") redirect(STAFF_HOME);
  if (state.kind === "unverified") redirect(ROUTES.verifyEmail);
  if (state.kind === "active") redirect(ROUTES.home);
  return { userId: state.user.id, user: state.user };
}

/** For auth routes: an authenticated user never sees the login again. Staff land in the portal, not the app. */
export async function redirectIfAuthenticated(): Promise<void> {
  const state = await getAuthState();
  if (state.kind === "staff") redirect(STAFF_HOME);
  if (state.kind === "active") redirect(ROUTES.home);
  if (state.kind === "unverified") redirect(ROUTES.verifyEmail);
  if (state.kind === "onboarding") redirect(ROUTES.onboarding);
}

/**
 * The guard every member server action goes through (docs/ARCHITECTURE.md §4.1b, §22.4). It is the single choke
 * point that keeps two different kinds of account out of the dating domain:
 *
 *  - an email account that has not confirmed its address (`unverified`), and
 *  - an operational account (`staff`), which has no dating identity at all.
 *
 * Because it refuses here rather than in the UI, hiding a button is never what protects anything: discovery,
 * likes, matches, messages, Likes You, Boost, Community, Plus and profile editing are all closed to staff by this
 * one check, even if a request is crafted by hand.
 */
export async function requireMember(): Promise<Actor & { user: SessionUser }> {
  const state = await getAuthState();
  if (state.kind === "anonymous") throw new Error("Not authenticated");
  if (state.kind === "staff") throw new StaffCannotUseMemberFeaturesError();
  if (state.kind === "unverified") throw new EmailVerificationRequiredError();
  return { userId: state.user.id, user: state.user };
}

/**
 * The staff counterpart, for operational server actions. It establishes only that the caller is a live staff
 * account; which staff account may do what is decided by the permission check in src/server/admin/authz.ts, which
 * calls this first.
 */
export async function requireStaffActor(): Promise<Actor & { user: SessionUser; sessionId: string }> {
  const state = await getAuthState();
  if (state.kind !== "staff") throw new StaffAccessRequiredError();
  return { userId: state.user.id, user: state.user, sessionId: state.sessionId };
}

/** Thrown by `requireMember` for an email account that has not confirmed its address. */
export class EmailVerificationRequiredError extends Error {
  constructor() {
    super("Confirm your email address to use Mellocrush.");
    this.name = "EmailVerificationRequiredError";
  }
}

/** Thrown by `requireMember` when an operational account reaches a dating action (§16). */
export class StaffCannotUseMemberFeaturesError extends Error {
  constructor() {
    super("Staff accounts don't use Mellocrush as members.");
    this.name = "StaffCannotUseMemberFeaturesError";
  }
}

/** Thrown by `requireStaffActor` for anything that is not a live staff account. */
export class StaffAccessRequiredError extends Error {
  constructor() {
    super("Not authorized");
    this.name = "StaffAccessRequiredError";
  }
}

/**
 * The only actor the verification screen's own actions accept: a signed-in email account that is still unconfirmed.
 * Nothing else in the app uses it, so no member functionality can be reached through this door.
 */
export async function requireUnverifiedActor(): Promise<Actor & { sessionId: string }> {
  const state = await getAuthState();
  if (state.kind !== "unverified") throw new Error("Not awaiting email verification");
  return { userId: state.user.id, sessionId: state.sessionId };
}
