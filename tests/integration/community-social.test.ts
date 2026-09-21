import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { addComment } from "@/server/community/comments";
import { getCommunityDiscover } from "@/server/community/discover";
import { ANONYMOUS_AUTHOR } from "@/server/community/dto";
import { getFeed, getPost } from "@/server/community/feed";
import { followMember, followingIds, isFollowing, unfollowMember } from "@/server/community/follows";
import { parsePollOptions, toPercentages, votePoll } from "@/server/community/polls";
import { createPost } from "@/server/community/posts";
import { blockPostAuthor, reportPost } from "@/server/community/reports";
import { parseTopic, suggestedTopic } from "@/server/community/topics";
import { blockUser } from "@/server/safety/block";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createLocation, createStaff, createUser, type TestUser } from "../helpers/factory";

/*
 * Topics, polls, private follows, anonymous confessions and the side modules.
 *
 * The anonymity block is the one that matters most: the brief allows a confession to be shown without its author
 * but forbids it from becoming untraceable internally, so these tests assert BOTH halves — nothing identifying in
 * any DTO any other member can obtain, and the author id still on the row for moderation, reports and blocks.
 */
const db = testDb();
const T0 = new Date("2026-09-21T10:00:00Z");
const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));
const deps = (now = T0) => ({ db, storage, now });

const text = (author: TestUser, body: string, now = T0, topic?: string) => createPost(author, { kind: "TEXT", body, topic }, deps(now));
const confess = (author: TestUser, body: string, now = T0) => createPost(author, { kind: "CONFESSION", body }, deps(now));
const poll = (author: TestUser, body: string, options: string[], now = T0) => createPost(author, { kind: "POLL", body, pollOptions: options }, deps(now));

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

describe("topics", () => {
  it("parses only the six known keys and suggests one per kind", () => {
    expect(parseTopic("DATING")).toBe("DATING");
    expect(parseTopic("dating")).toBeNull();
    expect(parseTopic("")).toBeNull();
    expect(parseTopic(null)).toBeNull();
    expect(parseTopic("DROP TABLE")).toBeNull();
    expect(suggestedTopic("POLL")).toBe("POLLS");
    expect(suggestedTopic("CONFESSION")).toBe("CONFESSIONS");
    expect(suggestedTopic("QUESTION")).toBe("QUESTIONS");
    expect(suggestedTopic("TEXT")).toBeNull();
  });

  it("filters the feed by chip, keeps untagged posts out of every chip, and defaults a poll and a confession to their own", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const other = await createUser(db, { now: T0 });
    await text(other, "no chip", at(T0, 1000));
    const dating = await text(other, "chip post", at(T0, 2000), "DATING");
    const p = await poll(other, "Pick one", ["A", "B"], at(T0, 3000));
    const c = await confess(other, "a secret", at(T0, 4000));

    expect((await getFeed(me, { topic: "DATING" }, deps(at(T0, 9000)))).posts.map((x) => x.id)).toEqual([dating.id]);
    expect((await getFeed(me, { topic: "POLLS" }, deps(at(T0, 9000)))).posts.map((x) => x.id)).toEqual([p.id]);
    expect((await getFeed(me, { topic: "CONFESSIONS" }, deps(at(T0, 9000)))).posts.map((x) => x.id)).toEqual([c.id]);
    expect((await getFeed(me, {}, deps(at(T0, 9000)))).posts).toHaveLength(4);
  });

  it("refuses an unknown topic rather than storing it", async () => {
    const me = await createUser(db, { now: T0 });
    const created = await createPost(me, { kind: "TEXT", body: "hi", topic: "NONSENSE" }, deps());
    expect(created.topic).toBeNull();
  });
});

