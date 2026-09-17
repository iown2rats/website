/**
 * Request-scoped authentication state for server components, layouts and actions.
 * Every protected operation derives the acting user from here; nothing accepts a userId from the client.
 */
import { cache } from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { readSessionToken } from "@/lib/session-cookie";
import type { Actor } from "@/server/actor";
import { ROUTES, type AuthKind } from "./route-access";
import { authKindForUser, resolveSession, type SessionUser } from "./session";

export type AuthState =
  | { kind: "anonymous" }
  | { kind: "onboarding"; user: SessionUser; sessionId: string }
  | { kind: "active"; user: SessionUser; sessionId: string };

/** Memoised per request. Suspended/banned/deleted accounts behave as anonymous (the session is dropped). */
export const getAuthState = cache(async (): Promise<AuthState> => {
  const token = await readSessionToken();
  if (!token) return { kind: "anonymous" };
  const db = getDb();
  const resolved = await resolveSession(db, token);
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

/** For app routes: redirects anonymous users to the welcome screen (Continue with Google) and incomplete users to onboarding. */
export async function requireActiveUser(): Promise<Actor & { user: SessionUser }> {
  const state = await getAuthState();
  if (state.kind === "anonymous") redirect(ROUTES.welcome);
  if (state.kind === "onboarding") redirect(ROUTES.onboarding);
  return { userId: state.user.id, user: state.user };
}

/** For onboarding routes: anonymous → welcome; completed → Discover. */
export async function requireOnboardingUser(): Promise<Actor & { user: SessionUser }> {
  const state = await getAuthState();
  if (state.kind === "anonymous") redirect(ROUTES.welcome);
  if (state.kind === "active") redirect(ROUTES.home);
  return { userId: state.user.id, user: state.user };
}

/** For auth routes: an authenticated user never sees the login again. */
export async function redirectIfAuthenticated(): Promise<void> {
  const state = await getAuthState();
  if (state.kind === "active") redirect(ROUTES.home);
  if (state.kind === "onboarding") redirect(ROUTES.onboarding);
}

/** For server actions: any signed-in user (onboarding or active). Throws instead of redirecting. */
export async function requireActor(): Promise<Actor & { user: SessionUser }> {
  const state = await getAuthState();
  if (state.kind === "anonymous") throw new Error("Not authenticated");
  return { userId: state.user.id, user: state.user };
}
