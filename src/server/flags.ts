/**
 * Server-controlled switches for the Plus promotion work (docs/ARCHITECTURE.md §12.19).
 *
 * Each one isolates a single new behaviour so it can be turned off without touching Discover, Likes You, checkout
 * or anything else that was already live. They are read from the environment on every call — not through the
 * cached `getEnv()` — so a test can flip one, and so there is nothing to invalidate.
 *
 * EVERY SWITCH IS OFF UNLESS IT READS EXACTLY "on". A missing, misspelt or unexpected value means off: the failure
 * mode of a typo is that a promotion does not appear, never that one appears unasked. Deliberately not validated in
 * `src/lib/env.ts`, where an invalid value would refuse to boot the whole app over a promotional switch.
 *
 * Turning one off hides the new surface only. Server-side enforcement never depends on these: Undo is refused to
 * Free members by `undoLastPass` whatever PLUS_UNDO_UI says, exactly as it was before the switch existed.
 */

export type PlusFlag = "PLUS_DISCOVER_PROMPT" | "PLUS_UNDO_UI" | "PLUS_CHECKOUT_REMINDERS" | "PLUS_FUNNEL_ANALYTICS";

export function flagEnabled(flag: PlusFlag): boolean {
  return process.env[flag] === "on";
}
