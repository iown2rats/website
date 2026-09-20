/**
 * "Someone messaged you while you were away" (docs/ARCHITECTURE.md §12.13).
 *
 * The trigger is that a message is STILL UNREAD a while after it arrived — not that the recipient looks offline.
 * Mellocrush has no reliable liveness signal: User.lastActiveAt is written at sign-in, and Session.lastSeenAt is
 * refreshed at most hourly on purpose, so neither can say whether somebody is looking at the app right now.
 * Guessing wrong means emailing a person mid-conversation. "Still unread after ten minutes" needs no guess, and it
 * is self-correcting: open the chat and the notification is marked read, so the email never goes.
 *
 * There is no queue table and no migration. The unread MESSAGE notification IS the queue — it already exists per
 * conversation, it is already cleared when the chat is opened, and it is already suppressed when the recipient has
 * message notifications off. Throttling rides on RateLimitBucket, the same durable fixed-window counter the rest of
 * the app uses, keyed per recipient and conversation.
 *
 * Nothing here may throw into a caller. It is driven opportunistically from ordinary traffic, and a mail provider
 * having a bad minute must never turn into a failed message send.
 */
import { MESSAGE_EMAIL } from "@/config/product";
import { getDb, type Db } from "@/lib/db";
import { getEmailProvider } from "@/lib/email";
import { newMessageEmail } from "@/lib/email/templates";
import { emailDeliveryConfigured, getEnv } from "@/lib/env";
import { consumeRateLimit } from "@/server/auth/rate-limit";

export interface SweepResult {
  /** Emails actually handed to the provider. */
  sent: number;
  /** Candidates skipped: throttled, no address, settings off, read in the meantime. */
  skipped: number;
  /** The sweep did not run because another one had just run. */
  throttled: boolean;
}

const NONE: SweepResult = { sent: 0, skipped: 0, throttled: true };

/**
 * Sends for everything still unread past the delay. Safe to call from anywhere and often: a global fixed-window
 * limiter means only one sweep per minute does real work, whoever asks.
 */
export async function sweepUnreadMessageEmails(options: { db?: Db; now?: Date; force?: boolean } = {}): Promise<SweepResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (!emailDeliveryConfigured()) return { sent: 0, skipped: 0, throttled: false };

  if (!options.force) {
    const gate = await consumeRateLimit(db, "email:message:sweep", 1, MESSAGE_EMAIL.sweepEveryMs, now);
    if (!gate.allowed) return NONE;
  }

  const olderThan = new Date(now.getTime() - MESSAGE_EMAIL.unreadForMs);
  const giveUpBefore = new Date(now.getTime() - MESSAGE_EMAIL.giveUpAfterMs);

  const candidates = await db.notification.findMany({
    where: {
      type: "MESSAGE",
      readAt: null,
      createdAt: { lt: olderThan, gt: giveUpBefore },
      conversationId: { not: null },
      // A suspended, banned or deleted account is not owed mail.
      user: { status: "ACTIVE", deletedAt: null, accountType: "MEMBER" },
    },
    orderBy: { createdAt: "asc" },
    take: MESSAGE_EMAIL.batchSize,
    select: {
      id: true,
      userId: true,
      conversationId: true,
      actor: { select: { profile: { select: { displayName: true } } } },
      user: {
        select: {
          notificationSettings: { select: { messages: true } },
          identities: { select: { email: true }, where: { email: { not: null } }, take: 1 },
        },
      },
    },
  });

  let sent = 0;
  let skipped = 0;
  const appUrl = getEnv().APP_URL;
  const provider = getEmailProvider();

  for (const row of candidates) {
    // Re-read rather than trust the batch: the recipient may have opened the chat since the query.
    const settingsOn = row.user.notificationSettings?.messages ?? true;
    const address = row.user.identities[0]?.email ?? null;
    if (!settingsOn || !address) {
      skipped++;
      continue;
    }

    // One per conversation per window. Counted before sending, so a provider failure cannot produce a retry storm.
    const gate = await consumeRateLimit(
      db,
      `email:message:${row.userId}:${row.conversationId}`,
      1,
      MESSAGE_EMAIL.perConversationCooldownMs,
      now,
    );
    if (!gate.allowed) {
      skipped++;
      continue;
    }

    // Other conversations also waiting, so one email can speak for all of them.
    const alsoWaiting = await db.notification.count({
      where: { userId: row.userId, type: "MESSAGE", readAt: null, conversationId: { not: row.conversationId }, createdAt: { lt: olderThan } },
    });

    const fromName = row.actor?.profile?.displayName?.trim() || "Someone";
    const message = newMessageEmail(fromName, `${appUrl}/chats/${row.conversationId}`, alsoWaiting);
    try {
      await provider.send({ to: address, ...message });
      sent++;
    } catch {
      // Swallowed on purpose: this runs behind a member's ordinary request. The cooldown above already ran, so a
      // failed send waits for the next window rather than being retried immediately against a struggling provider.
      skipped++;
    }
  }

  return { sent, skipped, throttled: false };
}

/**
 * Fire-and-forget for request paths. Never awaited by the caller and never rejects, so sending a message cannot
 * fail because of the mailer.
 */
export function kickMessageEmailSweep(options: { db?: Db; now?: Date } = {}): void {
  void sweepUnreadMessageEmails(options).catch(() => {});
}
