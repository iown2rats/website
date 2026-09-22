/**
 * "Someone messaged you while you were away" (docs/ARCHITECTURE.md §12.16).
 *
 * The rule is presence, not timing: a member who is in the app gets no email, and a member who is away gets one
 * straight away. Waiting ten minutes to find out what is already known — that nobody is there — only delays the
 * mail, and mailing someone mid-conversation is the thing to avoid. `src/server/presence.ts` supplies the signal.
 *
 * Two paths, one delivery:
 *
 *   - `notifyAwayRecipient` runs the instant a message is sent. Recipient away → email now.
 *   - `sweepUnreadMessageEmails` is the safety net for the one case the first path cannot cover: the recipient WAS
 *     present when the message landed, so no mail went, and then they left without reading it. It emails only when
 *     the message is still unread AND they are away by then, so it can never mail somebody who is still reading.
 *
 * There is no queue table and no migration. The unread MESSAGE notification IS the queue — one per conversation,
 * cleared when the chat opens, suppressed when message notifications are off. Both paths share one per-recipient,
 * per-conversation throttle on RateLimitBucket, so a burst is one email however it is triggered.
 *
 * Nothing here may throw into a caller. A mail provider having a bad minute must never fail a message send.
 */
import { MESSAGE_EMAIL } from "@/config/product";
import { getDb, type Db, type DbLike } from "@/lib/db";
import { getEmailProvider } from "@/lib/email";
import { newMessageEmail } from "@/lib/email/templates";
import { emailDeliveryConfigured, getEnv } from "@/lib/env";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { isMemberPresent, isPresent } from "@/server/presence";
import { logEmailOutcome, resolveEmailRecipient, warnEmailUnconfigured } from "./email-recipient";

export type DeliveryOutcome = "sent" | "no-address" | "notifications-off" | "throttled" | "failed";

/**
 * Sends one "you have a message" email, or says why it did not. Presence is the CALLER's question: both callers
 * have already established the recipient is away, and re-checking here would only hide which path decided.
 */
async function deliverMessageEmail(
  db: DbLike,
  input: { recipientId: string; conversationId: string; now: Date },
): Promise<DeliveryOutcome> {
  const recipient = await resolveEmailRecipient(db, input.recipientId, "messages");
  if (!recipient.ok) {
    logEmailOutcome("message", recipient.reason, input.recipientId);
    return recipient.reason;
  }
  const address = recipient.address;

  // Counted before sending, so a provider failure cannot turn into a retry storm against a struggling provider.
  const gate = await consumeRateLimit(
    db,
    `email:message:${input.recipientId}:${input.conversationId}`,
    1,
    MESSAGE_EMAIL.perConversationCooldownMs,
    input.now,
  );
  if (!gate.allowed) return "throttled";

  // Who wrote, plus anything else waiting, so one email can speak for several conversations.
  const [actorRow, alsoWaiting] = await Promise.all([
    db.notification.findFirst({
      where: { userId: input.recipientId, type: "MESSAGE", conversationId: input.conversationId },
      orderBy: { createdAt: "desc" },
      select: { actor: { select: { profile: { select: { displayName: true } } } } },
    }),
    db.notification.count({
      where: { userId: input.recipientId, type: "MESSAGE", readAt: null, conversationId: { not: input.conversationId } },
    }),
  ]);

  const fromName = actorRow?.actor?.profile?.displayName?.trim() || "Someone";
  const message = newMessageEmail(fromName, `${getEnv().APP_URL}/chats/${input.conversationId}`, alsoWaiting);
  try {
    await getEmailProvider().send({ to: address, ...message });
    return "sent";
  } catch {
    // The error itself is not logged: a provider error can quote the recipient's address back at us, and an
    // address is exactly what these logs must not hold. The outcome and the internal id are enough to chase.
    logEmailOutcome("message", "failed", input.recipientId);
    return "failed";
  }
}

/**
 * The send path. Emails the recipient straight away when they are not in the app.
 *
 * Returns the outcome so tests can assert on it; callers in request paths ignore it.
 */
export async function notifyAwayRecipient(
  input: { recipientId: string; conversationId: string },
  options: { db?: Db; now?: Date } = {},
): Promise<DeliveryOutcome | "present" | "not-configured"> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (!emailDeliveryConfigured()) {
    warnEmailUnconfigured("message emails");
    return "not-configured";
  }
  if (await isMemberPresent(db, input.recipientId, now)) return "present";
  return deliverMessageEmail(db, { ...input, now });
}

/** Fire-and-forget wrapper for request paths: never awaited, never rejects. */
export function kickAwayRecipientEmail(input: { recipientId: string; conversationId: string }, options: { db?: Db; now?: Date } = {}): void {
  void notifyAwayRecipient(input, options).catch(() => {});
}

export interface SweepResult {
  sent: number;
  /** Candidates passed over: present, throttled, no address, notifications off. */
  skipped: number;
  /** The sweep did not run because another had just run. */
  throttled: boolean;
}

/**
 * The safety net: people who were present when a message arrived, and have since gone away without reading it.
 * The send path cannot know that will happen, so this catches it.
 */
export async function sweepUnreadMessageEmails(options: { db?: Db; now?: Date; force?: boolean } = {}): Promise<SweepResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  if (!emailDeliveryConfigured()) {
    warnEmailUnconfigured("message emails");
    return { sent: 0, skipped: 0, throttled: false };
  }

  if (!options.force) {
    const gate = await consumeRateLimit(db, "email:message:sweep", 1, MESSAGE_EMAIL.sweepEveryMs, now);
    if (!gate.allowed) return { sent: 0, skipped: 0, throttled: true };
  }

  const candidates = await db.notification.findMany({
    where: {
      type: "MESSAGE",
      readAt: null,
      createdAt: { lt: new Date(now.getTime() - MESSAGE_EMAIL.unreadForMs), gt: new Date(now.getTime() - MESSAGE_EMAIL.giveUpAfterMs) },
      conversationId: { not: null },
      user: { status: "ACTIVE", deletedAt: null, accountType: "MEMBER" },
    },
    orderBy: { createdAt: "asc" },
    take: MESSAGE_EMAIL.batchSize,
    select: { userId: true, conversationId: true, user: { select: { lastActiveAt: true } } },
  });

  let sent = 0;
  let skipped = 0;
  for (const row of candidates) {
    if (!row.conversationId) continue;
    // Never mail somebody who is in the app, whatever the message's age. That is the whole rule.
    if (isPresent(row.user.lastActiveAt, now)) {
      skipped++;
      continue;
    }
    const outcome = await deliverMessageEmail(db, { recipientId: row.userId, conversationId: row.conversationId, now });
    if (outcome === "sent") sent++;
    else skipped++;
  }
  return { sent, skipped, throttled: false };
}

/** Fire-and-forget wrapper for request paths. */
export function kickMessageEmailSweep(options: { db?: Db; now?: Date } = {}): void {
  void sweepUnreadMessageEmails(options).catch(() => {});
}
