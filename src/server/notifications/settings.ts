/**
 * Notification preferences (Phase 9 §18). The five schema categories; each gates future notification creation in
 * the writer that raises it (matches → matching/match.ts, likes → likes/like.ts, messages → conversations, community
 * → community/notify.ts). Historical rows are never touched. Marketing has no sender yet and is stored only.
 */
import { getDb, type Db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { notificationSettingsSchema } from "@/lib/validation/profile";
import type { Actor } from "@/server/actor";

export interface NotificationSettingsDto {
  matches: boolean;
  likes: boolean;
  messages: boolean;
  community: boolean;
  marketing: boolean;
  /** The master switch for external push. Off until the member turns it on; see PUSH_DEFAULTS. */
  push: boolean;
  pushMessages: boolean;
  pushLikes: boolean;
  pushMatches: boolean;
  pushReactions: boolean;
  pushCommunity: boolean;
  pushAccount: boolean;
}

/**
 * What switching the master toggle ON turns on with it.
 *
 * Every push column DEFAULTS to false in the database, so a member who never touches this is never pushed to.
 * But "push is on and nothing arrives" is a broken-looking product, so the deliberate act of enabling push also
 * enables the three the brief calls priority. They are shown as on the moment the section expands and every one
 * is individually switchable, so nothing is turned on out of sight — the member enabled these, in one tap, and
 * can see exactly what they agreed to.
 */
export const PUSH_DEFAULTS_ON_ENABLE = { pushMessages: true, pushLikes: true, pushMatches: true } as const;

export async function getNotificationSettings(actor: Actor, deps: { db?: Db } = {}): Promise<NotificationSettingsDto> {
  const db = deps.db ?? getDb();
  const row = await db.notificationSettings.findUnique({ where: { userId: actor.userId } });
  return {
    matches: row?.matches ?? true,
    likes: row?.likes ?? true,
    messages: row?.messages ?? true,
    community: row?.community ?? false,
    marketing: row?.marketing ?? false,
    push: row?.push ?? false,
    pushMessages: row?.pushMessages ?? false,
    pushLikes: row?.pushLikes ?? false,
    pushMatches: row?.pushMatches ?? false,
    pushReactions: row?.pushReactions ?? false,
    pushCommunity: row?.pushCommunity ?? false,
    pushAccount: row?.pushAccount ?? false,
  };
}

export async function updateNotificationSettings(actor: Actor, input: unknown, deps: { db?: Db } = {}): Promise<NotificationSettingsDto> {
  const db = deps.db ?? getDb();
  const parsed = notificationSettingsSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Please check your settings");
  const data: Record<string, boolean> = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as Record<string, boolean>;

  /*
   * Turning the master switch on brings the priority categories with it, but only when the member has not already
   * expressed a view — an existing row with categories already chosen is left exactly as the member left it, and
   * anything sent in the same request wins outright.
   */
  if (data.push === true) {
    const current = await db.notificationSettings.findUnique({
      where: { userId: actor.userId },
      select: { push: true, pushMessages: true, pushLikes: true, pushMatches: true, pushReactions: true, pushCommunity: true, pushAccount: true },
    });
    const nothingChosenYet =
      !current ||
      ![current.pushMessages, current.pushLikes, current.pushMatches, current.pushReactions, current.pushCommunity, current.pushAccount].some(Boolean);
    if (!current?.push && nothingChosenYet) {
      for (const [key, value] of Object.entries(PUSH_DEFAULTS_ON_ENABLE)) {
        if (data[key] === undefined) data[key] = value;
      }
    }
  }

  if (Object.keys(data).length > 0) {
    await db.notificationSettings.upsert({ where: { userId: actor.userId }, create: { userId: actor.userId, ...data }, update: data });
  }
  return getNotificationSettings(actor, { db });
}
