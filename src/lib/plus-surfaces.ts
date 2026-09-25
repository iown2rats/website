/**
 * Where a Plus promotion can appear (docs/ARCHITECTURE.md §12.19). A CLOSED list: it is the `surface` dimension of the
 * Plus funnel analytics and the `?from=` of a link into Membership, and anything not on it is dropped rather than
 * stored, so no caller — and no crafted URL — can put an arbitrary string into either.
 *
 * Client-safe: no server imports.
 */
export const PLUS_SURFACES = ["likes_you", "discover_likes", "daily_limit", "photo_lock", "undo", "membership", "checkout_recovery", "super_like"] as const;

export type PlusSurface = (typeof PLUS_SURFACES)[number];

const KNOWN = new Set<string>(PLUS_SURFACES);

/** The surface named by an untrusted value, or null. Never repairs, trims or guesses. */
export function parsePlusSurface(value: unknown): PlusSurface | null {
  return typeof value === "string" && KNOWN.has(value) ? (value as PlusSurface) : null;
}

/** The Membership URL for a promotion on `surface`. */
export function membershipHref(surface?: PlusSurface): string {
  return surface ? `/settings/membership?from=${surface}` : "/settings/membership";
}
