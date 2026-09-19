"use server";

import { redirect } from "next/navigation";
import { isDomainError } from "@/lib/errors";
import { requireMember } from "@/server/auth/current-user";
import { cancelOrder, createOrder, submitOrderForActor, type OrderDto } from "@/server/billing/orders";

/*
 * Customer billing actions (docs/ARCHITECTURE.md §12.11). The client names a plan; everything else (price, duration,
 * bank details, reference, state) is decided on the server. Nothing here can grant Plus. Submitting takes only the
 * order id: the OCR result attached to the receipt is read from the database, never from the client (§12.14).
 */

export type BillingFailure = { ok: false; code: "VALIDATION" | "NOT_FOUND" | "ERROR"; message: string };

function failure(e: unknown): BillingFailure {
  if (isDomainError(e)) {
    if (e.code === "VALIDATION" || e.code === "INVALID_STATE") return { ok: false, code: "VALIDATION", message: e.message };
    if (e.code === "NOT_FOUND") return { ok: false, code: "NOT_FOUND", message: "That order isn't available." };
  }
  console.error("[billing] action failed", e);
  return { ok: false, code: "ERROR", message: "Mellocrush couldn't start that right now. Try again." };
}

export async function startPlusOrder(input: { planId: string }): Promise<BillingFailure | { ok: true; order: OrderDto }> {
  let order: OrderDto;
  try {
    const actor = await requireMember();
    order = await createOrder({ userId: actor.userId }, { planId: String(input?.planId ?? "") });
  } catch (e) {
    return failure(e);
  }
  redirect(`/settings/membership/order/${order.id}`);
}

export async function cancelPlusOrder(input: { orderId: string }): Promise<BillingFailure | { ok: true; order: OrderDto }> {
  try {
    const actor = await requireMember();
    const order = await cancelOrder({ userId: actor.userId }, String(input?.orderId ?? ""));
    return { ok: true, order };
  } catch (e) {
    return failure(e);
  }
}

export async function submitPlusOrder(input: { orderId: string }): Promise<BillingFailure | { ok: true; order: OrderDto }> {
  try {
    const actor = await requireMember();
    const order = await submitOrderForActor({ userId: actor.userId }, String(input?.orderId ?? ""));
    return { ok: true, order };
  } catch (e) {
    return failure(e);
  }
}
