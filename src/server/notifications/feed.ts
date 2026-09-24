/**
 * The member's own notification feed (docs/ARCHITECTURE.md §13). Every query and every mutation here is scoped to
 * the acting user's id in the WHERE clause, never by trusting an id from the client: `markNotificationRead` updates
 * `{ id, userId }` together, so passing somebody else's notification id changes nothing and returns the same
 * answer as passing one that does not exist. Nothing leaks whether that id exists.
 *
 * The rows are already produced across the app (likes, matches, messages, Community, verification, billing);
 * this module only reads them and marks them read. It adds no notification types and no producers.
 *
 * Privacy. The row text is composed here, on the server, rather than in the client, because who a row may name is
 * an authorization question:
 *  - A like is the paywall. Free members see a count and anonymised placeholders on Likes You (§12.5), so a
 *    LIKE_RECEIVED / INTRO_RECEIVED row reads "Someone liked you" with no name and no photo unless the viewer
 *    holds `seeIncomingLikes`. The client is never sent the liker's identity to hide.
*  - A blocked member is never named, whatever the row is. A like row names its liker only when that liker is
 *    actually on the viewer's Likes You page — the same `nameableLikers` rule the page runs — so the feed can
 *    never reveal somebody the page then refuses to show (§12.5).
 *  - A message preview is one line of a conversation the viewer is a participant in — the query re-asserts that
 *    participation instead of trusting the notification. Soft-deleted and non-text messages are skipped and the
 *    preview is truncated.
 * No other member's data is reachable from here.
 */
import { NOTIFICATION_FEED } from "@/config/product";
import { getDb, type Db } from "@/lib/db";
import { displayablePhotoWhere } from "@/lib/photo-policy";
import { getStorageProvider } from "@/lib/storage";
import { PHOTO_URL_TTL_SECONDS, type StorageProvider } from "@/lib/storage/provider";
import { reactionGlyph } from "@/lib/reactions";
import type { Actor } from "@/server/actor";
import { isDemoKey } from "@/server/discovery/dto";
import { getEntitlements } from "@/server/entitlements";
import { nameableLikers } from "@/server/likes/eligibility";

export type NotificationKind =
  | "NEW_MATCH"
  | "MESSAGE"
  | "LIKE_RECEIVED"
  | "INTRO_RECEIVED"
  | "COMMUNITY_LIKE"
  | "COMMUNITY_COMMENT"
  | "VERIFICATION_UPDATE"
  | "SAFETY_NOTICE"
  | "ACCOUNT_NOTICE"
  | "PAYMENT_APPROVED"
  | "PAYMENT_REJECTED"
  | "SUBSCRIPTION_EXPIRING"
  | "SUBSCRIPTION_EXPIRED"
  | "MESSAGE_REACTION"
  | "COMMUNITY_COMMENT_REACTION";

/** Which line icon a row falls back to when it shows no member photo. */
export type NotificationIcon = "like" | "match" | "message" | "community" | "verification" | "billing" | "safety" | "account";

export interface NotificationPhoto {
  url: string | null;
  demoKey: string | null;
  blurhash: string;
}

export interface NotificationDto {
  id: string;
  type: NotificationKind;
  createdAt: string;
  read: boolean;
  /** The main line, already resolved. An anonymised like says "Someone liked you" and carries no name. */
  title: string;
  /** One short line of context: a message preview, a verification outcome, a plan name. Null when there is none. */
  detail: string | null;
  /** Resolved destination. Null when the target is gone (a deleted post), so the row renders without a link. */
  href: string | null;
  /** The member's thumb, when this row may name them. Null on system rows and anonymised ones — then `icon` shows. */
  photo: NotificationPhoto | null;
  /** Accessible label for the avatar. Null whenever `photo` is null. */
  actorName: string | null;
  icon: NotificationIcon;
}

export interface NotificationFeedDto {
  items: NotificationDto[];
  unread: number;
  /** Opaque cursor for the next page. Null when there is nothing after this page. */
  nextCursor: string | null;
}

const SELECT = {
  id: true,
  type: true,
  createdAt: true,
  readAt: true,
  conversationId: true,
  postId: true,
  data: true,
  actorId: true,
  actor: { select: { status: true, profile: { select: { displayName: true } } } },
  conversation: { select: { id: true } },
  post: { select: { id: true, deletedAt: true } },
} as const;

type Row = {
  id: string;
  type: string;
  createdAt: Date;
  readAt: Date | null;
  conversationId: string | null;
  postId: string | null;
  data: unknown;
  actorId: string | null;
  actor: { status: string; profile: { displayName: string } | null } | null;
  conversation: { id: string } | null;
  post: { id: string; deletedAt: Date | null } | null;
};

