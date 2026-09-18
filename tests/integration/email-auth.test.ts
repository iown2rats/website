/**
 * Email + password sign-in (docs/ARCHITECTURE.md §4.1b): registration and its duplicate/enumeration behaviour,
 * password rules and hashing, sign-in, the unverified restriction and its server-side enforcement, verification
 * tokens (success, expiry, reuse, resend, rate limit), forgot-password enumeration protection, reset tokens,
 * password re-authentication, and proof that Google and Telegram are untouched by any of it.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConsoleEmailProvider } from "@/lib/email";
import { resetEnvCache } from "@/lib/env";
import { emailSchema, registerSchema } from "@/lib/validation/auth";
import { consumeAuthToken, issueAuthToken, TOKEN_TTL_MS } from "@/server/auth/auth-tokens";
import { databaseSupportsEmailAuth, resetEmailAvailabilityCache } from "@/server/auth/email-availability";
import {
  changeUnverifiedEmail,
  EMAIL_AUTH_RULES,
  getEmailVerificationState,
  reauthenticateWithPassword,
  registerWithEmail,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  signInWithEmail,
  verifyEmailToken,
} from "@/server/auth/email-identity";
import { signInWithIdentity } from "@/server/auth/identity";
import { hashPassword, needsRehash, validatePassword, verifyPassword } from "@/server/auth/password";
import { resolveAccess, ROUTES } from "@/server/auth/route-access";
import { authKindForUser, createSession, resolveSession } from "@/server/auth/session";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createIdentity, createUser, minutes } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-18T19:00:00Z");
const PASSWORD = "coral lagoon 42";
const OTHER_PASSWORD = "different anchor 91";

/** A fresh console provider per case, so `sent` is the emails that case produced. */
function mailbox() {
  return new ConsoleEmailProvider();
}
const linkIn = (text: string) => text.match(/https?:\/\/\S+\/auth\/(?:verify|reset-password)\?token=([\w-]+)/)?.[1] ?? null;

async function register(email: string, o: { password?: string; mail?: ConsoleEmailProvider; now?: Date; clientKey?: string | null } = {}) {
  const mail = o.mail ?? mailbox();
  const result = await registerWithEmail({ email, password: o.password ?? PASSWORD }, { db, email: mail, now: o.now ?? T0, clientKey: o.clientKey ?? null });
  return { result, mail, token: mail.sent.length ? linkIn(mail.sent[mail.sent.length - 1]!.text) : null };
}

beforeEach(() => resetDb(db));
afterEach(() => {
  resetEnvCache();
  resetEmailAvailabilityCache();
});
afterAll(() => disconnectDb());

describe("password rules and hashing", () => {
  it("accepts a long passphrase, rejects short, repeated, sequential and notorious passwords", () => {
    expect(validatePassword(PASSWORD)).toBeNull();
    expect(validatePassword("short")).toMatchObject({ code: "TOO_SHORT" });
    expect(validatePassword("aaaaaaaaaaaa")).toMatchObject({ code: "TOO_SIMPLE" });
    expect(validatePassword("1234567890123")).toMatchObject({ code: "TOO_SIMPLE" });
    expect(validatePassword("password123")).toMatchObject({ code: "COMMON" });
    expect(validatePassword("x".repeat(400))).toMatchObject({ code: "TOO_LONG" });
  });

  it("never stores the password: the verifier is salted, parameterised, unique per call and only matches the right password", async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).not.toBe(b); // per-hash salt
    expect(a).not.toContain(PASSWORD);
    expect(a.startsWith("scrypt$65536$8$1$")).toBe(true);
    expect((await verifyPassword(PASSWORD, a)).ok).toBe(true);
    expect((await verifyPassword(OTHER_PASSWORD, a)).ok).toBe(false);
    expect((await verifyPassword(PASSWORD, null)).ok).toBe(false);
    expect((await verifyPassword(PASSWORD, "not-a-verifier")).ok).toBe(false);
    // A verifier with weaker parameters still verifies, and asks to be upgraded on the next sign-in.
    const weak = `scrypt$16384$8$1$${a.split("$")[4]}$${a.split("$")[5]}`;
    expect(needsRehash(weak)).toBe(true);
    expect(needsRehash(a)).toBe(false);
    // Absurd parameters from a tampered row are refused rather than allocated against.
    expect((await verifyPassword(PASSWORD, "scrypt$999999999$8$1$AAAA$AAAA")).ok).toBe(false);
  });
});

