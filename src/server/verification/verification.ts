/**
 * Photo verification, member side (docs/ARCHITECTURE.md §11).
 *
 * What the badge means: an admin or moderator looked at a selfie the member took and judged that it shows the same
 * person as the profile photos. Nothing more: no identity document, no nationality, no age, no background check, and
 * Google sign-in is never evidence. Copy everywhere says "Photo verified".
 *
 * The selfie is a private document: re-encoded with metadata dropped, stored under a server-chosen key in the
 * private bucket (`verification-selfies/<userId>/<id>.webp`), reachable only through short-lived signed URLs handed
 * to the owner and to reviewers. A replaced selfie's file is deleted. Account deletion removes the current file.
 */
import { randomUUID } from "node:crypto";
import { getDb, type Db, type DbLike, type Tx } from "@/lib/db";
import { InvalidStateError, ValidationError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { processImage } from "@/server/media/process-image";
import { sniffUnsupported, unsupportedMessage } from "@/server/media/sniff";
import { manualReviewProvider, type VerificationProvider } from "./provider";
import { assertVerificationTransition, phaseOf, type VerificationPhase, type VerificationStatus } from "./state";

export const VERIFICATION_RULES = {
  /** A rejected member may submit again after this long (§11). */
  retryAfterMs: 24 * 3_600_000,
  /** Anti-abuse: selfie uploads per member per hour. */
  uploadsPerHour: 3,
  maxBytes: 8 * 1024 * 1024,
  maxWidth: 1080,
  maxHeight: 1440,
  /** Signed URL lifetime for the owner's own preview and for reviewers. */
  selfieUrlTtlSeconds: 300,
} as const;

export interface VerificationStateDto {
  phase: VerificationPhase;
  submittedAt: string | null;
  decidedAt: string | null;
  /** The reviewer's reason, written for the member. Null unless REJECTED. */
  rejectionReason: string | null;
  attempts: number;
  /** Whether a selfie can be submitted right now (eligible state, retry window elapsed, account active). */
  canSubmit: boolean;
  /** When a rejected member may try again; null when not applicable. */
  retryAvailableAt: string | null;
  /** Short-lived signed URL of the member's own current selfie, only when requested and one exists. */
  selfieUrl: string | null;
}

export interface SelfieUpload {
  bytes: Uint8Array;
  size: number;
}

function retryAt(status: VerificationStatus, decidedAt: Date | null): Date | null {
  if (status !== "REJECTED" || !decidedAt) return null;
  return new Date(decidedAt.getTime() + VERIFICATION_RULES.retryAfterMs);
}

/** Why a selfie cannot be submitted now, or null when it can. Pure. */
export function submitBlocker(input: { status: VerificationStatus; decidedAt: Date | null; accountStatus: string; onboardingCompletedAt: Date | null }, now: Date): string | null {
  if (input.accountStatus === "ONBOARDING" || (input.accountStatus === "ACTIVE" && !input.onboardingCompletedAt)) return "Finish setting up your profile before getting verified.";
  if (input.accountStatus !== "ACTIVE") return "This account can't submit a verification right now.";
  if (input.status === "VERIFIED") return "You're already verified.";
  if (input.status === "SELFIE_SUBMITTED" || input.status === "UNDER_REVIEW") return "Your selfie is already under review.";
  const retry = retryAt(input.status, input.decidedAt);
  if (retry && retry.getTime() > now.getTime()) return "You can try again 24 hours after the last decision.";
  return null;
}

async function ensureRow(db: DbLike, userId: string) {
  return db.verification.upsert({ where: { userId }, create: { userId, status: "NONE" }, update: {}, select: { status: true, selfieStorageKey: true, submittedAt: true, decidedAt: true, rejectionReason: true, attempts: true } });
}

export async function getVerificationState(actor: Actor, deps: { db?: Db; storage?: StorageProvider; now?: Date; withSelfie?: boolean } = {}): Promise<VerificationStateDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const [row, user] = await Promise.all([ensureRow(db, actor.userId), db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { status: true, onboardingCompletedAt: true } })]);
  const status = row.status as VerificationStatus;
  const blocker = submitBlocker({ status, decidedAt: row.decidedAt, accountStatus: user.status, onboardingCompletedAt: user.onboardingCompletedAt }, now);
  const selfieUrl = deps.withSelfie && row.selfieStorageKey && phaseOf(status) === "PENDING" ? await (deps.storage ?? getStorageProvider()).getReadUrl(row.selfieStorageKey, VERIFICATION_RULES.selfieUrlTtlSeconds) : null;
  return {
    phase: phaseOf(status),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    rejectionReason: status === "REJECTED" ? row.rejectionReason : null,
    attempts: row.attempts,
    canSubmit: blocker === null,
    retryAvailableAt: retryAt(status, row.decidedAt)?.toISOString() ?? null,
    selfieUrl,
  };
}

