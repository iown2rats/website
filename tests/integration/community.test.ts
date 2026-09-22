import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { COMMUNITY, PRODUCT_RULES } from "@/config/product";
import { LikeLimitReachedError, NotFoundError, ValidationError } from "@/lib/errors";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { addComment, deleteComment, listComments } from "@/server/community/comments";
import { getFeed, getPost } from "@/server/community/feed";
import { createPost, deletePost } from "@/server/community/posts";
import { getCommunityProfile } from "@/server/community/profile";
import { setReaction } from "@/server/community/reactions";
import { blockPostAuthor, reportComment, reportPost } from "@/server/community/reports";
import { getLikeAllowance } from "@/server/entitlements";
import { canView, getDeckCandidateIds } from "@/server/discovery/query";
import { likeByHandle } from "@/server/discovery/deck";
import { likeUser } from "@/server/likes/like";
import { blockUser } from "@/server/safety/block";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createLocation, createUser, grantPlus, hours, minutes, type TestUser } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-17T20:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));
const deps = (now = T0) => ({ db, storage, now });
const post = (author: TestUser, body: string, now = T0, kind: "TEXT" | "QUESTION" = "TEXT") => createPost(author, { kind, body }, deps(now));

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

describe("community feed", () => {
  it("shows eligible posts newest first and excludes blocked (both ways), suspended, deleted and hidden-media posts", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0, name: "Ismail" });
    const a = await createUser(db, { now: T0, name: "Ahmed" });
    const iBlocked = await createUser(db, { now: T0, name: "Bisma" });
    const blockedMe = await createUser(db, { now: T0, name: "Rifga" });
    const suspended = await createUser(db, { now: T0, name: "Zeena" });
    const deletedUser = await createUser(db, { now: T0, name: "Gone" });
    await post(a, "Anyone else think Malé needs more benches?", at(T0, 1000));
    const mine = await post(me, "My own post", at(T0, 2000));
    await post(iBlocked, "blocked author post", at(T0, 3000));
    await post(blockedMe, "reverse block post", at(T0, 4000));
    await post(suspended, "suspended post", at(T0, 5000));
    await post(deletedUser, "deleted account post", at(T0, 6000));
    const toDelete = await post(a, "to be deleted", at(T0, 7000));
    await blockUser(me, iBlocked.userId, { db, now: T0 });
    await blockUser(blockedMe, me.userId, { db, now: T0 });
    await db.user.update({ where: { id: suspended.userId }, data: { status: "SUSPENDED" } });
    await db.user.update({ where: { id: deletedUser.userId }, data: { status: "DELETED", deletedAt: T0 } });
    await deletePost(a, toDelete.id, { db, now: at(T0, 8000) });

    const feed = await getFeed(me, {}, deps(at(T0, 9000)));
    expect(feed.posts.map((p) => p.body)).toEqual(["My own post", "Anyone else think Malé needs more benches?"]);
    expect(feed.posts[0]).toMatchObject({ isMine: true, author: { isMe: true, name: "Ismail" } });
    expect(feed.posts[1]).toMatchObject({ isMine: false, likedByMe: false, likeCount: 0, commentCount: 0, author: { name: "Ahmed" } });
    expect(feed.nextCursor).toBeNull();
    // A stranger sees the blocked author's post; the block is a relationship, not a global removal.
    const c = await createUser(db, { now: T0 });
    expect((await getFeed(c, {}, deps(at(T0, 9000)))).posts.map((p) => p.body)).toContain("blocked author post");
    // Direct reads follow the same rule.
    await expect(getPost(me, toDelete.id, deps())).rejects.toBeInstanceOf(NotFoundError);
    expect((await getPost(me, mine.id, deps())).body).toBe("My own post");
    await expect(getPost(me, "nope", deps())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("paginates with a stable cursor and no duplicates; New shows only the last 24 hours", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const a = await createUser(db, { now: T0 });
    await grantPlus(db, a.userId, at(T0, -hours(48)), at(T0, hours(1)));
    for (let i = 0; i < 30; i++) {
      // Bypass the posting ceiling for fixture volume.
      await db.communityPost.create({ data: { authorId: a.userId, kind: "TEXT", body: `post ${i}`, createdAt: at(T0, -hours(i)) } });
    }
    const p1 = await getFeed(me, { limit: 12 }, deps());
    const p2 = await getFeed(me, { limit: 12, cursor: p1.nextCursor }, deps());
    const p3 = await getFeed(me, { limit: 12, cursor: p2.nextCursor }, deps());
    const all = [...p1.posts, ...p2.posts, ...p3.posts];
    expect(p1.posts).toHaveLength(12);
    expect(p3.posts).toHaveLength(6);
    expect(p3.nextCursor).toBeNull();
    expect(new Set(all.map((p) => p.id)).size).toBe(30);
    expect(all.map((p) => p.body)).toEqual(Array.from({ length: 30 }, (_, i) => `post ${i}`));
    const fresh = await getFeed(me, { tab: "NEW", limit: 50 }, deps());
    expect(fresh.posts).toHaveLength(24); // hours 0..23
    expect((await getFeed(me, { cursor: "not-a-cursor" }, deps())).posts).toHaveLength(12); // bad cursor → first page
  });

  it("hides a photo post from others until its media is displayable, while the author sees it under review", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const a = await createUser(db, { now: T0 });
    const row = await db.communityPost.create({ data: { authorId: a.userId, kind: "PHOTO", body: "Sunrise", photoKey: `community-photos/${a.userId}/x/full.webp`, photoBlurhash: "LKO2?U%2Tw=w]~RBVZRi};RPxuwH", photoModeration: "REJECTED", createdAt: T0 } });
    expect((await getFeed(me, {}, deps())).posts.map((p) => p.id)).not.toContain(row.id);
    const own = await getFeed(a, {}, deps());
    expect(own.posts[0]).toMatchObject({ id: row.id, photo: null, photoUnderReview: true });
    await db.communityPost.update({ where: { id: row.id }, data: { photoModeration: "APPROVED" } });
    const visible = await getFeed(me, {}, deps());
    expect(visible.posts[0]?.photo?.url).toMatch(/^\/api\/media\/community-photos\//);
  });
});

