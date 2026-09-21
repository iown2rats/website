/**
 * Community DTOs (docs/ARCHITECTURE.md §14). Authors carry only the public identity the prototype shows:
 * display name, handle, verified flag, displayable avatar and island (or nothing when hidden). Never phone, DOB,
 * database ids, contact hashes, subscription, moderation or report data. Prisma rows are never serialised directly.
 */
import type { DbLike } from "@/lib/db";
import { displayableCommunityMediaStates, displayablePhotoWhere } from "@/lib/photo-policy";
import { PHOTO_URL_TTL_SECONDS, type StorageProvider } from "@/lib/storage/provider";
import { isDemoKey } from "@/server/discovery/dto";
import type { PollDto } from "./polls";
import type { PostContextDto } from "./social-context";
import type { TopicKey } from "./topics";

export interface CommunityPhotoDto {
  url: string | null;
  demoKey: string | null;
  blurhash: string;
}

export interface CommunityAuthorDto {
  handle: string;
  name: string;
  verified: boolean;
  /** Island / city label, or null when the author hides their location. */
  location: string | null;
  photo: CommunityPhotoDto | null;
  isMe: boolean;
  /**
   * Whether the VIEWER follows this member. Private by design: it answers "do I follow them", never "who follows
   * them" or "how many". The person being described is never told (src/server/community/follows.ts).
   */
  followed: boolean;
}

export type CommunityPostKind = "TEXT" | "QUESTION" | "PHOTO" | "POLL" | "CONFESSION";

export interface CommunityPostDto {
  id: string;
  kind: CommunityPostKind;
  /** Which chip this post sits under, or null when the author chose none. */
  topic: TopicKey | null;
  body: string;
  /** Null for text posts, or when the photo is not displayable to this viewer (author sees `underReview`). */
  photo: CommunityPhotoDto | null;
  /** True for the author while their photo awaits moderation under the active policy. */
  photoUnderReview: boolean;
  /** Options, totals and the viewer's own choice. Null for every kind but POLL. */
  poll: PollDto | null;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  createdAt: string;
  /** True when `author` is the placeholder rather than a real member (see `ANONYMOUS_AUTHOR`). */
  isAnonymous: boolean;
  author: CommunityAuthorDto;
  isMine: boolean;
  /** Real aggregate signals ("12 people joined this conversation"), or null when there is nothing true to say. */
  context: PostContextDto | null;
}

export interface CommunityCommentDto {
  id: string;
  body: string;
  createdAt: string;
  author: CommunityAuthorDto;
  isMine: boolean;
}

/**
 * What every viewer — including the author — is told about the author of an anonymous confession.
 *
 * A frozen constant rather than a derived object on purpose. The rule "an anonymous post carries no identifying
 * field" is then one value that a test can compare against, instead of five nullings spread through a hydrator
 * where the sixth one added later is the leak. `handle` is the empty string, which the profile overlay already
 * treats as "this profile isn't available", so tapping the name cannot open a profile either (spec §7).
 *
 * The row behind it is untouched: CommunityPost.authorId stays set and NOT NULL, so reports, moderation, blocks
 * and the admin surfaces see exactly who wrote it. Anonymity is presentation, never a gap in the record.
 */
export const ANONYMOUS_AUTHOR: CommunityAuthorDto = Object.freeze({
  handle: "",
  name: "Anonymous",
  verified: false,
  location: null,
  photo: null,
  isMe: false,
  followed: false,
});

export const authorSelect = () => ({
  id: true,
  privacy: { select: { hideLocation: true } },
  verification: { select: { status: true } },
  profile: {
    select: {
      handle: true,
      displayName: true,
      location: { select: { name: true } },
      photos: { where: displayablePhotoWhere(), orderBy: { position: "asc" as const }, take: 1, select: { thumbKey: true, blurhash: true } },
    },
  },
});

type AuthorRow = {
  id: string;
  privacy: { hideLocation: boolean } | null;
  verification: { status: string } | null;
  profile: { handle: string; displayName: string; location: { name: string } | null; photos: { thumbKey: string; blurhash: string }[] } | null;
};

export async function photoDto(storage: StorageProvider, key: string | null | undefined, blurhash: string | null | undefined): Promise<CommunityPhotoDto | null> {
  if (!key) return null;
  if (isDemoKey(key)) return { url: null, demoKey: key, blurhash: blurhash ?? "" };
  return { url: await storage.getReadUrl(key, PHOTO_URL_TTL_SECONDS), demoKey: null, blurhash: blurhash ?? "" };
}

export async function toAuthorDto(storage: StorageProvider, viewerId: string, u: AuthorRow, followed = false): Promise<CommunityAuthorDto> {
  const first = u.profile?.photos[0];
  return {
    handle: u.profile?.handle ?? "",
    name: u.profile?.displayName ?? "Member",
    verified: u.verification?.status === "VERIFIED",
    location: u.privacy?.hideLocation ? null : (u.profile?.location?.name ?? null),
    photo: await photoDto(storage, first?.thumbKey, first?.blurhash),
    isMe: u.id === viewerId,
    followed,
  };
}

export function isMediaDisplayable(moderation: string): boolean {
  return (displayableCommunityMediaStates() as readonly string[]).includes(moderation);
}

/**
 * Loads authors for a set of user ids in one query, preserving privacy rules.
 *
 * Operational accounts are filtered out here as well as in the post and comment predicates (§22.6): a staff
 * account must never be rendered as a Community member, and this is the function that renders one. An author that
 * is dropped leaves its post or comment without an author entry, which the callers already treat as "not
 * displayable".
 */
export async function loadAuthors(db: DbLike, storage: StorageProvider, viewerId: string, userIds: string[]): Promise<Map<string, CommunityAuthorDto>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const [rows, follows] = await Promise.all([
    db.user.findMany({ where: { id: { in: unique }, accountType: "MEMBER" }, select: authorSelect() }),
    db.communityFollow.findMany({ where: { followerId: viewerId, followingId: { in: unique } }, select: { followingId: true } }),
  ]);
  const followed = new Set(follows.map((f) => f.followingId));
  const out = new Map<string, CommunityAuthorDto>();
  await Promise.all(rows.map(async (r) => out.set(r.id, await toAuthorDto(storage, viewerId, r, followed.has(r.id)))));
  return out;
}
