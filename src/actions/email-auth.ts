"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "@/lib/session-cookie";
import { changeEmailSchema, forgotPasswordSchema, loginSchema, passwordReauthSchema, registerSchema, resetPasswordSchema } from "@/lib/validation/auth";
import { getAuthState, requireUnverifiedActor } from "@/server/auth/current-user";
import { emailAuthAvailable } from "@/server/auth/email-availability";
import { changeUnverifiedEmail, reauthenticateWithPassword, registerWithEmail, requestPasswordReset, resendVerification, resetPassword, signInWithEmail } from "@/server/auth/email-identity";
import { ROUTES } from "@/server/auth/route-access";
import { createSession, ipPrefix, revokeAllSessions, revokeSession } from "@/server/auth/session";

/*
 * Email + password server actions (docs/ARCHITECTURE.md §4.1b). Every one of them re-checks the feature gate, so a
 * deployment without the migration or without an email provider cannot be driven through a form; and every one
 * derives the acting user from the session, never from the form.
 */

export interface AuthFormResult {
  ok: boolean;
  message?: string;
  field?: "email" | "password" | "confirmPassword";
  /** Registration and resend echo the address so the next screen can name it. */
  email?: string;
}

const UNAVAILABLE: AuthFormResult = { ok: false, message: "Email sign-in isn't available right now. Use Google or Telegram." };
const INVALID_INPUT: AuthFormResult = { ok: false, message: "Check the details and try again." };

/** A coarse client key for rate limiting: the /24 or /48 prefix of the caller's address, never the full address. */
async function clientKey(): Promise<string | null> {
  const forwarded = (await headers()).get("x-forwarded-for");
  return ipPrefix(forwarded ? forwarded.split(",")[0]!.trim() : null);
}

async function currentSessionMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return { ip: forwarded ? forwarded.split(",")[0]!.trim() : null, userAgent: h.get("user-agent") };
}

export async function registerWithEmailAction(raw: { email: string; password: string; confirmPassword: string }): Promise<AuthFormResult> {
  const db = getDb();
  if (!(await emailAuthAvailable(db))) return UNAVAILABLE;
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? INVALID_INPUT.message, field: issue?.path[0] as AuthFormResult["field"] };
  }
  const result = await registerWithEmail({ email: parsed.data.email, password: parsed.data.password }, { db, clientKey: await clientKey() });
  if (!result.ok) return { ok: false, message: result.message, field: result.field };

  // A brand-new account is signed in immediately so it lands on "Verify your email" rather than a dead end. It holds
  // a session and nothing else: every member route and action refuses an unconfirmed address (§4.1b).
  if (result.value.userId) {
    const session = await createSession(db, result.value.userId, await currentSessionMeta());
    await setSessionCookie(session.token, session.expiresAt);
    redirect(ROUTES.verifyEmail);
  }
  // An address that already has an account gets the identical answer; the difference went to the inbox.
  return { ok: true, email: result.value.email };
}

export async function signInWithEmailAction(raw: { email: string; password: string }): Promise<AuthFormResult> {
  const db = getDb();
  if (!(await emailAuthAvailable(db))) return UNAVAILABLE;
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That email and password don't match an account." };
  const result = await signInWithEmail(parsed.data, { db, clientKey: await clientKey() });
  if (!result.ok) return { ok: false, message: result.message, field: result.code === "INVALID_CREDENTIALS" ? "password" : undefined };
  const session = await createSession(db, result.value.userId, await currentSessionMeta());
  await setSessionCookie(session.token, session.expiresAt);
  redirect(result.value.destination === "verify-email" ? ROUTES.verifyEmail : result.value.destination === "app" ? ROUTES.home : ROUTES.onboarding);
}

export async function resendVerificationAction(): Promise<AuthFormResult> {
  const db = getDb();
  if (!(await emailAuthAvailable(db))) return UNAVAILABLE;
  const actor = await requireUnverifiedActor();
  const result = await resendVerification(actor.userId, { db, clientKey: await clientKey() });
  return result.ok ? { ok: true, message: "Sent. Check your inbox, and your spam folder.", email: result.value.email } : { ok: false, message: result.message };
}

export async function changeUnverifiedEmailAction(raw: { email: string }): Promise<AuthFormResult> {
  const db = getDb();
  if (!(await emailAuthAvailable(db))) return UNAVAILABLE;
  const actor = await requireUnverifiedActor();
  const parsed = changeEmailSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? INVALID_INPUT.message, field: "email" };
  const result = await changeUnverifiedEmail(actor.userId, parsed.data.email, { db, clientKey: await clientKey() });
  return result.ok ? { ok: true, message: "Sent. Check the new address.", email: result.value.email } : { ok: false, message: result.message, field: result.field };
}

export async function forgotPasswordAction(raw: { email: string }): Promise<AuthFormResult> {
  const db = getDb();
  if (!(await emailAuthAvailable(db))) return UNAVAILABLE;
  const parsed = forgotPasswordSchema.safeParse(raw);
  // Even an unparseable address answers the same way: anything else would separate "no such account" from "invalid".
  if (parsed.success) await requestPasswordReset(parsed.data.email, { db, clientKey: await clientKey() });
  return { ok: true };
}

export async function resetPasswordAction(raw: { token: string; password: string; confirmPassword: string }): Promise<AuthFormResult> {
  const db = getDb();
  if (!(await emailAuthAvailable(db))) return UNAVAILABLE;
  const parsed = resetPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? INVALID_INPUT.message, field: issue?.path[0] as AuthFormResult["field"] };
  }
  const result = await resetPassword({ token: parsed.data.token, password: parsed.data.password }, { db, clientKey: await clientKey() });
  if (!result.ok) return { ok: false, message: result.message, field: result.field };
  // Every session was revoked, including this browser's: the new password is used to sign in again.
  const token = await readSessionToken();
  if (token) await revokeSession(db, token);
  await clearSessionCookie();
  return { ok: true };
}

/** The email account's equivalent of re-signing in with Google or Telegram before a destructive action (§4.4). */
export async function confirmPasswordAction(raw: { password: string }): Promise<AuthFormResult> {
  const db = getDb();
  const state = await getAuthState();
  if (state.kind !== "active" && state.kind !== "onboarding") return { ok: false, message: "Your session ended. Sign in again." };
  const parsed = passwordReauthSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "That password isn't right.", field: "password" };
  const result = await reauthenticateWithPassword({ sessionId: state.sessionId, userId: state.user.id, password: parsed.data.password }, { db });
  return result.ok ? { ok: true } : { ok: false, message: result.message, field: "password" };
}

/** Sign out from the verification screen. */
export async function signOutAction(): Promise<void> {
  const token = await readSessionToken();
  if (token) await revokeSession(getDb(), token);
  await clearSessionCookie();
  redirect(ROUTES.welcome);
}

/** Used by tests and by the reset flow: end every session for a user. */
export async function revokeEverySession(userId: string): Promise<number> {
  return revokeAllSessions(getDb(), userId);
}
