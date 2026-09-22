/**
 * The devices a member has allowed to notify them (docs/ARCHITECTURE.md §29.5).
 *
 * One row per browser or device, never a token on the User row. A person reasonably has a laptop, a phone browser
 * and (later) the Android app at once; each gets its own endpoint, its own keys and its own way of going stale,
 * and a single column would silently drop every one but the last to ask.
 *
 * Re-subscribing is an UPSERT on the endpoint, not an insert. A browser that is asked again — after a permission
 * reset, a reinstall, or simply on a later visit — is handed back the same endpoint by its push service, so
 * matching on it is what stops one browser becoming five rows and one person getting five buzzes.
 */
import { PUSH } from "@/config/product";
import { getDb, type Db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { webPushConfigured } from "@/lib/env";
import { vapidPublicKey } from "@/lib/push/transport";
import type { Actor } from "@/server/actor";

export interface PushDeviceInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** From the browser. Display only, truncated, never used to decide anything. */
  userAgent?: string | null;
}

/** What the client needs to decide whether to offer push at all. */
export interface PushStateDto {
  /** False when this deployment has no VAPID keys: the UI then says push is unavailable rather than failing. */
  available: boolean;
  /** The VAPID public key a browser needs to subscribe. Null when unavailable. */
  publicKey: string | null;
  /** How many live devices this member has. Lets the UI say "on for 2 devices" without naming them. */
  deviceCount: number;
}

export async function getPushState(actor: Actor, deps: { db?: Db } = {}): Promise<PushStateDto> {
  const db = deps.db ?? getDb();
  if (!webPushConfigured()) return { available: false, publicKey: null, deviceCount: 0 };
  const deviceCount = await db.pushSubscription.count({ where: { userId: actor.userId, disabledAt: null } });
  return { available: true, publicKey: vapidPublicKey(), deviceCount };
}

/**
 * Registers this browser, or revives it if it is already known.
 *
 * Takes the endpoint over from a previous owner when one exists. That is not a security hole but the fix for one:
 * a shared or handed-down device would otherwise keep pushing one person's notifications to a browser somebody
 * else now signs in from. The endpoint belongs to whoever most recently proved they are signed in on it.
 */
export async function registerPushDevice(actor: Actor, input: PushDeviceInput, deps: { db?: Db; now?: Date } = {}): Promise<PushStateDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (!webPushConfigured()) throw new ValidationError("Push notifications aren't available right now");

  const endpoint = input.endpoint.trim();
  // An endpoint is a URL the push service issued. Anything else is a malformed or crafted request.
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new ValidationError("That isn't a valid push endpoint");
  }
  if (parsed.protocol !== "https:") throw new ValidationError("That isn't a valid push endpoint");
  if (!input.keys?.p256dh || !input.keys?.auth) throw new ValidationError("That subscription is missing its keys");

  const live = await db.pushSubscription.count({ where: { userId: actor.userId, disabledAt: null } });
  const existing = await db.pushSubscription.findUnique({ where: { endpoint }, select: { id: true, userId: true } });
  if (!existing && live >= PUSH.maxDevicesPerUser) {
    throw new ValidationError("You've reached the maximum number of devices for notifications");
  }

  await db.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId: actor.userId,
      transport: "WEBPUSH",
      endpoint,
      keys: input.keys,
      userAgent: input.userAgent?.slice(0, 200) ?? null,
      lastSeenAt: now,
      createdAt: now,
    },
    update: {
      // Everything is refreshed, including the owner: this is the browser saying "I am signed in as this member".
      userId: actor.userId,
      keys: input.keys,
      userAgent: input.userAgent?.slice(0, 200) ?? null,
      lastSeenAt: now,
      // Reviving a device that had been written off. A member who re-grants permission expects it to work again.
      disabledAt: null,
      failureCount: 0,
    },
  });

  return getPushState(actor, { db });
}

/**
 * Forgets one device — the browser said it is unsubscribing, or the member turned push off on this device.
 *
 * Scoped by userId as well as endpoint, so an endpoint belonging to somebody else is a no-op that reports the
 * same success as one that did not exist. Nothing here tells a caller whether an endpoint is real.
 */
export async function unregisterPushDevice(actor: Actor, endpoint: string, deps: { db?: Db } = {}): Promise<PushStateDto> {
  const db = deps.db ?? getDb();
  await db.pushSubscription.deleteMany({ where: { endpoint: endpoint.trim(), userId: actor.userId } });
  return getPushState(actor, { db });
}

/** Forgets every device. What "turn push off everywhere" does, alongside clearing the preference. */
export async function unregisterAllPushDevices(actor: Actor, deps: { db?: Db } = {}): Promise<PushStateDto> {
  const db = deps.db ?? getDb();
  await db.pushSubscription.deleteMany({ where: { userId: actor.userId } });
  return getPushState(actor, { db });
}