describe("registration", () => {
  it("creates one UNVERIFIED account, stores only a verifier, and emails a link", async () => {
    const { result, mail, token } = await register("someone@example.com");
    expect(result.ok).toBe(true);
    const identity = await db.authIdentity.findUniqueOrThrow({ where: { provider_providerSubject: { provider: "EMAIL", providerSubject: "someone@example.com" } } });
    expect(identity).toMatchObject({ provider: "EMAIL", email: "someone@example.com", emailVerified: false });
    expect(identity.passwordHash).not.toBeNull();
    expect(identity.passwordHash).not.toContain(PASSWORD);
    const user = await db.user.findUniqueOrThrow({ where: { id: identity.userId }, include: { verification: true, privacy: true } });
    expect(user).toMatchObject({ status: "ONBOARDING", onboardingStage: "NAME" });
    expect(user.verification?.status).toBe("NONE");
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: "someone@example.com" });
    expect(mail.sent[0]!.subject).toMatch(/Confirm your email/);
    expect(token).toBeTruthy();
    // The raw token is never stored.
    const stored = await db.authToken.findFirstOrThrow({ where: { identityId: identity.id } });
    expect(Buffer.from(stored.tokenHash).toString("base64url")).not.toBe(token);
    expect(stored.purpose).toBe("EMAIL_VERIFICATION");
  });

  it("normalises and validates the address, and refuses a weak password before any account exists", async () => {
    expect(emailSchema.parse("  Someone@Example.COM ")).toBe("someone@example.com");
    for (const bad of ["not-an-email", "no@domain", "a b@example.com", "@example.com"]) {
      expect(emailSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(registerSchema.safeParse({ email: "a@b.co", password: PASSWORD, confirmPassword: "mismatch pass" }).success).toBe(false);
    const weak = await registerWithEmail({ email: "weak@example.com", password: "short" }, { db, email: mailbox(), now: T0 });
    expect(weak).toMatchObject({ ok: false, code: "WEAK_PASSWORD", field: "password" });
    expect(await db.user.count()).toBe(0);
  });

  it("a duplicate registration creates no second account and tells the caller nothing, while the address's owner is emailed", async () => {
    await register("taken@example.com");
    // Still unverified: the same link is simply sent again.
    const second = await register("taken@example.com", { password: OTHER_PASSWORD, now: at(T0, 1000) });
    expect(second.result).toMatchObject({ ok: true });
    expect(second.mail.sent[0]!.subject).toMatch(/Confirm your email/);
    expect(await db.user.count()).toBe(1);
    // The original password still works: a stranger's "registration" never overwrote it.
    expect((await signInWithEmail({ email: "taken@example.com", password: OTHER_PASSWORD }, { db, now: at(T0, 2000) })).ok).toBe(false);
    expect((await signInWithEmail({ email: "taken@example.com", password: PASSWORD }, { db, now: at(T0, 3000) })).ok).toBe(true);

    // Once verified, the duplicate attempt is answered identically but the email says an account already exists.
    const id = await db.authIdentity.findFirstOrThrow({ where: { email: "taken@example.com" } });
    await db.authIdentity.update({ where: { id: id.id }, data: { emailVerified: true } });
    const third = await register("taken@example.com", { now: at(T0, minutes(30)) });
    expect(third.result).toMatchObject({ ok: true });
    expect(third.mail.sent[0]!.subject).toMatch(/already have a Mellocrush account/i);
    expect(await db.user.count()).toBe(1);
  });

  it("rate-limits account creation per address and per client", async () => {
    for (let i = 0; i < EMAIL_AUTH_RULES.registrationsPerEmailHour; i += 1) {
      expect((await register("spam@example.com", { now: at(T0, i) })).result.ok).toBe(true);
    }
    expect((await register("spam@example.com", { now: at(T0, 99) })).result).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    const client = "203.0.113.0";
    for (let i = 0; i < EMAIL_AUTH_RULES.registrationsPerClientHour; i += 1) {
      await register(`bulk${i}@example.com`, { clientKey: client, now: at(T0, i) });
    }
    expect((await register("bulk-last@example.com", { clientKey: client, now: at(T0, 99) })).result).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });
});

