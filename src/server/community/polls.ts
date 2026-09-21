/**
 * Community polls (docs/ARCHITECTURE.md §14.3).
 *
 * One vote per member per poll, enforced by the composite primary key on CommunityPollVote rather than by a check
 * the application has to remember. Changing a vote is an update of that one row plus two counter moves, all in one
 * transaction, so a poll's counts can never drift from its votes.
 *
 * Who voted for what is never exposed. The DTO carries totals and the viewer's OWN choice; there is no function
 * here that answers "who picked option B", because a poll about something personal would otherwise be a way to
 * publish an opinion the voter thought was aggregate.
 */
import { getDb, type Db, type DbLike } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/server/actor";
import { POLL_RULES } from "./rules";

// Re-exported so server callers can keep reaching the rules through the module that enforces them; client
// components must import them from ./rules directly, which is the only copy that does not reach the database.
export { POLL_RULES };

export interface PollOptionDto {
  id: string;
  label: string;
  votes: number;
  /** 0–100, rounded. Zero for every option while the poll has no votes. */
  percent: number;
  chosenByMe: boolean;
}

export interface PollDto {
  options: PollOptionDto[];
  totalVotes: number;
  /** Null until the viewer votes. The UI shows counts either way; hiding them would just invite poking. */
  myOptionId: string | null;
}

/** Clean a list of option labels from an untrusted payload. */
export function parsePollOptions(value: unknown): string[] {
  if (!Array.isArray(value)) throw new ValidationError("Add some options to your poll.");
  const labels = value.map((v) => String(v ?? "").trim()).filter((v) => v.length > 0);
  if (labels.length < POLL_RULES.minOptions) throw new ValidationError(`A poll needs at least ${POLL_RULES.minOptions} options.`);
  if (labels.length > POLL_RULES.maxOptions) throw new ValidationError(`A poll can have at most ${POLL_RULES.maxOptions} options.`);
  for (const label of labels) {
    if (label.length > POLL_RULES.optionMaxLength) throw new ValidationError(`Keep each option under ${POLL_RULES.optionMaxLength} characters.`);
  }
  if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) throw new ValidationError("Poll options have to be different from each other.");
  return labels;
}

/** Percentages that add to 100 without a rounding artefact showing 99% or 101% under the bars. */
export function toPercentages(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return counts.map(() => 0);
  const exact = counts.map((c) => (c / total) * 100);
  const floored = exact.map(Math.floor);
  let remainder = 100 - floored.reduce((a, b) => a + b, 0);
  // Hand the leftover points to the largest fractional parts, which is the standard largest-remainder method.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
    .map((e) => e.i);
  const out = [...floored];
  for (const i of order) {
    if (remainder <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    remainder -= 1;
  }
  return out;
}

export interface PollRow {
  id: string;
  label: string;
  position: number;
  voteCount: number;
}

export function pollDto(options: PollRow[], myOptionId: string | null): PollDto {
  const ordered = [...options].sort((a, b) => a.position - b.position);
  const percents = toPercentages(ordered.map((o) => o.voteCount));
  return {
    options: ordered.map((o, i) => ({ id: o.id, label: o.label, votes: o.voteCount, percent: percents[i] ?? 0, chosenByMe: o.id === myOptionId })),
    totalVotes: ordered.reduce((a, o) => a + o.voteCount, 0),
    myOptionId,
  };
}

/** Load polls for a set of posts in two queries rather than two per post. */
export async function loadPolls(db: DbLike, viewerId: string, postIds: string[]): Promise<Map<string, PollDto>> {
  if (postIds.length === 0) return new Map();
  const [options, votes] = await Promise.all([
    db.communityPollOption.findMany({ where: { postId: { in: postIds } }, select: { id: true, postId: true, label: true, position: true, voteCount: true } }),
    db.communityPollVote.findMany({ where: { postId: { in: postIds }, userId: viewerId }, select: { postId: true, optionId: true } }),
  ]);
  const mine = new Map(votes.map((v) => [v.postId, v.optionId]));
  const byPost = new Map<string, PollRow[]>();
  for (const o of options) {
    const list = byPost.get(o.postId) ?? [];
    list.push(o);
    byPost.set(o.postId, list);
  }
  const out = new Map<string, PollDto>();
  for (const [postId, rows] of byPost) out.set(postId, pollDto(rows, mine.get(postId) ?? null));
  return out;
}

/**
 * Cast or change a vote. One transaction: the vote row and both counters move together, so a reader can never see
 * a total that does not match the rows behind it.
 */
export async function votePoll(actor: Actor, input: { postId: string; optionId: string }, deps: { db?: Db; now?: Date } = {}): Promise<PollDto> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const option = await db.communityPollOption.findUnique({ where: { id: input.optionId }, select: { id: true, postId: true } });
  if (!option || option.postId !== input.postId) throw new NotFoundError("Poll option");
  const post = await db.communityPost.findFirst({ where: { id: input.postId, deletedAt: null, kind: "POLL" }, select: { id: true } });
  if (!post) throw new NotFoundError("Poll");

  await db.$transaction(async (tx) => {
    const existing = await tx.communityPollVote.findUnique({ where: { postId_userId: { postId: input.postId, userId: actor.userId } }, select: { optionId: true } });
    if (existing?.optionId === input.optionId) return; // Voting the same way twice changes nothing.
    if (existing) {
      await tx.communityPollOption.update({ where: { id: existing.optionId }, data: { voteCount: { decrement: 1 } } });
      await tx.communityPollVote.update({ where: { postId_userId: { postId: input.postId, userId: actor.userId } }, data: { optionId: input.optionId, createdAt: now } });
    } else {
      await tx.communityPollVote.create({ data: { postId: input.postId, userId: actor.userId, optionId: input.optionId, createdAt: now } });
    }
    await tx.communityPollOption.update({ where: { id: input.optionId }, data: { voteCount: { increment: 1 } } });
  });

  const options = await db.communityPollOption.findMany({ where: { postId: input.postId }, select: { id: true, label: true, position: true, voteCount: true } });
  return pollDto(options, input.optionId);
}
