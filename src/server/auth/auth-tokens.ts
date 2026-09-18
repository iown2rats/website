/**
 * Hashed, single-use, expiring tokens for email verification and password reset (docs/ARCHITECTURE.md §4.1b).
 *
 * The raw token is 32 random bytes and exists only in the email that was sent: the database stores its SHA-256, so
 * a leaked table cannot be replayed as a link. Issuing a token consumes the identity's outstanding tokens of the
 * same purpose, so only the newest link ever works. Consuming is a conditional UPDATE, so two clicks on the same
 * link race safely and exactly one wins.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DbLike } from "@/lib/db";

export type AuthTokenPurpose = "EMAIL_VERIFICATION" | "PASSWORD_RESET";

export const TOKEN_TTL_MS: Record<AuthTokenPurpose, number> = {
  EMAIL_VERIFICATION: 24 * 3_600_000,
  PASSWORD_RESET: 60 * 60_000,
};

/** 32 bytes, base64url: 256 bits of entropy, safe in a URL and unguessable. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(createHash("sha256").update(token).digest());
}

export interface IssuedToken {
  /** The raw token — put it in the email and nowhere else. */
  token: string;
  expiresAt: Date;
}

/**
 * Issues a token for an identity, invalidating that identity's outstanding tokens of the same purpose first.
 * `email` records which address an EMAIL_VERIFICATION token confirms, so a link sent to a previous address cannot
 * verify a new one.
 */
export async function issueAuthToken(db: DbLike, input: { identityId: string; purpose: AuthTokenPurpose; email?: string | null }, now: Date = new Date()): Promise<IssuedToken> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS[input.purpose]);
  await db.authToken.updateMany({ where: { identityId: input.identityId, purpose: input.purpose, consumedAt: null }, data: { consumedAt: now } });
  await db.authToken.create({
    data: { identityId: input.identityId, purpose: input.purpose, tokenHash: hashToken(token), expiresAt, email: input.email ?? null, createdAt: now },
  });
  return { token, expiresAt };
}

export interface ConsumedToken {
  identityId: string;
  /** The address an EMAIL_VERIFICATION token was issued for, when it carried one. */
  email: string | null;
}

/**
 * Consumes a token if it exists, matches the purpose, is unused and unexpired. Returns null otherwise — the caller
 * must not distinguish "wrong token" from "expired" or "already used" to the visitor beyond one generic message.
 */
export async function consumeAuthToken(db: DbLike, token: string, purpose: AuthTokenPurpose, now: Date = new Date()): Promise<ConsumedToken | null> {
  if (typeof token !== "string" || token.length < 16 || token.length > 200) return null;
  const tokenHash = hashToken(token);
  const row = await db.authToken.findUnique({ where: { tokenHash }, select: { id: true, identityId: true, purpose: true, expiresAt: true, consumedAt: true, email: true, tokenHash: true } });
  if (!row) return null;
  // The lookup is by a unique hash, but compare the bytes too so a future non-unique lookup stays constant-time.
  const stored = Buffer.from(row.tokenHash);
  const given = Buffer.from(tokenHash);
  if (stored.length !== given.length || !timingSafeEqual(stored, given)) return null;
  if (row.purpose !== purpose || row.consumedAt !== null || row.expiresAt.getTime() <= now.getTime()) return null;
  // Conditional update: whoever flips consumedAt from null wins, so a double click consumes once.
  const claimed = await db.authToken.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: now } });
  if (claimed.count !== 1) return null;
  return { identityId: row.identityId, email: row.email };
}

/** Housekeeping: drop tokens that expired a while ago. Consumed rows are kept until they expire as an audit trail. */
export async function pruneAuthTokens(db: DbLike, now: Date = new Date()): Promise<number> {
  const result = await db.authToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * 24 * 3_600_000) } } });
  return result.count;
}