describe("community DTO privacy", () => {
  it("carries only public identity; hidden location is absent; nothing private leaks", async () => {
    const male = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const open = await createUser(db, { now: T0, name: "Open", locationId: male.id, verified: true });
    const shy = await createUser(db, { now: T0, name: "Shy", locationId: male.id, hideLocation: true, hideAge: true });
    await grantPlus(db, open.userId, at(T0, -hours(1)), at(T0, hours(1)));
    await post(open, "hello", at(T0, 1000));
    await post(shy, "quiet", at(T0, 2000));
    const feed = await getFeed(me, {}, deps(at(T0, 3000)));
    expect(feed.posts[0]?.author).toMatchObject({ name: "Shy", location: null, verified: false });
    expect(feed.posts[1]?.author).toMatchObject({ name: "Open", location: "Malé", verified: true });
    const strip = (p: (typeof feed.posts)[number]) => ({ ...p, author: { ...p.author, photo: p.author.photo ? { ...p.author.photo, url: "<url>" } : null }, photo: p.photo ? { ...p.photo, url: "<url>" } : null });
    const json = JSON.stringify(feed.posts.map(strip));
    for (const forbidden of [open.userId, shy.userId, me.userId, open.phoneE164, "phone", "dateOfBirth", "age", "storageKey", "thumbKey", "test/", "contactHash", "subscription", "provider", "snapshot", "moderation", "authorId", "tokenHash"]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
    // An exact key list, not a subset: a new field on the post DTO has to be added here deliberately, which is
    // the moment to ask whether it is safe to hand to every other member.
    expect(Object.keys(feed.posts[0]!).sort()).toEqual([
      "author", "body", "commentCount", "context", "createdAt", "id", "isAnonymous", "isMine", "kind", "likeCount", "likedByMe", "photo", "photoUnderReview", "poll", "reactions", "topic",
    ]);
    expect(Object.keys(feed.posts[0]!.author).sort()).toEqual(["followed", "handle", "isMe", "location", "name", "photo", "verified"]);
  });
});

describe("posting", () => {
  it("validates body, kind and ownership; treats markup as text; only the author can delete", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const other = await createUser(db, { now: T0 });
    await expect(post(me, "   ")).rejects.toBeInstanceOf(ValidationError);
    await expect(post(me, "x".repeat(COMMUNITY.postMaxLength + 1))).rejects.toBeInstanceOf(ValidationError);
    await expect(createPost(me, { kind: "PHOTO", body: "no photo" }, deps())).rejects.toBeInstanceOf(ValidationError);
    await expect(createPost(me, { kind: "BAD" as never, body: "x" }, deps())).rejects.toThrow();
    const xss = "<script>alert(1)</script> benches";
    const created = await post(me, xss);
    expect(created.body).toBe(xss); // stored as text; React renders it as text
    expect(created.kind).toBe("TEXT");
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: created.id } })).photoModeration).toBe("APPROVED"); // only media is moderated
    const q = await post(me, "Best breakfast in Hulhumalé?", at(T0, 1000), "QUESTION");
    expect(q.kind).toBe("QUESTION");
    // Ownership comes from the actor, never the payload: another user cannot delete.
    await expect(deletePost(other, created.id, { db })).rejects.toBeInstanceOf(NotFoundError);
    await deletePost(me, created.id, { db, now: at(T0, 2000) });
    expect((await db.communityPost.findUniqueOrThrow({ where: { id: created.id } })).deletedAt).not.toBeNull();
    const suspended = await createUser(db, { now: T0 });
    await db.user.update({ where: { id: suspended.userId }, data: { status: "SUSPENDED" } });
    await expect(post(suspended, "still here?")).rejects.toThrow(/can't post/);
  });

  it("applies the per-hour posting ceiling", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    for (let i = 0; i < COMMUNITY.postsPerHour; i++) await post(me, `p${i}`, at(T0, i * 1000));
    await expect(post(me, "one more", at(T0, minutes(30)))).rejects.toBeInstanceOf(ValidationError);
    expect((await post(me, "next hour", at(T0, hours(1) + 1000))).body).toBe("next hour");
  });
});