describe("anonymous confessions", () => {
  it("shows no identifying field to anyone — including the author — while keeping authorId on the row", async () => {
    const male = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const author = await createUser(db, { now: T0, name: "Aminath", locationId: male.id, verified: true });
    const created = await confess(author, "I still keep the ferry ticket", at(T0, 1000));

    for (const viewer of [me, author]) {
      const [dto] = (await getFeed(viewer, {}, deps(at(T0, 5000)))).posts;
      expect(dto?.isAnonymous).toBe(true);
      expect(dto?.author).toEqual(ANONYMOUS_AUTHOR);
      const json = JSON.stringify(dto);
      for (const forbidden of [author.userId, author.handle, "Aminath", "Malé", author.phoneE164]) {
        expect(json, forbidden).not.toContain(forbidden);
      }
    }
    // …and the same through the single-post read, which is a different entry point into the same hydrator.
    expect((await getPost(me, created.id, deps(at(T0, 5000)))).author).toEqual(ANONYMOUS_AUTHOR);

    // Internally traceable: this is the half the brief is emphatic about.
    const row = await db.communityPost.findUniqueOrThrow({ where: { id: created.id }, select: { authorId: true, isAnonymous: true } });
    expect(row).toEqual({ authorId: author.userId, isAnonymous: true });
  });

  it("still reports and blocks the real author", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const author = await createUser(db, { now: T0 });
    const created = await confess(author, "a thing I did", at(T0, 1000));

    const { reportId } = await reportPost(me, { postId: created.id, reason: "HARASSMENT" }, { db, now: at(T0, 2000) });
    const report = await db.report.findUniqueOrThrow({ where: { id: reportId }, select: { targetUserId: true } });
    expect(report.targetUserId).toBe(author.userId);

    await blockPostAuthor(me, created.id, { db, now: at(T0, 3000) });
    expect(await db.block.count({ where: { blockerId: me.userId, blockedId: author.userId } })).toBe(1);
    expect((await getFeed(me, {}, deps(at(T0, 4000)))).posts).toHaveLength(0);
  });

  it("cannot be created anonymously by any other kind, and a confession cannot be created signed", async () => {
    const author = await createUser(db, { now: T0 });
    // The route and the domain take no "anonymous" input at all; the flag follows the kind.
    const plain = await createPost(author, { kind: "TEXT", body: "signed" }, deps(at(T0, 1000)));
    expect(plain.isAnonymous).toBe(false);
    const secret = await confess(author, "unsigned", at(T0, 2000));
    expect(secret.isAnonymous).toBe(true);
  });

  it("never suggests a member on the strength of their anonymous posts", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const quiet = await createUser(db, { now: T0, name: "Quiet" });
    for (let i = 0; i < 3; i++) await confess(quiet, `secret ${i}`, at(T0, 1000 + i));
    const { suggestions } = await getCommunityDiscover(me, deps(at(T0, 9000)));
    expect(suggestions).toHaveLength(0);
  });
});

