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

/**
 * Three fields, and the middle one is easy to misread: `effective` does NOT mean "hidden".
 *
 *  - `enabled`   — the stored wish. Hidden from Discover at large whenever this is true, with or without Plus.
 *  - `effective` — the *premium* behaviour is operating: hidden from strangers but visible to people this member
 *                  has liked. Needs the entitlement.
 *  - `suspended` — the wish is on but Plus has lapsed, so the member is hidden from everyone, including the people
 *                  they liked. Still hidden; the exception is what they lost, not the hiding.
 *
 * So both `effective` and `suspended` keep a member out of other people's decks. The discovery predicate is
 * therefore keyed on `enabled`, and the entitlement only decides whether the liked-people exception applies
 * (src/server/discovery/predicate.ts). This is deliberate: a lapse must never push somebody who asked to be hidden
 * back in front of strangers, which is exactly what the privacy screen promises them
 * ("You are never shown to new people without your say"). Regression tests:
 * tests/integration/invisible-mode.test.ts.
 */
export interface InvisibleModeState {
  /** The stored wish. Hidden from Discover whenever true, entitlement or not. */
  enabled: boolean;
  /** The premium behaviour is operating: hidden from strangers, visible to people this member liked. */
  effective: boolean;
  /** True when enabled but the entitlement lapsed: hidden from everyone, not exposed. */
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