describe("reactions", () => {
  it("is idempotent, toggles, keeps the count exact under concurrency and never touches dating state", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const a = await createUser(db, { now: T0 });
    const p = await post(a, "benches");
    const first = await setReaction(me, p.id, true, { db, now: T0 });
    const again = await setReaction(me, p.id, true, { db, now: at(T0, 1000) });
    const oneHeart = { groups: [{ emoji: "HEART", count: 1, mine: true }], total: 1, mine: "HEART" };
    expect(first).toEqual({ liked: true, likeCount: 1, reactions: oneHeart });
    // Idempotent: the same call again leaves one row, one heart, and the same count.
    expect(again).toEqual({ liked: true, likeCount: 1, reactions: oneHeart });
    const fans = await Promise.all(Array.from({ length: 8 }, () => createUser(db, { now: T0 })));
    await Promise.all(fans.map((f) => setReaction(f, p.id, true, { db, now: T0 })));
    await Promise.all([setReaction(me, p.id, true, { db, now: T0 }), setReaction(me, p.id, true, { db, now: T0 }), setReaction(me, p.id, true, { db, now: T0 })]);
    const row = await db.communityPost.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.likeCount).toBe(9);
    expect(await db.communityLike.count({ where: { postId: p.id } })).toBe(9);
    const off = await setReaction(me, p.id, false, { db, now: at(T0, 2000) });
    // Mine is gone; the eight fans' hearts are not. `mine: null` with a count of 8 is exactly that distinction.
    expect(off).toEqual({ liked: false, likeCount: 8, reactions: { groups: [{ emoji: "HEART", count: 8, mine: false }], total: 8, mine: null } });
    expect((await setReaction(me, p.id, false, { db, now: at(T0, 3000) })).likeCount).toBe(8);
    // Dating boundary: no Like, Match, Conversation, and the like allowance is untouched.
    expect(await db.like.count()).toBe(0);
    expect(await db.match.count()).toBe(0);
    expect(await db.conversation.count()).toBe(0);
    expect((await getLikeAllowance(db, me.userId, T0)).used).toBe(0);
  });

  it("a blocked pair cannot react or comment; existing reactions from the blocked side no longer show the post", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const a = await createUser(db, { now: T0 });
    const p = await post(a, "hello");
    await blockUser(a, me.userId, { db, now: T0 });
    await expect(setReaction(me, p.id, true, { db, now: T0 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(addComment(me, p.id, "hi", deps())).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.communityLike.count()).toBe(0);
  });
});

