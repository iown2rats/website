/**
 * What a push notification is allowed to say (docs/ARCHITECTURE.md §29.2).
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a push never carries the content of anything.
 *
 * Not the message body, not a comment, not a post. A push leaves our servers, is relayed by a push service we do
 * not own, and is then drawn on a lock screen that anybody standing nearby can read and that the operating system
 * keeps in a notification history the member never asked for. The in-app feed is behind a session; a lock screen
 * is not. So the payload says that something happened and where to look, and the app — behind authentication —
 * says what it was.
 *
 * This is structural rather than a matter of care: `pushCopyFor` takes a NOTIFICATION ROW, and a notification row
 * has never contained message text. There is no parameter to pass a body through and nothing here reads one. The
 * regression test in tests/integration/push.test.ts sends a message full of distinctive words and asserts none of
 * them reach a payload.
 *
 * The second rule is that a push may not say more than the app would. Whether a liker can be named is a PAYWALL
 * question (§12.5: Free members see "Someone liked you"), and a push that leaked the name would sell the feature
 * to people who have not bought it. Whether anyone can be named at all is a BLOCK question. Both are decided by
 * the caller, which has the database; this module is handed `actorName: null` and writes the anonymous line.
 */
import type { ReactionKey } from "@/lib/reactions";

/** Every push MelloCrush can send. Deliberately a closed set: an unknown type sends nothing rather than guessing. */
export type PushKind =
  | "MESSAGE"
  | "MESSAGE_REACTION"
  | "LIKE_RECEIVED"
  | "INTRO_RECEIVED"
  | "NEW_MATCH"
  | "COMMUNITY_LIKE"
  | "COMMUNITY_COMMENT"
  | "COMMUNITY_COMMENT_REACTION"
  | "VERIFICATION_UPDATE"
  | "PAYMENT_APPROVED"
  | "PAYMENT_REJECTED"
  | "SUBSCRIPTION_EXPIRING"
  | "SUBSCRIPTION_EXPIRED"
  | "SAFETY_NOTICE"
  | "ACCOUNT_NOTICE";

export interface PushCopyInput {
  kind: PushKind;
  /**
   * The display name, or null when this member may not be named to this recipient — blocked, not ACTIVE, or a
   * liker the recipient has not paid to see. Null is a first-class case, never a missing value to paper over.
   */
  actorName: string | null;
  /** For reaction copy. Never rendered as the glyph on its own — the sentence has to make sense read aloud. */
  emoji?: ReactionKey | null;
  /** A LIKE_RECEIVED that is a Super Like, and whether it carries a message (never the message itself). */
  superLike?: { withMessage: boolean } | null;
}

export interface PushCopy {
  title: string;
  body: string;
}

/**
 * The words. Short, plain, and never a preview of anything.
 *
 * "left you a message", not "sent you a message": what was left is waiting to be read, which is the true thing
 * and the thing that gets somebody to open the app. "Sent" invites the reader to expect the message itself.
 */
export function pushCopyFor(input: PushCopyInput): PushCopy {
  const who = input.actorName?.trim() || null;

  switch (input.kind) {
    case "MESSAGE":
      return who
        ? { title: `${who} left you a message 💬`, body: "Open MelloCrush to see it" }
        : { title: "New message 💬", body: "Someone left you a message on MelloCrush" };

    case "MESSAGE_REACTION":
      return who
        ? { title: `${who} reacted to your message`, body: "Open MelloCrush to see it" }
        : { title: "New reaction", body: "Someone reacted to your message on MelloCrush" };

    // Never named, for anybody. Who liked you is the thing Likes You sells (§12.5), and a push that named them
    // would hand a Plus feature to every Free member's lock screen.
    case "LIKE_RECEIVED":
    case "INTRO_RECEIVED":
      // A Super Like is still a like: anonymous for everybody on a lock screen, and never its message (§12.20).
      if (input.kind === "LIKE_RECEIVED" && input.superLike) {
        return { title: input.superLike.withMessage ? "Someone Super Liked you and sent a message ⭐" : "Someone Super Liked you ⭐", body: "Open MelloCrush to find out who" };
      }
      return { title: "Someone likes you ❤️", body: "Open MelloCrush to find out who" };

    case "NEW_MATCH":
      return { title: "It's a match! ✨", body: "You have a new connection on MelloCrush" };

    case "COMMUNITY_LIKE":
      return who
        ? { title: `${who} reacted to your post`, body: "Open MelloCrush to see it" }
        : { title: "New reaction on your post", body: "Open MelloCrush to see it" };

    case "COMMUNITY_COMMENT":
      // Emphatically not the comment. A reply on a public post is still somebody's words on a lock screen.
      return who
        ? { title: `${who} commented on your post`, body: "Open MelloCrush to read it" }
        : { title: "New comment on your post", body: "Open MelloCrush to read it" };

    case "COMMUNITY_COMMENT_REACTION":
      return who
        ? { title: `${who} reacted to your comment`, body: "Open MelloCrush to see it" }
        : { title: "New reaction on your comment", body: "Open MelloCrush to see it" };

    case "VERIFICATION_UPDATE":
      // Not whether it passed. A rejection on a lock screen is a private thing made public, and the reason is
      // moderation detail that must never leave the app.
      return { title: "Photo verification update", body: "Open MelloCrush to see the result" };

    case "PAYMENT_APPROVED":
      return { title: "Payment approved", body: "Your MelloCrush Plus is active" };

    case "PAYMENT_REJECTED":
      // No reason, no amount, no reference. Someone's payment being refused is not for a lock screen.
      return { title: "Payment needs attention", body: "Open MelloCrush to check your order" };

    case "SUBSCRIPTION_EXPIRING":
      return { title: "Your Plus is ending soon", body: "Open MelloCrush to renew" };

    case "SUBSCRIPTION_EXPIRED":
      return { title: "Your Plus has ended", body: "Open MelloCrush to renew" };

    case "SAFETY_NOTICE":
      return { title: "Safety notice", body: "Open MelloCrush to read it" };

    case "ACCOUNT_NOTICE":
      return { title: "Account notice", body: "Open MelloCrush to read it" };
  }
}