/** The cursor is the ordering key itself, so a page boundary between two rows sharing a timestamp cannot skip one. */
function encodeCursor(row: Row): string {
  return `${row.createdAt.toISOString()}|${row.id}`;
}

function decodeCursor(cursor: string | null | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const sep = cursor.indexOf("|");
  if (sep <= 0) return null;
  const at = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (Number.isNaN(at.getTime()) || !id) return null;
  return { at, id };
}

/** Primary displayable thumb per actor, in one query, with the signed URLs requested together. */
async function actorPhotos(db: Db, userIds: string[], storage: StorageProvider): Promise<Map<string, NotificationPhoto>> {
  const out = new Map<string, NotificationPhoto>();
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return out;
  const rows = await db.profilePhoto.findMany({
    where: { profile: { userId: { in: ids } }, ...displayablePhotoWhere() },
    orderBy: [{ profileId: "asc" }, { position: "asc" }],
    distinct: ["profileId"],
    select: { thumbKey: true, blurhash: true, profile: { select: { userId: true } } },
  });
  await Promise.all(
    rows.map(async (ph) => {
      const userId = ph.profile.userId;
      if (isDemoKey(ph.thumbKey)) out.set(userId, { url: null, demoKey: ph.thumbKey, blurhash: ph.blurhash });
      else out.set(userId, { url: await storage.getReadUrl(ph.thumbKey, PHOTO_URL_TTL_SECONDS), demoKey: null, blurhash: ph.blurhash });
    }),
  );
  return out;
}

/** Ids on either side of a block with the viewer. A blocked member is never named in a notification. */
async function blockedActors(db: Db, userId: string, actorIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(actorIds)];
  if (ids.length === 0) return new Set();
  const rows = await db.block.findMany({
    where: { OR: [{ blockerId: userId, blockedId: { in: ids } }, { blockerId: { in: ids }, blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  return new Set(rows.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)));
}

/**
 * Latest visible line per conversation, for message rows. Scoped to conversations the viewer participates in — the
 * notification already proves that, and the extra `OR` makes it true in the query rather than by assumption.
 */
async function messagePreviews(db: Db, userId: string, conversationIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(conversationIds)];
  if (ids.length === 0) return out;
  const rows = await db.message.findMany({
    where: {
      conversationId: { in: ids },
      deletedAt: null,
      kind: "TEXT",
      conversation: { OR: [{ userAId: userId }, { userBId: userId }] },
    },
    orderBy: [{ conversationId: "asc" }, { createdAt: "desc" }],
    distinct: ["conversationId"],
    select: { conversationId: true, body: true },
  });
  for (const m of rows) {
    const body = m.body.trim().replace(/\s+/g, " ");
    if (!body) continue;
    out.set(m.conversationId, body.length > NOTIFICATION_FEED.previewChars ? `${body.slice(0, NOTIFICATION_FEED.previewChars - 1)}…` : body);
  }
  return out;
}

const ICONS: Record<NotificationKind, NotificationIcon> = {
  NEW_MATCH: "match",
  MESSAGE: "message",
  LIKE_RECEIVED: "like",
  INTRO_RECEIVED: "like",
  COMMUNITY_LIKE: "community",
  COMMUNITY_COMMENT: "community",
  VERIFICATION_UPDATE: "verification",
  SAFETY_NOTICE: "safety",
  ACCOUNT_NOTICE: "account",
  PAYMENT_APPROVED: "billing",
  PAYMENT_REJECTED: "billing",
  SUBSCRIPTION_EXPIRING: "billing",
  SUBSCRIPTION_EXPIRED: "billing",
  MESSAGE_REACTION: "message",
  COMMUNITY_COMMENT_REACTION: "community",
};

/** The order a checkout-reminder row is about (src/server/billing/checkout-reminder.ts), or null for any other row. */
function checkoutReminderOrder(row: Row): string | null {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return data.kind === "CHECKOUT_REMINDER" && typeof data.orderId === "string" && /^[a-z0-9]{8,40}$/.test(data.orderId) ? data.orderId : null;
}

/**
 * Where a row leads. Null means "no destination": a deleted Community post, or a post that is gone. The row still
 * renders and can still be marked read — it just is not a link, so nothing routes to a page that no longer exists.
 */
function destinationFor(row: Row): string | null {
  switch (row.type as NotificationKind) {
    case "MESSAGE":
    case "MESSAGE_REACTION":
      return row.conversation ? `/chats/${row.conversation.id}` : "/chats";
    case "NEW_MATCH":
      return row.conversation ? `/chats/${row.conversation.id}` : "/likes";
    case "LIKE_RECEIVED":
    case "INTRO_RECEIVED":
      return "/likes";
    case "COMMUNITY_LIKE":
    case "COMMUNITY_COMMENT":
    case "COMMUNITY_COMMENT_REACTION":
      return row.post && row.post.deletedAt === null ? `/community/${row.post.id}` : null;
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
      // The checkout reminder leads back into that order's own page, which re-authorises and shows its real status.
      const reminder = checkoutReminderOrder(row);
      return reminder ? `/settings/membership/order/${reminder}?from=checkout_recovery` : "/settings";
    }
    default:
      return null;
  }
}

