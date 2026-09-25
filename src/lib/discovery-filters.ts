/**
 * The Filters sheet's decisions, as plain functions (client-safe, no React), so they can be tested without a browser.
 * The server enforces every rule regardless (src/server/discovery/filters.ts); these only decide what the sheet
 * shows and submits.
 */
import { DISCOVERY } from "@/config/product";

type InterestedIn = "WOMEN" | "MEN" | "EVERYONE";
type Mode = "DATING" | "FRIENDSHIP";

/** The Friendship "Show me" to restore: the remembered answer, or the one in force when they are on Friendship now. */
export function rememberedFriendship(f: { connectionIntent: Mode; interestedIn: InterestedIn; friendshipInterestedIn: InterestedIn | null }): InterestedIn | null {
  return f.friendshipInterestedIn ?? (f.connectionIntent === "FRIENDSHIP" ? f.interestedIn : null);
}

/**
 * What "Show me" becomes on a switch into `mode`. Each mode restores its OWN value: Dating's is derived from gender
 * and never chosen; Friendship's is the member's remembered answer, never the Dating-derived one (the bug this
 * replaces saved a man's derived "Women" as his Friendship answer the first time he switched).
 */
export function showMeForMode(mode: Mode, datingInterestedIn: "WOMEN" | "MEN" | null, friendship: InterestedIn | null): InterestedIn | null {
  return mode === "DATING" ? datingInterestedIn : friendship;
}

/** What Reset returns the filters to. The mode and its "Show me" are not filters, so the caller keeps them. */
export function resetFilterValues<I extends string>(mode: Mode, currentIntent: I | null) {
  return {
    ageMin: DISCOVERY.defaultAgeRange.min,
    ageMax: DISCOVERY.defaultAgeRange.max,
    locationScope: "ANYWHERE" as const,
    locationId: null,
    // On Friendship the Dating "Looking for" is hidden and kept for a switch back, so Reset leaves it alone.
    intent: mode === "DATING" ? null : currentIntent,
    heightMinCm: null,
    heightMaxCm: null,
    education: null,
  };
}

/**
 * The non-blocking age warning. The age check is reciprocal, so a range that leaves out the member's own age also
 * tends to hide them from people who chose a range like it. Their own age only — never anybody else's preference.
 */
export function ageRangeWarning(ownAge: number | null, ageMin: number, ageMax: number): string | null {
  if (ownAge == null || (ownAge >= ageMin && ownAge <= ageMax)) return null;
  return `You're ${ownAge}, which is outside this range. Age ranges work both ways, so members who set a range like yours may not see you in Discover.`;
}