describe("polls", () => {
  it("validates option lists", () => {
    expect(() => parsePollOptions(["only one"])).toThrow(ValidationError);
    expect(() => parsePollOptions(["a", "b", "c", "d", "e"])).toThrow(ValidationError);
    expect(() => parsePollOptions(["Tea", "tea"])).toThrow(ValidationError);
    expect(() => parsePollOptions(["a", "x".repeat(61)])).toThrow(ValidationError);
    expect(parsePollOptions([" Tea ", "Coffee", ""])).toEqual(["Tea", "Coffee"]);
  });

  it("gives percentages that always sum to 100", () => {
    expect(toPercentages([0, 0])).toEqual([0, 0]);
    expect(toPercentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(toPercentages([1, 2])).toEqual([33, 67]);
    for (const counts of [[1, 1, 1], [2, 3, 4], [1, 1, 1, 1], [5, 1, 1], [7, 7, 7, 7]]) {
      expect(toPercentages(counts).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it("counts one vote per member, lets a vote move, and never reveals who voted", async () => {
    const author = await createUser(db, { now: T0 });
    const voter = await createUser(db, { gender: "MAN", now: T0 });
    const created = await poll(author, "Ferry or drive?", ["Ferry", "Drive"], at(T0, 1000));
    const [ferry, drive] = created.poll!.options;

    const first = await votePoll(voter, { postId: created.id, optionId: ferry!.id }, { db, now: at(T0, 2000) });
    expect(first.totalVotes).toBe(1);
    // Idempotent: voting the same way again changes nothing.
    const again = await votePoll(voter, { postId: created.id, optionId: ferry!.id }, { db, now: at(T0, 2100) });
    expect(again.totalVotes).toBe(1);
    // Moving the vote moves both counters at once.
    const moved = await votePoll(voter, { postId: created.id, optionId: drive!.id }, { db, now: at(T0, 3000) });
    expect(moved.totalVotes).toBe(1);
    expect(moved.options.find((o) => o.id === drive!.id)).toMatchObject({ votes: 1, percent: 100, chosenByMe: true });
    expect(moved.options.find((o) => o.id === ferry!.id)).toMatchObject({ votes: 0, percent: 0 });
    expect(await db.communityPollVote.count({ where: { postId: created.id } })).toBe(1);

    // The author sees totals but not the voter; the voter sees only their own choice.
    const asAuthor = (await getFeed(author, {}, deps(at(T0, 4000)))).posts[0]!;
    expect(asAuthor.poll).toMatchObject({ totalVotes: 1, myOptionId: null });
    expect(JSON.stringify(asAuthor.poll)).not.toContain(voter.userId);
    const asVoter = (await getFeed(voter, {}, deps(at(T0, 4000)))).posts[0]!;
    expect(asVoter.poll?.myOptionId).toBe(drive!.id);
  });

  it("rejects an option from another poll and a vote on a deleted poll", async () => {
    const author = await createUser(db, { now: T0 });
    const voter = await createUser(db, { gender: "MAN", now: T0 });
    const a = await poll(author, "One", ["A", "B"], at(T0, 1000));
    const b = await poll(author, "Two", ["C", "D"], at(T0, 2000));
    await expect(votePoll(voter, { postId: a.id, optionId: b.poll!.options[0]!.id }, { db })).rejects.toThrow(NotFoundError);
    await db.communityPost.update({ where: { id: a.id }, data: { deletedAt: at(T0, 3000) } });
    await expect(votePoll(voter, { postId: a.id, optionId: a.poll!.options[0]!.id }, { db })).rejects.toThrow(NotFoundError);
  });

  it("refuses options on a non-poll and a poll without them", async () => {
    const author = await createUser(db, { now: T0 });
    await expect(createPost(author, { kind: "TEXT", body: "x", pollOptions: ["a", "b"] }, deps())).rejects.toThrow(ValidationError);
    await expect(createPost(author, { kind: "POLL", body: "x" }, deps())).rejects.toThrow(ValidationError);
  });
});

describe("private follows", () => {
  it("is one-directional, idempotent, and invisible to the person followed", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const them = await createUser(db, { now: T0 });
    await followMember(me, them.userId, { db, now: T0 });
    await followMember(me, them.userId, { db, now: at(T0, 1000) });
    expect(await db.communityFollow.count()).toBe(1);
    expect(await isFollowing(db, me, them.userId)).toBe(true);
    // The other direction is untouched, and nothing was sent to them.
    expect(await isFollowing(db, them, me.userId)).toBe(false);
    expect(await followingIds(db, them.userId)).toEqual([]);
    expect(await db.notification.count({ where: { userId: them.userId } })).toBe(0);

    // Their own view of a post of mine carries no hint that I follow them.
    await text(me, "mine", at(T0, 2000));
    const theirFeed = await getFeed(them, {}, deps(at(T0, 3000)));
    expect(theirFeed.posts[0]?.author.followed).toBe(false);

    await unfollowMember(me, them.userId, { db });
    expect(await db.communityFollow.count()).toBe(0);
    // Unfollowing something that is not followed is not an error.
    await unfollowMember(me, them.userId, { db });
  });

  it("refuses self, staff and either direction of a block — all with the same answer", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const iBlocked = await createUser(db, { now: T0 });
    const blockedMe = await createUser(db, { now: T0 });
    const staff = await createStaff(db, { now: T0 });
    await blockUser(me, iBlocked.userId, { db, now: T0 });
    await blockUser(blockedMe, me.userId, { db, now: T0 });

    await expect(followMember(me, me.userId, { db })).rejects.toThrow(ValidationError);
    await expect(followMember(me, iBlocked.userId, { db })).rejects.toThrow(NotFoundError);
    await expect(followMember(me, blockedMe.userId, { db })).rejects.toThrow(NotFoundError);
    await expect(followMember(me, staff.userId, { db })).rejects.toThrow(NotFoundError);
    await expect(followMember(me, "does-not-exist", { db })).rejects.toThrow(NotFoundError);
  });

  it("drops the relationship in both directions when either side blocks", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const them = await createUser(db, { now: T0 });
    await followMember(me, them.userId, { db, now: T0 });
    await followMember(them, me.userId, { db, now: T0 });
    await blockUser(them, me.userId, { db, now: at(T0, 1000) });
    expect(await db.communityFollow.count()).toBe(0);
  });

  it("shows only followed authors in Following, and never one a block should hide", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const followed = await createUser(db, { now: T0 });
    const stranger = await createUser(db, { now: T0 });
    const followedThenBlocked = await createUser(db, { now: T0 });
    const kept = await text(followed, "from someone I follow", at(T0, 1000));
    await text(stranger, "from a stranger", at(T0, 2000));
    const later = await text(followedThenBlocked, "from someone I blocked", at(T0, 3000));
    await followMember(me, followed.userId, { db, now: T0 });
    await followMember(me, followedThenBlocked.userId, { db, now: T0 });

    // Both followed authors, newest first; the stranger's post is absent although For You would carry it.
    expect((await getFeed(me, { tab: "FOLLOWING" }, deps(at(T0, 4000)))).posts.map((p) => p.id)).toEqual([later.id, kept.id]);

    // A stale follow row cannot resurrect a blocked author's posts: the visibility SQL runs on this tab too.
    // The Block row is written directly so the follow row survives the block, which is the case being tested.
    await db.block.create({ data: { blockerId: me.userId, blockedId: followedThenBlocked.userId, source: "MANUAL", createdAt: at(T0, 5000) } });
    expect((await getFeed(me, { tab: "FOLLOWING" }, deps(at(T0, 6000)))).posts.map((p) => p.id)).toEqual([kept.id]);
  });

  it("marks follow state on the author DTO for the viewer only", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const them = await createUser(db, { now: T0 });
    await text(them, "hello", at(T0, 1000));
    expect((await getFeed(me, {}, deps(at(T0, 2000)))).posts[0]?.author.followed).toBe(false);
    await followMember(me, them.userId, { db, now: at(T0, 2500) });
    expect((await getFeed(me, {}, deps(at(T0, 3000)))).posts[0]?.author.followed).toBe(true);
  });
});