async function lockRow(tx: Tx, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT "userId" FROM "Verification" WHERE "userId" = ${userId} FOR UPDATE`;
}

/**
 * Submits a verification selfie. Eligibility, the retry window, the rate limit and the state machine are all
 * checked here; the client sends a file and nothing else. The status moves NONE/REJECTED → SELFIE_SUBMITTED →
 * (provider) UNDER_REVIEW inside one transaction; the previous selfie file, if any, is deleted afterwards.
 */
export async function submitSelfie(actor: Actor, file: SelfieUpload, deps: { db?: Db; storage?: StorageProvider; provider?: VerificationProvider; now?: Date } = {}): Promise<VerificationStateDto> {
  const db = deps.db ?? getDb();
  const storage = deps.storage ?? getStorageProvider();
  const provider = deps.provider ?? manualReviewProvider;
  const now = deps.now ?? new Date();

  if (file.size > VERIFICATION_RULES.maxBytes || file.bytes.byteLength > VERIFICATION_RULES.maxBytes) throw new ValidationError("That photo is too large. Choose one under 8 MB.");
  if (file.bytes.byteLength === 0) throw new ValidationError("That file is empty.");
  const unsupported = sniffUnsupported(file.bytes);
  if (unsupported) throw new ValidationError(unsupportedMessage(unsupported, "selfie"));

  const [row, user] = await Promise.all([ensureRow(db, actor.userId), db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { status: true, onboardingCompletedAt: true } })]);
  const blocker = submitBlocker({ status: row.status as VerificationStatus, decidedAt: row.decidedAt, accountStatus: user.status, onboardingCompletedAt: user.onboardingCompletedAt }, now);
  if (blocker) throw new InvalidStateError(blocker);

  const limit = await consumeRateLimit(db, `verification:selfie:${actor.userId}`, VERIFICATION_RULES.uploadsPerHour, 3_600_000, now);
  if (!limit.allowed) throw new ValidationError("Too many attempts. Try again in a while.");

  const processed = await processImage(file.bytes, { maxWidth: VERIFICATION_RULES.maxWidth, maxHeight: VERIFICATION_RULES.maxHeight, quality: 82 });
  const selfieKey = `verification-selfies/${actor.userId}/${randomUUID()}.webp`;
  await storage.put(selfieKey, processed.full, "image/webp");

  const profilePhotoKeys = (await db.profilePhoto.findMany({ where: { profile: { userId: actor.userId } }, select: { storageKey: true } })).map((p) => p.storageKey);
  const decision = await provider.submit({ userId: actor.userId, selfieKey, profilePhotoKeys });

  let previousKey: string | null = null;
  try {
    await db.$transaction(async (tx) => {
      await lockRow(tx, actor.userId);
      const fresh = await tx.verification.findUniqueOrThrow({ where: { userId: actor.userId }, select: { status: true, selfieStorageKey: true, decidedAt: true, attempts: true } });
      const freshUser = await tx.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { status: true, onboardingCompletedAt: true } });
      const again = submitBlocker({ status: fresh.status as VerificationStatus, decidedAt: fresh.decidedAt, accountStatus: freshUser.status, onboardingCompletedAt: freshUser.onboardingCompletedAt }, now);
      if (again) throw new InvalidStateError(again);
      assertVerificationTransition(fresh.status as VerificationStatus, "SELFIE_SUBMITTED");
      if (decision.status === "UNDER_REVIEW") assertVerificationTransition("SELFIE_SUBMITTED", "UNDER_REVIEW");
      previousKey = fresh.selfieStorageKey;
      await tx.verification.update({
        where: { userId: actor.userId },
        data: { status: decision.status, selfieStorageKey: selfieKey, provider: provider.id, providerRef: decision.providerRef, submittedAt: now, reviewedById: null, decidedAt: null, rejectionReason: null, attempts: fresh.attempts + 1 },
      });
    });
  } catch (e) {
    await storage.delete([selfieKey]).catch(() => undefined);
    throw e;
  }
  if (previousKey && previousKey !== selfieKey) await storage.delete([previousKey]).catch(() => undefined);
  return getVerificationState(actor, { db, storage, now, withSelfie: true });
}
