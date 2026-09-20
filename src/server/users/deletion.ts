/**
 * Account deletion (Phase 9 §25–§26; Google-auth migration). A destructive action needs recent authentication: the
 * user re-authenticates with the same Google or Telegram identity (docs/ARCHITECTURE.md §4.4), which marks their current
 * session; deletion consumes that mark and refuses without it, so an old application session alone can never
 * delete an account. Deletion anonymises the account and removes personal data while keeping safety evidence
 * (reports, blocks, message history, audit log). The sign-in identity row is kept with its email scrubbed and
 * `releasedAt` set, so the same Google account is told its previous account was deleted before it may start a
 * new one — the deleted profile itself is never revived.
 */
import { randomBytes } from "node:crypto";
import { getDb, type Db } from "@/lib/db";
import { InvalidStateError } from "@/lib/errors";
import type { StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { consumeRecentAuthentication } from "@/server/auth/recent-auth";
import { StaffInMemberDomainError } from "@/server/members/guard";

export type DeleteAccountResult = { ok: true } | { ok: false; code: "REAUTH_REQUIRED" };

/**
 * Consumes the session's recent Google re-authentication, then anonymises the account in one transaction.
 * Kept: Report, Block, Message, AuditLog, Subscription rows (billing records), the anonymised User row and the
 * scrubbed identity row. Removed: photos (rows + files), profile text, interests, prompts, likes, passes,
 * notifications, contact hashes, push subscriptions, sessions, community likes; posts and comments are
 * soft-deleted; matches end and conversations lock.
 */
export async function deleteAccount(actor: Actor, input: { sessionId: string }, deps: { db?: Db; storage: StorageProvider; now?: Date }): Promise<DeleteAccountResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { id: true, accountType: true, status: true } });
  if (user.status === "DELETED") throw new InvalidStateError("This account is already deleted");
  // Member deletion anonymises a dating profile and its graph. An operational account has none of that, and
  // removing one is a revocation decided in the admin portal, not self-service (§16, §22).
  if (user.accountType !== "MEMBER") throw new StaffInMemberDomainError();

  const fresh = await consumeRecentAuthentication(db, input.sessionId, now);
  if (!fresh) return { ok: false, code: "REAUTH_REQUIRED" };

  const photos = await db.profilePhoto.findMany({ where: { profile: { userId: user.id } }, select: { storageKey: true, thumbKey: true } });
  const verification = await db.verification.findUnique({ where: { userId: user.id }, select: { selfieStorageKey: true } });

  await db.$transaction(async (tx) => {
    const uid = user.id;
    // Profile content → anonymised.
    await tx.profilePhoto.deleteMany({ where: { profile: { userId: uid } } });
    await tx.profileInterest.deleteMany({ where: { profile: { userId: uid } } });
    await tx.profilePrompt.deleteMany({ where: { profile: { userId: uid } } });
    await tx.profile.updateMany({
      where: { userId: uid },
      data: { displayName: "Deleted member", bio: null, occupation: null, education: null, languages: [], heightCm: null, locationId: null, homeLocationId: null, intent: null },
    });
    // Dating state: no pending interactions survive; matches end for the other person, history stays readable.
    await tx.like.deleteMany({ where: { OR: [{ fromUserId: uid }, { toUserId: uid }] } });
    await tx.pass.deleteMany({ where: { OR: [{ fromUserId: uid }, { toUserId: uid }] } });
    await tx.match.updateMany({ where: { status: "ACTIVE", OR: [{ userAId: uid }, { userBId: uid }] }, data: { status: "UNMATCHED", unmatchedAt: now, unmatchedById: uid } });
    await tx.conversation.updateMany({ where: { status: "ACTIVE", OR: [{ userAId: uid }, { userBId: uid }] }, data: { status: "LOCKED" } });
    // Community: soft-delete authored content, remove reactions, keep counters exact.
    const likedPosts = await tx.communityLike.findMany({ where: { userId: uid }, select: { postId: true } });
    await tx.communityLike.deleteMany({ where: { userId: uid } });
    for (const { postId } of likedPosts) {
      await tx.$executeRaw`UPDATE "CommunityPost" p SET "likeCount" = (SELECT count(*) FROM "CommunityLike" l WHERE l."postId" = p.id) WHERE p.id = ${postId}`;
    }
    const commented = await tx.communityComment.findMany({ where: { authorId: uid, deletedAt: null }, select: { postId: true } });
    await tx.communityComment.updateMany({ where: { authorId: uid, deletedAt: null }, data: { deletedAt: now } });
    for (const postId of new Set(commented.map((c) => c.postId))) {
      await tx.$executeRaw`UPDATE "CommunityPost" p SET "commentCount" = (SELECT count(*) FROM "CommunityComment" c WHERE c."postId" = p.id AND c."deletedAt" IS NULL) WHERE p.id = ${postId}`;
    }
    await tx.communityPost.updateMany({ where: { authorId: uid, deletedAt: null }, data: { deletedAt: now } });
    // Personal data with no safety value.
    await tx.notification.deleteMany({ where: { OR: [{ userId: uid }, { actorId: uid }] } });
    await tx.contactHash.deleteMany({ where: { userId: uid } });
    await tx.pushSubscription.deleteMany({ where: { userId: uid } });
    await tx.session.deleteMany({ where: { userId: uid } });
    await tx.authIdentity.updateMany({ where: { userId: uid }, data: { email: null, displayName: null, providerUsername: null, releasedAt: now } });
    await tx.verification.updateMany({ where: { userId: uid }, data: { status: "NONE", selfieStorageKey: null, providerRef: null } });
    await tx.privacySettings.updateMany({ where: { userId: uid }, data: { visibility: "HIDDEN", pausedAt: now, invisibleMode: false } });
    // The account itself: no phone, unrecoverable hash, no DOB or gender.
    await tx.user.update({
      where: { id: uid },
      data: { status: "DELETED", deletedAt: now, phoneE164: null, phoneHash: randomBytes(32), dateOfBirth: null, gender: null, lastActiveAt: null },
    });
    await tx.auditLog.create({ data: { actorId: uid, action: "account.deleted", targetType: "User", targetId: uid, createdAt: now } });
  });

  const keys = [...photos.flatMap((p) => [p.storageKey, p.thumbKey]), ...(verification?.selfieStorageKey ? [verification.selfieStorageKey] : [])];
  if (keys.length) await deps.storage.delete(keys).catch(() => undefined);
  return { ok: true };
}