describe("email verification", () => {
  it("verifies once server-side, and a reused or expired token never verifies", async () => {
    const { token } = await register("verify@example.com");
    const identityBefore = await db.authIdentity.findFirstOrThrow({ where: { email: "verify@example.com" } });
    expect(identityBefore.emailVerified).toBe(false);

    const ok = await verifyEmailToken(token!, { db, now: at(T0, minutes(5)) });
    expect(ok).toMatchObject({ ok: true });
    expect((await db.authIdentity.findUniqueOrThrow({ where: { id: identityBefore.id } })).emailVerified).toBe(true);

    // Single use.
    expect(await verifyEmailToken(token!, { db, now: at(T0, minutes(6)) })).toMatchObject({ ok: false, code: "INVALID_TOKEN" });
    // A token nobody issued.
    expect(await verifyEmailToken("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { db, now: at(T0, minutes(6)) })).toMatchObject({ ok: false, code: "INVALID_TOKEN" });

    // Expiry, on a fresh identity.
    const fresh = await register("expiry@example.com", { now: at(T0, minutes(10)) });
    const afterExpiry = at(T0, minutes(10) + TOKEN_TTL_MS.EMAIL_VERIFICATION + 1000);
    expect(await verifyEmailToken(fresh.token!, { db, now: afterExpiry })).toMatchObject({ ok: false, code: "INVALID_TOKEN" });
    expect((await db.authIdentity.findFirstOrThrow({ where: { email: "expiry@example.com" } })).emailVerified).toBe(false);
  });

  it("resends the link, invalidating the previous one, with a cooldown and an hourly ceiling", async () => {
    const { token: first } = await register("resend@example.com");
    const identity = await db.authIdentity.findFirstOrThrow({ where: { email: "resend@example.com" } });

    // The cooldown protects against a double tap.
    expect(await resendVerification(identity.userId, { db, email: mailbox(), now: at(T0, 1000) })).toMatchObject({ ok: false, code: "RATE_LIMITED" });

    const mail = mailbox();
    const again = await resendVerification(identity.userId, { db, email: mail, now: at(T0, minutes(2)) });
    expect(again).toMatchObject({ ok: true });
    const second = linkIn(mail.sent[0]!.text);
    expect(second).not.toBe(first);
    // Only the newest link works.
    expect(await verifyEmailToken(first!, { db, now: at(T0, minutes(3)) })).toMatchObject({ ok: false });
    expect(await verifyEmailToken(second!, { db, now: at(T0, minutes(3)) })).toMatchObject({ ok: true });

    // Hourly ceiling on a second identity.
    const other = await register("ceiling@example.com", { now: at(T0, minutes(10)) });
    expect(other.result.ok).toBe(true);
    const otherIdentity = await db.authIdentity.findFirstOrThrow({ where: { email: "ceiling@example.com" } });
    let limited = false;
    for (let i = 1; i <= EMAIL_AUTH_RULES.resendsPerHour + 1; i += 1) {
      const r = await resendVerification(otherIdentity.userId, { db, email: mailbox(), now: at(T0, minutes(10 + i * 2)) });
      if (!r.ok && r.code === "RATE_LIMITED") limited = true;
    }
    expect(limited).toBe(true);
  });

  it("changing the address before verification moves the identity and retires the old link", async () => {
    const { token: oldToken } = await register("old@example.com");
    const identity = await db.authIdentity.findFirstOrThrow({ where: { email: "old@example.com" } });
    const mail = mailbox();
    const changed = await changeUnverifiedEmail(identity.userId, "new@example.com", { db, email: mail, now: at(T0, minutes(2)) });
    expect(changed).toMatchObject({ ok: true });
    expect(mail.sent[0]).toMatchObject({ to: "new@example.com" });
    const moved = await db.authIdentity.findUniqueOrThrow({ where: { id: identity.id } });
    expect(moved).toMatchObject({ email: "new@example.com", providerSubject: "new@example.com", emailVerified: false });
    // The link sent to the previous address cannot confirm the new one.
    expect(await verifyEmailToken(oldToken!, { db, now: at(T0, minutes(3)) })).toMatchObject({ ok: false, code: "INVALID_TOKEN" });
    expect(await verifyEmailToken(linkIn(mail.sent[0]!.text)!, { db, now: at(T0, minutes(3)) })).toMatchObject({ ok: true });
    // An address that already belongs to someone else is refused without saying so.
    await register("occupied@example.com", { now: at(T0, minutes(4)) });
    const second = await register("mover@example.com", { now: at(T0, minutes(5)) });
    expect(second.result.ok).toBe(true);
    const mover = await db.authIdentity.findFirstOrThrow({ where: { email: "mover@example.com" } });
    expect(await changeUnverifiedEmail(mover.userId, "occupied@example.com", { db, email: mailbox(), now: at(T0, minutes(6)) })).toMatchObject({ ok: false, code: "EMAIL_TAKEN" });
  });
});

describe("sign-in and the unverified restriction", () => {
  it("signs in with the right password and refuses the wrong one with one generic message", async () => {
    await register("login@example.com");
    const identity = await db.authIdentity.findFirstOrThrow({ where: { email: "login@example.com" } });
    await db.authIdentity.update({ where: { id: identity.id }, data: { emailVerified: true } });

    const good = await signInWithEmail({ email: "login@example.com", password: PASSWORD }, { db, now: at(T0, minutes(1)) });
    expect(good).toMatchObject({ ok: true });
    expect(good.ok && good.value).toMatchObject({ userId: identity.userId, emailVerified: true, destination: "onboarding" });

    const bad = await signInWithEmail({ email: "login@example.com", password: OTHER_PASSWORD }, { db, now: at(T0, minutes(2)) });
    const unknown = await signInWithEmail({ email: "nobody@example.com", password: PASSWORD }, { db, now: at(T0, minutes(2)) });
    expect(bad).toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });
    // The same words for a wrong password and an address that has no account: no enumeration.
    expect(bad.ok === false && bad.message).toBe(unknown.ok === false && unknown.message);
  });

  it("an unverified account signs in but is sent to the verification screen, and is refused everywhere else", async () => {
    await register("pending@example.com");
    const identity = await db.authIdentity.findFirstOrThrow({ where: { email: "pending@example.com" } });
    const signIn = await signInWithEmail({ email: "pending@example.com", password: PASSWORD }, { db, now: at(T0, minutes(1)) });
    expect(signIn.ok && signIn.value.destination).toBe("verify-email");

    // The session resolves as "unverified", which is what every route and server action reads.
    const session = await createSession(db, identity.userId, {}, at(T0, minutes(1)));
    const resolved = await resolveSession(db, session.token, at(T0, minutes(2)));
    expect(resolved?.user.emailVerificationPending).toBe(true);
    expect(authKindForUser(resolved!.user)).toBe("unverified");

    // Every member surface is refused; only the verification screen and the flow endpoints are allowed.
    for (const path of ["/discover", "/likes", "/chats", "/chats/abc", "/community", "/profile", "/settings", "/settings/membership", "/onboarding", "/onboarding/name", "/admin", "/admin/users", "/"]) {
      expect(resolveAccess("unverified", path), path).toEqual({ allow: false, redirectTo: ROUTES.verifyEmail });
    }
    expect(resolveAccess("unverified", ROUTES.verifyEmail)).toEqual({ allow: true });
    expect(resolveAccess("unverified", ROUTES.logout)).toEqual({ allow: true });
    expect(resolveAccess("unverified", ROUTES.verifyEmailToken)).toEqual({ allow: true });

    // After verification the same session is an ordinary onboarding account again.
    await db.authIdentity.update({ where: { id: identity.id }, data: { emailVerified: true } });
    const after = await resolveSession(db, session.token, at(T0, minutes(3)));
    expect(after?.user.emailVerificationPending).toBe(false);
    expect(authKindForUser(after!.user)).toBe("onboarding");
    expect(await getEmailVerificationState(db, identity.userId)).toEqual({ email: "pending@example.com", verified: true });
  });

  it("rate-limits sign-in attempts per address", async () => {
    await register("brute@example.com");
    let limited = false;
    for (let i = 0; i <= EMAIL_AUTH_RULES.loginAttemptsPerEmail + 1; i += 1) {
      const r = await signInWithEmail({ email: "brute@example.com", password: "wrong wrong wrong" }, { db, now: at(T0, minutes(1)) });
      if (!r.ok && r.code === "RATE_LIMITED") limited = true;
    }
    expect(limited).toBe(true);
  });

  it("a suspended or banned email account gets no session", async () => {
    await register("suspended@example.com");
    const identity = await db.authIdentity.findFirstOrThrow({ where: { email: "suspended@example.com" } });
    await db.authIdentity.update({ where: { id: identity.id }, data: { emailVerified: true } });
    for (const status of ["SUSPENDED", "BANNED"] as const) {
      await db.user.update({ where: { id: identity.userId }, data: { status } });
      expect(await signInWithEmail({ email: "suspended@example.com", password: PASSWORD }, { db, now: at(T0, minutes(2)) })).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    }
  });
});

