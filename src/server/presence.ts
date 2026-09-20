/**
 * "Is this member using the app right now?" (docs/ARCHITECTURE.md §12.17)
 *
 * The app had no such signal. `Session.lastSeenAt` is refreshed at most hourly on purpose, so a browsing session
 * is not a write per request, and `User.lastActiveAt` was only stamped at sign-in — both far too coarse to tell
 * somebody mid-conversation from somebody who left this morning.
 *
 * `lastActiveAt` now means what its name says: the last time this member's browser asked the server for anything.
 * The write is conditional, so the common case costs one indexed UPDATE that matches no rows:
 *
 *     UPDATE "User" SET "lastActiveAt" = now() WHERE id = $1 AND ("lastActiveAt" IS NULL OR "lastActiveAt" < $2)
 *
 * At one write per member per minute, a member clicking around for an hour costs sixty rows touched rather than
 * several hundred — the reason sessions were kept coarse in the first place, without the coarseness.
 *
 * Note for anyone reading the admin dashboard: this CHANGES what the 7- and 30-day figures there measure. They
 * used to count accounts that signed in during the window; they now count accounts that actually used the app in
 * it, which is the number those labels always implied.
 */
import { PRESENCE } from "@/config/product";
import type { DbLike } from "@/lib/db";

/**
 * Records that this member is here, at most once per PRESENCE.touchEveryMs. Never throws: presence is a nicety and
 * must not be able to fail a page render.
 */
export async function touchPresence(db: DbLike, userId: string, now: Date = new Date()): Promise<void> {
  const staleBefore = new Date(now.getTime() - PRESENCE.touchEveryMs);
  try {
    await db.$executeRaw`
      UPDATE "User"
      SET "lastActiveAt" = ${now}
      WHERE id = ${userId}
        AND ("lastActiveAt" IS NULL OR "lastActiveAt" < ${staleBefore})
    `;
  } catch {
    /* presence is not worth an error page */
  }
}

/** Whether a member counts as being in the app. Null — never seen — is away. */
export function isPresent(lastActiveAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!lastActiveAt) return false;
  return now.getTime() - lastActiveAt.getTime() < PRESENCE.activeWithinMs;
}

/** Convenience for the send path: one lookup, one answer. */
export async function isMemberPresent(db: DbLike, userId: string, now: Date = new Date()): Promise<boolean> {
  const row = await db.user.findUnique({ where: { id: userId }, select: { lastActiveAt: true } });
  return isPresent(row?.lastActiveAt ?? null, now);
}
