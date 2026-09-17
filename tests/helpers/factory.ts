/**
 * Test factories. Every user gets the full set of settings rows and one photo so the discovery
 * joins behave as they will in production.
 */
import type { Db } from "@/lib/db";
import { hashPhone } from "@/lib/hashing";
import type { Actor } from "@/server/actor";

let seq = 0;

export interface UserOptions {
  gender?: "WOMAN" | "MAN" | "UNSPECIFIED";
  interestedIn?: "WOMEN" | "MEN" | "EVERYONE";
  age?: number;
  ageMin?: number;
  ageMax?: number;
  name?: string;
  status?: "ONBOARDING" | "ACTIVE";
  invisibleMode?: boolean;
  visibility?: "EVERYONE" | "HIDDEN";
  locationId?: string | null;
  now?: Date;
}

export interface TestUser extends Actor {
  handle: string;
  phoneE164: string;
}

export async function createUser(db: Db, o: UserOptions = {}): Promise<TestUser> {
  seq += 1;
  const now = o.now ?? new Date();
  const age = o.age ?? 27;
  const dob = new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), Math.max(1, now.getUTCDate() - 1)));
  const phoneE164 = `+9607${String(100000 + seq).padStart(6, "0")}`;
  const handle = `u${seq}_${Math.random().toString(36).slice(2, 8)}`;
  const gender = o.gender ?? (seq % 2 === 0 ? "WOMAN" : "MAN");
  const status = o.status ?? "ACTIVE";

  const user = await db.user.create({
    data: {
      phoneE164,
      phoneHash: hashPhone(phoneE164),
      dateOfBirth: dob,
      gender,
      status,
      onboardingStep: 12,
      onboardingCompletedAt: status === "ACTIVE" ? now : null,
      lastActiveAt: now,
      profile: {
        create: {
          handle,
          displayName: o.name ?? `User ${seq}`,
          bio: "Test bio",
          intent: "SERIOUS_RELATIONSHIP",
          locationId: o.locationId ?? null,
          photos: {
            create: [
              {
                position: 0,
                storageKey: `test/${handle}/0.webp`,
                thumbKey: `test/${handle}/0-thumb.webp`,
                blurhash: "LKO2?U%2Tw=w]~RBVZRi};RPxuwH",
                width: 1080,
                height: 1440,
                moderation: "APPROVED",
              },
            ],
          },
        },
      },
      privacy: { create: { invisibleMode: o.invisibleMode ?? false, visibility: o.visibility ?? "EVERYONE" } },
      discoveryPreferences: { create: { interestedIn: o.interestedIn ?? "EVERYONE", ageMin: o.ageMin ?? 18, ageMax: o.ageMax ?? 99 } },
      notificationSettings: { create: {} },
      verification: { create: { status: "PHONE_VERIFIED" } },
    },
    select: { id: true },
  });
  return { userId: user.id, handle, phoneE164 };
}

/** Grants Plus via an EntitlementOverride covering [from, to). */
export async function grantPlus(db: Db, userId: string, from: Date, to: Date): Promise<void> {
  await db.entitlementOverride.create({ data: { userId, tier: "PLUS", reason: "test", startsAt: from, endsAt: to } });
}

/** Creates a Plus subscription row as a payment webhook would. */
export async function createSubscription(
  db: Db,
  userId: string,
  o: { status?: "ACTIVE" | "TRIALING" | "PAST_DUE" | "CANCELLED" | "EXPIRED"; periodStart: Date; periodEnd: Date },
) {
  const plan = await db.subscriptionPlan.upsert({
    where: { code: "MONTHLY" },
    create: { code: "MONTHLY", name: "1 month", intervalDays: 30, priceMinor: 0, isPlaceholderPrice: true },
    update: {},
  });
  return db.subscription.create({
    data: {
      userId,
      planId: plan.id,
      status: o.status ?? "ACTIVE",
      provider: "test",
      providerSubscriptionRef: `sub_${Math.random().toString(36).slice(2)}`,
      startedAt: o.periodStart,
      currentPeriodStart: o.periodStart,
      currentPeriodEnd: o.periodEnd,
    },
  });
}

export async function createLocation(db: Db, o: { name: string; atollCode: string; isGreaterMale?: boolean }) {
  return db.location.create({
    data: {
      slug: o.name.toLowerCase().replace(/\W+/g, "-") + "-" + Math.random().toString(36).slice(2, 6),
      name: o.name,
      kind: "CITY",
      atollCode: o.atollCode,
      atollName: o.atollCode,
      isGreaterMale: o.isGreaterMale ?? false,
    },
  });
}

export const hours = (n: number) => n * 3_600_000;
export const minutes = (n: number) => n * 60_000;
export const at = (base: Date, deltaMs: number) => new Date(base.getTime() + deltaMs);
