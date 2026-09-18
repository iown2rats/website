"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDomainError } from "@/lib/errors";
import { AdminAccessError, requireAdmin } from "@/server/admin/authz";
import { bootstrapFirstAdmin, changeUserRole, type Role } from "@/server/admin/bootstrap";
import { decideReport, type ReportDetailDto } from "@/server/admin/moderation";
import { setAccountStatus, type AccountAction, type AccountStatus } from "@/server/admin/users";
import { decideVerification } from "@/server/admin/verification";
import { requireActor } from "@/server/auth/current-user";
import { approveOrder, rejectOrder, type AdminOrderDto } from "@/server/billing/approval";
import { reprocessReceipt } from "@/server/billing/receipts";
import type { AdminReceiptVerificationDto } from "@/server/billing/receipt-dto";
import { createPaymentMethod, updatePaymentMethod, type PaymentMethodAdminDto } from "@/server/billing/payment-methods";
import { createPlan, updatePlan, type PlanAdminDto } from "@/server/billing/plans";
import { adjustSubscriptionPeriod, type AdminSubscriptionDto } from "@/server/billing/subscriptions";

/*
 * Admin server actions (docs/ARCHITECTURE.md §21). Each one re-derives the acting admin from the session and the
 * database through requireAdmin(permission) — nothing about authorization arrives from the client — and every
 * mutation is audited inside the domain function it calls. Failures are reported with a message only; a non-admin
 * gets the same generic refusal as any other failure.
 */

export type AdminResult<T> = { ok: true; data: T } | { ok: false; message: string };

function failure(e: unknown): { ok: false; message: string } {
  if (e instanceof AdminAccessError) return { ok: false, message: "Not authorized" };
  if (isDomainError(e)) return { ok: false, message: e.message };
  console.error("[admin] action failed", e);
  return { ok: false, message: "That didn't go through. Try again." };
}

export async function adminSetAccountStatus(userId: string, input: { action: AccountAction; reason: string }): Promise<AdminResult<{ status: AccountStatus }>> {
  try {
    const admin = await requireAdmin("users.moderate");
    const r = await setAccountStatus(admin, String(userId), input);
    revalidatePath(`/admin/users/${r.userId}`);
    return { ok: true, data: { status: r.status } };
  } catch (e) {
    return failure(e);
  }
}

export async function adminChangeRole(userId: string, input: { role: Role; reason: string }): Promise<AdminResult<{ role: Role }>> {
  try {
    const admin = await requireAdmin("users.role");
    const r = await changeUserRole(admin, String(userId), input);
    revalidatePath(`/admin/users/${r.userId}`);
    return { ok: true, data: { role: r.role } };
  } catch (e) {
    return failure(e);
  }
}

export async function adminApprovePayment(orderId: string, input?: { reason?: string }): Promise<AdminResult<{ order: AdminOrderDto; alreadyApproved: boolean }>> {
  try {
    const admin = await requireAdmin("payments.review");
    const r = await approveOrder(admin, String(orderId), { reason: typeof input?.reason === "string" ? input.reason : undefined });
    revalidatePath("/admin/payments");
    revalidatePath(`/admin/payments/${r.order.id}`);
    return { ok: true, data: r };
  } catch (e) {
    return failure(e);
  }
}

export async function adminRejectPayment(orderId: string, input: { reason: string }): Promise<AdminResult<{ order: AdminOrderDto }>> {
  try {
    const admin = await requireAdmin("payments.review");
    const order = await rejectOrder(admin, String(orderId), { reason: String(input?.reason ?? "") });
    revalidatePath("/admin/payments");
    revalidatePath(`/admin/payments/${order.id}`);
    return { ok: true, data: { order } };
  } catch (e) {
    return failure(e);
  }
}

export async function adminReprocessReceipt(orderId: string): Promise<AdminResult<{ verification: AdminReceiptVerificationDto }>> {
  try {
    const admin = await requireAdmin("payments.review");
    const verification = await reprocessReceipt(admin, String(orderId));
    revalidatePath(`/admin/payments/${String(orderId)}`);
    return { ok: true, data: { verification } };
  } catch (e) {
    return failure(e);
  }
}

export async function adminSavePlan(planId: string | null, input: unknown): Promise<AdminResult<{ plan: PlanAdminDto }>> {
  try {
    const admin = await requireAdmin("plans.manage");
    const plan = planId ? await updatePlan(admin, String(planId), input) : await createPlan(admin, input);
    revalidatePath("/admin/plans");
    revalidatePath("/settings/membership");
    return { ok: true, data: { plan } };
  } catch (e) {
    return failure(e);
  }
}

export async function adminSavePaymentMethod(methodId: string | null, input: unknown): Promise<AdminResult<{ method: PaymentMethodAdminDto }>> {
  try {
    const admin = await requireAdmin("payment-methods.manage");
    const method = methodId ? await updatePaymentMethod(admin, String(methodId), input) : await createPaymentMethod(admin, input);
    revalidatePath("/admin/payments/methods");
    revalidatePath("/settings/membership");
    return { ok: true, data: { method } };
  } catch (e) {
    return failure(e);
  }
}

export async function adminDecideReport(reportId: string, input: unknown): Promise<AdminResult<{ report: ReportDetailDto }>> {
  try {
    const admin = await requireAdmin("reports.act");
    const report = await decideReport(admin, String(reportId), input);
    revalidatePath("/admin/reports");
    revalidatePath(`/admin/reports/${report.id}`);
    return { ok: true, data: { report } };
  } catch (e) {
    return failure(e);
  }
}

export async function adminDecideVerification(userId: string, input: unknown): Promise<AdminResult<{ status: "VERIFIED" | "REJECTED" }>> {
  try {
    const admin = await requireAdmin("verification.act");
    const r = await decideVerification(admin, String(userId), input);
    revalidatePath("/admin/verifications");
    revalidatePath(`/admin/users/${r.userId}`);
    return { ok: true, data: { status: r.status } };
  } catch (e) {
    return failure(e);
  }
}

export async function adminAdjustSubscription(subscriptionId: string, input: unknown): Promise<AdminResult<{ subscription: AdminSubscriptionDto }>> {
  try {
    const admin = await requireAdmin("subscriptions.adjust");
    const subscription = await adjustSubscriptionPeriod(admin, String(subscriptionId), input);
    revalidatePath("/admin/subscriptions");
    return { ok: true, data: { subscription } };
  } catch (e) {
    return failure(e);
  }
}

export type BootstrapActionResult = { ok: true } | { ok: false; message: string };

/** First-admin claim (src/server/admin/bootstrap.ts). Any signed-in user may try; the server decides. */
export async function claimAdminBootstrap(input: { token: string }): Promise<BootstrapActionResult> {
  let claimed = false;
  try {
    const actor = await requireActor();
    const r = await bootstrapFirstAdmin({ userId: actor.userId }, String(input?.token ?? ""));
    if (!r.ok) {
      const message = r.code === "INVALID_TOKEN" ? "That token isn't right." : r.code === "RATE_LIMITED" ? "Too many attempts. Try again in an hour." : r.code === "NOT_ELIGIBLE" ? "Finish onboarding first, then try again." : "Bootstrap isn't available.";
      return { ok: false, message };
    }
    claimed = true;
  } catch (e) {
    return failure(e);
  }
  if (claimed) redirect("/admin");
  return { ok: true };
}
