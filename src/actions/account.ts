"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { isDomainError } from "@/lib/errors";
import { clearPendingIdentity, readPendingIdentity } from "@/lib/oauth-cookie";
import { clearSessionCookie, setSessionCookie } from "@/lib/session-cookie";
import { getStorageProvider } from "@/lib/storage";
import { getAuthState } from "@/server/auth/current-user";
import { createFreshAccountForIdentity } from "@/server/auth/identity";
import { ROUTES } from "@/server/auth/route-access";
import { createSession } from "@/server/auth/session";
import { deleteAccount } from "@/server/users/deletion";

/*
 * Destructive account actions (docs/ARCHITECTURE.md §4.4). Deleting requires that THIS session completed a fresh
 * Google re-authentication moments ago (/auth/google/start?purpose=reauth); the server consumes that mark. An old
 * application session on its own is never enough.
 */

export type DeletionConfirmResult = { ok: true } | { ok: false; code: "REAUTH_REQUIRED" | "ERROR"; message: string };

export async function confirmAccountDeletion(): Promise<DeletionConfirmResult> {
  let deleted = false;
  try {
    const state = await getAuthState();
    if (state.kind === "anonymous") return { ok: false, code: "ERROR", message: "Your session ended. Sign in again." };
    const r = await deleteAccount({ userId: state.user.id }, { sessionId: state.sessionId }, { storage: getStorageProvider(), db: getDb() });
    if (!r.ok) return { ok: false, code: "REAUTH_REQUIRED", message: "Your confirmation has expired. Sign in again to delete your account." };
    deleted = true;
  } catch (e) {
    if (isDomainError(e)) return { ok: false, code: "ERROR", message: e.message };
    console.error("[account] deletion failed", e);
    return { ok: false, code: "ERROR", message: "Mellocrush couldn't delete your account right now. Try again." };
  }
  if (deleted) {
    await clearSessionCookie();
    redirect(ROUTES.welcome);
  }
  return { ok: true };
}

/**
 * The explicit choice on /auth/deleted: the Google or Telegram account that just signed in belongs to a deleted Mellocrush
 * account; start a brand-new one. Nothing from the deleted profile comes back.
 */
export async function startFreshAccount(): Promise<{ ok: false; message: string } | never> {
  const pending = await readPendingIdentity();
  if (!pending) return { ok: false, message: "That sign-in has expired. Sign in again to continue." };
  const db = getDb();
  const now = new Date();
  try {
    const { userId } = await createFreshAccountForIdentity(db, pending.provider, { subject: pending.subject, email: pending.email, name: pending.name, username: pending.username, emailVerified: pending.email !== null }, now);
    const session = await createSession(db, userId, {}, now);
    await clearPendingIdentity();
    await setSessionCookie(session.token, session.expiresAt);
  } catch (e) {
    if (isDomainError(e)) return { ok: false, message: e.message };
    console.error("[account] fresh account failed", e);
    return { ok: false, message: "Mellocrush couldn't create your account right now. Try again." };
  }
  redirect(ROUTES.onboarding);
}
