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
  /** Dating (the default, matching the column) or Friendship. Separate pools in discovery. */
  connectionIntent?: "DATING" | "FRIENDSHIP";
  friendshipInterestedIn?: "WOMEN" | "MEN" | "EVERYONE" | null;
  /**
   * The member's own Dating answer (Profile.intent). Defaults as onboarding leaves it: SERIOUS_RELATIONSHIP on the
   * Dating path, null on the Friendship path (which never asks). Pass a value to model a stale answer.
   */
  intent?: "SERIOUS_RELATIONSHIP" | "DATING" | "MARRIAGE" | "FIGURING_OUT" | null;
  /** The Dating "Looking for" filter (DiscoveryPreferences.intent). Null by default. */
  lookingFor?: "SERIOUS_RELATIONSHIP" | "DATING" | "MARRIAGE" | "FIGURING_OUT" | null;
  locationScope?: "ANYWHERE" | "GREATER_MALE" | "MY_ATOLL" | "SPECIFIC";
  /** DiscoveryPreferences.locationId, for locationScope SPECIFIC. */
  prefLocationId?: string | null;
  age?: number;
  ageMin?: number;
  ageMax?: number;
  name?: string;
  status?: "ONBOARDING" | "ACTIVE";
  invisibleMode?: boolean;
  visibility?: "EVERYONE" | "HIDDEN";
  locationId?: string | null;
  /** Displayable photos to create (default 2, the discovery minimum). */
  photos?: number;
  photoModeration?: "APPROVED" | "PENDING" | "REJECTED";
  hideLocation?: boolean;
  hideAge?: boolean;
  verified?: boolean;
  lastActiveAt?: Date | null;
  /** null = no phone on file (Google-only sign-in). Default: a unique test number, kept as contact-blocking data. */
  phone?: string | null;
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
  const phoneE164 = o.phone === null ? null : (o.phone ?? `+9607${String(100000 + seq).padStart(6, "0")}`);
  const handle = `u${seq}_${Math.random().toString(36).slice(2, 8)}`;
  /*
   * Deterministic, not alternating. The old default flipped on a module-level counter, so whether two fixtures
   * were opposite genders depended on the order they happened to be created in — invisible until Dating became
   * strictly opposite-gender and a dozen unrelated tests started failing on it. A test that cares about gender
   * says so; one that does not gets the same answer every time.
   */
  const gender = o.gender ?? "WOMAN";
  const status = o.status ?? "ACTIVE";

  const user = await db.user.create({
    data: {
      phoneE164,
      phoneHash: phoneE164 ? hashPhone(phoneE164) : null,
      dateOfBirth: dob,
      gender,
      status,
      onboardingStage: status === "ACTIVE" ? "COMPLETE" : "NAME",
      onboardingCompletedAt: status === "ACTIVE" ? now : null,
      lastActiveAt: o.lastActiveAt === undefined ? now : o.lastActiveAt,
      profile: {
        create: {
          handle,
          displayName: o.name ?? `User ${seq}`,
          bio: "Test bio",
          intent: o.intent !== undefined ? o.intent : o.connectionIntent === "FRIENDSHIP" ? null : "SERIOUS_RELATIONSHIP",
          locationId: o.locationId ?? null,
          photos: {
            create: Array.from({ length: o.photos ?? 2 }, (_, i) => ({
              position: i,
              storageKey: `test/${handle}/${i}.webp`,
              thumbKey: `test/${handle}/${i}-thumb.webp`,
              blurhash: "LKO2?U%2Tw=w]~RBVZRi};RPxuwH",
              width: 1080,
              height: 1440,
              moderation: o.photoModeration ?? "APPROVED",
            })),
          },
        },
      },
      privacy: { create: { invisibleMode: o.invisibleMode ?? false, visibility: o.visibility ?? "EVERYONE", hideLocation: o.hideLocation ?? false, hideAge: o.hideAge ?? false } },
      discoveryPreferences: {
        create: {
          interestedIn: o.interestedIn ?? "EVERYONE",
          connectionIntent: o.connectionIntent ?? "DATING",
          friendshipInterestedIn: o.friendshipInterestedIn ?? (o.connectionIntent === "FRIENDSHIP" ? (o.interestedIn ?? "EVERYONE") : null),
          ageMin: o.ageMin ?? 18,
          ageMax: o.ageMax ?? 99,
          intent: o.lookingFor ?? null,
          locationScope: o.locationScope ?? "ANYWHERE",
          locationId: o.prefLocationId ?? null,
        },
      },
      notificationSettings: { create: {} },
      verification: { create: { status: o.verified ? "VERIFIED" : "NONE" } },
    },
    select: { id: true },
  });
  return { userId: user.id, handle, phoneE164: phoneE164 ?? "" };
}

/** A Google sign-in identity for a test user (AUTH_PROVIDER-independent: the row is what the mapping code reads). */
export async function createIdentity(db: Db, userId: string, o: { subject?: string; email?: string; name?: string | null } = {}): Promise<{ subject: string; email: string }> {
  seq += 1;
  const subject = o.subject ?? `google-sub-${seq}`;
  const email = o.email ?? `user${seq}@example.com`;
  await db.authIdentity.create({ data: { userId, provider: "GOOGLE", providerSubject: subject, email, emailVerified: true, displayName: o.name ?? null } });
  return { subject, email };
}

export interface TestStaff {
  userId: string;
  email: string;
  role: "ADMIN" | "MODERATOR";
  grantId: string;
  password: string;
}

/**
 * A live STAFF account: an operational User row with no member-domain rows at all, an ACTIVE StaffGrant and an
 * EMAIL identity carrying a real scrypt verifier. Deliberately does NOT go through `createUser`, because the whole
 * point of the split is that a staff account is not a member account — it has no Profile, no PrivacySettings, no
 * DiscoveryPreferences and no Verification (docs/ARCHITECTURE.md §22.1).
 */
export async function createStaff(
  db: Db,
  o: { role?: "ADMIN" | "MODERATOR"; email?: string; password?: string; now?: Date; status?: "PENDING" | "ACTIVE" | "REVOKED" } = {},
): Promise<TestStaff> {
  seq += 1;
  const role = o.role ?? "ADMIN";
  const now = o.now ?? new Date();
  const email = (o.email ?? `staff${seq}@example.com`).trim().toLowerCase();
  const password = o.password ?? "correct-horse-battery";
  const { hashPassword } = await import("@/server/auth/password");
  const user = await db.user.create({
    data: { accountType: "STAFF", role, status: "ACTIVE", onboardingStage: "NAME", lastActiveAt: now, createdAt: now },
    select: { id: true },
  });
  await db.authIdentity.create({
    data: {
      userId: user.id,
      provider: "EMAIL",
      providerSubject: email,
      email,
      emailVerified: true,
      passwordHash: await hashPassword(password),
      passwordUpdatedAt: now,
      createdAt: now,
    },
  });
  const grant = await db.staffGrant.create({
    data: {
      email,
      role,
      reason: "test fixture",
      status: o.status ?? "ACTIVE",
      claimedByUserId: (o.status ?? "ACTIVE") === "PENDING" ? null : user.id,
      claimedAt: (o.status ?? "ACTIVE") === "PENDING" ? null : now,
      createdAt: now,
    },
    select: { id: true },
  });
  return { userId: user.id, email, role, grantId: grant.id, password };
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
