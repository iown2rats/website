/**
 * Verification review (docs/ARCHITECTURE.md §11, §21.5). Human review only: the reviewer compares the submitted selfie
 * with the member's profile photos by eye and decides. No face recognition, no similarity score. Google sign-in is
 * never evidence; nobody can be marked verified without a submitted selfie.
 */
import { z } from "zod";
import { getDb, type Db } from "@/lib/db";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage/provider";
import { noMarkup } from "@/lib/validation/onboarding";
import { assertVerificationTransition, PENDING_VERIFICATION_STATUSES, type VerificationStatus } from "@/server/verification/state";
import { VERIFICATION_RULES } from "@/server/verification/verification";
import { AUDIT_ACTIONS, writeAudit } from "./audit";
import { assertPermission, type AdminActor } from "./authz";

export interface VerificationQueueRowDto {
  userId: string;
  handle: string | null;
  displayName: string | null;
  status: string;
  submittedAt: string | null;
  attempts: number;
  hasSelfie: boolean;
}

const PENDING = [...PENDING_VERIFICATION_STATUSES] as ("SELFIE_SUBMITTED" | "UNDER_REVIEW")[];

export async function listVerificationQueue(admin: AdminActor, deps: { db?: Db; page?: number; pageSize?: number } = {}): Promise<{ items: VerificationQueueRowDto[]; total: number }> {
  assertPermission(admin, "verification.act");
  const db = deps.db ?? getDb();
  const page = Math.max(1, deps.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, deps.pageSize ?? 25));
  const where = { status: { in: PENDING } };
  const [rows, total] = await Promise.all([
    db.verification.findMany({ where, orderBy: { submittedAt: "asc" }, skip: (page - 1) * pageSize, take: pageSize, include: { user: { select: { profile: { select: { handle: true, displayName: true } } } } } }),
    db.verification.count({ where }),
  ]);
  return { items: rows.map((v) => ({ userId: v.userId, handle: v.user.profile?.handle ?? null, displayName: v.user.profile?.displayName ?? null, status: v.status, submittedAt: v.submittedAt?.toISOString() ?? null, attempts: v.attempts, hasSelfie: Boolean(v.selfieStorageKey) })), total };
}

/** Short-lived signed URL to the submitted selfie, for the reviewing admin only. Null when nothing was submitted. */
export async function getVerificationEvidenceUrl(admin: AdminActor, userId: string, deps: { db?: Db; storage?: StorageProvider } = {}): Promise<string | null> {
  assertPermission(admin, "verification.act");
  const db = deps.db ?? getDb();
  const v = await db.verification.findUnique({ where: { userId }, select: { selfieStorageKey: true } });
  if (!v?.selfieStorageKey) return null;
  return (deps.storage ?? getStorageProvider()).getReadUrl(v.selfieStorageKey, VERIFICATION_RULES.selfieUrlTtlSeconds);
}

export interface VerificationDetailDto {
  userId: string;
  handle: string | null;
  displayName: string | null;
  accountStatus: string;
  status: string;
  submittedAt: string | null;
  decidedAt: string | null;
  attempts: number;
  rejectionReason: string | null;
  reviewedBy: { userId: string; displayName: string | null } | null;
  /** Signed, short-lived. Null when no selfie is on file. */
  selfieUrl: string | null;
  /** The member's current profile photos (all moderation states, so the reviewer sees what the member uploaded). */
  profilePhotos: { id: string; position: number; moderation: string; url: string | null }[];
  /** Earlier decisions on this member, newest first, from the audit log. */
  history: { at: string; decision: string; reason: string | null; reviewer: string | null }[];
}

