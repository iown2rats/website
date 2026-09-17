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

/** Housekeeping: drop buckets older than the largest window in use. Safe to call from any request. */
export async function pruneRateLimits(db: DbLike, olderThanMs: number, now: Date = new Date()): Promise<number> {
  const result = await db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - olderThanMs) } } });
  return result.count;
}
