/**
 * Seed script.
 *   - Reference data (locations, interests, prompts, plans) is idempotent and safe everywhere.
 *   - Demo data (prototype profiles, likes, matches, chats, posts) is DEVELOPMENT ONLY and is
 *     refused when NODE_ENV=production or when THUNDI_SEED_DEMO is not "true".
 *
 * Run: npm run db:seed          (reference only)
 *      THUNDI_SEED_DEMO=true npm run db:seed   (reference + demo)
 */
import "dotenv/config";
import { createPrismaClient } from "../src/lib/db";
import { hashPhone } from "../src/lib/hashing";
import { sortPair } from "../src/server/actor";
import { INTERESTS, LOCATIONS, PLANS, PROMPTS } from "./seed-data/reference";
import { DEMO_CHATS, DEMO_COMMUNITY_POSTS, DEMO_LIKES_YOU, DEMO_MATCHES, DEMO_PROFILES, blurhashFor, type DemoProfile } from "./seed-data/demo";
import { DEMO_PLUS_USER, DISCOVERY_SCENARIOS } from "./seed-data/discovery-scenarios";

const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL must be set");
const db = createPrismaClient(url);

async function seedReference() {
  for (const l of LOCATIONS) {
    await db.location.upsert({ where: { slug: l.slug }, create: l, update: { ...l } });
  }
  for (const i of INTERESTS) {
    await db.interest.upsert({ where: { slug: i.slug }, create: i, update: { label: i.label, sortOrder: i.sortOrder } });
  }
  for (const p of PROMPTS) {
    await db.prompt.upsert({ where: { slug: p.slug }, create: p, update: { text: p.text, sortOrder: p.sortOrder } });
  }
  for (const p of PLANS) {
    await db.subscriptionPlan.upsert({
      where: { code: p.code },
      create: { code: p.code, name: p.name, intervalDays: p.intervalDays, priceMinor: p.priceMinor, currency: p.currency, badge: p.badge, discountLabel: p.discountLabel, isPlaceholderPrice: true, active: true, sortOrder: p.sortOrder },
      update: { name: p.name, intervalDays: p.intervalDays, priceMinor: p.priceMinor, currency: p.currency, badge: p.badge, discountLabel: p.discountLabel, isPlaceholderPrice: true, sortOrder: p.sortOrder },
    });
  }
  console.log(`reference: ${LOCATIONS.length} locations, ${INTERESTS.length} interests, ${PROMPTS.length} prompts, ${PLANS.length} plans (placeholder prices)`);
}

function dobForAge(age: number, now: Date): Date {
  // Birthday roughly 100 days ago so the age is stable for a while.
  return new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate() - 100));
}

