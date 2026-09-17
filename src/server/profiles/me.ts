/**
 * The signed-in user's own profile summary for the Profile tab. Includes private-derived values (age) for the
 * owner only; never phone or DOB. Row metadata (counts, membership, verification) comes from the user's own rows.
 */
import { getDb, type Db } from "@/lib/db";
import { ageFromDateOfBirth } from "@/lib/age";
import { getStorageProvider } from "@/lib/storage";
import { PHOTO_URL_TTL_SECONDS } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { resolveTier } from "@/server/entitlements";
import { getOnboardingData } from "@/server/onboarding/onboarding";
import type { CompletionResult } from "./completion";

export interface MyProfileSummary {
  name: string;
  age: number | null;
  location: string | null;
  occupation: string | null;
  verified: boolean;
  verificationStatus: "NONE" | "PHONE_VERIFIED" | "SELFIE_SUBMITTED" | "UNDER_REVIEW" | "VERIFIED" | "REJECTED";
  primaryPhoto: { url: string | null; key: string | null; blurhash: string } | null;
  completion: CompletionResult;
  tier: "FREE" | "PLUS";
  likesGiven: number;
  activeMatches: number;
}

export async function getMyProfileSummary(actor: Actor, deps: { db?: Db; now?: Date } = {}): Promise<MyProfileSummary> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const [user, data, tier, likesGiven, activeMatches] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: {
        dateOfBirth: true,
        verification: { select: { status: true } },
        profile: {
          select: {
            displayName: true,
            occupation: true,
            location: { select: { name: true } },
            photos: { where: { moderation: { not: "REJECTED" } }, orderBy: { position: "asc" }, take: 1, select: { thumbKey: true, blurhash: true } },
          },
        },
      },
    }),
    getOnboardingData(actor, { db }),
    resolveTier(db, actor.userId, now),
    db.like.count({ where: { fromUserId: actor.userId } }),
    db.match.count({ where: { status: "ACTIVE", OR: [{ userAId: actor.userId }, { userBId: actor.userId }] } }),
  ]);
  const primary = user.profile?.photos[0];
  const isDemo = primary?.thumbKey.startsWith("demo/") ?? false;
  return {
    name: user.profile?.displayName ?? "",
    age: user.dateOfBirth ? ageFromDateOfBirth(user.dateOfBirth, now) : null,
    location: user.profile?.location?.name ?? null,
    occupation: user.profile?.occupation ?? null,
    verified: user.verification?.status === "VERIFIED",
    verificationStatus: user.verification?.status ?? "NONE",
    primaryPhoto: primary
      ? { url: isDemo ? null : await getStorageProvider().getReadUrl(primary.thumbKey, PHOTO_URL_TTL_SECONDS), key: isDemo ? primary.thumbKey : null, blurhash: primary.blurhash }
      : null,
    completion: data.completion,
    tier,
    likesGiven,
    activeMatches,
  };
}
