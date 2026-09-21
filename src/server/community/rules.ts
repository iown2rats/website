/**
 * Community constants that both halves of the app need.
 *
 * PURE: no imports at all, and nothing here may ever import the database, the storage provider or anything under
 * `@/lib/db`. The compose sheet and the feed filler are client components, so a value imported from a module that
 * transitively reaches `pg` fails the production build outright — which is exactly how these two constants ended
 * up in their own file rather than beside the code that uses them on the server.
 */

export const POLL_RULES = {
  minOptions: 2,
  maxOptions: 4,
  optionMaxLength: 60,
} as const;

/**
 * Editorial prompts for a thin feed, not data. The brief allows these to be static precisely because they claim
 * nothing about anyone: they are things to write about, shown when there is little to read. Keep them
 * Maldives-specific, answerable in a sentence, and free of anything that would read as a dating opener.
 */
export const CONVERSATION_STARTERS: readonly string[] = [
  "What's the best ferry-ride view in the country?",
  "Hedhikaa order that never misses?",
  "Best thing to do in Malé on a Friday morning?",
  "An island everyone should visit once — and why?",
  "What's a small thing that makes someone instantly more attractive?",
  "Coffee at Rasfannu or a late drive around Hulhumalé?",
];
