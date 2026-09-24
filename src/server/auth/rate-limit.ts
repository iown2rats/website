/**
 * Postgres-backed fixed-window rate limits (RateLimitBucket). No Redis dependency.
 * The increment is a single atomic upsert, so concurrent requests cannot exceed `limit`.
 */
import type { DbLike } from "@/lib/db";

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  /** When the current window ends and the limit resets. */
  retryAt: Date;
}

export async function consumeRateLimit(db: DbLike, key: string, limit: number, windowMs: number, now: Date = new Date()): Promise<RateLimitResult> {
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" (key, "windowStart", count)
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (key, "windowStart") DO UPDATE SET count = "RateLimitBucket".count + 1
    RETURNING count
  `;
  const count = rows[0]?.count ?? 1;
  return { allowed: count <= limit, count, limit, retryAt: new Date(windowStart.getTime() + windowMs) };
}

/**
 * Where a one-time claim lives: the end of time, so `pruneRateLimits` (which deletes windows older than a horizon)
 * can never reach it and quietly turn "once" back into "again".
 */
export const CLAIM_WINDOW_START = new Date("9999-12-31T00:00:00Z");

/**
 * A claim that is taken at most once per key, EVER — not once per window.
 *
 * `consumeRateLimit` is the wrong tool for "never twice": its windows are aligned to the epoch, so a limit of one per
 * week is really one per calendar week, and a key consumed on Wednesday is free again at Thursday 00:00 UTC. That is
 * exactly how a match could be emailed twice. A claim has no window: the first caller inserts the row and every later
 * caller, concurrent or not, finds it.
 *
 * A key that was ever consumed through `consumeRateLimit` counts as already claimed, whatever window it landed in, so
 * switching a caller from the windowed limit to a claim cannot re-send anything the old code already sent.
 */
export async function claimOnce(db: DbLike, key: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" (key, "windowStart", count)
    SELECT ${key}, ${CLAIM_WINDOW_START}, 1
    WHERE NOT EXISTS (SELECT 1 FROM "RateLimitBucket" WHERE key = ${key})
    ON CONFLICT (key, "windowStart") DO NOTHING
    RETURNING count
  `;
  return rows.length > 0;
}

/** Housekeeping: drop buckets older than the largest window in use. Safe to call from any request. */
export async function pruneRateLimits(db: DbLike, olderThanMs: number, now: Date = new Date()): Promise<number> {
  const result = await db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - olderThanMs) } } });
  return result.count;
}