async function seedDemo() {
  const now = new Date();
  const locations = new Map((await db.location.findMany()).map((l) => [l.slug, l.id]));
  const interests = new Map((await db.interest.findMany()).map((i) => [i.label, i.id]));
  const prompts = (await db.prompt.findMany({ orderBy: { sortOrder: "asc" } })).map((p) => p.id);
  const ids = new Map<string, string>();

  /**
   * Development sign-in identity for a demo account (AUTH_PROVIDER=dev). The mapping is explicit — demo key →
   * subject `dev-<key>` — never inferred from a name, and the demo phone stays as optional contact-blocking data.
   */
  async function ensureDevIdentity(userId: string, d: DemoProfile): Promise<void> {
    await db.authIdentity.upsert({
      where: { provider_providerSubject: { provider: "GOOGLE", providerSubject: `dev-${d.key}` } },
      create: { userId, provider: "GOOGLE", providerSubject: `dev-${d.key}`, email: `${d.key}@demo.thundi.dev`, emailVerified: true, displayName: d.name },
      update: { userId, email: `${d.key}@demo.thundi.dev`, displayName: d.name },
    });
  }

  async function createDemoUser(d: DemoProfile, o: { status?: "ACTIVE" | "ONBOARDING" | "SUSPENDED"; hideLocation?: boolean; hideAge?: boolean; invisibleMode?: boolean; ageMin?: number; ageMax?: number } = {}): Promise<string> {
    const existing = await db.user.findUnique({ where: { phoneE164: d.phone }, select: { id: true } });
    if (existing) {
      await ensureDevIdentity(existing.id, d);
      return existing.id;
    }
    const status = o.status ?? "ACTIVE";
    const user = await db.user.create({
      data: {
        phoneE164: d.phone,
        phoneHash: hashPhone(d.phone),
        dateOfBirth: dobForAge(d.age, now),
        gender: d.gender,
        status,
        onboardingStage: status === "ONBOARDING" ? "PHOTOS" : "COMPLETE",
        onboardingCompletedAt: status === "ONBOARDING" ? null : now,
        lastActiveAt: new Date(now.getTime() - Math.floor(Math.random() * 6) * 3_600_000),
        profile: {
          create: {
            handle: `${d.name.toLowerCase()}-${d.key}`,
            displayName: d.name,
            bio: d.bio,
            occupation: d.occupation,
            education: d.education,
            languages: d.languages,
            heightCm: d.heightCm,
            intent: d.intent,
            locationId: locations.get(d.location) ?? null,
            photos: {
              create: d.hues.map((h, i) => ({
                position: i,
                storageKey: `demo/${d.key}/${i}.hue-${h}`,
                thumbKey: `demo/${d.key}/${i}-thumb.hue-${h}`,
                blurhash: blurhashFor(h),
                width: 1080,
                height: 1440,
                moderation: "APPROVED",
              })),
            },
            interests: { create: d.interests.filter((l) => interests.has(l)).map((l) => ({ interestId: interests.get(l)! })) },
            prompts: { create: [{ promptId: prompts[d.prompt]!, answer: d.answer, position: 0 }] },
          },
        },
        privacy: { create: { hideLocation: o.hideLocation ?? false, hideAge: o.hideAge ?? false, invisibleMode: o.invisibleMode ?? false } },
        discoveryPreferences: { create: { interestedIn: d.interestedIn, ageMin: o.ageMin ?? 22, ageMax: o.ageMax ?? 34 } },
        notificationSettings: { create: {} },
        verification: { create: { status: d.verified ? "VERIFIED" : "NONE", decidedAt: d.verified ? now : null } },
      },
      select: { id: true },
    });
    await ensureDevIdentity(user.id, d);
    return user.id;
  }

  for (const d of DEMO_PROFILES) ids.set(d.key, await createDemoUser(d));

  const me = ids.get("me")!;
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  for (const key of DEMO_LIKES_YOU) {
    const from = ids.get(key)!;
    await db.like.upsert({ where: { fromUserId_toUserId: { fromUserId: from, toUserId: me } }, create: { fromUserId: from, toUserId: me, createdAt: minutesAgo(600) }, update: {} });
  }

  for (const key of DEMO_MATCHES) {
    const other = ids.get(key)!;
    const pair = sortPair(me, other);
    await db.like.upsert({ where: { fromUserId_toUserId: { fromUserId: me, toUserId: other } }, create: { fromUserId: me, toUserId: other, createdAt: minutesAgo(3000) }, update: {} });
    await db.like.upsert({ where: { fromUserId_toUserId: { fromUserId: other, toUserId: me } }, create: { fromUserId: other, toUserId: me, createdAt: minutesAgo(2900) }, update: {} });
    const match = await db.match.upsert({ where: { userAId_userBId: pair }, create: { ...pair, status: "ACTIVE", createdAt: minutesAgo(2900) }, update: {} });
    const conversation = await db.conversation.upsert({
      where: { userAId_userBId: pair },
      create: { ...pair, matchId: match.id, status: "ACTIVE", participants: { create: [{ userId: pair.userAId }, { userId: pair.userBId }] } },
      update: {},
    });
    const msgs = DEMO_CHATS[key] ?? [];
    if ((await db.message.count({ where: { conversationId: conversation.id } })) === 0) {
      for (const [who, text, ago] of msgs) {
        await db.message.create({ data: { conversationId: conversation.id, senderId: who === "me" ? me : other, kind: "TEXT", body: text, createdAt: minutesAgo(ago) } });
      }
      const last = msgs[msgs.length - 1];
      if (last) await db.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: minutesAgo(last[2]) } });
      // Unread state mirrors the prototype: p4 has 2 unread, p7 has 1.
      const unreadFromThem = msgs.filter(([who]) => who === "them").length;
      if (key !== "p1" && unreadFromThem > 0) {
        await db.notification.create({ data: { userId: me, type: "MESSAGE", actorId: other, conversationId: conversation.id, createdAt: minutesAgo(msgs[msgs.length - 1]![2]) } });
      }
    }
  }

  await seedDiscoveryScenarios(me, createDemoUser, minutesAgo);
  await seedCommunity(ids, me);
  console.log(`demo: ${DEMO_PROFILES.length} profiles, ${DEMO_LIKES_YOU.length} incoming likes, ${DEMO_MATCHES.length} matches, ${DISCOVERY_SCENARIOS.length} discovery scenarios`);
}

