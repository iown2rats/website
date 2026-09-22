/**
 * The reaction vocabulary, shared by Chat and Community (docs/ARCHITECTURE.md §9.4, §14.10).
 *
 * PURE: no imports at all. Both halves of the app need this — the server to reject anything outside the set, the
 * picker and the summary rows to draw it — and a client component that transitively reaches `@/lib/db` fails the
 * production build. It is the same reason src/server/community/rules.ts exists.
 *
 * The keys mirror the `ReactionEmoji` enum in prisma/schema.prisma and are checked against it by
 * tests/unit/reactions.test.ts, so adding a value in one place without the other fails a test rather than
 * producing a reaction the database will not store. The ORDER here is the order the picker shows, and it is the
 * Messenger order the brief asked for: ❤️ 😂 😮 😢 👍 🔥.
 *
 * The glyph lives here rather than in the database because it is presentation. A row written today says LAUGH; if
 * the artwork ever changes, every stored reaction still means what it meant, and no data has to be migrated.
 */

export type ReactionKey = "HEART" | "LAUGH" | "WOW" | "SAD" | "THUMBS_UP" | "FIRE";

export interface ReactionSpec {
  key: ReactionKey;
  /** What is drawn. */
  glyph: string;
  /** Screen-reader and aria label text: "Hind reacted with love", "Remove your laugh reaction". */
  label: string;
}

export const REACTIONS: readonly ReactionSpec[] = [
  { key: "HEART", glyph: "❤️", label: "love" },
  { key: "LAUGH", glyph: "😂", label: "laugh" },
  { key: "WOW", glyph: "😮", label: "wow" },
  { key: "SAD", glyph: "😢", label: "sad" },
  { key: "THUMBS_UP", glyph: "👍", label: "thumbs up" },
  { key: "FIRE", glyph: "🔥", label: "fire" },
];

const BY_KEY = new Map(REACTIONS.map((r) => [r.key, r]));

export function isReactionKey(value: unknown): value is ReactionKey {
  return typeof value === "string" && BY_KEY.has(value as ReactionKey);
}

/** The glyph for a key, or the key itself if something unknown ever reached the client. Never throws in render. */
export function reactionGlyph(key: string): string {
  return BY_KEY.get(key as ReactionKey)?.glyph ?? "•";
}

export function reactionLabel(key: string): string {
  return BY_KEY.get(key as ReactionKey)?.label ?? "reaction";
}

/**
 * One line of a reaction summary: which reaction, how many people, and whether the viewer is one of them.
 *
 * Counts only. Who reacted is a separate, deliberate request (the reactor sheet), because a feed that names
 * everybody who reacted to everything is both noise and a privacy leak by volume.
 */
export interface ReactionGroupDto {
  emoji: ReactionKey;
  count: number;
  /** True when this is the viewer's own active reaction. Exactly one group can have it. */
  mine: boolean;
}

/**
 * The whole reaction state of one target, as the client needs it.
 *
 * `groups` is ordered by REACTIONS, not by count: a bubble whose emoji re-order themselves as counts change is
 * hard to read and impossible to aim at on a phone.
 */
export interface ReactionSummaryDto {
  groups: ReactionGroupDto[];
  /** Total across every group — what the compact pill shows next to the emoji. */
  total: number;
  /** The viewer's own reaction, or null. Lets the UI show "tap again to remove" without scanning groups. */
  mine: ReactionKey | null;
}

/** Rows of (emoji, userId) → the summary. One place builds this, so chat and Community cannot disagree. */
export function summarizeReactions(rows: readonly { emoji: string; userId: string }[], viewerId: string): ReactionSummaryDto {
  const counts = new Map<ReactionKey, { count: number; mine: boolean }>();
  let mine: ReactionKey | null = null;
  for (const row of rows) {
    if (!isReactionKey(row.emoji)) continue;
    const entry = counts.get(row.emoji) ?? { count: 0, mine: false };
    entry.count += 1;
    if (row.userId === viewerId) {
      entry.mine = true;
      mine = row.emoji;
    }
    counts.set(row.emoji, entry);
  }
  const groups: ReactionGroupDto[] = [];
  let total = 0;
  for (const spec of REACTIONS) {
    const entry = counts.get(spec.key);
    if (!entry) continue;
    groups.push({ emoji: spec.key, count: entry.count, mine: entry.mine });
    total += entry.count;
  }
  return { groups, total, mine };
}

export const EMPTY_REACTIONS: ReactionSummaryDto = { groups: [], total: 0, mine: null };