export async function getVerificationDetail(admin: AdminActor, userId: string, deps: { db?: Db; storage?: StorageProvider } = {}): Promise<VerificationDetailDto> {
  assertPermission(admin, "verification.act");
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const v = await db.verification.findUnique({
    where: { userId },
    include: {
      user: { select: { status: true, profile: { select: { handle: true, displayName: true, photos: { orderBy: { position: "asc" }, select: { id: true, position: true, moderation: true, thumbKey: true } } } } } },
      reviewedBy: { select: { id: true, profile: { select: { displayName: true } } } },
    },
  });
  if (!v) throw new NotFoundError("Verification");
  const [selfieUrl, profilePhotos, audit] = await Promise.all([
    v.selfieStorageKey ? storage.getReadUrl(v.selfieStorageKey, VERIFICATION_RULES.selfieUrlTtlSeconds) : Promise.resolve(null),
    Promise.all((v.user.profile?.photos ?? []).map(async (p) => ({ id: p.id, position: p.position, moderation: p.moderation, url: p.thumbKey.startsWith("demo/") ? null : await storage.getReadUrl(p.thumbKey, VERIFICATION_RULES.selfieUrlTtlSeconds) }))),
    db.auditLog.findMany({ where: { action: AUDIT_ACTIONS.verificationDecided, targetType: "User", targetId: userId }, orderBy: { createdAt: "desc" }, take: 20, select: { createdAt: true, data: true, actor: { select: { profile: { select: { displayName: true } } } } } }),
  ]);
  return {
    userId: v.userId,
    handle: v.user.profile?.handle ?? null,
    displayName: v.user.profile?.displayName ?? null,
    accountStatus: v.user.status,
    status: v.status,
    submittedAt: v.submittedAt?.toISOString() ?? null,
    decidedAt: v.decidedAt?.toISOString() ?? null,
    attempts: v.attempts,
    rejectionReason: v.rejectionReason,
    reviewedBy: v.reviewedBy ? { userId: v.reviewedBy.id, displayName: v.reviewedBy.profile?.displayName ?? null } : null,
    selfieUrl,
    profilePhotos,
    history: audit.map((a) => {
      const d = (a.data ?? {}) as { after?: { status?: string }; reason?: string | null };
      return { at: a.createdAt.toISOString(), decision: d.after?.status ?? "?", reason: d.reason ?? null, reviewer: a.actor?.profile?.displayName ?? null };
    }),
  };
}

const decisionSchema = z.object({ decision: z.enum(["VERIFIED", "REJECTED"]), reason: noMarkup(300, "Reason").optional().default("") });

/**
 * The human decision. Runs under a row lock; the state machine refuses anything that is not pending; a member with
 * no selfie on file cannot be verified. Rejection needs a reason the member will read. Audited with before/after.
 * The account's status is untouched: verifying never unsuspends anyone.
 */
export async function decideVerification(admin: AdminActor, userId: string, input: unknown, deps: { db?: Db; now?: Date } = {}): Promise<{ userId: string; status: "VERIFIED" | "REJECTED" }> {
  assertPermission(admin, "verification.act");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the decision");
  const { decision, reason } = parsed.data;
  if (decision === "REJECTED" && reason.length < 3) throw new ValidationError("Tell the person why it wasn't approved");
  if (userId === admin.userId) throw new InvalidStateError("You can't review your own verification");
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT "userId" FROM "Verification" WHERE "userId" = ${userId} FOR UPDATE`;
    const v = await tx.verification.findUnique({ where: { userId }, select: { status: true, selfieStorageKey: true } });
    if (!v) throw new NotFoundError("Verification");
    if (!PENDING_VERIFICATION_STATUSES.includes(v.status as VerificationStatus)) throw new InvalidStateError("There is nothing waiting for review");
    assertVerificationTransition(v.status as VerificationStatus, decision);
    if (!v.selfieStorageKey) throw new InvalidStateError("No selfie was submitted, so there is nothing to verify against");
    await tx.verification.update({ where: { userId }, data: { status: decision, reviewedById: admin.userId, decidedAt: now, rejectionReason: decision === "REJECTED" ? reason : null } });
    await tx.notification.create({ data: { userId, type: "VERIFICATION_UPDATE", data: { status: decision, reason: decision === "REJECTED" ? reason : null }, createdAt: now } });
    await writeAudit(tx, { actorId: admin.userId, action: AUDIT_ACTIONS.verificationDecided, targetType: "User", targetId: userId, data: { reason: reason || null, before: { status: v.status }, after: { status: decision } }, now });
  });
  return { userId, status: decision };
}
