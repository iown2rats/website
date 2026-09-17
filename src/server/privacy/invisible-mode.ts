/**
 * Invisible Mode setting (docs/ARCHITECTURE.md §12.6). The flag is the user's wish; the discovery
 * predicate applies it only while the entitlement is held, and fails closed when it lapses.
 */
import { getDb, type Db } from "@/lib/db";
import { EntitlementRequiredError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { getEntitlements } from "@/server/entitlements";

export async function setInvisibleMode(actor: Actor, enabled: boolean, options: { now?: Date; db?: Db } = {}): Promise<{ invisibleMode: boolean }> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (enabled) {
    const e = await getEntitlements(db, actor.userId, now);
    if (!e.rules.canUseInvisibleMode) throw new EntitlementRequiredError("Invisible Mode");
  }
  const updated = await db.privacySettings.upsert({
    where: { userId: actor.userId },
    create: { userId: actor.userId, invisibleMode: enabled },
    update: { invisibleMode: enabled },
    select: { invisibleMode: true },
  });
  return updated;
}

export interface InvisibleModeState {
  /** The stored wish. */
  enabled: boolean;
  /** Whether it is currently in effect (wish AND entitlement). */
  effective: boolean;
  /** True when enabled but the entitlement lapsed: the user is paused from Discover, not exposed. */
  suspended: boolean;
}

export async function getInvisibleModeState(actor: Actor, options: { now?: Date; db?: Db } = {}): Promise<InvisibleModeState> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const [privacy, e] = await Promise.all([
    db.privacySettings.findUnique({ where: { userId: actor.userId }, select: { invisibleMode: true } }),
    getEntitlements(db, actor.userId, now),
  ]);
  const enabled = privacy?.invisibleMode ?? false;
  const effective = enabled && e.rules.canUseInvisibleMode;
  return { enabled, effective, suspended: enabled && !effective };
}
