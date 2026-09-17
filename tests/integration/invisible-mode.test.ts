import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { EntitlementRequiredError } from "@/lib/errors";
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
});