describe("social context", () => {
  it("counts distinct repliers, excludes the author, and says nothing below the threshold", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const author = await createUser(db, { now: T0 });
    const created = await text(author, "Where's the best hedhikaa?", at(T0, 1000));

    // The author replying to themselves twice is not a conversation.
    await addComment(author, created.id, "bump", { db, storage, now: at(T0, 2000) });
    await addComment(me, created.id, "Sosun", { db, storage, now: at(T0, 2100) });
    await addComment(me, created.id, "or Symphony", { db, storage, now: at(T0, 2200) });
    expect((await getFeed(me, {}, deps(at(T0, 3000)))).posts[0]?.context).toBeNull();

    const others = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    for (const [i, u] of others.entries()) await addComment(u, created.id, `me too ${i}`, { db, storage, now: at(T0, 2300 + i) });
    const context = (await getFeed(me, {}, deps(at(T0, 4000)))).posts[0]?.context;
    expect(context).toMatchObject({ participants: 3 });
  });

  it("names an island only when enough located repliers share it, and never one that is hidden", async () => {
    const male = await createLocation(db, { name: "Malé", atollCode: "K", isGreaterMale: true });
    const me = await createUser(db, { gender: "MAN", now: T0, locationId: male.id });
    const author = await createUser(db, { now: T0 });
    const created = await text(author, "Anyone up?", at(T0, 1000));
    const locals = [
      await createUser(db, { now: T0, locationId: male.id }),
      await createUser(db, { now: T0, locationId: male.id }),
      await createUser(db, { now: T0, locationId: male.id, hideLocation: true }),
    ];
    for (const [i, u] of locals.entries()) await addComment(u, created.id, `hi ${i}`, { db, storage, now: at(T0, 2000 + i) });

    // Two located repliers plus one who hides their island: below the floor, so no label.
    expect((await getFeed(me, {}, deps(at(T0, 3000)))).posts[0]?.context).toMatchObject({ participants: 3, popularIn: null });

    const third = await createUser(db, { now: T0, locationId: male.id });
    await addComment(third, created.id, "hi again", { db, storage, now: at(T0, 2500) });
    expect((await getFeed(me, {}, deps(at(T0, 4000)))).posts[0]?.context).toMatchObject({ participants: 4, popularIn: "Malé" });
  });
});

