/*
 * Seeds the LOCAL DEVELOPMENT database with deliberately hostile user-generated content, so the responsive
 * contract is exercised against the data real users actually produce rather than against polite fixtures
 * (docs/DESIGN_SYSTEM.md §33). Long unbroken tokens, long URLs, long names and long posts are the content that
 * breaks page geometry; a layout that only survives "Aishath, 26" has not been tested.
 *
 * Refuses to run against anything that is not localhost: this writes junk rows and must never touch production.
 */
import { getDb } from "@/lib/db";

const LONG_TOKEN = "Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const LONG_URL = "https://www.example.com/a/very/long/path/that/keeps/going/and/going?query=1&another=2&more=3&yet=4&still=5&final=6";
const LONG_NAME = "Aishathmohamedabdullahibrahimhassanaliismail";
const LONG_POST = `${LONG_TOKEN} and then some normal words after it, followed by ${LONG_URL} and more prose to make the card tall as well as wide.`;

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error("Refusing to run: DATABASE_URL is not localhost. This seeder writes junk rows.");
  }
  const db = getDb();
  const me = await db.profile.findFirstOrThrow({ where: { handle: "ismail-me" }, select: { userId: true, id: true } });

  // A long display name and location on somebody the demo account can see everywhere.
  const other = await db.profile.findFirstOrThrow({ where: { handle: { not: "ismail-me" } }, select: { userId: true, id: true, displayName: true } });
  await db.profile.update({ where: { id: other.id }, data: { displayName: LONG_NAME } });

  // Hostile chat content in an existing conversation.
  const conv = await db.conversation.findFirst({ where: { OR: [{ userAId: me.userId }, { userBId: me.userId }] }, select: { id: true, userAId: true, userBId: true } });
  if (conv) {
    const otherId = conv.userAId === me.userId ? conv.userBId : conv.userAId;
    const now = Date.now();
    const rows = [
      { senderId: me.userId, body: LONG_TOKEN },
      { senderId: otherId, body: LONG_URL },
      { senderId: me.userId, body: `${LONG_TOKEN}${LONG_TOKEN}` },
      { senderId: otherId, body: `Normal message then ${LONG_URL} then more text.` },
    ];
    for (const [i, r] of rows.entries()) {
      await db.message.create({ data: { conversationId: conv.id, senderId: r.senderId, kind: "TEXT", body: r.body, createdAt: new Date(now - (rows.length - i) * 1000) } });
    }
  }

  // Hostile community content.
  const post = await db.communityPost.create({ data: { authorId: other.userId, body: LONG_POST, createdAt: new Date() }, select: { id: true } });
  await db.communityComment.create({ data: { postId: post.id, authorId: me.userId, body: `${LONG_TOKEN} reply`, createdAt: new Date() } });

  // A long notification actor name is already covered by the profile rename; add a long-detail billing row.
  await db.notification.create({
    data: { userId: me.userId, type: "PAYMENT_REJECTED", data: { reason: LONG_TOKEN, planName: LONG_NAME }, createdAt: new Date() },
  });

  console.log("stress content seeded");
  await db.$disconnect();
}
main();
