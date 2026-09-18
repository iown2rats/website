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
  | { kind: "active"; user: SessionUser; sessionId: string };

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

/** For app routes: anonymous → welcome, unverified → the verification screen, incomplete → onboarding. */
export async function requireActiveUser(): Promise<Actor & { user: SessionUser }> {
  const state = await getAuthState();
  if (state.kind === "anonymous") redirect(ROUTES.welcome);
  if (state.kind === "unverified") redirect(ROUTES.verifyEmail);
  if (state.kind === "onboarding") redirect(ROUTES.onboarding);
  return { userId: state.user.id, user: state.user };
}

/** For onboarding routes: anonymous → welcome; unverified → verify first; completed → Discover. */
export async function requireOnboardingUser(): Promise<Actor & { user: SessionUser }> {
  const state = await getAuthState();
  if (state.kind === "anonymous") redirect(ROUTES.welcome);
  if (state.kind === "unverified") redirect(ROUTES.verifyEmail);
  if (state.kind === "active") redirect(ROUTES.home);
  return { userId: state.user.id, user: state.user };
}

/** For auth routes: an authenticated user never sees the login again. */
export async function redirectIfAuthenticated(): Promise<void> {
  const state = await getAuthState();
  if (state.kind === "active") redirect(ROUTES.home);
  if (state.kind === "unverified") redirect(ROUTES.verifyEmail);
  if (state.kind === "onboarding") redirect(ROUTES.onboarding);
}

/**
 * For server actions: any signed-in user whose account is usable. This is the single choke point every member
 * action goes through, so refusing "unverified" here is what actually keeps an unconfirmed email account out of
 * discovery, likes, matches, messages, Likes You, Boost, Community and Plus — not the hidden UI (§4.1b).
 */
export async function requireActor(): Promise<Actor & { user: SessionUser }> {
  const state = await getAuthState();
  if (state.kind === "anonymous") throw new Error("Not authenticated");
  if (state.kind === "unverified") throw new EmailVerificationRequiredError();
  return { userId: state.user.id, user: state.user };
}

/** Thrown by `requireActor` for an email account that has not confirmed its address. */
export class EmailVerificationRequiredError extends Error {
  constructor() {
    super("Confirm your email address to use Mellocrush.");
    this.name = "EmailVerificationRequiredError";
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
