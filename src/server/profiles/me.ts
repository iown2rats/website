/**
 * The signed-in user's own profile summary for the Profile tab. Includes private-derived values (age) for the
 * owner only; never phone or DOB.
 */
import { getDb, type Db } from "@/lib/db";
import { ageFromDateOfBirth } from "@/lib/age";
import { getStorageProvider } from "@/lib/storage";
import { PHOTO_URL_TTL_SECONDS } from "@/lib/storage/provider";
import type { Actor } from "@/server/actor";
import { getOnboardingData } from "@/server/onboarding/onboarding";
import type { CompletionResult } from "./completion";

export interface MyProfileSummary {
  name: string;
  age: number | null;
  location: string | null;
  occupation: string | null;
  verified: boolean;
  primaryPhoto: { url: string; blurhash: string } | null;
  completion: CompletionResult;
}

export async function getMyProfileSummary(actor: Actor, deps: { db?: Db } = {}): Promise<MyProfileSummary> {
  const db = deps.db ?? getDb();
  const [user, data] = await Promise.all([
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
  ]);
  const primary = user.profile?.photos[0];
  return {
    name: user.profile?.displayName ?? "",
    age: user.dateOfBirth ? ageFromDateOfBirth(user.dateOfBirth) : null,
    location: user.profile?.location?.name ?? null,
    occupation: user.profile?.occupation ?? null,
    verified: user.verification?.status === "VERIFIED",
    primaryPhoto: primary ? { url: await getStorageProvider().getReadUrl(primary.thumbKey, PHOTO_URL_TTL_SECONDS), blurhash: primary.blurhash } : null,
    completion: data.completion,
  };
}
