/**
 * The Plus funnel (docs/ARCHITECTURE.md §12.19): promotion seen → tapped → checkout started → payment instructions
 * reached → receipt uploaded → payment approved, with the promotion SURFACE as the one dimension.
 *
 * BEST-EFFORT, ALWAYS. `recordPlusEvent` never throws and is never called inside another write's transaction: a
 * failed analytics insert must not cost anybody a like, a checkout or a receipt. Callers invoke it AFTER their own
 * work has committed and do not await anything that depends on it succeeding.
 *
 * SWITCHED. Nothing is written, and the admin report says so, unless PLUS_FUNNEL_ANALYTICS is "on". That is also
 * what lets the code ship before its table exists in production: with the switch off the table is never touched.
 *
 * PRIVATE BY CONSTRUCTION. A row holds the member's own id, the step, the surface (a closed list), and for checkout
 * steps the order id. There is no parameter through which a liker id, a name, a photo URL, an amount or anything
 * from a receipt could reach this table.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getDb, type Db, type DbLike } from "@/lib/db";
import { parsePlusSurface, PLUS_SURFACES, type PlusSurface } from "@/lib/plus-surfaces";
import { flagEnabled } from "@/server/flags";

export const PLUS_EVENTS = [
  "plus_prompt_viewed",
  "plus_prompt_clicked",
  "plus_checkout_started",
  "plus_payment_instructions_viewed",
  "plus_receipt_uploaded",
  "plus_payment_approved",
  // Super Likes (§12.20). Counts of acts, surface "super_like"; never a recipient, never message text.
  "super_like_composer_opened",
  "super_like_sent",
  "super_like_with_message_sent",
  "super_like_matched",
] as const;
export type PlusEvent = (typeof PLUS_EVENTS)[number];

/**
 * The steps a browser may report. Everything from checkout onwards, and every Super Like that was actually sent or
 * matched, is recorded by the server itself; a browser can only say that it opened the composer.
 */
export const CLIENT_PLUS_EVENTS = ["plus_prompt_viewed", "plus_prompt_clicked", "super_like_composer_opened"] as const satisfies readonly PlusEvent[];

export interface PlusEventInput {
  event: PlusEvent;
  userId: string;
  surface?: PlusSurface | null;
  orderId?: string | null;
  /** Duplicate protection. Omit for a one-off (a random key is minted); pass a deterministic key for once-only steps. */
  eventKey?: string;
  now?: Date;
}

let warned = false;

/** Records one funnel step, or does nothing. Never throws, never blocks the caller's own outcome. */
export async function recordPlusEvent(input: PlusEventInput, deps: { db?: DbLike } = {}): Promise<void> {
  if (!flagEnabled("PLUS_FUNNEL_ANALYTICS")) return;
  try {
    const db = deps.db ?? getDb();
    const surface = input.surface ? parsePlusSurface(input.surface) : null;
    await db.$executeRaw`
      INSERT INTO "PlusFunnelEvent" ("id", "eventKey", "userId", "event", "surface", "orderId", "createdAt")
      VALUES (${randomUUID()}, ${input.eventKey ?? randomUUID()}, ${input.userId}, ${input.event}, ${surface}, ${input.orderId ?? null}, ${input.now ?? new Date()})
      ON CONFLICT ("eventKey") DO NOTHING
    `;
  } catch (e) {
    // Once per process: a missing table or a database blip must not flood the log, and must never propagate.
    if (!warned) {
      warned = true;
      console.error("[plus-funnel] event not recorded", e instanceof Error ? e.message : e);
    }
  }
}

/** Fire-and-forget for request paths: never awaited by the caller's critical path, never rejects. */
export function kickPlusEvent(input: PlusEventInput, deps: { db?: DbLike } = {}): void {
  void recordPlusEvent(input, deps).catch(() => {});
}

// ─────────────────────────────── Admin report ───────────────────────────────

export interface FunnelRow {
  /** A surface from the closed list, "unattributed" for checkout steps with no known promotion, or "all". */
  surface: PlusSurface | "unattributed" | "all";
  /** Distinct members who saw / tapped a promotion. */
  viewed: number;
  clicked: number;
  /** Distinct orders from here on. */
  checkouts: number;
  instructions: number;
  receipts: number;
  approved: number;
}

