/**
 * Choosing the live Welcome Screen cover (docs/ARCHITECTURE.md §26).
 *
 * Scheduling is evaluated HERE, at read time, against the clock — there is no job that flips rows, and therefore no
 * window where a promotion has started but nothing has noticed yet. It also means a schedule needs no deployment:
 * publish a cover with a start date and it appears on its own.
 *
 * Overlap is resolved deterministically, in this order:
 *   1. a cover with a start date beats one without  — an explicit promotion beats the evergreen cover
 *   2. the later start date wins                    — the most recently begun promotion
 *   3. the later publish time wins                  — two covers scheduled for the same moment
 *   4. the higher id wins                           — a total order, so the answer never depends on row order
 *
 * The whole thing is wrapped so it cannot throw. This is the first screen a stranger sees; a database that is down
 * or a row pointing at artwork that no longer exists must cost the promotion, never the sign-in page.
 */
import { cache } from "react";
import { getDb, type DbLike } from "@/lib/db";
import { coverView, DEFAULT_COVER, type CoverRow, type WelcomeCoverView } from "./cover";

const ASSET_SELECT = { select: { id: true, width: true, height: true, blurhash: true } } as const;

/** The `where` that answers "is this cover live at `now`?" — shared by the lookup and by the admin list. */
export function liveCoverWhere(now: Date) {
  return {
    status: "PUBLISHED" as const,
    AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
  };
}

/** The tie-break above, as Prisma reads it. `nulls: "last"` is what puts an unscheduled cover behind a scheduled one. */
export const LIVE_COVER_ORDER = [{ startsAt: { sort: "desc", nulls: "last" } }, { publishedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }] as const;

/** The id of the cover that is live at `now`, or null. Used by the admin list to mark which row is actually on air. */
export async function liveCoverId(db: DbLike, now: Date = new Date()): Promise<string | null> {
  const row = await db.welcomeCover.findFirst({ where: liveCoverWhere(now), orderBy: [...LIVE_COVER_ORDER], select: { id: true } });
  return row?.id ?? null;
}

/**
 * What the Welcome Screen should paint right now. Never throws, never rejects: every failure is the built-in cover.
 */
export async function getActiveWelcomeCover(db: DbLike, now: Date = new Date()): Promise<WelcomeCoverView> {
  try {
    const cover = (await db.welcomeCover.findFirst({
      where: liveCoverWhere(now),
      orderBy: [...LIVE_COVER_ORDER],
      select: { id: true, name: true, mobileAsset: ASSET_SELECT, tabletAsset: ASSET_SELECT, desktopAsset: ASSET_SELECT },
    })) as CoverRow | null;
    return coverView(cover);
  } catch {
    return DEFAULT_COVER;
  }
}

/**
 * The cover for THIS request, memoised so the five signed-out screens that share the shell cannot each issue their
 * own query. Callers put it in whatever `Promise.all` they already have, so it never adds a round trip of its own.
 */
export const currentWelcomeCover = cache(async (): Promise<WelcomeCoverView> => getActiveWelcomeCover(getDb()));
