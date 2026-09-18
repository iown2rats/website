/**
 * Verification queue (docs/ARCHITECTURE.md §11, §21.5). The selfie upload step is not built yet, so this queue is
 * empty in practice; the decision path is real but refuses to mark anyone VERIFIED without a submitted selfie.
 * Google sign-in is never evidence.
 */
import { z } from "zod";
import { getDb, type Db } from "@/lib/db";
import { InvalidStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage/provider";
import { noMarkup } from "@/lib/validation/onboarding";
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

export async function listVerificationQueue(admin: AdminActor, deps: { db?: Db; page?: number; pageSize?: number } = {}): Promise<{ items: VerificationQueueRowDto[]; total: number }> {
  assertPermission(admin, "verification.act");
  const db = deps.db ?? getDb();
  const page = Math.max(1, deps.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, deps.pageSize ?? 25));
  const where = { status: { in: ["SELFIE_SUBMITTED", "UNDER_REVIEW"] as ("SELFIE_SUBMITTED" | "UNDER_REVIEW")[] } };
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
  return (deps.storage ?? getStorageProvider()).getReadUrl(v.selfieStorageKey, 300);
}

const decisionSchema = z.object({ decision: z.enum(["VERIFIED", "REJECTED"]), reason: noMarkup(300, "Reason").optional().default("") });

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
    if (v.status !== "SELFIE_SUBMITTED" && v.status !== "UNDER_REVIEW") throw new InvalidStateError("There is nothing waiting for review");
    if (!v.selfieStorageKey) throw new InvalidStateError("No selfie was submitted, so there is nothing to verify against");
    await tx.verification.update({ where: { userId }, data: { status: decision, reviewedById: admin.userId, decidedAt: now, rejectionReason: decision === "REJECTED" ? reason : null } });
    await tx.notification.create({ data: { userId, type: "VERIFICATION_UPDATE", data: { status: decision, reason: decision === "REJECTED" ? reason : null }, createdAt: now } });
    await writeAudit(tx, { actorId: admin.userId, action: AUDIT_ACTIONS.verificationDecided, targetType: "User", targetId: userId, data: { reason: reason || null, before: { status: v.status }, after: { status: decision } }, now });
  });
  return { userId, status: decision };
}
