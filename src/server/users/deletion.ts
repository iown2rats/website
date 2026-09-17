/**
 * Account deletion (Phase 9 §25–§26). A destructive action needs recent authentication: the user requests a code to
 * their own phone (same OTP rules and provider abstraction as sign-in) and confirms with it. Deletion anonymises the
 * account and removes personal data while keeping safety evidence (reports, blocks, message history, audit log):
 * see docs/ARCHITECTURE.md §4.4 for what is removed, what is kept and the retention decision still open.
 */
import { randomBytes } from "node:crypto";
import { getDb, type Db } from "@/lib/db";
import { InvalidStateError, ValidationError } from "@/lib/errors";
import type { StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { requestOtp, verifyOtpCode, type RequestOtpResult } from "@/server/auth/otp";
import type { SmsProvider } from "@/server/auth/sms";

export async function requestDeletionCode(actor: Actor, deps: { db?: Db; sms: SmsProvider; ip?: string | null; now?: Date }): Promise<RequestOtpResult> {
  const db = deps.db ?? getDb();
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { phoneE164: true, status: true } });
  if (user.status === "DELETED") throw new InvalidStateError("This account is already deleted");
  return requestOtp(db, { phoneInput: user.phoneE164, ip: deps.ip ?? null, now: deps.now, sms: deps.sms });
}

export type DeleteAccountResult = { ok: true } | { ok: false; code: "INVALID_CODE" | "CODE_EXPIRED" | "CODE_USED" | "TOO_MANY_ATTEMPTS"; attemptsRemaining?: number };

/**
 * Verifies the fresh code (must belong to this account's own phone), then anonymises the account in one transaction.
 * Kept: Report, Block, Message, AuditLog, Subscription rows (billing records), the anonymised User row.
 * Removed: photos (rows + files), profile text, interests, prompts, likes, passes, notifications, contact hashes,
 * push subscriptions, sessions, community likes; posts and comments are soft-deleted; matches end and conversations lock.
 */
export async function deleteAccount(actor: Actor, input: { challengeId: string; code: string }, deps: { db?: Db; storage: StorageProvider; now?: Date }): Promise<DeleteAccountResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { id: true, phoneE164: true, status: true } });
  if (user.status === "DELETED") throw new InvalidStateError("This account is already deleted");

  const checked = await verifyOtpCode(db, { challengeId: input.challengeId, code: input.code, now });
  if (!checked.ok) return checked;
  if (checked.phoneE164 !== user.phoneE164) throw new ValidationError("That code wasn't sent to this account's phone.");

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
    await tx.otpRequest.updateMany({ where: { phoneE164: user.phoneE164, consumedAt: null, supersededAt: null }, data: { supersededAt: now } });
    await tx.verification.updateMany({ where: { userId: uid }, data: { status: "NONE", selfieStorageKey: null, providerRef: null } });
    await tx.privacySettings.updateMany({ where: { userId: uid }, data: { visibility: "HIDDEN", pausedAt: now, invisibleMode: false } });
    // The account itself: unusable phone, unrecoverable hash, no DOB or gender.
    await tx.user.update({
      where: { id: uid },
      data: { status: "DELETED", deletedAt: now, phoneE164: `deleted:${uid}`, phoneHash: randomBytes(32), dateOfBirth: null, gender: null, lastActiveAt: null },
    });
    await tx.auditLog.create({ data: { actorId: uid, action: "account.deleted", targetType: "User", targetId: uid, createdAt: now } });
  });

  const keys = [...photos.flatMap((p) => [p.storageKey, p.thumbKey]), ...(verification?.selfieStorageKey ? [verification.selfieStorageKey] : [])];
  if (keys.length) await deps.storage.delete(keys).catch(() => undefined);
  return { ok: true };
}
