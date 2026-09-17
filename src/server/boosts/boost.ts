/**
 * Profile Boosts (docs/ARCHITECTURE.md §12.8). Allowance via the rolling 7-day UsageCounter window.
 */
import { BOOST } from "@/config/product";
import { getDb, type Db } from "@/lib/db";
import { BoostAlreadyActiveError, BoostLimitReachedError, EntitlementRequiredError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { getEntitlements } from "@/server/entitlements";
import { consumeLocked, lockUsage } from "@/server/usage/usage-window";

export interface ActivatedBoost {
  id: string;
  startsAt: Date;
  endsAt: Date;
  boostsRemaining: number;
  allowanceResetsAt: Date;
}

export async function activateBoost(actor: Actor, options: { now?: Date; db?: Db } = {}): Promise<ActivatedBoost> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  return db.$transaction(async (tx) => {
    const locked = await lockUsage(tx, actor.userId, "BOOSTS", now);
    const entitlements = await getEntitlements(tx, actor.userId, now);
    const limit = entitlements.rules.boostsPerWindow;
    if (limit === 0) throw new EntitlementRequiredError("Profile Boost");

    const active = await tx.boost.findFirst({
      where: { userId: actor.userId, startsAt: { lte: now }, endsAt: { gt: now } },
      select: { endsAt: true },
    });
    if (active) throw new BoostAlreadyActiveError(active.endsAt);

    const consumed = await consumeLocked(tx, actor.userId, "BOOSTS", locked, limit, now);
    if (!consumed.ok) throw new BoostLimitReachedError(limit, consumed.windowEnd);

    const endsAt = new Date(now.getTime() + BOOST.durationMs);
    const boost = await tx.boost.create({
      data: { userId: actor.userId, startsAt: now, endsAt, createdAt: now },
      select: { id: true, startsAt: true, endsAt: true },
    });
    return { ...boost, boostsRemaining: limit - consumed.used, allowanceResetsAt: consumed.windowEnd };
  });
}
