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
 * The age sliders. From and To can never meet: moving either one stops `filterAgeMinSpan` years short of the
 * other, inside the 18–60 bounds. Nothing else about the range is changed — a value is only ever clamped to where
 * the member's own drag can legitimately reach.
 */
export function moveAgeFrom(value: number, currentTo: number): number {
  const ceiling = Math.max(DISCOVERY.filterAgeMin, currentTo - DISCOVERY.filterAgeMinSpan);
  return Math.min(Math.max(value, DISCOVERY.filterAgeMin), ceiling);
}

export function moveAgeTo(value: number, currentFrom: number): number {
  const floor = Math.min(DISCOVERY.filterAgeMax, currentFrom + DISCOVERY.filterAgeMinSpan);
  return Math.max(Math.min(value, DISCOVERY.filterAgeMax), floor);
}

/**
 * A range narrower than the minimum span. The sliders cannot create one, but a range saved before they were fixed
 * (60–60, 34–34) still loads as it is, and Apply waits until the member widens it rather than the sheet quietly
 * choosing new ages for them.
 */
export function ageRangeTooNarrow(ageMin: number, ageMax: number): boolean {
  return ageMax - ageMin < DISCOVERY.filterAgeMinSpan;
}

export const AGE_RANGE_TOO_NARROW = `Choose an age range of at least ${DISCOVERY.filterAgeMinSpan} years.`;

export function ownAgeOutsideRange(ownAge: number | null, ageMin: number, ageMax: number): boolean {
  return ownAge != null && (ownAge < ageMin || ownAge > ageMax);
}

/**
 * The inline note under the sliders. Age is one-way, so leaving out your own age hides nobody from you and you from
 * nobody — but it is the usual sign of a slip on the sliders, so it is pointed out. Their own age only.
 */
export function ageRangeWarning(ownAge: number | null, ageMin: number, ageMax: number): string | null {
  if (!ownAgeOutsideRange(ownAge, ageMin, ageMax)) return null;
  return `You're ${ownAge}, so your own age isn't in this range.`;
}

/**
 * Whether Apply should ask "Save it anyway?" first: the range the member is about to save leaves out their own age
 * AND they changed it in this edit. A range they already confirmed, or one they are not touching, is not asked
 * about again every time they change something else — the inline note above still says it.
 */
export function needsOwnAgeConfirmation(ownAge: number | null, saved: { ageMin: number; ageMax: number }, next: { ageMin: number; ageMax: number }): boolean {
  const changed = saved.ageMin !== next.ageMin || saved.ageMax !== next.ageMax;
  return changed && ownAgeOutsideRange(ownAge, next.ageMin, next.ageMax);
}
