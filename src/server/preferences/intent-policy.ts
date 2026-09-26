/**
 * Connection intent and gender (docs/ARCHITECTURE.md §7.5).
 *
 * THE ONE PLACE these rules live. Onboarding, Edit profile and the discovery filters sheet call in here; none of them
 * re-derives a rule of its own.
 *
 *   gender              who the member is                     User.gender
 *   connectionIntent    what they are here for                DiscoveryPreferences.connectionIntent
 *
 * Who a member is shown is AUTOMATIC from those two (2026-09-26): Dating is opposite gender, Friendship has no gender
 * rule at all (everyone in the pool), and the two pools never mix (src/server/discovery/predicate.ts). There is no "Show me" question any
 * more — not in onboarding, not in the Filters sheet — and no stored answer to it decides anybody's deck.
 *
 * `interestedIn` / `friendshipInterestedIn` are still stored for backwards compatibility. Nothing reads them for
 * discovery and nothing writes them any more: a new row takes the column default, and an existing member's stored
 * answer is never rewritten, whatever they change.
 *
 * `connectionIntent` is NOT `RelationshipIntent`. That enum (SERIOUS_RELATIONSHIP / DATING / MARRIAGE /
 * FIGURING_OUT) is the Dating "how serious?" answer. It is shown on the profile and asked in Dating onboarding, but it
 * is never a discovery rule: no answer, or a different answer, never hides anybody.
 */
import { ValidationError } from "@/lib/errors";

export type Gender = "WOMAN" | "MAN" | "UNSPECIFIED";
export type ConnectionIntent = "DATING" | "FRIENDSHIP";

export const CONNECTION_INTENTS: readonly ConnectionIntent[] = ["DATING", "FRIENDSHIP"];

/**
 * Whether this gender can use Dating at all. Dating is woman ↔ man, so "Prefer not to say" (or no gender) has no
 * Dating match; Friendship has no gender rule and is open to everyone.
 */
export function canDate(gender: Gender | null): boolean {
  return gender === "WOMAN" || gender === "MAN";
}

/**
 * "Prefer not to say" is no longer offered (2026-09-26): new members choose Woman or Man. A member who already
 * holds it keeps it — it is never changed or invented for them — and may re-save it, but nobody can newly select it.
 */
export function assertGenderSelectable(next: Gender, current: Gender | null): void {
  if (next === "UNSPECIFIED" && current !== "UNSPECIFIED") throw new ValidationError("Choose Woman or Man.");
}

/** The genders a member may choose: Woman and Man, plus "Prefer not to say" only for somebody who already has it. */
export function selectableGenders(current: Gender | null): Gender[] {
  return current === "UNSPECIFIED" ? ["WOMAN", "MAN", "UNSPECIFIED"] : ["WOMAN", "MAN"];
}

/** Why Dating is refused to a gender that has no opposite. One sentence, shown wherever that choice is refused. */
export const DATING_NEEDS_GENDER = "Dating on Mellocrush matches women with men, so it needs Woman or Man as your gender. Friendship is open to everyone.";

/** Why a Dating member cannot switch their gender to "Prefer not to say" without leaving Dating first. */
export const GENDER_NEEDS_FRIENDSHIP = "Dating on Mellocrush matches women with men, so it needs Woman or Man as your gender. To use Prefer not to say, switch to Friendship in your Discover filters first.";

/**
 * Refuses a gender the member's chosen Dating intent cannot hold, instead of leaving an account in a Dating state
 * that can never match anybody (the predicate's Dating branch needs a woman or a man on both sides).
 */
export function assertGenderFitsIntent(gender: Gender | null, connectionIntent: ConnectionIntent): void {
  if (connectionIntent === "DATING" && !canDate(gender)) throw new ValidationError(GENDER_NEEDS_FRIENDSHIP);
}

/**
 * THE rule for the romantic "how serious?" fields: `DiscoveryPreferences.intent` (the "Looking for" filter) and
 * `Profile.intent` (the member's own answer) mean something only while the member is here to date.
 *
 * On Friendship both are kept exactly as stored, so a member who goes back to Dating finds them as they left them,
 * and both are INERT: the discovery query ignores them, the filter sheet and Edit profile hide them, and no profile
 * card shows them. Hidden values must never be able to decide who a Friendship member sees or is seen by.
 */
export function datingFieldsApply(connectionIntent: ConnectionIntent): boolean {
  return connectionIntent === "DATING";
}

/**
 * Refuses a pool the member's gender cannot use, instead of leaving an account in a Dating state that can never match
 * anybody. Friendship needs nothing.
 */
export function assertPoolAllowed(gender: Gender | null, connectionIntent: ConnectionIntent): void {
  if (connectionIntent === "DATING" && !canDate(gender)) throw new ValidationError(DATING_NEEDS_GENDER);
}

/** Parse an untrusted connection intent. */
export function parseConnectionIntent(value: unknown): ConnectionIntent {
  if (value === "DATING" || value === "FRIENDSHIP") return value;
  throw new ValidationError("Choose Dating or Friendship.");
}
