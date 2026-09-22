/**
 * "Does this account hold staff authority right now?" — the one lookup (docs/ARCHITECTURE.md §22.2).
 *
 * A deliberately tiny leaf module with no imports beyond the database type, so the authorisation gate in
 * src/server/admin/authz.ts can use it without dragging in the staff domain's email templates and audit writer.
 *
 * It exists because `claimedByUserId` is NOT unique on its own: a revoked grant keeps the account it used to
 * belong to, so history survives a revocation the same way it survives for the address. One account can therefore
 * have one live grant and any number of revoked ones, and `findUnique({ claimedByUserId })` would be a coin toss
 * between them. Asking for the ACTIVE row by name is both correct and the honest description of the question.
 */
import type { DbLike } from "@/lib/db";

export interface LiveStaffGrant {
  id: string;
  role: string;
  claimedAt: Date | null;
}

/** The account's ACTIVE grant, or null. Null is the answer for pending, revoked and never-was alike. */
export async function findLiveStaffGrant(db: DbLike, userId: string): Promise<LiveStaffGrant | null> {
  return db.staffGrant.findFirst({
    where: { claimedByUserId: userId, status: "ACTIVE" },
    select: { id: true, role: true, claimedAt: true },
  });
}

/**
 * Any grant bound to this account that is not revoked — live or still pending. Used inside the claim transaction
 * to refuse a second binding with a sentence rather than a unique-constraint crash.
 */
export async function findOpenStaffGrant(db: DbLike, userId: string): Promise<{ id: string; status: string } | null> {
  return db.staffGrant.findFirst({
    where: { claimedByUserId: userId, status: { not: "REVOKED" } },
    select: { id: true, status: true },
  });
}
