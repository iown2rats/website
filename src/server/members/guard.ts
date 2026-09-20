/**
 * The member-domain guard at the *domain* layer (docs/ARCHITECTURE.md §22.4).
 *
 * `requireMember()` in src/server/auth/current-user.ts already refuses an operational account at every server
 * action and route handler, and that is the boundary the app actually relies on. This is the second line: the
 * domain functions that create dating state take an `Actor` from their caller, and a caller is only as careful as
 * whoever wrote it. Asserting here means a future action, script or job that forgets the request-level guard still
 * cannot make a staff account like, match, message, comment or boost.
 *
 * One indexed primary-key lookup, and only on the write paths that create dating state — never on reads, which
 * would put a query on every list in the app for no benefit.
 */
import { getDb, type DbLike } from "@/lib/db";
import { InvalidStateError } from "@/lib/errors";

export class StaffInMemberDomainError extends InvalidStateError {
  constructor() {
    super("Staff accounts don't use Mellocrush as members.");
    this.name = "StaffInMemberDomainError";
  }
}

/** Throws unless `userId` is a dating MEMBER. An unknown account is treated as not a member. */
export async function assertMemberAccount(db: DbLike, userId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { accountType: true } });
  if (!user || user.accountType !== "MEMBER") throw new StaffInMemberDomainError();
}

/** Non-throwing variant for callers that already branch on a boolean. */
export async function isMemberAccount(db: DbLike | undefined, userId: string): Promise<boolean> {
  const user = await (db ?? getDb()).user.findUnique({ where: { id: userId }, select: { accountType: true } });
  return user?.accountType === "MEMBER";
}