/**
 * Where tapping it goes. A path on our own origin and nothing else — no ids beyond the ones already in the URL
 * bar when the member is looking at that screen, and no token of any kind.
 *
 * The path is a ROUTE, not an authorization. Every destination re-authorises on arrival exactly as it does when
 * typed: `/chats/<id>` runs `getConversationForActor`, `/community/<id>` runs `canSeePost`, and a member who taps
 * a notification for something they may no longer see gets the same NotFound as anyone else. That is why a
 * conversation id in the payload is not a leak: it is useless to whoever holds it without the session.
 */
export function pushUrlFor(input: {
  kind: PushKind;
  conversationId?: string | null;
  postId?: string | null;
  /** The notification's own payload. Read for exactly one case: the checkout reminder's order (§12.19). */
  data?: unknown;
}): string {
  switch (input.kind) {
    case "MESSAGE":
    case "MESSAGE_REACTION":
      return input.conversationId ? `/chats/${input.conversationId}` : "/chats";
    case "NEW_MATCH":
      return input.conversationId ? `/chats/${input.conversationId}` : "/likes";
    case "LIKE_RECEIVED":
    case "INTRO_RECEIVED":
      return "/likes";
    case "COMMUNITY_LIKE":
    case "COMMUNITY_COMMENT":
    case "COMMUNITY_COMMENT_REACTION":
      return input.postId ? `/community/${input.postId}` : "/community";
    case "VERIFICATION_UPDATE":
      return "/settings/verification";
    case "PAYMENT_APPROVED":
    case "PAYMENT_REJECTED":
    case "SUBSCRIPTION_EXPIRING":
    case "SUBSCRIPTION_EXPIRED":
      return "/settings/membership";
    case "SAFETY_NOTICE":
      return "/settings/safety";
    case "ACCOUNT_NOTICE": {
      // The checkout reminder returns the member to that order's own payment screen, which re-authorises on arrival
      // like every destination here. Every other account notice keeps its existing destination.
      const order = checkoutReminderOrderId(input.data);
      return order ? `/settings/membership/order/${order}?from=checkout_recovery` : "/settings";
    }
  }
}

/** The order id of a checkout-reminder payload (`{ kind: "CHECKOUT_REMINDER", orderId }`), or null for anything else. */
function checkoutReminderOrderId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  return d.kind === "CHECKOUT_REMINDER" && typeof d.orderId === "string" && /^[a-z0-9]{8,40}$/.test(d.orderId) ? d.orderId : null;
}

/** Which preference decides whether this kind may be pushed. */
export type PushCategory = "messages" | "likes" | "matches" | "reactions" | "community" | "account";

export const PUSH_CATEGORY: Record<PushKind, PushCategory> = {
  MESSAGE: "messages",
  MESSAGE_REACTION: "reactions",
  LIKE_RECEIVED: "likes",
  INTRO_RECEIVED: "likes",
  NEW_MATCH: "matches",
  COMMUNITY_LIKE: "reactions",
  COMMUNITY_COMMENT: "community",
  COMMUNITY_COMMENT_REACTION: "reactions",
  VERIFICATION_UPDATE: "account",
  PAYMENT_APPROVED: "account",
  PAYMENT_REJECTED: "account",
  SUBSCRIPTION_EXPIRING: "account",
  SUBSCRIPTION_EXPIRED: "account",
  SAFETY_NOTICE: "account",
  ACCOUNT_NOTICE: "account",
};

const KINDS = new Set<string>(Object.keys(PUSH_CATEGORY));

/** A notification type this module knows how to push. Anything else sends nothing rather than improvising. */
export function isPushKind(value: string): value is PushKind {
  return KINDS.has(value);
}