describe("forgot password and reset", () => {
  it("answers identically for an address with an account, without one, and when rate-limited", async () => {
    await register("has@example.com");
    const withAccount = mailbox();
    const withoutAccount = mailbox();
    expect(await requestPasswordReset("has@example.com", { db, email: withAccount, now: at(T0, minutes(1)) })).toEqual({ ok: true });
    expect(await requestPasswordReset("none@example.com", { db, email: withoutAccount, now: at(T0, minutes(1)) })).toEqual({ ok: true });
    expect(withAccount.sent).toHaveLength(1);
    expect(withoutAccount.sent).toHaveLength(0); // the difference is only in the inbox
    for (let i = 0; i < EMAIL_AUTH_RULES.resetRequestsPerEmailHour + 2; i += 1) {
      expect(await requestPasswordReset("has@example.com", { db, email: mailbox(), now: at(T0, minutes(2)) })).toEqual({ ok: true });
    }
  });

  it("resets the password once, ends every session, and refuses an expired or reused link", async () => {
    await register("reset@example.com");
    const identity = await db.authIdentity.findFirstOrThrow({ where: { email: "reset@example.com" } });
    await db.authIdentity.update({ where: { id: identity.id }, data: { emailVerified: true } });
    await createSession(db, identity.userId, {}, at(T0, minutes(1)));
    await createSession(db, identity.userId, {}, at(T0, minutes(1)));
    expect(await db.session.count({ where: { userId: identity.userId } })).toBe(2);

    const mail = mailbox();
    await requestPasswordReset("reset@example.com", { db, email: mail, now: at(T0, minutes(2)) });
    const token = linkIn(mail.sent[0]!.text);
    expect(mail.sent[0]!.subject).toMatch(/Reset your password/);

    expect(await resetPassword({ token: token!, password: "short" }, { db, now: at(T0, minutes(3)) })).toMatchObject({ ok: false, code: "WEAK_PASSWORD" });
    expect(await resetPassword({ token: token!, password: OTHER_PASSWORD }, { db, now: at(T0, minutes(3)) })).toMatchObject({ ok: true });

    // Sessions are gone, the old password is dead and the new one works.
    expect(await db.session.count({ where: { userId: identity.userId } })).toBe(0);
    expect(await signInWithEmail({ email: "reset@example.com", password: PASSWORD }, { db, now: at(T0, minutes(4)) })).toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });
    expect(await signInWithEmail({ email: "reset@example.com", password: OTHER_PASSWORD }, { db, now: at(T0, minutes(5)) })).toMatchObject({ ok: true });
    // Reuse.
    expect(await resetPassword({ token: token!, password: "another good one" }, { db, now: at(T0, minutes(6)) })).toMatchObject({ ok: false, code: "INVALID_TOKEN" });

    // Expiry.
    const mail2 = mailbox();
    await requestPasswordReset("reset@example.com", { db, email: mail2, now: at(T0, minutes(20)) });
    const stale = linkIn(mail2.sent[0]!.text);
    const afterExpiry = at(T0, minutes(20) + TOKEN_TTL_MS.PASSWORD_RESET + 1000);
    expect(await resetPassword({ token: stale!, password: "yet another one" }, { db, now: afterExpiry })).toMatchObject({ ok: false, code: "INVALID_TOKEN" });
  });

  it("issuing a reset token retires the identity's previous one", async () => {
    await register("rotate@example.com");
    const identity = await db.authIdentity.findFirstOrThrow({ where: { email: "rotate@example.com" } });
    const first = await issueAuthToken(db, { identityId: identity.id, purpose: "PASSWORD_RESET" }, at(T0, minutes(1)));
    const second = await issueAuthToken(db, { identityId: identity.id, purpose: "PASSWORD_RESET" }, at(T0, minutes(2)));
    expect(await consumeAuthToken(db, first.token, "PASSWORD_RESET", at(T0, minutes(3)))).toBeNull();
    expect(await consumeAuthToken(db, second.token, "PASSWORD_RESET", at(T0, minutes(3)))).toMatchObject({ identityId: identity.id });
    // A token is only valid for its own purpose.
    const verify = await issueAuthToken(db, { identityId: identity.id, purpose: "EMAIL_VERIFICATION" }, at(T0, minutes(4)));
    expect(await consumeAuthToken(db, verify.token, "PASSWORD_RESET", at(T0, minutes(5)))).toBeNull();
  });
});