/** The main line. `name` is null whenever this viewer may not know who the actor is. */
function titleFor(row: Row, name: string | null): string {
  const data = (row.data ?? {}) as Record<string, unknown>;
  switch (row.type as NotificationKind) {
    case "NEW_MATCH":
      return name ? `You matched with ${name}` : "You have a new match";
    case "MESSAGE":
      return name ? `${name} sent you a message` : "New message";
    case "LIKE_RECEIVED":
      return name ? `${name} liked you` : "Someone liked you";
    case "INTRO_RECEIVED":
      return name ? `${name} sent you an intro` : "Someone sent you an intro";
    case "COMMUNITY_LIKE": {
      const glyph = typeof data.emoji === "string" && data.emoji !== "HEART" ? reactionGlyph(data.emoji) : null;
      if (glyph) return name ? `${name} reacted ${glyph} to your post` : `Someone reacted ${glyph} to your post`;
      return name ? `${name} liked your post` : "Someone liked your post";
    }
    case "COMMUNITY_COMMENT":
      return name ? `${name} commented on your post` : "New comment on your post";
    case "MESSAGE_REACTION": {
      const glyph = reactionGlyph(typeof data.emoji === "string" ? data.emoji : "HEART");
      return name ? `${name} reacted ${glyph} to your message` : `Someone reacted ${glyph} to your message`;
    }
    case "COMMUNITY_COMMENT_REACTION": {
      const glyph = reactionGlyph(typeof data.emoji === "string" ? data.emoji : "HEART");
      return name ? `${name} reacted ${glyph} to your comment` : `Someone reacted ${glyph} to your comment`;
    }
    case "VERIFICATION_UPDATE":
      return data.status === "VERIFIED" ? "You're photo verified" : "Photo verification update";
    case "PAYMENT_APPROVED":
      return "Payment approved";
    case "PAYMENT_REJECTED":
      return "Payment not accepted";
    case "SUBSCRIPTION_EXPIRING":
      return "Your Plus is ending soon";
    case "SUBSCRIPTION_EXPIRED":
      return "Your Plus has ended";
    case "SAFETY_NOTICE":
      return "Safety notice";
    case "ACCOUNT_NOTICE":
      return checkoutReminderOrder(row) ? "Still interested in MelloCrush Plus?" : "Account notice";
    default:
      return "Notification";
  }
}

/** The one line of context under the title, from the row's own payload. Never another member's private data. */
function detailFor(row: Row, preview: string | null): string | null {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : null);
  switch (row.type as NotificationKind) {
    case "MESSAGE":
      return preview;
    case "NEW_MATCH":
      return "Say hello before the conversation goes cold";
    case "VERIFICATION_UPDATE":
      return data.status === "VERIFIED" ? "Your badge is live on your profile" : str("reason") ?? "Your selfie wasn't approved";
    case "PAYMENT_APPROVED":
      return str("planName") ? `${str("planName")} is active` : "Your plan is active";
    case "PAYMENT_REJECTED":
      return str("reason") ?? "Check the details and try again";
    case "SUBSCRIPTION_EXPIRING":
      return "Renew to keep your Plus features";
    case "SUBSCRIPTION_EXPIRED":
      return "Your Plus features have ended";
    case "ACCOUNT_NOTICE":
      // No approval-time promise: MelloCrush has no documented SLA, so the reminder does not invent one.
      return checkoutReminderOrder(row) ? "Your Plus order is waiting for payment." : null;
    default:
      return null;
  }
}

export async function countUnreadNotifications(actor: Actor, deps: { db?: Db } = {}): Promise<number> {
  const db = deps.db ?? getDb();
  return db.notification.count({ where: { userId: actor.userId, readAt: null } });
}

