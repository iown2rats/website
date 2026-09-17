import { createHmac, timingSafeEqual } from "node:crypto";

function salt(): string {
  const s = process.env.CONTACT_HASH_SALT;
  if (!s || s.length < 32) throw new Error("CONTACT_HASH_SALT must be set (32+ characters)");
  return s;
}

/**
 * Keyed hash of an E.164 phone number. Used for User.phoneHash and ContactHash.hash so contact
 * matching is an indexed equality join. See docs/CONTACT_BLOCKING.md §4 for the honest limits.
 */
export function hashPhone(e164: string, version = 1): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(createHmac("sha256", `${salt()}:v${version}`).update(e164).digest());
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
