import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { COMMUNITY } from "@/config/product";
import { EntitlementRequiredError } from "@/lib/errors";
import { createPost } from "@/server/community/posts";
import { getConversationForActor, sendMessage } from "@/server/conversations/messages";
import { canView, getDeckCandidateIds } from "@/server/discovery/query";
import { likeUser } from "@/server/likes/like";
import { getInvisibleModeState, setInvisibleMode } from "@/server/privacy/invisible-mode";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createUser, grantPlus, hours } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-17T20:00:00Z");

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

describe("Invisible Mode", () => {
  it("a normal user is discoverable normally", async () => {
    const a = await createUser(db, { now: T0 });
    const c = await createUser(db, { now: T0 });
    expect(await getDeckCandidateIds(db, c, { now: T0 })).toContain(a.userId);
    expect(await canView(db, c.userId, a.userId, T0)).toBe(true);
  });

  it("an invisible Plus user is not shown to people they have not liked", async () => {
    const a = await createUser(db, { now: T0 });
    await grantPlus(db, a.userId, at(T0, -hours(1)), at(T0, hours(24)));
    await setInvisibleMode(a, true, { db, now: T0 });
    const c = await createUser(db, { now: T0 });
    expect(await getDeckCandidateIds(db, c, { now: T0 })).not.toContain(a.userId);
    expect(await canView(db, c.userId, a.userId, T0)).toBe(false);
    // C cannot like A either: the like path uses the same predicate.
    await expect(likeUser(c, a.userId, { db, now: T0 })).rejects.toThrow(/not found/i);
  });

  it("becomes discoverable to someone after liking them, and only to them", async () => {
    const a = await createUser(db, { now: T0 });
    await grantPlus(db, a.userId, at(T0, -hours(1)), at(T0, hours(24)));
    await setInvisibleMode(a, true, { db, now: T0 });
    const b = await createUser(db, { now: T0 });
    const c = await createUser(db, { now: T0 });
    await likeUser(a, b.userId, { db, now: T0 });
    expect(await getDeckCandidateIds(db, b, { now: T0 })).toContain(a.userId);
    expect(await getDeckCandidateIds(db, c, { now: T0 })).not.toContain(a.userId);
    // B can like back and match.
    const r = await likeUser(b, a.userId, { db, now: T0 });
    expect(r.matched).toBe(true);
  });

  it("existing matches and chats remain available after enabling", async () => {
    const a = await createUser(db, { now: T0 });
    const b = await createUser(db, { now: T0 });
    await likeUser(a, b.userId, { db, now: T0 });
    const r = await likeUser(b, a.userId, { db, now: T0 });
    await grantPlus(db, a.userId, at(T0, -hours(1)), at(T0, hours(24)));
    await setInvisibleMode(a, true, { db, now: T0 });
    const conv = await getConversationForActor(db, b, r.conversationId!);
    expect(conv.status).toBe("ACTIVE");
    const sent = await sendMessage(b, r.conversationId!, "Still here", { db, now: at(T0, 1000) });
    expect(sent.body).toBe("Still here");
  });

  it("a Free user cannot enable it and is pointed to Plus", async () => {
    const a = await createUser(db, { now: T0 });
    await expect(setInvisibleMode(a, true, { db, now: T0 })).rejects.toBeInstanceOf(EntitlementRequiredError);
    expect((await getInvisibleModeState(a, { db, now: T0 })).enabled).toBe(false);
  });

  it("a Plus member with the flag off is discoverable like anyone else", async () => {
    const a = await createUser(db, { now: T0 });
    await grantPlus(db, a.userId, at(T0, -hours(1)), at(T0, hours(24)));
    const c = await createUser(db, { now: T0 });
    expect((await getInvisibleModeState(a, { db, now: T0 }))).toEqual({ enabled: false, effective: false, suspended: false });
    expect(await getDeckCandidateIds(db, c, { now: T0 })).toContain(a.userId);
    expect(await canView(db, c.userId, a.userId, T0)).toBe(true);
  });

  /**
   * The stored flag with no entitlement behind it at all. `setInvisibleMode` refuses to create this state, so it can
   * only arrive from a lapse or from data written outside the product — which is exactly why the read path is
   * asserted separately from the write gate.
   */
  it("stays hidden when the flag is set and the account has never held Plus", async () => {
    const a = await createUser(db, { now: T0 });
    await db.privacySettings.update({ where: { userId: a.userId }, data: { invisibleMode: true } });
    const c = await createUser(db, { now: T0 });
    expect(await getDeckCandidateIds(db, c, { now: T0 })).not.toContain(a.userId);
    expect(await canView(db, c.userId, a.userId, T0)).toBe(false);
    expect(await getInvisibleModeState(a, { db, now: T0 })).toEqual({ enabled: true, effective: false, suspended: true });
  });

  it("fails closed when Plus lapses: the user is neither exposed nor given the feature for free", async () => {
    const a = await createUser(db, { now: T0 });
    await grantPlus(db, a.userId, at(T0, -hours(1)), at(T0, hours(1)));
    await setInvisibleMode(a, true, { db, now: T0 });
    const b = await createUser(db, { now: T0 });
    const c = await createUser(db, { now: T0 });
    await likeUser(a, b.userId, { db, now: T0 });

    const afterLapse = at(T0, hours(2));
    // Not discoverable by anyone new (C) — not exposed.
    expect(await getDeckCandidateIds(db, c, { now: afterLapse })).not.toContain(a.userId);
    // Also no longer shown to B via the premium rule — the premium behaviour is not granted for free.
    expect(await getDeckCandidateIds(db, b, { now: afterLapse })).not.toContain(a.userId);
    const state = await getInvisibleModeState(a, { db, now: afterLapse });
    expect(state).toEqual({ enabled: true, effective: false, suspended: true });
    // Turning the flag off restores normal visibility without Plus.
    await setInvisibleMode(a, false, { db, now: afterLapse });
    expect(await getDeckCandidateIds(db, c, { now: afterLapse })).toContain(a.userId);
  });

  /**
   * The lapse never rewrites the stored wish, so regaining Plus restores the premium behaviour by itself: hidden
   * from strangers again, and visible once more to the people this member liked while it was in force.
   */
  it("restores the premium behaviour when Plus is regained, without the member touching the setting", async () => {
    const a = await createUser(db, { now: T0 });
    await grantPlus(db, a.userId, at(T0, -hours(1)), at(T0, hours(1)));
    await setInvisibleMode(a, true, { db, now: T0 });
    const b = await createUser(db, { now: T0 });
    const c = await createUser(db, { now: T0 });
    await likeUser(a, b.userId, { db, now: T0 });

    const lapsed = at(T0, hours(2));
    expect(await getDeckCandidateIds(db, b, { now: lapsed })).not.toContain(a.userId);
    expect((await getInvisibleModeState(a, { db, now: lapsed })).enabled).toBe(true);

    const renewed = at(T0, hours(3));
    await grantPlus(db, a.userId, at(T0, hours(2.5)), at(T0, hours(48)));
    expect(await getInvisibleModeState(a, { db, now: renewed })).toEqual({ enabled: true, effective: true, suspended: false });
    // The person they liked can see them again; a stranger still cannot.
    expect(await getDeckCandidateIds(db, b, { now: renewed })).toContain(a.userId);
    expect(await getDeckCandidateIds(db, c, { now: renewed })).not.toContain(a.userId);
  });

  /**
   * Community is governed by its own setting (COMMUNITY.invisibleModeParticipation), currently ALLOWED, and the
   * privacy screen discloses exactly that: "Your Community posts and comments can still be visible to other
   * Community members." This guards the disclosure against a silent change on either side.
   */
  it("does not bar an invisible member from Community while participation is ALLOWED", async () => {
    expect(COMMUNITY.invisibleModeParticipation).toBe("ALLOWED");
    const a = await createUser(db, { now: T0 });
    await grantPlus(db, a.userId, at(T0, -hours(1)), at(T0, hours(24)));
    await setInvisibleMode(a, true, { db, now: T0 });
    const post = await createPost(a, { kind: "TEXT", body: "Still part of the island conversation." }, { db, now: T0 });
    expect(post.body).toBe("Still part of the island conversation.");
  });
});
