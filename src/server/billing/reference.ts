/**
 * Human-readable payment references (docs/ARCHITECTURE.md §12.11): THU- plus six characters from an alphabet
 * without 0/O/1/I. Random (not sequential, so sales volume is not exposed), generated server-side, unique by the
 * database constraint; callers retry on collision.
 */
import { randomInt } from "node:crypto";

export const REFERENCE_PREFIX = "THU-";
export const REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const REFERENCE_LENGTH = 6;
const PATTERN = new RegExp(`^${REFERENCE_PREFIX}[${REFERENCE_ALPHABET}]{${REFERENCE_LENGTH}}$`);

export function generateReference(random: (max: number) => number = (max) => randomInt(max)): string {
  let body = "";
  for (let i = 0; i < REFERENCE_LENGTH; i += 1) body += REFERENCE_ALPHABET[random(REFERENCE_ALPHABET.length)];
  return REFERENCE_PREFIX + body;
}

export function isPaymentReference(value: string): boolean {
  return PATTERN.test(value);
}

/** Accepts what a customer might type (lower case, spaces, missing dash) and returns the canonical form or null. */
export function normalizeReference(value: string): string | null {
  const cleaned = value.trim().toUpperCase().replace(/\s+/g, "").replace(/^THU-?/, REFERENCE_PREFIX);
  return isPaymentReference(cleaned) ? cleaned : null;
}