export async function getNotificationFeed(
  actor: Actor,
  options: { limit?: number; cursor?: string | null } = {},
  deps: { db?: Db; storage?: StorageProvider; now?: Date } = {},
): Promise<NotificationFeedDto> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const now = deps.now ?? new Date();
  const limit = Math.min(Math.max(options.limit ?? NOTIFICATION_FEED.dropdownSize, 1), NOTIFICATION_FEED.maxPageSize);
  const after = decodeCursor(options.cursor);

  const [found, unread] = await Promise.all([
    db.notification.findMany({
      where: {
        userId: actor.userId,
        ...(after ? { OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }] } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: SELECT,
    }),
    countUnreadNotifications(actor, { db }),
  ]);

  const rows = found.slice(0, limit) as Row[];
  const actorIds = rows.flatMap((r) => (r.actorId ? [r.actorId] : []));
  const hasLikeRow = rows.some((r) => r.type === "LIKE_RECEIVED" || r.type === "INTRO_RECEIVED");

  const likeActorIds = rows.flatMap((r) => ((r.type === "LIKE_RECEIVED" || r.type === "INTRO_RECEIVED") && r.actorId ? [r.actorId] : []));
  const [photos, previews, blocked, canSeeLikers] = await Promise.all([
    actorPhotos(db, actorIds, storage),
    messagePreviews(db, actor.userId, rows.flatMap((r) => (r.type === "MESSAGE" && r.conversationId ? [r.conversationId] : []))),
    blockedActors(db, actor.userId, actorIds),
    // Only worth a query when a like is actually on this page.
    hasLikeRow ? getEntitlements(db, actor.userId, now).then((e) => e.rules.canSeeIncomingLikes) : Promise.resolve(false),
  ]);

  /*
   * A like row may name its liker only when that liker is on the viewer's Likes You page right now — the same
   * `nameableLikers` rule the page itself runs. Paying for Plus and then being told a name that leads to an empty
   * page is worse than not being told (docs/ARCHITECTURE.md §12.5); this is what makes the two agree.
   *
   * Asked only once the entitlement is known, so a Free viewer costs no extra query.
   */
  const nameable = canSeeLikers ? await nameableLikers(db, actor.userId, likeActorIds, now) : new Set<string>();

  const items = rows.map((r) => {
    const kind = r.type as NotificationKind;
    const isLike = kind === "LIKE_RECEIVED" || kind === "INTRO_RECEIVED";
    const named =
      r.actorId !== null &&
      !blocked.has(r.actorId) &&
      (!isLike || (canSeeLikers && nameable.has(r.actorId)));
    const name = named ? r.actor?.profile?.displayName ?? null : null;
    return {
      id: r.id,
      type: kind,
      createdAt: r.createdAt.toISOString(),
      read: r.readAt !== null,
      title: titleFor(r, name),
      detail: detailFor(r, r.conversationId ? previews.get(r.conversationId) ?? null : null),
      href: destinationFor(r),
      photo: name && r.actorId ? photos.get(r.actorId) ?? null : null,
      actorName: name,
      icon: ICONS[kind] ?? "account",
    } satisfies NotificationDto;
  });

  return { items, unread, nextCursor: found.length > limit && rows.length > 0 ? encodeCursor(rows[rows.length - 1]!) : null };
}

/**
 * Marks one notification read. The id and the owner are matched together, so another member's id is a no-op that
 * reports the same `{ changed: false }` as an id that does not exist — the caller cannot tell them apart.
 */
export async function markNotificationRead(actor: Actor, id: string, deps: { db?: Db; now?: Date } = {}): Promise<{ changed: boolean; unread: number }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const result = await db.notification.updateMany({ where: { id, userId: actor.userId, readAt: null }, data: { readAt: now } });
  return { changed: result.count > 0, unread: await countUnreadNotifications(actor, { db }) };
}

/**
 * The member has looked at Likes You: their LIKE_RECEIVED notifications up to `seenAt` are read (docs/ARCHITECTURE.md
 * §13). Both tiers — a Free member saw the count and the tiles, a Plus member saw the people; either way the news in
 * those rows has been delivered.
 *
 * `seenAt` is the page's own server time, so a like that lands after the page was rendered stays unread; it is never
 * later than now. Only LIKE_RECEIVED, only the caller's own rows. The likes themselves, their eligibility and every
 * other notification type are untouched, and nothing is deleted.
 */
export async function markLikesSeen(actor: Actor, input: { seenAt: Date }, deps: { db?: Db; now?: Date } = {}): Promise<{ marked: number; unread: number }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const upTo = input.seenAt < now ? input.seenAt : now;
  const result = await db.notification.updateMany({ where: { userId: actor.userId, type: "LIKE_RECEIVED", readAt: null, createdAt: { lte: upTo } }, data: { readAt: now } });
  return { marked: result.count, unread: await countUnreadNotifications(actor, { db }) };
}

/** Marks every unread notification read. Nothing is deleted; the history stays. */
export async function markAllNotificationsRead(actor: Actor, deps: { db?: Db; now?: Date } = {}): Promise<{ marked: number; unread: number }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const result = await db.notification.updateMany({ where: { userId: actor.userId, readAt: null }, data: { readAt: now } });
  return { marked: result.count, unread: 0 };
}
