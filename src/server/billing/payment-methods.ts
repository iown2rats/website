/**
 * Payment methods (docs/ARCHITECTURE.md §12.10): where customers send money. Bank details live only in this table,
 * entered by an admin; nothing in source code names a bank or an account. The enabled method with the lowest sort
 * order is offered at checkout and its details are snapshotted onto the order.
 */
import { z } from "zod";
import { getDb, type Db, type DbLike } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { noMarkup } from "@/lib/validation/onboarding";
import { AUDIT_ACTIONS, writeAudit } from "@/server/admin/audit";
import { assertPermission, type AdminActor } from "@/server/admin/authz";
import { CURRENCIES } from "./plans";

export const paymentMethodInputSchema = z.object({
  type: z.literal("BANK_TRANSFER").default("BANK_TRANSFER"),
  label: noMarkup(60, "Label").pipe(z.string().min(1, "Label is required")),
  bankName: noMarkup(60, "Bank").pipe(z.string().min(1, "Bank is required")),
  accountHolder: noMarkup(80, "Account holder").pipe(z.string().min(1, "Account holder is required")),
  accountNumber: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 -]{3,39}$/, "Account number: 4–40 letters, digits, spaces or dashes"),
  currency: z.enum(CURRENCIES).default("MVR"),
  instructions: noMarkup(500, "Instructions").optional().default(""),
  enabled: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export type PaymentMethodInput = z.infer<typeof paymentMethodInputSchema>;

export interface PaymentMethodAdminDto {
  id: string;
  type: "BANK_TRANSFER";
  label: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  currency: string;
  instructions: string | null;
  enabled: boolean;
  sortOrder: number;
  orders: number;
  createdAt: string;
  updatedAt: string;
}

type Row = { id: string; type: "BANK_TRANSFER"; label: string; bankName: string; accountHolder: string; accountNumber: string; currency: string; instructions: string | null; enabled: boolean; sortOrder: number; createdAt: Date; updatedAt: Date };

function toDto(m: Row & { _count?: { orders: number } }): PaymentMethodAdminDto {
  return { id: m.id, type: m.type, label: m.label, bankName: m.bankName, accountHolder: m.accountHolder, accountNumber: m.accountNumber, currency: m.currency, instructions: m.instructions, enabled: m.enabled, sortOrder: m.sortOrder, orders: m._count?.orders ?? 0, createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString() };
}

/** Audit payload: enough to see what changed, without copying the full account number into the log. */
function snapshot(m: Row) {
  return { label: m.label, bankName: m.bankName, accountHolder: m.accountHolder, accountNumberLast4: m.accountNumber.slice(-4), currency: m.currency, enabled: m.enabled, sortOrder: m.sortOrder, hasInstructions: Boolean(m.instructions) };
}

function parse(input: unknown): PaymentMethodInput {
  const parsed = paymentMethodInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the payment method details");
  return parsed.data;
}

export async function listPaymentMethodsForAdmin(deps: { db?: Db } = {}): Promise<PaymentMethodAdminDto[]> {
  const db = deps.db ?? getDb();
  const rows = await db.paymentMethod.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { _count: { select: { orders: true } } } });
  return rows.map(toDto);
}

/** The method offered at checkout. Null means Plus cannot be bought right now. */
export async function getCheckoutPaymentMethod(db: DbLike) {
  return db.paymentMethod.findFirst({ where: { enabled: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
}

export async function createPaymentMethod(admin: AdminActor, input: unknown, deps: { db?: Db; now?: Date } = {}): Promise<PaymentMethodAdminDto> {
  assertPermission(admin, "payment-methods.manage");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const data = parse(input);
  const created = await db.$transaction(async (tx) => {
    const row = await tx.paymentMethod.create({ data: { ...data, instructions: data.instructions || null, createdAt: now } });
    await writeAudit(tx, { actorId: admin.userId, action: AUDIT_ACTIONS.paymentMethodCreated, targetType: "PaymentMethod", targetId: row.id, data: { after: snapshot(row) }, now });
    return row;
  });
  return toDto(created);
}

export async function updatePaymentMethod(admin: AdminActor, methodId: string, input: unknown, deps: { db?: Db; now?: Date } = {}): Promise<PaymentMethodAdminDto> {
  assertPermission(admin, "payment-methods.manage");
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const data = parse(input);
  const before = await db.paymentMethod.findUnique({ where: { id: methodId } });
  if (!before) throw new NotFoundError("Payment method");
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.paymentMethod.update({ where: { id: methodId }, data: { ...data, instructions: data.instructions || null } });
    await writeAudit(tx, { actorId: admin.userId, action: AUDIT_ACTIONS.paymentMethodUpdated, targetType: "PaymentMethod", targetId: row.id, data: { before: snapshot(before), after: snapshot(row) }, now });
    return row;
  });
  return toDto(updated);
}
