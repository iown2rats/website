"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { isDomainError } from "@/lib/errors";
import { AdminAccessError, requireStaff } from "@/server/admin/authz";
import { clearSessionCookie, readSessionToken, setSessionCookie } from "@/lib/session-cookie";
import { createSession, ipPrefix, revokeSession } from "@/server/auth/session";
import { ROUTES } from "@/server/auth/route-access";
import { requestStaffPasswordReset, resetStaffPassword, sendStaffInviteEmail, signInStaff } from "@/server/staff/auth";
import { claimStaffInvite } from "@/server/staff/claim";
import { cancelStaffInvite, changeStaffRole, createStaffGrant, resendStaffInvite, revokeStaffGrant } from "@/server/staff/grants";
import type { StaffRole } from "@/server/staff/rules";

/*
 * Admin portal server actions (docs/ARCHITECTURE.md §22.2).
 *
 * Every one of them derives the acting account from the session and the database — nothing about authorisation
 * arrives from the client — and the three unauthenticated ones (sign in, forgot password, set password) answer
 * identically whatever the address is, so none of them can be used to discover who is staff. Raw tokens appear
 * only as arguments here and in the email that carries them; none is ever returned to a caller or logged.
 */

export type StaffResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | {
      ok: false;
      message: string;
      field?: "email" | "password" | "reason" | "role";
      /** Seconds until a rate-limited form may be submitted again. The form waits; it never retries on its own. */
      retryAfterSeconds?: number;
    };

/** Whole seconds until `retryAt`, floored at 1, so a cooldown never renders as "0s". */
function cooldown(retryAt: Date | undefined, now: Date = new Date()): number | undefined {
  if (!retryAt) return undefined;
  return Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000));
}

/**
 * The unauthenticated portal actions do not get to crash silently.
 *
 * `claimStaffInvite` and friends throw on a database fault, and an uncaught throw in a server action reaches the
 * client as a rejected promise that the form's `.catch()` turns into nothing at all: no message, no spinner, no
 * clue — so the person clicks again, and again, until the rate limiter finally says something. That is precisely
 * how one broken index turned into twenty identical failures and a "Too many attempts" (docs/ARCHITECTURE.md
 * §22.10). The fault code goes to the server log and, deliberately, into the sentence the visitor reads, because
 * "tell an administrator it said P2002" is a thousand times more useful than "that didn't go through".
 */
function portalFailure(where: string, e: unknown): { ok: false; message: string } {
  const code =
    typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string"
      ? (e as { code: string }).code
      : e instanceof Error
        ? e.name
        : "UNKNOWN";
  console.error(`[staff] ${where} failed`, { code, message: e instanceof Error ? e.message : String(e) });
  return { ok: false, message: `Something went wrong at our end (${code}). Nothing was changed. Try again, and tell an administrator if it keeps happening.` };
}

function failure(e: unknown): { ok: false; message: string } {
  if (e instanceof AdminAccessError) return { ok: false, message: "Not authorized" };
  if (isDomainError(e)) return { ok: false, message: e.message };
  console.error("[staff] action failed", e);
  return { ok: false, message: "That didn't go through. Try again." };
}