describe("re-authentication for a sensitive action", () => {
  it("an email account confirms with its password; a wrong password never marks the session", async () => {
    await register("reauth@example.com");
    const identity = await db.authIdentity.findFirstOrThrow({ where: { email: "reauth@example.com" } });
    await db.authIdentity.update({ where: { id: identity.id }, data: { emailVerified: true } });
    const session = await createSession(db, identity.userId, {}, at(T0, minutes(1)));

    expect(await reauthenticateWithPassword({ sessionId: session.sessionId, userId: identity.userId, password: OTHER_PASSWORD }, { db, now: at(T0, minutes(2)) })).toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });
    expect((await db.session.findUniqueOrThrow({ where: { id: session.sessionId } })).reauthenticatedAt).toBeNull();

    expect(await reauthenticateWithPassword({ sessionId: session.sessionId, userId: identity.userId, password: PASSWORD }, { db, now: at(T0, minutes(3)) })).toMatchObject({ ok: true });
    expect((await db.session.findUniqueOrThrow({ where: { id: session.sessionId } })).reauthenticatedAt).not.toBeNull();

    // A Google account has no password to confirm with.
    const googleUser = await createUser(db, { now: T0 });
    await createIdentity(db, googleUser.userId);
    const googleSession = await createSession(db, googleUser.userId, {}, at(T0, minutes(4)));
    expect(await reauthenticateWithPassword({ sessionId: googleSession.sessionId, userId: googleUser.userId, password: PASSWORD }, { db, now: at(T0, minutes(5)) })).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });

  it("rate-limits password confirmations per session", async () => {
    await register("reauth-limit@example.com");
    const identity = await db.authIdentity.findFirstOrThrow({ where: { email: "reauth-limit@example.com" } });
    const session = await createSession(db, identity.userId, {}, at(T0, minutes(1)));
    let limited = false;
    for (let i = 0; i <= EMAIL_AUTH_RULES.reauthAttempts + 1; i += 1) {
      const r = await reauthenticateWithPassword({ sessionId: session.sessionId, userId: identity.userId, password: "wrong one here" }, { db, now: at(T0, minutes(2)) });
      if (!r.ok && r.code === "RATE_LIMITED") limited = true;
    }
    expect(limited).toBe(true);
  });
});

