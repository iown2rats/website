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
import { DEMO_CHATS, DEMO_LIKES_YOU, DEMO_MATCHES, DEMO_POSTS, DEMO_PROFILES, blurhashFor } from "./seed-data/demo";

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

  for (const d of DEMO_PROFILES) {
    const existing = await db.user.findUnique({ where: { phoneE164: d.phone }, select: { id: true } });
    if (existing) {
      ids.set(d.key, existing.id);
      continue;
    }
    const user = await db.user.create({
      data: {
        phoneE164: d.phone,
        phoneHash: hashPhone(d.phone),
        dateOfBirth: dobForAge(d.age, now),
        gender: d.gender,
        status: "ACTIVE",
        onboardingStage: "COMPLETE",
        onboardingCompletedAt: now,
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
        privacy: { create: {} },
        discoveryPreferences: { create: { interestedIn: d.interestedIn, ageMin: 22, ageMax: 34 } },
        notificationSettings: { create: {} },
        verification: { create: { status: d.verified ? "VERIFIED" : "PHONE_VERIFIED", decidedAt: d.verified ? now : null } },
      },
      select: { id: true },
    });
    ids.set(d.key, user.id);
  }

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

  if ((await db.communityPost.count()) === 0) {
    for (const p of DEMO_POSTS) {
      await db.communityPost.create({
        data: {
          authorId: ids.get(p.author)!,
          kind: p.kind,
          body: p.body,
          photoKey: p.kind === "PHOTO" ? `demo/posts/${p.author}.hue-${p.hue}` : null,
          photoBlurhash: p.kind === "PHOTO" ? blurhashFor(p.hue!) : null,
          likeCount: p.likes,
          commentCount: p.comments,
          createdAt: new Date(now.getTime() - p.hoursAgo * 3_600_000),
        },
      });
    }
  }
  console.log(`demo: ${DEMO_PROFILES.length} profiles, ${DEMO_LIKES_YOU.length} incoming likes, ${DEMO_MATCHES.length} matches, ${DEMO_POSTS.length} posts`);
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
