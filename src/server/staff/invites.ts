/**
 * Hashed, single-use, expiring invitation links for a StaffGrant (docs/ARCHITECTURE.md §22.2).
 *
 * Deliberately a near-copy of src/server/auth/auth-tokens.ts, and it reuses that module's primitives rather than
 * inventing its own: same 32 random bytes, same SHA-256 at rest, same conditional-update consume so two clicks on
 * one link race safely. It exists as a separate table only because an invitation is issued before its holder has
 * an AuthIdentity to hang a token off — a pending grant is an address and nothing else.
 *
 * The raw token leaves this module exactly once, in the return value, to be placed in the email. It is never
 * stored, logged, audited or shown in the admin UI.
 */
import { timingSafeEqual } from "node:crypto";
import type { DbLike } from "@/lib/db";
import { generateToken, hashToken } from "@/server/auth/auth-tokens";
import { STAFF_RULES } from "./rules";

export interface IssuedInvite {
  /** The raw token — put it in the email and nowhere else. */
  token: string;
  expiresAt: Date;
}

/**
 * Issues an invitation for a grant, consuming that grant's outstanding invitations first, so only the newest link
 * ever works. Resending is therefore also an invalidation of the previous link.
 */
export async function issueStaffInvite(db: DbLike, input: { grantId: string; createdById: string | null }, now: Date = new Date()): Promise<IssuedInvite> {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + STAFF_RULES.inviteTtlMs);
  await db.staffInvite.updateMany({ where: { grantId: input.grantId, consumedAt: null }, data: { consumedAt: now } });
  await db.staffInvite.create({
    data: { grantId: input.grantId, tokenHash: hashToken(token), expiresAt, createdById: input.createdById, createdAt: now },
  });
  return { token, expiresAt };
}

export interface InviteView {
  grantId: string;
  email: string;
  role: string;
  status: string;
  claimedByUserId: string | null;
}

/**
 * Looks a token up without consuming it, so the set-password page can show whose invitation it is before the
 * visitor commits. Returns null for anything unusable, with no distinction between wrong, expired and spent.
 */
export async function peekStaffInvite(db: DbLike, token: string, now: Date = new Date()): Promise<InviteView | null> {
  const row = await findUsableInvite(db, token, now);
  if (!row) return null;
  return {
    grantId: row.grant.id,
    email: row.grant.email,
    role: row.grant.role,
    status: row.grant.status,
    claimedByUserId: row.grant.claimedByUserId,
  };
}

interface UsableInvite {
  id: string;
  grant: { id: string; email: string; role: string; status: string; claimedByUserId: string | null };
}

async function findUsableInvite(db: DbLike, token: string, now: Date): Promise<UsableInvite | null> {
  if (typeof token !== "string" || token.length < 16 || token.length > 200) return null;
  const tokenHash = hashToken(token);
  const row = await db.staffInvite.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      tokenHash: true,
      expiresAt: true,
      consumedAt: true,
      grant: { select: { id: true, email: true, role: true, status: true, claimedByUserId: true } },
    },
  });
  if (!row) return null;
  // The lookup is by a unique hash, but compare the bytes too so a future non-unique lookup stays constant-time.
  const stored = Buffer.from(row.tokenHash);
  const given = Buffer.from(tokenHash);
  if (stored.length !== given.length || !timingSafeEqual(stored, given)) return null;
  if (row.consumedAt !== null || row.expiresAt.getTime() <= now.getTime()) return null;
  // A cancelled or revoked grant kills its outstanding links even before they expire.
  if (row.grant.status !== "PENDING" && row.grant.status !== "ACTIVE") return null;
  return { id: row.id, grant: row.grant };
}

/**
 * Consumes an invitation if it is real, unspent, unexpired and its grant is still live. Returns null otherwise —
 * the caller must not tell the visitor which of those it was.
 */
export async function consumeStaffInvite(db: DbLike, token: string, now: Date = new Date()): Promise<InviteView | null> {
  const row = await findUsableInvite(db, token, now);
  if (!row) return null;
  // Conditional update: whoever flips consumedAt from null wins, so a double click consumes once.
  const claimed = await db.staffInvite.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: now } });
  if (claimed.count !== 1) return null;
  return {
    grantId: row.grant.id,
    email: row.grant.email,
    role: row.grant.role,
    status: row.grant.status,
    claimedByUserId: row.grant.claimedByUserId,
  };
}

/** Housekeeping: drop invitations that expired a while ago. Consumed rows are kept until they expire. */
export async function pruneStaffInvites(db: DbLike, now: Date = new Date()): Promise<number> {
  const result = await db.staffInvite.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * 24 * 3_600_000) } } });
  return result.count;
}
