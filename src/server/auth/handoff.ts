/**
 * Moving a finished OAuth sign-in from the system browser into the Android app (docs/ARCHITECTURE.md §4.1c).
 *
 * WHY THIS EXISTS. Google refuses OAuth inside an embedded WebView (`disallowed_useragent`), and Telegram is no
 * friendlier, so the Android app runs the flow in a Chrome Custom Tab. A Custom Tab has its own cookie jar: a
 * session cookie set there is invisible to the app's WebView, which is the thing that actually needs it. This
 * module is the bridge across that gap.
 *
 * WHAT CROSSES THE GAP. A 256-bit random code, in one deep link, once, for two minutes — and nothing else. In
 * particular:
 *
 *   - No session token is ever put in a URL, and none is stored here. The session does not exist yet when the
 *     code is issued; it is created at redemption, inside the WebView, so it carries the WebView's own user agent
 *     and address instead of the browser's.
 *   - The code is stored as a SHA-256 digest, so a database reader cannot redeem one.
 *   - The code alone is not enough. Android custom schemes can be claimed by any installed app, so a hostile app
 *     could receive the deep link. Before opening the browser the real app generates a random verifier, keeps it,
 *     and sends only SHA-256 of it; redemption requires the verifier itself. An interceptor holds a code it
 *     cannot use. This is PKCE's argument, applied to the second hop.
 *   - Redemption is a conditional update on `consumedAt IS NULL`, so two racing redemptions cannot both win.
 *
 * None of this replaces the OAuth protections. State, nonce, PKCE and the provider check all still run in
 * flow.ts exactly as they do for the website; this only decides where the finished result is delivered.
 */
import { createHash, randomBytes } from "node:crypto";
import type { DbLike } from "@/lib/db";
import { bytesEqual } from "@/lib/hashing";
import type { OidcSignInProvider } from "./oidc";

/** Two minutes is a deep link crossing between two apps on the same device, not a session. */
export const HANDOFF_TTL_MS = 2 * 60_000;
/** Bytes of entropy in the code and in the app's verifier. Base64url of 32 bytes is 43 characters. */
const SECRET_BYTES = 32;
const ENCODED_LENGTH = 43;

/** `Uint8Array.from`, not `new Uint8Array`: Prisma's `Bytes` wants a plain ArrayBuffer behind it (as in lib/hashing.ts). */
const sha256 = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(createHash("sha256").update(value).digest());

/** Untrusted input → a base64url secret of exactly the length we issue, or null. */
export function parseHandoffSecret(value: string | null | undefined): string | null {
  if (!value || value.length !== ENCODED_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return value;
}

export function createVerifierChallenge(verifier: string): string {
  return Buffer.from(sha256(verifier)).toString("base64url");
}

export interface IssuedHandoff {
  /** The raw code. Returned once, travels in one deep link, and is never stored or logged. */
  code: string;
}

/**
 * Issues a code for a user whose OAuth sign-in has just succeeded in the browser.
 *
 * `challenge` is the base64url SHA-256 the app sent when it started the flow, carried through the signed
 * pending-auth cookie so it cannot be swapped by anything on the wire.
 */
export async function issueHandoff(
  db: DbLike,
  input: { userId: string; landing: string; provider: OidcSignInProvider; challenge: string },
  now: Date = new Date(),
): Promise<IssuedHandoff> {
  const code = randomBytes(SECRET_BYTES).toString("base64url");
  await db.authHandoff.create({
    data: {
      codeHash: sha256(code),
      challengeHash: Uint8Array.from(Buffer.from(input.challenge, "base64url")),
      userId: input.userId,
      landing: input.landing,
      provider: input.provider,
      expiresAt: new Date(now.getTime() + HANDOFF_TTL_MS),
      createdAt: now,
    },
    select: { id: true },
  });
  return { code };
}

export interface ConsumedHandoff {
  userId: string;
  landing: string;
}

/**
 * Redeems a code, or returns null. Null for every failure and with no detail: an expired code, a replayed code, a
 * code that never existed and a code presented with the wrong verifier are indistinguishable to the caller, which
 * is the same posture the rest of the auth surface takes.
 */
export async function consumeHandoff(db: DbLike, rawCode: string, rawVerifier: string, now: Date = new Date()): Promise<ConsumedHandoff | null> {
  const code = parseHandoffSecret(rawCode);
  const verifier = parseHandoffSecret(rawVerifier);
  if (!code || !verifier) return null;

  const row = await db.authHandoff.findUnique({
    where: { codeHash: sha256(code) },
    select: { id: true, challengeHash: true, userId: true, landing: true, expiresAt: true, consumedAt: true },
  });
  if (!row || row.consumedAt || row.expiresAt <= now) return null;

  if (!bytesEqual(row.challengeHash, sha256(verifier))) return null;

  // The guard is in the WHERE clause, not in the branch above: two redemptions arriving together both pass the
  // read, and only the one that actually changes a row may continue.
  const claimed = await db.authHandoff.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: now } });
  if (claimed.count === 0) return null;

  return { userId: row.userId, landing: row.landing };
}

/** Housekeeping for expired and spent rows. Nothing depends on it; the checks above stand on their own. */
export async function purgeExpiredHandoffs(db: DbLike, now: Date = new Date()): Promise<number> {
  const { count } = await db.authHandoff.deleteMany({ where: { expiresAt: { lte: now } } });
  return count;
}
