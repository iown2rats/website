/**
 * The acting user, derived from the server session. Domain functions take this as their first
 * argument and never accept a user id from client payloads.
 */
export interface Actor {
  readonly userId: string;
}

/** Sorts a user pair so (userAId < userBId) — the invariant for Match and Conversation rows. */
export function sortPair(a: string, b: string): { userAId: string; userBId: string } {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}
