/**
 * Who an email notification may be sent to, and whether it may be sent at all (docs/ARCHITECTURE.md §12.16).
 *
 * Extracted so the message, match and like senders answer this question with ONE piece of code rather than three
 * copies that drift. The rules it encodes are not incidental:
 *
 *   - the account must be a live MEMBER. A suspended, banned, deleted or staff account is never mailed;
 *   - the category toggle in Settings decides, and an ABSENT settings row means the column default, so a member
 *     who has never opened that screen is treated exactly as the in-app feed treats them;
 *   - an address is whatever identity has one. Google and email accounts always do; a Telegram-only account has
 *     none, and that is a skip rather than an error — the in-app feed and push still reach them.
 *
 * There is no third state where an address is guessed, derived or carried over from somewhere else.
 */
import type { DbLike } from "@/lib/db";

/** The Settings toggle that gates each kind of email. These are the same columns the in-app feed already uses. */
export type EmailCategory = "messages" | "matches" | "likes";

export type RecipientResolution =
  | { ok: true; address: string }
  /** Not a live member, or the category is switched off. Deliberately one reason: neither is the caller's business. */
  | { ok: false; reason: "notifications-off" }
  /** A Telegram-only account. Nothing is wrong; there is simply nowhere to send. */
  | { ok: false; reason: "no-address" };

export async function resolveEmailRecipient(db: DbLike, userId: string, category: EmailCategory): Promise<RecipientResolution> {
  const recipient = await db.user.findFirst({
    where: { id: userId, status: "ACTIVE", deletedAt: null, accountType: "MEMBER" },
    select: {
      notificationSettings: { select: { messages: true, matches: true, likes: true } },
      // `take: 1` with a non-null filter: any identity carrying an address will do, whichever provider it came from.
      identities: { select: { email: true }, where: { email: { not: null } }, take: 1 },
    },
  });
  if (!recipient) return { ok: false, reason: "notifications-off" };

  const settings = recipient.notificationSettings;
  // Absent row → the column default, which is `true` for all three of these.
  const wants = settings ? settings[category] : true;
  if (wants === false) return { ok: false, reason: "notifications-off" };

  const address = recipient.identities[0]?.email;
  if (!address) return { ok: false, reason: "no-address" };
  return { ok: true, address };
}

/**
 * Structured, PII-free logging for email delivery (docs/ARCHITECTURE.md §12.16).
 *
 * Before this, a send that failed returned "failed" to a caller that ignored it, and a deployment with no mail
 * provider configured did nothing at all, silently — which is indistinguishable from a deployment where nobody
 * happened to be away. Both are now visible in the runtime logs.
 *
 * What is logged is the KIND, the OUTCOME and the internal recipient id: enough to find the account and follow it
 * up. Never the address, never a display name, never a message body, never anything a log aggregator should not
 * be holding.
 */
export function logEmailOutcome(kind: "message" | "match" | "likes", outcome: string, recipientId: string): void {
  // FAILURES ONLY, and deliberately so. Recipient resolution happens BEFORE the per-send throttle is consumed,
  // so anything logged from it is unbounded: a Telegram-only member with one unread message would emit a line on
  // every sweep pass — once a minute, for as long as the message stays unread. Having no address is also not a
  // failure; it is a permanent, expected property of an account that signed in with Telegram, and the provider
  // mix is a database question, not a log question.
  //
  // A real failure is bounded, because the throttle is consumed before the send is attempted: at most one line
  // per conversation per 6 hours, per match per week, per member per day.
  if (outcome !== "failed") return;
  console.error(`[email] ${kind} delivery failed`, { recipientId, outcome });
}

let warnedUnconfigured = false;

/**
 * Says once per process that mail cannot be delivered here. Once, because this is asked on every send and a line
 * per attempt would bury everything else; and at all, because "no provider configured" was previously the single
 * most invisible way for notifications to stop working.
 */
export function warnEmailUnconfigured(kind: string): void {
  if (warnedUnconfigured) return;
  warnedUnconfigured = true;
  console.warn(`[email] no mail provider is configured; ${kind} and all other notification emails are disabled`);
}
