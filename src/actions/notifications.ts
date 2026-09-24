"use server";

import { z } from "zod";
import { NOTIFICATION_FEED } from "@/config/product";
import { requireMember } from "@/server/auth/current-user";
import {
  getNotificationFeed,
  markAllNotificationsRead,
  markLikesSeen,
  markNotificationRead,
  type NotificationFeedDto,
} from "@/server/notifications/feed";

/*
 * Notification server actions. The acting user comes from the session (requireMember) and is never taken from the
 * payload, so the id in `readNotification` only ever resolves inside the caller's own rows: another member's id
 * marks nothing and returns the same answer as an id that does not exist (docs/ARCHITECTURE.md §13).
 * Server actions are POST requests scoped to the caller's cookie and are never cached (§7.5).
 */

export type NotificationFailure = { ok: false; code: "VALIDATION" | "ERROR"; message: string };

const feedInput = z.object({
  limit: z.number().int().min(1).max(NOTIFICATION_FEED.maxPageSize).optional(),
  cursor: z.string().max(128).nullish(),
});
const idInput = z.object({ id: z.string().min(1).max(64) });

function failure(e: unknown): NotificationFailure {
  if (e instanceof z.ZodError) return { ok: false, code: "VALIDATION", message: "That request wasn't valid." };
  console.error("[notifications] action failed", e);
  return { ok: false, code: "ERROR", message: "Mellocrush couldn't load your notifications right now." };
}

export async function loadNotifications(input: unknown): Promise<({ ok: true } & NotificationFeedDto) | NotificationFailure> {
  try {
    const actor = await requireMember();
    const { limit, cursor } = feedInput.parse(input ?? {});
    return { ok: true, ...(await getNotificationFeed(actor, { limit, cursor: cursor ?? null })) };
  } catch (e) {
    return failure(e);
  }
}

/** Marks one row read. `changed` is false for an id that is not the caller's — it is not an error and says nothing more. */
export async function readNotification(input: unknown): Promise<{ ok: true; changed: boolean; unread: number } | NotificationFailure> {
  try {
    const actor = await requireMember();
    const { id } = idInput.parse(input ?? {});
    return { ok: true, ...(await markNotificationRead(actor, id)) };
  } catch (e) {
    return failure(e);
  }
}

/** Marks every unread row read. Nothing is deleted — the list stays, the rows just stop counting. */
export async function readAllNotifications(): Promise<{ ok: true; marked: number; unread: number } | NotificationFailure> {
  try {
    const actor = await requireMember();
    return { ok: true, ...(await markAllNotificationsRead(actor)) };
  } catch (e) {
    return failure(e);
  }
}

const likesSeenInput = z.object({ seenAt: z.string().datetime() });

/** Likes You was on screen: that member's like notifications up to the page's render time are read. */
export async function markLikesViewed(input: unknown): Promise<{ ok: true; marked: number; unread: number } | NotificationFailure> {
  try {
    const actor = await requireMember();
    const { seenAt } = likesSeenInput.parse(input ?? {});
    return { ok: true, ...(await markLikesSeen(actor, { seenAt: new Date(seenAt) })) };
  } catch (e) {
    return failure(e);
  }
}