describe("comments", () => {
  it("persists, paginates oldest first, hides blocked and non-active authors, and counts correctly", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const a = await createUser(db, { now: T0, name: "Ahmed" });
    const b = await createUser(db, { now: T0, name: "Bisma" });
    const p = await post(a, "Question: best breakfast spot?", T0, "QUESTION");
    const mine = await addComment(me, p.id, "Sea House, before 7", deps(at(T0, 1000)));
    await addComment(b, p.id, "<b>Try</b> the tea shop", deps(at(T0, 2000)));
    await addComment(a, p.id, "Thanks both", deps(at(T0, 3000)));
    expect(mine).toMatchObject({ isMine: true, author: { isMe: true } });
    const page = await listComments(me, p.id, {}, deps());
    expect(page.comments.map((c) => c.body)).toEqual(["Sea House, before 7", "<b>Try</b> the tea shop", "Thanks both"]);
    expect((await getPost(me, p.id, deps())).commentCount).toBe(3);
    // Pagination
    const p1 = await listComments(me, p.id, { limit: 2 }, deps());
    const p2 = await listComments(me, p.id, { limit: 2, cursor: p1.nextCursor }, deps());
    expect([...p1.comments, ...p2.comments].map((c) => c.body)).toEqual(["Sea House, before 7", "<b>Try</b> the tea shop", "Thanks both"]);
    expect(p2.nextCursor).toBeNull();
    // Block Bisma → her comment disappears for me; count stays a persisted total.
    await blockUser(me, b.userId, { db, now: at(T0, 4000) });
    expect((await listComments(me, p.id, {}, deps())).comments.map((c) => c.author.name)).toEqual(["User 1", "Ahmed"].map((n, i) => (i === 0 ? mine.author.name : n)));
    // Validation and ownership
    await expect(addComment(me, p.id, "  ", deps())).rejects.toBeInstanceOf(ValidationError);
    await expect(addComment(me, p.id, "x".repeat(COMMUNITY.commentMaxLength + 1), deps())).rejects.toBeInstanceOf(ValidationError);
    await expect(deleteComment(a, mine.id, { db })).rejects.toBeInstanceOf(NotFoundError);
    await deleteComment(me, mine.id, { db, now: at(T0, 5000) });
    expect((await getPost(me, p.id, deps())).commentCount).toBe(2);
    expect((await listComments(me, p.id, {}, deps())).comments.map((c) => c.body)).toEqual(["Thanks both"]);
  });

  it("notifies the author of reactions and comments only when they opted in, never for their own actions or across a block", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const a = await createUser(db, { now: T0 });
    await db.notificationSettings.update({ where: { userId: a.userId }, data: { community: true } });
    const p = await post(a, "hello");
    await setReaction(a, p.id, true, { db, now: T0 }); // own action
    await setReaction(me, p.id, true, { db, now: T0 });
    await setReaction(me, p.id, false, { db, now: at(T0, 500) });
    await setReaction(me, p.id, true, { db, now: at(T0, 1000) }); // deduped: still one unread
    await addComment(me, p.id, "nice", deps(at(T0, 2000)));
    const notes = await db.notification.findMany({ where: { userId: a.userId }, orderBy: { createdAt: "asc" } });
    expect(notes.map((n) => n.type)).toEqual(["COMMUNITY_LIKE", "COMMUNITY_COMMENT"]);
    expect(await db.notification.count({ where: { userId: me.userId } })).toBe(0);
    // Opt-out default: another author without the setting gets nothing.
    const quiet = await createUser(db, { now: T0 });
    const q = await post(quiet, "quiet post");
    await setReaction(me, q.id, true, { db, now: T0 });
    expect(await db.notification.count({ where: { userId: quiet.userId } })).toBe(0);
  });
});