describe("the modules beside the feed", () => {
  it("returns nothing at all for an empty Community rather than inventing activity", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    expect(await getCommunityDiscover(me, deps(at(T0, 1000)))).toEqual({ popular: [], suggestions: [], activeTopics: [] });
  });

  it("shows popular discussions only once two clear the floor, with their real counts", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const author = await createUser(db, { now: T0 });
    const repliers = [await createUser(db, { now: T0 }), await createUser(db, { now: T0 })];
    const busy = await text(author, "One reply only", at(T0, 1000));
    await addComment(repliers[0]!, busy.id, "a", { db, storage, now: at(T0, 1100) });
    expect((await getCommunityDiscover(me, deps(at(T0, 5000)))).popular).toEqual([]);

    await addComment(repliers[1]!, busy.id, "b", { db, storage, now: at(T0, 1200) });
    const second = await text(author, "Another busy one", at(T0, 2000), "ADVICE");
    for (const r of repliers) await addComment(r, second.id, "c", { db, storage, now: at(T0, 2100) });
    const { popular } = await getCommunityDiscover(me, deps(at(T0, 5000)));
    expect(popular).toHaveLength(2);
    expect(popular.map((p) => p.commentCount)).toEqual([2, 2]);
    expect(popular.map((p) => p.id).sort()).toEqual([busy.id, second.id].sort());
    // No author is named, which is what makes the module safe for confessions.
    expect(JSON.stringify(popular)).not.toContain(author.userId);
  });

  it("suggests only members the viewer can see and does not already follow", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const stranger = await createUser(db, { now: T0, name: "Stranger" });
    const alreadyFollowed = await createUser(db, { now: T0, name: "Known" });
    const blocked = await createUser(db, { now: T0, name: "Blocked" });
    for (const u of [stranger, alreadyFollowed, blocked]) await text(u, `post by ${u.handle}`, at(T0, 1000));
    await followMember(me, alreadyFollowed.userId, { db, now: T0 });
    await blockUser(me, blocked.userId, { db, now: at(T0, 1500) });

    const { suggestions } = await getCommunityDiscover(me, deps(at(T0, 2000)));
    expect(suggestions.map((s) => s.author.name)).toEqual(["Stranger"]);
    expect(suggestions[0]).toMatchObject({ recentPosts: 1 });
    expect(suggestions[0]?.author.followed).toBe(false);
    // Self is never suggested.
    await text(me, "my own", at(T0, 1800));
    expect((await getCommunityDiscover(me, deps(at(T0, 2500)))).suggestions.map((s) => s.author.name)).toEqual(["Stranger"]);
  });

  it("lists active topics with real counts and omits chips with nothing behind them", async () => {
    const me = await createUser(db, { gender: "MAN", now: T0 });
    const author = await createUser(db, { now: T0 });
    await text(author, "a", at(T0, 1000), "DATING");
    await text(author, "b", at(T0, 2000), "DATING");
    await text(author, "c", at(T0, 3000), "ADVICE");
    await text(author, "untagged", at(T0, 4000));
    const { activeTopics } = await getCommunityDiscover(me, deps(at(T0, 5000)));
    expect(activeTopics).toEqual([
      { key: "DATING", label: "Dating 👀", posts: 2 },
      { key: "ADVICE", label: "Advice", posts: 1 },
    ]);
  });
});
