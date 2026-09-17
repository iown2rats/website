/**
 * Rolling usage windows (docs/ARCHITECTURE.md §12.3, §12.11).
 *
 * One UsageCounter row per (user, kind). The consuming transaction locks the row FOR UPDATE, lazily
 * resets it when the window has ended, checks the limit, and increments. No cron, no per-event rows.
 * Changing the reset policy means changing `openWindow` only.
 */
import { Prisma } from "@/generated/prisma/client";
import type { DbLike, Tx } from "@/lib/db";
import { USAGE_WINDOWS, type UsageKindKey } from "@/config/product";

export interface UsageState {
  used: number;
  windowStart: Date | null;
  windowEnd: Date | null;
}

export type ConsumeResult =
  | { ok: true; used: number; limit: number; windowEnd: Date }
  | { ok: false; used: number; limit: number; windowEnd: Date };

interface CounterRow {
  windowStart: Date;
  windowEnd: Date;
  used: number;
}

/** Policy: a fresh window opens at the moment of first use and lasts USAGE_WINDOWS[kind]. */
function openWindow(kind: UsageKindKey, now: Date): { windowStart: Date; windowEnd: Date } {
  return { windowStart: now, windowEnd: new Date(now.getTime() + USAGE_WINDOWS[kind]) };
}

/**
 * Locks the counter row for `userId`/`kind` for the rest of the transaction and returns its state
 * after applying a lazy reset. Must be called inside `$transaction`.
 */
export async function lockUsage(tx: Tx, userId: string, kind: UsageKindKey, now: Date): Promise<CounterRow> {
  const fresh = openWindow(kind, now);
  // Ensure the row exists (idempotent), then take the exclusive lock.
  await tx.$executeRaw`
    INSERT INTO "UsageCounter" ("userId", kind, "windowStart", "windowEnd", used, "updatedAt")
    VALUES (${userId}, ${kind}::"UsageKind", ${fresh.windowStart}, ${fresh.windowEnd}, 0, ${now})
    ON CONFLICT ("userId", kind) DO NOTHING
  `;
  const rows = await tx.$queryRaw<CounterRow[]>`
    SELECT "windowStart", "windowEnd", used
    FROM "UsageCounter"
    WHERE "userId" = ${userId} AND kind = ${kind}::"UsageKind"
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new Error("UsageCounter row missing after upsert");
  if (now.getTime() >= row.windowEnd.getTime()) {
    await tx.$executeRaw`
      UPDATE "UsageCounter"
      SET "windowStart" = ${fresh.windowStart}, "windowEnd" = ${fresh.windowEnd}, used = 0, "updatedAt" = ${now}
      WHERE "userId" = ${userId} AND kind = ${kind}::"UsageKind"
    `;
    return { ...fresh, used: 0 };
  }
  return row;
}

/**
 * Consumes one unit if `used < limit`. Caller must already hold the lock via `lockUsage` in the same
 * transaction (pass the returned row). Returns the outcome; on `ok: false` the caller should roll back.
 */
export async function consumeLocked(
  tx: Tx,
  userId: string,
  kind: UsageKindKey,
  locked: CounterRow,
  limit: number,
  now: Date,
): Promise<ConsumeResult> {
  if (locked.used >= limit) {
    return { ok: false, used: locked.used, limit, windowEnd: locked.windowEnd };
  }
  await tx.$executeRaw`
    UPDATE "UsageCounter" SET used = used + 1, "updatedAt" = ${now}
    WHERE "userId" = ${userId} AND kind = ${kind}::"UsageKind"
  `;
  return { ok: true, used: locked.used + 1, limit, windowEnd: locked.windowEnd };
}

/** Lock + consume in one call, for actions where nothing else needs to happen between the two. */
export async function consumeUsage(
  tx: Tx,
  userId: string,
  kind: UsageKindKey,
  limit: number,
  now: Date,
): Promise<ConsumeResult> {
  const locked = await lockUsage(tx, userId, kind, now);
  return consumeLocked(tx, userId, kind, locked, limit, now);
}

/** Non-locking read for UI. Applies the same lazy-reset view without writing. */
export async function peekUsage(db: DbLike, userId: string, kind: UsageKindKey, now: Date): Promise<UsageState> {
  const rows = await db.$queryRaw<CounterRow[]>(
    Prisma.sql`SELECT "windowStart", "windowEnd", used FROM "UsageCounter" WHERE "userId" = ${userId} AND kind = ${kind}::"UsageKind"`,
  );
  const row = rows[0];
  if (!row || now.getTime() >= row.windowEnd.getTime()) return { used: 0, windowStart: null, windowEnd: null };
  return { used: row.used, windowStart: row.windowStart, windowEnd: row.windowEnd };
}