describe("report and block from Community", () => {
  it("reporting a post or comment stores evidence with the approved reason and does NOT block; blocking is separate and hides both ways", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const a = await createUser(db, { now: T0 });
    const p = await post(a, "send me money");
    const c = await addComment(a, p.id, "cash only", deps(at(T0, 1000)));
    const r1 = await reportPost(me, { postId: p.id, reason: "SCAM_OR_FINANCIAL_REQUEST", note: "asked for cash", targetUserId: me.userId }, { db, now: at(T0, 2000) });
    const r2 = await reportComment(me, { commentId: c.id, reason: "SPAM" }, { db, now: at(T0, 3000) });
    const rows = await db.report.findMany({ where: { id: { in: [r1.reportId, r2.reportId] } }, orderBy: { createdAt: "asc" } });
    expect(rows[0]).toMatchObject({ reporterId: me.userId, targetUserId: a.userId, targetPostId: p.id, reason: "SCAM_OR_FINANCIAL_REQUEST", status: "OPEN" });
    expect(JSON.stringify(rows[0]!.snapshot)).toContain("send me money");
    expect(rows[1]).toMatchObject({ targetCommentId: c.id, targetUserId: a.userId, reason: "SPAM" });
    expect(JSON.stringify(rows[1]!.snapshot)).toContain("cash only");
    expect(await db.block.count()).toBe(0); // report alone does not block
    expect((await getFeed(me, {}, deps())).posts.map((x) => x.id)).toContain(p.id); // still visible until blocked
    await expect(reportPost(a, { postId: p.id, reason: "SPAM" }, { db })).rejects.toBeInstanceOf(ValidationError); // own post
    await expect(reportPost(me, { postId: p.id, reason: "NOT_A_REASON" }, { db })).rejects.toBeInstanceOf(ValidationError);

    await blockPostAuthor(me, p.id, { db, now: at(T0, 4000) });
    expect(await db.block.count({ where: { blockerId: me.userId, blockedId: a.userId } })).toBe(1);
    expect((await getFeed(me, {}, deps())).posts).toEqual([]);
    expect((await getFeed(a, {}, deps())).posts.map((x) => x.id)).toContain(p.id); // a still sees their own post
    await post(me, "mine");
    expect((await getFeed(a, {}, deps(at(T0, 5000)))).posts.map((x) => x.body)).not.toContain("mine");
    await expect(setReaction(a, (await getFeed(me, {}, deps())).posts[0]!.id, true, { db })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getCommunityProfile(me, a.handle, deps())).rejects.toBeInstanceOf(NotFoundError);
    // Reporting never changed dating state.
    expect(await db.match.count()).toBe(0);
    expect(await db.like.count()).toBe(0);
  });
});

