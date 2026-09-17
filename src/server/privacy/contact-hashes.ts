/**
 * Block my contacts — server side of docs/CONTACT_BLOCKING.md §6. Numbers are normalised and hashed on the device
 * with the public salt (same keyed function as User.phoneHash); the server stores only 32-byte digests, never a
 * number, name or count of matches. Turning the setting off keeps the list; "clear" deletes it.
 */
import { getDb, type Db, type DbLike } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { ValidationError } from "@/lib/errors";
import { contactHashesSchema } from "@/lib/validation/profile";
import type { Actor } from "@/server/actor";
import { consumeRateLimit } from "@/server/auth/rate-limit";

export const CONTACT_HASH_LIMITS = { perCall: 5000, perUser: 20000, callsPerHour: 30, version: 1 } as const;

/** What the device needs to hash exactly like hashPhone(): HMAC-SHA-256 keyed with `${salt}:v${version}` over E.164. */
export function getContactHashKey(): { key: string; version: number } {
  return { key: `${getEnv().CONTACT_HASH_SALT}:v${CONTACT_HASH_LIMITS.version}`, version: CONTACT_HASH_LIMITS.version };
}

export async function countContactHashes(db: DbLike, userId: string): Promise<number> {
  return db.contactHash.count({ where: { userId } });
}

export async function addContactHashes(actor: Actor, input: unknown, deps: { db?: Db; now?: Date } = {}): Promise<{ added: number; total: number }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = contactHashesSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Those numbers couldn't be added. Try again.");
  const limit = await consumeRateLimit(db, `contacts:add:${actor.userId}`, CONTACT_HASH_LIMITS.callsPerHour, 3_600_000, now);
  if (!limit.allowed) throw new ValidationError("Too many updates. Try again in a while.");
  const unique = [...new Set(parsed.data.hashes.map((h) => h.toLowerCase()))];
  const existing = await countContactHashes(db, actor.userId);
  if (existing + unique.length > CONTACT_HASH_LIMITS.perUser) throw new ValidationError(`You can hide from up to ${CONTACT_HASH_LIMITS.perUser} numbers.`);
  const result = await db.contactHash.createMany({
    data: unique.map((hex) => ({ userId: actor.userId, hash: Buffer.from(hex, "hex"), hashVersion: CONTACT_HASH_LIMITS.version, source: parsed.data.source })),
    skipDuplicates: true,
  });
  return { added: result.count, total: await countContactHashes(db, actor.userId) };
}

export async function clearContactHashes(actor: Actor, deps: { db?: Db } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  await db.contactHash.deleteMany({ where: { userId: actor.userId } });
}