export type PlusFunnelReport = { enabled: false } | { enabled: true; rows: FunnelRow[]; total: FunnelRow };

const num = (v: unknown) => Number(v ?? 0);

/**
 * Raw counts per surface over the last `windowMs`. Checkout steps are attributed to the surface their order's checkout started
 * from, so a receipt uploaded days later still counts towards the promotion that led to it.
 */
export async function getPlusFunnelReport(windowMs: number, options: { db?: Db; now?: Date } = {}): Promise<PlusFunnelReport> {
  if (!flagEnabled("PLUS_FUNNEL_ANALYTICS")) return { enabled: false };
  const db = options.db ?? getDb();
  const since = new Date((options.now ?? new Date()).getTime() - windowMs);
  const select = Prisma.sql`
      count(DISTINCT e."userId") FILTER (WHERE e."event" = 'plus_prompt_viewed') AS viewed,
      count(DISTINCT e."userId") FILTER (WHERE e."event" = 'plus_prompt_clicked') AS clicked,
      count(DISTINCT e."orderId") FILTER (WHERE e."event" = 'plus_checkout_started') AS checkouts,
      count(DISTINCT e."orderId") FILTER (WHERE e."event" = 'plus_payment_instructions_viewed') AS instructions,
      count(DISTINCT e."orderId") FILTER (WHERE e."event" = 'plus_receipt_uploaded') AS receipts,
      count(DISTINCT e."orderId") FILTER (WHERE e."event" = 'plus_payment_approved') AS approved`;
  const from = Prisma.sql`
    FROM "PlusFunnelEvent" e
    LEFT JOIN "PlusFunnelEvent" c ON c."event" = 'plus_checkout_started' AND e."orderId" IS NOT NULL AND c."orderId" = e."orderId"
    WHERE e."createdAt" >= ${since}`;
  type Raw = { surface: string | null; viewed: bigint; clicked: bigint; checkouts: bigint; instructions: bigint; receipts: bigint; approved: bigint };
  const [grouped, totals] = await Promise.all([
    db.$queryRaw<Raw[]>(Prisma.sql`
      SELECT CASE WHEN e."event" IN ('plus_prompt_viewed', 'plus_prompt_clicked', 'plus_checkout_started') THEN e."surface" ELSE c."surface" END AS surface,
      ${select}
      ${from}
      GROUP BY 1`),
    db.$queryRaw<Raw[]>(Prisma.sql`SELECT NULL AS surface, ${select} ${from}`),
  ]);
  const toRow = (r: Raw | undefined, surface: FunnelRow["surface"]): FunnelRow => ({
    surface,
    viewed: num(r?.viewed),
    clicked: num(r?.clicked),
    checkouts: num(r?.checkouts),
    instructions: num(r?.instructions),
    receipts: num(r?.receipts),
    approved: num(r?.approved),
  });
  const bySurface = new Map(grouped.map((r) => [r.surface ?? "unattributed", r]));
  const rows: FunnelRow[] = [...PLUS_SURFACES, "unattributed" as const]
    .map((s) => toRow(bySurface.get(s), s))
    .filter((r) => r.viewed + r.clicked + r.checkouts + r.instructions + r.receipts + r.approved > 0);
  return { enabled: true, rows, total: toRow(totals[0], "all") };
}

// ─────────────────────────────── Browser ingest ───────────────────────────────

/**
 * What a browser may post about a promotion: a UUID key, one of the two client steps, and a surface from the closed
 * list. Anything else — an unknown surface, an extra field it hoped would be stored, a non-UUID key chosen to
 * collide with somebody else's — is refused whole, never repaired.
 */
export const plusPromptBodySchema = z
  .object({
    eventKey: z.string().uuid(),
    event: z.enum(CLIENT_PLUS_EVENTS),
    surface: z.enum(PLUS_SURFACES),
  })
  .strict();

export type PlusPromptBody = z.infer<typeof plusPromptBodySchema>;

export const MAX_PLUS_BODY_BYTES = 512;
/** Per member per minute. A page shows a handful of promotions at most; this only stops a loop or a script. */
export const PLUS_EVENTS_PER_MINUTE = 60;

export function parsePlusPromptBody(raw: string): PlusPromptBody | null {
  if (raw.length > MAX_PLUS_BODY_BYTES) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = plusPromptBodySchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
