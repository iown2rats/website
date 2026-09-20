/**
 * Connection intent and the gender preference that belongs to it (docs/ARCHITECTURE.md §7.5).
 *
 * THE ONE PLACE these rules live. Onboarding, Edit profile, the discovery filters sheet and the discovery query all
 * call in here; none of them re-derives a preference of its own. A rule stated twice is a rule that will disagree
 * with itself, and the disagreement would show up as somebody appearing in a deck they asked not to be in.
 *
 * Three concepts, kept separate on purpose:
 *
 *   gender              who the member is                     User.gender
 *   connectionIntent    what they are here for                DiscoveryPreferences.connectionIntent
 *   interestedIn        who they want to meet, for that intent DiscoveryPreferences.interestedIn
 *
 * `connectionIntent` is NOT `RelationshipIntent`. That enum (SERIOUS_RELATIONSHIP / DATING / MARRIAGE /
 * FIGURING_OUT) is a romantic detail question — "how serious?" — and stays exactly what it was, asked only of
 * people who came here to date. Dating vs Friendship is a different axis entirely, which is why it is a different
 * field rather than two more values on the old one.
 *
 * Dating is opposite-gender only, so the preference is not a question: a man dating is shown women, a woman dating
 * is shown men, and asking would be a step that has one answer. `interestedIn` is therefore DERIVED for Dating and
 * CHOSEN for Friendship. It is still stored, because the discovery predicate matches on it reciprocally in SQL and
 * pushing a branch into that query would complicate the one piece of code that must stay obviously correct. Every
 * write goes through `resolvePreferences` below, so the stored value cannot drift from the rule.
 *
 * `friendshipInterestedIn` remembers the Friendship answer while somebody is on Dating. Without it, switching
 * Dating → Friendship → Dating → Friendship would keep asking the same question, or worse, silently hand the
 * derived Dating value to Friendship as though the member had chosen it.
 */
import { ValidationError } from "@/lib/errors";

export type Gender = "WOMAN" | "MAN" | "UNSPECIFIED";
export type InterestedIn = "WOMEN" | "MEN" | "EVERYONE";
export type ConnectionIntent = "DATING" | "FRIENDSHIP";

export const CONNECTION_INTENTS: readonly ConnectionIntent[] = ["DATING", "FRIENDSHIP"];
export const FRIENDSHIP_CHOICES: readonly InterestedIn[] = ["MEN", "WOMEN", "EVERYONE"];

/**
 * The only Dating preference a member of this gender can have. Null means Dating cannot be expressed for them:
 * "Prefer not to say" has no opposite, and the reciprocal rule in the discovery predicate would show them to
 * nobody and nobody to them. Refusing the combination up front is kinder than an empty deck with no explanation.
 */
export function datingInterestedIn(gender: Gender | null): "WOMEN" | "MEN" | null {
  switch (gender) {
    case "MAN":
      return "WOMEN";
    case "WOMAN":
      return "MEN";
    default:
      return null;
  }
}

/** Whether this gender can use Dating at all. Friendship is open to everyone. */
export function canDate(gender: Gender | null): boolean {
  return datingInterestedIn(gender) !== null;
}

/** Does the member still owe us an answer before this intent is usable? Only Friendship ever asks. */
export function needsFriendshipChoice(intent: ConnectionIntent, friendshipInterestedIn: InterestedIn | null): boolean {
  return intent === "FRIENDSHIP" && friendshipInterestedIn == null;
}

export interface PreferenceState {
  gender: Gender | null;
  connectionIntent: ConnectionIntent;
  /** The remembered Friendship answer, independent of whether Friendship is the active intent. */
  friendshipInterestedIn: InterestedIn | null;
}

export interface ResolvedPreferences {
  connectionIntent: ConnectionIntent;
  friendshipInterestedIn: InterestedIn | null;
  /** The value discovery matches on: derived for Dating, the member's own answer for Friendship. */
  interestedIn: InterestedIn;
}

/**
 * Turn a state into the row to store, rejecting anything the rules do not allow.
 *
 * This is the server-side enforcement point the UI is only a convenience for: a request that posts
 * `MAN + DATING + MEN` never reaches the database, because the Dating preference is not read from the request at
 * all — it is computed here from the gender.
 */
export function resolvePreferences(state: PreferenceState): ResolvedPreferences {
  if (state.connectionIntent === "DATING") {
    const interestedIn = datingInterestedIn(state.gender);
    if (!interestedIn) {
      throw new ValidationError("Choose Woman or Man to use Dating. Friendship is open to everyone.");
    }
    // The Friendship answer is carried through untouched: it is theirs, and they may come back to it.
    return { connectionIntent: "DATING", friendshipInterestedIn: state.friendshipInterestedIn, interestedIn };
  }
  if (!state.friendshipInterestedIn) {
    throw new ValidationError("Choose who you'd like to meet.");
  }
  return {
    connectionIntent: "FRIENDSHIP",
    friendshipInterestedIn: state.friendshipInterestedIn,
    interestedIn: state.friendshipInterestedIn,
  };
}

/**
 * The same thing for a gender change, where the member is not answering a preference question at all.
 *
 * On Dating the preference follows the new gender, because it was never their answer to give. On Friendship it is
 * left alone: who you want to be friends with does not change because you corrected your own gender, and resetting
 * it would be the app throwing away something the member did choose.
 */
export function resolveAfterGenderChange(state: PreferenceState): ResolvedPreferences {
  return resolvePreferences(state);
}

/**
 * What the member should be asked next when they pick an intent, so a caller can route without re-deriving the
 * rule: Dating settles itself, Friendship needs the answer unless one is remembered.
 */
export function pendingQuestion(state: PreferenceState): "friendship-preference" | null {
  return needsFriendshipChoice(state.connectionIntent, state.friendshipInterestedIn) ? "friendship-preference" : null;
}

/** Parse an untrusted connection intent. */
export function parseConnectionIntent(value: unknown): ConnectionIntent {
  if (value === "DATING" || value === "FRIENDSHIP") return value;
  throw new ValidationError("Choose Dating or Friendship.");
}

/** Parse an untrusted Friendship preference. Dating never parses one — it is derived. */
export function parseFriendshipInterestedIn(value: unknown): InterestedIn {
  if (value === "MEN" || value === "WOMEN" || value === "EVERYONE") return value;
  throw new ValidationError("Choose who you'd like to meet.");
}
