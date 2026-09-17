/**
 * Recent authentication for destructive actions (docs/ARCHITECTURE.md §4.4). A session becomes "recently
 * authenticated" only by completing a fresh Google sign-in for the same identity; the mark is valid for a short
 * window and is consumed by the action that relies on it, so a stolen long-lived cookie alone can never delete
 * an account.
 */
import type { DbLike } from "@/lib/db";

export const RECENT_AUTH = { windowMs: 5 * 60_000 } as const;

export interface RecentAuthState {
  fresh: boolean;
  /** When the current mark stops counting as recent, if any. */
  expiresAt: Date | null;
}

export async function getRecentAuthentication(db: DbLike, sessionId: string, now: Date = new Date()): Promise<RecentAuthState> {
  const session = await db.session.findUnique({ where: { id: sessionId }, select: { reauthenticatedAt: true } });
  const at = session?.reauthenticatedAt ?? null;
  const expiresAt = at ? new Date(at.getTime() + RECENT_AUTH.windowMs) : null;
  return { fresh: Boolean(expiresAt && expiresAt.getTime() > now.getTime()), expiresAt: expiresAt && expiresAt.getTime() > now.getTime() ? expiresAt : null };
}

/** Atomically uses up a recent mark. Returns false when the session has none (or it is too old). */
export async function consumeRecentAuthentication(db: DbLike, sessionId: string, now: Date = new Date()): Promise<boolean> {
  const result = await db.session.updateMany({
    where: { id: sessionId, reauthenticatedAt: { gt: new Date(now.getTime() - RECENT_AUTH.windowMs) } },
    data: { reauthenticatedAt: null },
  });
  return result.count > 0;
}