const DAY = 24 * 3_600_000;

/** Community scenarios (see seed-data/demo.ts DEMO_COMMUNITY_POSTS). Idempotent: keyed ids, upserts. */
async function seedCommunity(ids: Map<string, string>, me: string) {
  const now = new Date();
  // Discovery scenario users are looked up by their demo phone → user id.
  const byPhone = async (phone: string) => (await db.user.findUnique({ where: { phoneE164: phone }, select: { id: true } }))?.id ?? null;
  const scenarioPhones: Record<string, string> = { "s-hidden-loc": "+9607000104", "s-i-blocked": "+9607000112", "s-blocked-me": "+9607000113", "s-suspended": "+9607000118" };
  const resolve = async (key: string) => ids.get(key) ?? (scenarioPhones[key] ? byPhone(scenarioPhones[key]) : null);
  let posts = 0;
  for (const d of DEMO_COMMUNITY_POSTS) {
    const authorId = await resolve(d.author);
    if (!authorId) continue;
    const createdAt = new Date(now.getTime() - d.hoursAgo * 3_600_000);
    const postId = `demo-${d.key}`;
    await db.communityPost.upsert({
      where: { id: postId },
      create: {
        id: postId,
        authorId,
        kind: d.kind,
        body: d.body,
        photoKey: d.kind === "PHOTO" ? `demo/posts/${d.key}.hue-${d.hue ?? 190}` : null,
        photoBlurhash: d.kind === "PHOTO" ? blurhashFor(d.hue ?? 190) : null,
        photoModeration: d.photoModeration ?? "APPROVED",
        createdAt,
        deletedAt: d.deleted ? new Date(createdAt.getTime() + 60_000) : null,
        likeCount: 0,
        commentCount: 0,
      },
      update: {},
    });
    posts++;
    for (const [i, c] of (d.comments ?? []).entries()) {
      const cAuthor = await resolve(c.author);
      if (!cAuthor) continue;
      await db.communityComment.upsert({ where: { id: `${postId}-c${i}` }, create: { id: `${postId}-c${i}`, postId, authorId: cAuthor, body: c.body, createdAt: new Date(createdAt.getTime() + c.minutesAfter * 60_000) }, update: {} });
    }
    for (const who of d.likedBy ?? []) {
      const uid = await resolve(who);
      if (uid) await db.communityLike.upsert({ where: { postId_userId: { postId, userId: uid } }, create: { postId, userId: uid, createdAt: new Date(createdAt.getTime() + 5 * 60_000) }, update: {} });
    }
    if (d.reportedByMe) {
      const exists = await db.report.findFirst({ where: { reporterId: me, targetPostId: postId } });
      if (!exists) await db.report.create({ data: { reporterId: me, targetUserId: authorId, targetPostId: postId, reason: d.reportedByMe, snapshot: { kind: d.kind, body: d.body }, createdAt: new Date(createdAt.getTime() + 3_600_000) } });
    }
    // Counters mirror the persisted rows.
    await db.$executeRaw`UPDATE "CommunityPost" p SET "likeCount" = (SELECT count(*) FROM "CommunityLike" l WHERE l."postId" = p.id), "commentCount" = (SELECT count(*) FROM "CommunityComment" c WHERE c."postId" = p.id AND c."deletedAt" IS NULL) WHERE p.id = ${postId}`;
  }
  // The demo viewer opted into Community notifications so reactions/comments on their post are visible in dev.
  await db.notificationSettings.update({ where: { userId: me }, data: { community: true } });
  console.log(`community: ${posts} scenario posts`);
}

