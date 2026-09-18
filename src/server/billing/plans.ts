/**
 * Plus plans as managed by admins (docs/ARCHITECTURE.md §12.10). A plan is FOR SALE only when it is active and an
 * admin has replaced the placeholder price with a real one. Orders snapshot name, amount, currency and duration, so
 * editing a plan afterwards never changes what an existing customer bought or owes.
 */
import { z } from "zod";
import { getDb, type Db, type DbLike } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { noMarkup } from "@/lib/validation/onboarding";
import { AUDIT_ACTIONS, writeAudit } from "@/server/admin/audit";
import { assertPermission, type AdminActor } from "@/server/admin/authz";

export const CURRENCIES = ["MVR"] as const;

export const planInputSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,32}$/, "Code: 2–32 letters, digits, _ or -"),
    name: noMarkup(40, "Name").pipe(z.string().min(1, "Name is required")),
    description: noMarkup(200, "Description").optional().default(""),
    intervalDays: z.number().int().min(1, "Duration must be at least 1 day").max(730, "Duration can be at most 730 days"),
    priceMinor: z.number().int().min(0).max(100_000_000),
    currency: z.enum(CURRENCIES).default("MVR"),
    badge: noMarkup(24, "Badge").optional().default(""),
    sortOrder: z.number().int().min(0).max(1000).default(0),
    active: z.boolean().default(true),
    isPlaceholderPrice: z.boolean().default(true),
  })
  .superRefine((p, ctx) => {
    if (!p.isPlaceholderPrice && p.priceMinor <= 0) ctx.addIssue({ code: "custom", path: ["priceMinor"], message: "Set a price above zero before marking the price final" });
  });
export type PlanInput = z.infer<typeof planInputSchema>;

export interface PlanAdminDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  intervalDays: number;
  priceMinor: number;
  currency: string;
  priceLabel: string;
  badge: string | null;
  sortOrder: number;
  active: boolean;
  isPlaceholderPrice: boolean;
  /** active && real price: customers may start an order. */
  forSale: boolean;
  orders: number;
  createdAt: string;
  updatedAt: string;
}

type PlanRow = { id: string; code: string; name: string; description: string | null; intervalDays: number; priceMinor: number; currency: string; badge: string | null; sortOrder: number; active: boolean; isPlaceholderPrice: boolean; createdAt: Date; updatedAt: Date };

export function isPlanForSale(plan: Pick<PlanRow, "active" | "isPlaceholderPrice" | "priceMinor">): boolean {
  return plan.active && !plan.isPlaceholderPrice && plan.priceMinor > 0;
}

function toDto(p: PlanRow & { _count?: { orders: number } }): PlanAdminDto {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    intervalDays: p.intervalDays,
    priceMinor: p.priceMinor,
    currency: p.currency,
    priceLabel: formatMoney(p.priceMinor, p.currency),
    badge: p.badge,
    sortOrder: p.sortOrder,
    active: p.active,
    isPlaceholderPrice: p.isPlaceholderPrice,
    forSale: isPlanForSale(p),
    orders: p._count?.orders ?? 0,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function listPlansForAdmin(deps: { db?: Db } = {}): Promise<PlanAdminDto[]> {
  const db = deps.db ?? getDb();
  const rows = await db.subscriptionPlan.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { _count: { select: { orders: true } } } });
  return rows.map(toDto);
}

/** Plans a customer may buy right now, in display order. */
export async function listSellablePlans(db: DbLike) {
  const rows = await db.subscriptionPlan.findMany({ where: { active: true, isPlaceholderPrice: false, priceMinor: { gt: 0 } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return rows.filter(isPlanForSale);
}

function parse(input: unknown): PlanInput {
  const parsed = planInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the plan details");
  return parsed.data;
}

function snapshot(p: PlanRow) {
  return { code: p.code, name: p.name, description: p.description, intervalDays: p.intervalDays, priceMinor: p.priceMinor, currency: p.currency, badge: p.badge, sortOrder: p.sortOrder, active: p.active, isPlaceholderPrice: p.isPlaceholderPrice };
}

export async function createPlan(admin: AdminActor, input: unknown, deps: { db?: Db; now?: Date } = {}): Promise<PlanAdminDto> {
  assertPermission(admin, "plans.manage");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const data = parse(input);
  if (await db.subscriptionPlan.findUnique({ where: { code: data.code }, select: { id: true } })) throw new ValidationError("A plan with that code already exists");
  const created = await db.$transaction(async (tx) => {
    const row = await tx.subscriptionPlan.create({
      data: { code: data.code, name: data.name, description: data.description || null, intervalDays: data.intervalDays, priceMinor: data.priceMinor, currency: data.currency, badge: data.badge || null, sortOrder: data.sortOrder, active: data.active, isPlaceholderPrice: data.isPlaceholderPrice, createdAt: now },
    });
    await writeAudit(tx, { actorId: admin.userId, action: AUDIT_ACTIONS.planCreated, targetType: "SubscriptionPlan", targetId: row.id, data: { after: snapshot(row) }, now });
    return row;
  });
  return toDto(created);
}

export async function updatePlan(admin: AdminActor, planId: string, input: unknown, deps: { db?: Db; now?: Date } = {}): Promise<PlanAdminDto> {
  assertPermission(admin, "plans.manage");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const data = parse(input);
  const before = await db.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!before) throw new NotFoundError("Plan");
  if (data.code !== before.code && (await db.subscriptionPlan.findUnique({ where: { code: data.code }, select: { id: true } }))) throw new ValidationError("A plan with that code already exists");
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.subscriptionPlan.update({
      where: { id: planId },
      data: { code: data.code, name: data.name, description: data.description || null, intervalDays: data.intervalDays, priceMinor: data.priceMinor, currency: data.currency, badge: data.badge || null, sortOrder: data.sortOrder, active: data.active, isPlaceholderPrice: data.isPlaceholderPrice },
    });
    await writeAudit(tx, { actorId: admin.userId, action: AUDIT_ACTIONS.planUpdated, targetType: "SubscriptionPlan", targetId: row.id, data: { before: snapshot(before), after: snapshot(row) }, now });
    return row;
  });
  return toDto(updated);
}