describe("dating boundary", () => {
  it("Community profiles are read-only relationships; a dating Like still goes through the Phase 6 path and caps", async () => {
    const me = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN" });
    const author = await createUser(db, { now: T0, gender: "WOMAN", interestedIn: "MEN", hideAge: true });
    await post(author, "hello from the reef");
    const profile = await getCommunityProfile(me, author.handle, deps());
    expect(profile).toMatchObject({ handle: author.handle, age: null });
    expect(JSON.stringify(profile)).not.toContain(author.userId);
    expect(await db.like.count()).toBe(0);

    // Liking that author consumes the same allowance as Discover.
    await likeByHandle(me, author.handle, deps());
    expect((await getLikeAllowance(db, me.userId, T0)).used).toBe(1);
    const others = await Promise.all(Array.from({ length: 30 }, () => createUser(db, { now: T0, gender: "WOMAN", interestedIn: "MEN" })));
    for (const o of others.slice(0, 29)) await likeUser(me, o.userId, { db, now: T0 });
    await expect(likeByHandle(me, others[29]!.handle, deps())).rejects.toBeInstanceOf(LikeLimitReachedError);
    // Plus: 90 cap, still enforced from a Community profile.
    const plus = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN" });
    await grantPlus(db, plus.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const many = await Promise.all(Array.from({ length: PRODUCT_RULES.PLUS.dailyLikeLimit }, () => createUser(db, { now: T0, gender: "WOMAN", interestedIn: "MEN" })));
    for (const o of many) await likeUser(plus, o.userId, { db, now: T0 });
    await expect(likeByHandle(plus, author.handle, deps())).rejects.toBeInstanceOf(LikeLimitReachedError);
    // Community interactions created no matches or conversations for anyone.
    expect(await db.match.count()).toBe(0);
    expect(await db.conversation.count()).toBe(0);
  });
});

describe("Invisible Mode + Community (owner decision, approved 2026-09-17)", () => {
  it("an Invisible Mode user participates in Community normally, is never made discoverable by it, and the DTO never reveals the state", async () => {
    expect(COMMUNITY.invisibleModeParticipation).toBe("ALLOWED");
    const viewer = await createUser(db, { now: T0, gender: "MAN", interestedIn: "WOMEN", age: 27, ageMin: 20, ageMax: 40 });
    const ghost = await createUser(db, { now: T0, gender: "WOMAN", interestedIn: "MEN", age: 26, ageMin: 20, ageMax: 40, invisibleMode: true, name: "Ghost" });
    await grantPlus(db, ghost.userId, at(T0, -hours(1)), at(T0, hours(24)));

    // Baseline: without Invisible Mode the pair would be mutually discoverable; with it, the viewer never gets Ghost.
    expect(await canView(db, viewer.userId, ghost.userId, T0)).toBe(false);
    expect(await getDeckCandidateIds(db, viewer, { now: T0 })).not.toContain(ghost.userId);

    // Ghost can view, post, comment and react.
    const ghostPost = await post(ghost, "Not in the deck, but here in Community");
    expect((await getFeed(ghost, {}, deps())).posts.length).toBeGreaterThan(0);
    const viewerPost = await post(viewer, "Hello from the viewer", at(T0, 1000));
    const comment = await addComment(ghost, viewerPost.id, "Hi from Ghost", deps(at(T0, 2000)));
    expect(comment.author.name).toBe("Ghost");
    expect((await setReaction(ghost, viewerPost.id, true, deps(at(T0, 3000)))).likeCount).toBe(1);

    // Ghost's content and profile are visible to others under the normal Community rules.
    const feed = await getFeed(viewer, {}, deps(at(T0, 4000)));
    const seen = feed.posts.find((p) => p.id === ghostPost.id);
    expect(seen?.author.name).toBe("Ghost");
    expect((await listComments(viewer, viewerPost.id, {}, deps())).comments.map((c) => c.body)).toEqual(["Hi from Ghost"]);
    const profile = await getCommunityProfile(viewer, ghost.handle, deps());
    expect(profile.name).toBe("Ghost");

    // Nothing in Community reveals dating eligibility, preferences, likes or the Invisible Mode flag.
    const payload = JSON.stringify({ seen, profile, feed: feed.posts });
    expect(payload).not.toMatch(/invisible|visibility|discoverable|interestedIn|ageMin|ageMax|likedBy(?!Me)|dateOfBirth|phone/i);

    // Community activity has not made Ghost discoverable; a dating Like from the viewer still fails through the Phase 6 path.
    expect(await canView(db, viewer.userId, ghost.userId, at(T0, 5000))).toBe(false);
    expect(await getDeckCandidateIds(db, viewer, { now: at(T0, 5000) })).not.toContain(ghost.userId);
    await expect(likeUser(viewer, ghost.userId, { db, now: at(T0, 5000) })).rejects.toBeInstanceOf(NotFoundError);

    // Plus lapses: Community participation continues; discovery stays fail-closed (§12.6).
    const later = at(T0, hours(48));
    const afterLapse = await post(ghost, "Still here after Plus lapsed", later);
    expect((await getFeed(viewer, {}, deps(later))).posts.map((p) => p.id)).toContain(afterLapse.id);
    expect(await canView(db, viewer.userId, ghost.userId, later)).toBe(false);
  });
});
