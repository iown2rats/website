/**
 * Privacy & Safety settings (Phase 9 §11–§14). Toggles are written server-side only for the session user; hidden
 * location/age/active status are enforced by the DTO builders (never CSS). Pause Dating = visibility HIDDEN with a
 * pausedAt stamp: hidden from Discover, matches and chats untouched (prototype: "Paused from Discover, chats still
 * work"). Invisible Mode keeps its own entitlement-checked path in ./invisible-mode.ts.
 */
import { getDb, type Db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { privacyTogglesSchema } from "@/lib/validation/profile";
import type { Actor } from "@/server/actor";
import { getEntitlements } from "@/server/entitlements";
import { getInvisibleModeState, type InvisibleModeState } from "./invisible-mode";

export interface PrivacySettingsDto {
  visibility: "EVERYONE" | "HIDDEN";
  /** Pause Dating (visibility HIDDEN). */
  paused: boolean;
  hideLocation: boolean;
  hideAge: boolean;
  hideActiveStatus: boolean;
  /**
   * Read receipts, and deliberately reciprocal: turning this off also stops YOU seeing when others read yours
   * (see conversationReadState). A one-directional version would let someone watch without being watched, which
   * is not a privacy setting so much as an advantage.
   */
  readReceipts: boolean;
  blockContacts: boolean;
  /** Number of hashed numbers the user added (their own list, never a match count). */
  contactHashCount: number;
  invisibleMode: InvisibleModeState & { available: boolean };
  blockedCount: number;
}

export async function getPrivacySettings(actor: Actor, deps: { db?: Db; now?: Date } = {}): Promise<PrivacySettingsDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const [privacy, invisible, entitlements, contactHashCount, blockedCount] = await Promise.all([
    db.privacySettings.findUnique({ where: { userId: actor.userId } }),
    getInvisibleModeState(actor, { db, now }),
    getEntitlements(db, actor.userId, now),
    db.contactHash.count({ where: { userId: actor.userId } }),
    db.block.count({ where: { blockerId: actor.userId } }),
  ]);
  return {
    visibility: privacy?.visibility ?? "EVERYONE",
    paused: privacy?.visibility === "HIDDEN" || Boolean(privacy?.pausedAt),
    hideLocation: privacy?.hideLocation ?? false,
    hideAge: privacy?.hideAge ?? false,
    hideActiveStatus: privacy?.hideActiveStatus ?? false,
    readReceipts: privacy?.readReceipts ?? true,
    blockContacts: privacy?.blockContacts ?? false,
    contactHashCount,
    invisibleMode: { ...invisible, available: entitlements.rules.canUseInvisibleMode },
    blockedCount,
  };
}

/** Changes only the toggles present in the payload; unknown keys are stripped by the schema. */
export async function updatePrivacyToggles(actor: Actor, input: unknown, deps: { db?: Db } = {}): Promise<PrivacySettingsDto> {
  const db = deps.db ?? getDb();
  const parsed = privacyTogglesSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Please check your settings");
  const data = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  if (Object.keys(data).length > 0) {
    await db.privacySettings.upsert({ where: { userId: actor.userId }, create: { userId: actor.userId, ...data }, update: data });
  }
  return getPrivacySettings(actor, { db });
}

/** Pause / resume dating. Never touches Invisible Mode, matches or conversations. */
export async function setDatingPaused(actor: Actor, paused: boolean, deps: { db?: Db; now?: Date } = {}): Promise<PrivacySettingsDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const data = paused ? { visibility: "HIDDEN" as const, pausedAt: now } : { visibility: "EVERYONE" as const, pausedAt: null };
  await db.privacySettings.upsert({ where: { userId: actor.userId }, create: { userId: actor.userId, ...data }, update: data });
  return getPrivacySettings(actor, { db, now });
}
