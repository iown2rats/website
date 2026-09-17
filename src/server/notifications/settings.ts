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
}

export async function getNotificationSettings(actor: Actor, deps: { db?: Db } = {}): Promise<NotificationSettingsDto> {
  const db = deps.db ?? getDb();
  const row = await db.notificationSettings.findUnique({ where: { userId: actor.userId } });
  return { matches: row?.matches ?? true, likes: row?.likes ?? true, messages: row?.messages ?? true, community: row?.community ?? false, marketing: row?.marketing ?? false };
}

export async function updateNotificationSettings(actor: Actor, input: unknown, deps: { db?: Db } = {}): Promise<NotificationSettingsDto> {
  const db = deps.db ?? getDb();
  const parsed = notificationSettingsSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Please check your settings");
  const data = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  if (Object.keys(data).length > 0) {
    await db.notificationSettings.upsert({ where: { userId: actor.userId }, create: { userId: actor.userId, ...data }, update: data });
  }
  return getNotificationSettings(actor, { db });
}