/** Discovery scenarios around "me" (see seed-data/discovery-scenarios.ts). Idempotent: skips rows that exist. */
async function seedDiscoveryScenarios(
  me: string,
  createDemoUser: (d: DemoProfile, o?: { status?: "ACTIVE" | "ONBOARDING" | "SUSPENDED"; hideLocation?: boolean; hideAge?: boolean; invisibleMode?: boolean; ageMin?: number; ageMax?: number }) => Promise<string>,
  minutesAgo: (m: number) => Date,
) {
  const now = new Date();
  const plusFor = async (userId: string, from: Date, to: Date) => {
    const has = await db.entitlementOverride.findFirst({ where: { userId, reason: "demo" } });
    if (!has) await db.entitlementOverride.create({ data: { userId, tier: "PLUS", reason: "demo", startsAt: from, endsAt: to } });
  };
  const likeOnce = async (from: string, to: string, at: Date) =>
    db.like.upsert({ where: { fromUserId_toUserId: { fromUserId: from, toUserId: to } }, create: { fromUserId: from, toUserId: to, createdAt: at }, update: {} });
  const passOnce = async (from: string, to: string, at: Date) =>
    db.pass.upsert({ where: { fromUserId_toUserId: { fromUserId: from, toUserId: to } }, create: { fromUserId: from, toUserId: to, createdAt: at, expiresAt: new Date(at.getTime() + 30 * DAY) }, update: {} });
  const blockOnce = async (blocker: string, blocked: string) =>
    db.block.upsert({ where: { blockerId_blockedId: { blockerId: blocker, blockedId: blocked } }, create: { blockerId: blocker, blockedId: blocked }, update: {} });

  const plusUser = await createDemoUser(DEMO_PLUS_USER);
  await plusFor(plusUser, new Date(now.getTime() - DAY), new Date(now.getTime() + 365 * DAY));

  for (const { kind, profile } of DISCOVERY_SCENARIOS) {
    switch (kind) {
      case "BOOSTED": {
        const id = await createDemoUser(profile);
        await plusFor(id, new Date(now.getTime() - DAY), new Date(now.getTime() + 365 * DAY));
        const active = await db.boost.findFirst({ where: { userId: id, endsAt: { gt: now } } });
        // A long-running demo boost so the ranking effect is visible whenever the dev server is opened.
        if (!active) await db.boost.create({ data: { userId: id, startsAt: minutesAgo(5), endsAt: new Date(now.getTime() + 365 * DAY) } });
        break;
      }
      case "HIDDEN_LOCATION":
        await createDemoUser(profile, { hideLocation: true });
        break;
      case "HIDDEN_AGE":
        await createDemoUser(profile, { hideAge: true });
        break;
      case "INVISIBLE_LIKED_ME": {
        const id = await createDemoUser(profile, { invisibleMode: true });
        await plusFor(id, new Date(now.getTime() - DAY), new Date(now.getTime() + 365 * DAY));
        await likeOnce(id, me, minutesAgo(90));
        break;
      }
      case "INVISIBLE_STRANGER": {
        const id = await createDemoUser(profile, { invisibleMode: true });
        await plusFor(id, new Date(now.getTime() - DAY), new Date(now.getTime() + 365 * DAY));
        break;
      }
      case "INVISIBLE_EXPIRED": {
        const id = await createDemoUser(profile, { invisibleMode: true });
        await plusFor(id, new Date(now.getTime() - 40 * DAY), new Date(now.getTime() - 2 * DAY));
        await likeOnce(id, me, new Date(now.getTime() - 10 * DAY));
        break;
      }
      case "DOES_NOT_WANT_MY_AGE":
        await createDemoUser(profile, { ageMin: 30, ageMax: 40 });
        break;
      case "I_BLOCKED":
        await blockOnce(me, await createDemoUser(profile));
        break;
      case "BLOCKED_ME":
        await blockOnce(await createDemoUser(profile), me);
        break;
      case "PASSED_RECENTLY":
        await passOnce(me, await createDemoUser(profile), new Date(now.getTime() - 2 * DAY));
        break;
      case "PASSED_LONG_AGO":
        await passOnce(me, await createDemoUser(profile), new Date(now.getTime() - 40 * DAY));
        break;
      case "ALREADY_LIKED":
        await likeOnce(me, await createDemoUser(profile), minutesAgo(200));
        break;
      case "LIKES_ME":
        await likeOnce(await createDemoUser(profile), me, minutesAgo(30));
        break;
      case "SUSPENDED":
        await createDemoUser(profile, { status: "SUSPENDED" });
        break;
      case "ONBOARDING":
        await createDemoUser(profile, { status: "ONBOARDING" });
        break;
      default:
        await createDemoUser(profile);
    }
  }
}

async function main() {
  await seedReference();
  const wantDemo = process.env.THUNDI_SEED_DEMO === "true";
  if (wantDemo) {
    if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");
    await seedDemo();
  } else {
    console.log("demo: skipped (set THUNDI_SEED_DEMO=true to load prototype demo data in development)");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
