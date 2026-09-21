/**
 * The topic chips above the feed (docs/ARCHITECTURE.md §14.1). Pure — no server imports — so the chip row and the
 * compose sheet describe a topic with exactly the value the query filters on.
 *
 * A fixed list rather than free-text tags. Tags fragment a small community into dozens of near-empty rooms, and a
 * chip row that has to fit on a 320px screen cannot hold an open vocabulary anyway. Six is what fits while still
 * covering what people actually post.
 */
export type TopicKey = "DATING" | "ADVICE" | "CONFESSIONS" | "QUESTIONS" | "POLLS" | "RANDOM";

export interface TopicSpec {
  key: TopicKey;
  /** What the chip says. The emoji belongs to Dating alone — a row of six emoji is noise, one is a focal point. */
  label: string;
}

export const TOPICS: readonly TopicSpec[] = [
  { key: "DATING", label: "Dating 👀" },
  { key: "ADVICE", label: "Advice" },
  { key: "CONFESSIONS", label: "Confessions" },
  { key: "QUESTIONS", label: "Questions" },
  { key: "POLLS", label: "Polls" },
  { key: "RANDOM", label: "Random" },
];

export function isTopic(value: unknown): value is TopicKey {
  return typeof value === "string" && TOPICS.some((t) => t.key === value);
}

/** Untrusted input → a topic or null. Null is legitimate: a post need not sit under a chip. */
export function parseTopic(value: unknown): TopicKey | null {
  if (value == null || value === "") return null;
  if (!isTopic(value)) return null;
  return value;
}

/**
 * The topic a post kind implies, used to pre-select a chip in the compose sheet. Only a suggestion: the author can
 * change it, and nothing downstream assumes kind and topic agree.
 */
export function suggestedTopic(kind: "TEXT" | "QUESTION" | "PHOTO" | "POLL" | "CONFESSION"): TopicKey | null {
  switch (kind) {
    case "QUESTION":
      return "QUESTIONS";
    case "POLL":
      return "POLLS";
    case "CONFESSION":
      return "CONFESSIONS";
    default:
      return null;
  }
}
