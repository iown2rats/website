import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { LocalDiskStorageProvider } from "@/lib/storage/local";
import { createSession, hashSessionToken, resolveSession, revokeAllSessions, revokeSession, SESSION_RULES } from "@/server/auth/session";
import { saveName } from "@/server/onboarding/onboarding";
import { deletePhoto } from "@/server/photos/photos";
import { disconnectDb, resetDb, testDb } from "../helpers/db";
import { at, createUser, hours } from "../helpers/factory";

const db = testDb();
const T0 = new Date("2026-09-17T20:00:00Z");

beforeEach(() => resetDb(db));
afterAll(() => disconnectDb());

describe("sessions", () => {
  it("creates a session whose token is stored only as a hash", async () => {
    const user = await createUser(db, { now: T0 });
    const s = await createSession(db, user.userId, { ip: "203.0.113.42", userAgent: "test" }, T0);
    expect(s.token.length).toBeGreaterThanOrEqual(40);
    const row = await db.session.findUniqueOrThrow({ where: { id: s.sessionId } });
    expect(Buffer.from(row.tokenHash)).toEqual(Buffer.from(hashSessionToken(s.token)));
    expect(JSON.stringify(row)).not.toContain(s.token);
    expect(row.ipPrefix).toBe("203.0.113.0");
    expect(row.expiresAt.getTime()).toBe(T0.getTime() + SESSION_RULES.idleMs);
  });

  it("resolves a valid token and rejects unknown or tampered ones", async () => {
    const user = await createUser(db, { now: T0 });
    const s = await createSession(db, user.userId, {}, T0);
    expect((await resolveSession(db, s.token, at(T0, 1000)))?.user.id).toBe(user.userId);
    expect(await resolveSession(db, s.token.slice(0, -1) + (s.token.endsWith("A") ? "B" : "A"), T0)).toBeNull();
    expect(await resolveSession(db, "", T0)).toBeNull();
    expect(await resolveSession(db, "short", T0)).toBeNull();
  });

  it("rejects idle-expired and absolutely-expired sessions and removes them", async () => {
    const user = await createUser(db, { now: T0 });
    const idle = await createSession(db, user.userId, {}, T0);
    expect(await resolveSession(db, idle.token, at(T0, SESSION_RULES.idleMs + 1))).toBeNull();
    expect(await db.session.count({ where: { id: idle.sessionId } })).toBe(0);

    // Sliding refresh keeps an active session alive but never past the absolute limit.
    const active = await createSession(db, user.userId, {}, T0);
    let now = T0;
    for (let d = 0; d < 100; d += 20) {
      now = at(T0, d * 24 * hours(1));
      await resolveSession(db, active.token, now);
    }
    expect(await resolveSession(db, active.token, at(T0, SESSION_RULES.absoluteMs + 1))).toBeNull();
  });

  it("logout revokes exactly that session; revoke-all clears every device", async () => {
    const user = await createUser(db, { now: T0 });
    const a = await createSession(db, user.userId, {}, T0);
    const b = await createSession(db, user.userId, {}, T0);
    expect(await revokeSession(db, a.token)).toBe(true);
    expect(await resolveSession(db, a.token, T0)).toBeNull();
    expect((await resolveSession(db, b.token, T0))?.user.id).toBe(user.userId);
    expect(await revokeSession(db, a.token)).toBe(false); // already gone
    await createSession(db, user.userId, {}, T0);
    expect(await revokeAllSessions(db, user.userId)).toBe(2);
    expect(await resolveSession(db, b.token, T0)).toBeNull();
  });

  it("protected operations act on the session's user and ignore any client-supplied identity", async () => {
    const alice = await createUser(db, { now: T0, status: "ONBOARDING" });
    const bob = await createUser(db, { now: T0, name: "Bob" });
    const s = await createSession(db, alice.userId, {}, T0);
    const actor = { userId: (await resolveSession(db, s.token, T0))!.user.id };

    // A payload that tries to smuggle another user's id is ignored by validation (unknown keys are stripped).
    await saveName(actor, { name: "Alice", userId: bob.userId, profileId: "x" } as unknown, { db });
    expect((await db.profile.findUnique({ where: { userId: alice.userId } }))?.displayName).toBe("Alice");
    expect((await db.profile.findUnique({ where: { userId: bob.userId } }))?.displayName).toBe("Bob");

    // Ownership is derived from the actor: Bob's photo cannot be deleted through Alice's session.
    const bobPhoto = await db.profilePhoto.findFirstOrThrow({ where: { profile: { userId: bob.userId } } });
    const storage = new LocalDiskStorageProvider("/tmp/thundi-test-storage", "x".repeat(32));
    await expect(deletePhoto(actor, bobPhoto.id, { db, storage })).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.profilePhoto.count({ where: { id: bobPhoto.id } })).toBe(1);
  });
});