describe("the other providers are unaffected", () => {
  it("Google and Telegram accounts never enter the verification flow and are never merged with a matching email", async () => {
    // A Google account whose address is exactly an email account's address.
    const shared = "same@example.com";
    await register(shared);
    const google = await signInWithIdentity(db, "google", { subject: "google-sub-same", email: shared, emailVerified: true, name: "Same Person", username: null, authTime: null, issuedAt: T0 }, at(T0, minutes(1)));
    expect(google.kind).toBe("signed-in");
    const emailIdentity = await db.authIdentity.findFirstOrThrow({ where: { provider: "EMAIL", email: shared } });
    expect(google.kind === "signed-in" && google.userId).not.toBe(emailIdentity.userId);
    expect(await db.user.count()).toBe(2);
    expect(await db.authIdentity.count({ where: { email: shared } })).toBe(2);

    // The Google session is "active"/"onboarding" as before — never held back by the email account's state.
    const googleUserId = google.kind === "signed-in" ? google.userId : "";
    const googleSession = await createSession(db, googleUserId, {}, at(T0, minutes(2)));
    const resolvedGoogle = await resolveSession(db, googleSession.token, at(T0, minutes(3)));
    expect(resolvedGoogle?.user.emailVerificationPending).toBe(false);
    expect(authKindForUser(resolvedGoogle!.user)).toBe("onboarding");

    // A Telegram account with no email at all behaves exactly as before.
    const telegram = await signInWithIdentity(db, "telegram", { subject: "900001", email: null, emailVerified: false, name: "Hassan", username: "hassan", authTime: null, issuedAt: T0 }, at(T0, minutes(4)));
    expect(telegram).toMatchObject({ kind: "signed-in", destination: "onboarding" });
    const tgUserId = telegram.kind === "signed-in" ? telegram.userId : "";
    const tgSession = await createSession(db, tgUserId, {}, at(T0, minutes(5)));
    const resolvedTg = await resolveSession(db, tgSession.token, at(T0, minutes(6)));
    expect(resolvedTg?.user.emailVerificationPending).toBe(false);
    expect(authKindForUser(resolvedTg!.user)).toBe("onboarding");
    expect(await getEmailVerificationState(db, tgUserId)).toBeNull();

    // Neither provider can be signed into with a password, and neither owns the email identity's password.
    expect(await signInWithEmail({ email: shared, password: PASSWORD }, { db, now: at(T0, minutes(7)) })).toMatchObject({ ok: true });
    const signedIn = await signInWithEmail({ email: shared, password: PASSWORD }, { db, now: at(T0, minutes(8)) });
    expect(signedIn.ok && signedIn.value.userId).toBe(emailIdentity.userId);
  });

  it("an existing Google-only account keeps a fully usable session: the new flow never applies to it", async () => {
    const user = await createUser(db, { now: T0 });
    await createIdentity(db, user.userId, { email: "existing@gmail.com" });
    await db.user.update({ where: { id: user.userId }, data: { status: "ACTIVE", onboardingCompletedAt: T0 } });
    const session = await createSession(db, user.userId, {}, at(T0, minutes(1)));
    const resolved = await resolveSession(db, session.token, at(T0, minutes(2)));
    expect(resolved?.user.emailVerificationPending).toBe(false);
    expect(authKindForUser(resolved!.user)).toBe("active");
    expect(resolveAccess("active", "/discover")).toEqual({ allow: true });
  });
});

describe("feature gate", () => {
  it("reports the database ready only when the EMAIL enum value and the AuthToken table both exist", async () => {
    resetEmailAvailabilityCache();
    expect(await databaseSupportsEmailAuth(db)).toBe(true);
    resetEmailAvailabilityCache();
    const without = { $queryRaw: async () => [] } as unknown as typeof db;
    expect(await databaseSupportsEmailAuth(without, 1_000)).toBe(false);
    expect(await databaseSupportsEmailAuth(db, 30_000)).toBe(false); // cached while negative
    expect(await databaseSupportsEmailAuth(db, 61_001)).toBe(true); // re-checked after a minute
    resetEmailAvailabilityCache();
    const broken = { $queryRaw: async () => { throw new Error("connection refused"); } } as unknown as typeof db;
    expect(await databaseSupportsEmailAuth(broken, 1_000)).toBe(false);
    resetEmailAvailabilityCache();
  });
});