/** Same-origin check in addition to the SameSite cookie, matching the member auth actions. */
async function assertSameOrigin(): Promise<boolean> {
  const site = (await headers()).get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

async function clientKey(): Promise<string | null> {
  const h = await headers();
  return ipPrefix(h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null);
}

async function sessionMeta() {
  const h = await headers();
  return { userAgent: h.get("user-agent"), ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null };
}

// ───────────────────────────── Portal authentication ─────────────────────────────

export async function staffSignInAction(raw: { email: string; password: string }): Promise<StaffResult> {
  if (!(await assertSameOrigin())) return { ok: false, message: "That didn't go through. Try again." };
  const db = getDb();
  // `redirect()` throws by design, so it happens after the try block rather than inside it.
  try {
    const result = await signInStaff({ email: String(raw?.email ?? ""), password: String(raw?.password ?? "") }, { db, clientKey: await clientKey() });
    if (!result.ok) {
      return { ok: false, message: result.message, field: result.code === "INVALID_CREDENTIALS" ? "password" : undefined, retryAfterSeconds: cooldown(result.retryAt) };
    }
    const session = await createSession(db, result.value.userId, await sessionMeta());
    await setSessionCookie(session.token, session.expiresAt);
  } catch (e) {
    return portalFailure("sign-in", e);
  }
  redirect(ROUTES.staffHome);
}

/** Always reports the same thing, so the portal never confirms whether an address is staff. */
export async function staffForgotPasswordAction(raw: { email: string }): Promise<StaffResult> {
  if (!(await assertSameOrigin())) return { ok: false, message: "That didn't go through. Try again." };
  try {
    await requestStaffPasswordReset(String(raw?.email ?? ""), { db: getDb(), clientKey: await clientKey() });
  } catch (e) {
    return portalFailure("forgot-password", e);
  }
  return { ok: true };
}

export async function staffResetPasswordAction(raw: { token: string; password: string }): Promise<StaffResult> {
  if (!(await assertSameOrigin())) return { ok: false, message: "That didn't go through. Try again." };
  try {
    const result = await resetStaffPassword({ token: String(raw?.token ?? ""), password: String(raw?.password ?? "") }, { db: getDb(), clientKey: await clientKey() });
    if (!result.ok) {
      return { ok: false, message: result.message, field: result.code === "WEAK_PASSWORD" ? "password" : undefined, retryAfterSeconds: cooldown(result.retryAt) };
    }
  } catch (e) {
    return portalFailure("reset-password", e);
  }
  return { ok: true };
}

/** Claiming an invitation, or setting the first password on an existing staff account. */
export async function staffSetPasswordAction(raw: { token: string; password: string }): Promise<StaffResult> {
  if (!(await assertSameOrigin())) return { ok: false, message: "That didn't go through. Try again." };
  const db = getDb();
  try {
    const result = await claimStaffInvite({ token: String(raw?.token ?? ""), password: String(raw?.password ?? "") }, { db, clientKey: await clientKey() });
    if (!result.ok) {
      return { ok: false, message: result.message, field: result.code === "WEAK_PASSWORD" ? "password" : undefined, retryAfterSeconds: cooldown(result.retryAt) };
    }
    const session = await createSession(db, result.userId, await sessionMeta());
    await setSessionCookie(session.token, session.expiresAt);
  } catch (e) {
    return portalFailure("set-password", e);
  }
  redirect(ROUTES.staffHome);
}

export async function staffSignOutAction(): Promise<void> {
  const token = await readSessionToken();
  if (token) await revokeSession(getDb(), token);
  await clearSessionCookie();
  redirect(ROUTES.staffSignIn);
}

// ───────────────────────────── Staff management ─────────────────────────────

export async function staffAddAction(input: { email: string; role: StaffRole; reason: string }): Promise<StaffResult<{ email: string }>> {
  try {
    const admin = await requireStaff("users.role");
    const grant = await createStaffGrant(admin, { email: String(input?.email ?? ""), role: input?.role, reason: String(input?.reason ?? "") }, { db: getDb() });
    await sendStaffInviteEmail(grant.email, grant.token, grant.expiresAt, { setup: false });
    revalidatePath("/admin/staff");
    return { ok: true, data: { email: grant.email } };
  } catch (e) {
    return failure(e);
  }
}

export async function staffResendInviteAction(grantId: string): Promise<StaffResult<{ email: string }>> {
  try {
    const admin = await requireStaff("users.role");
    const grant = await resendStaffInvite(admin, String(grantId), { db: getDb() });
    await sendStaffInviteEmail(grant.email, grant.token, grant.expiresAt, { setup: false });
    revalidatePath("/admin/staff");
    return { ok: true, data: { email: grant.email } };
  } catch (e) {
    return failure(e);
  }
}

export async function staffCancelInviteAction(grantId: string): Promise<StaffResult> {
  try {
    const admin = await requireStaff("users.role");
    await cancelStaffInvite(admin, String(grantId), { db: getDb() });
    revalidatePath("/admin/staff");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function staffChangeRoleAction(grantId: string, input: { role: StaffRole; reason: string }): Promise<StaffResult<{ role: StaffRole }>> {
  try {
    const admin = await requireStaff("users.role");
    const r = await changeStaffRole(admin, String(grantId), { role: input?.role, reason: String(input?.reason ?? "") }, { db: getDb() });
    revalidatePath("/admin/staff");
    return { ok: true, data: { role: r.role } };
  } catch (e) {
    return failure(e);
  }
}

export async function staffRevokeAction(grantId: string, input: { reason: string }): Promise<StaffResult> {
  try {
    const admin = await requireStaff("users.role");
    await revokeStaffGrant(admin, String(grantId), { reason: String(input?.reason ?? "") }, { db: getDb() });
    revalidatePath("/admin/staff");
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
