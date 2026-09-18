/**
 * Order state machine (docs/ARCHITECTURE.md §12.12). Pure and unit-tested; every write path calls `assertTransition`
 * inside its transaction, so an order can never move along an edge that is not listed here.
 *
 *   AWAITING_PAYMENT ─▶ SUBMITTED ─▶ APPROVED
 *          │                 └─────▶ REJECTED
 *          ├─▶ CANCELLED (customer, before submitting)
 *          └─▶ EXPIRED   (unpaid past expiresAt)
 */
import { InvalidStateError } from "@/lib/errors";

export type OrderStatus = "AWAITING_PAYMENT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED";

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  AWAITING_PAYMENT: ["SUBMITTED", "CANCELLED", "EXPIRED"],
  SUBMITTED: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
  EXPIRED: [],
};

/** Statuses that count as "in progress" for the one-open-order rule. */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ["AWAITING_PAYMENT", "SUBMITTED"];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new InvalidStateError(`An order that is ${label(from)} cannot become ${label(to)}`);
}

export function label(status: OrderStatus): string {
  switch (status) {
    case "AWAITING_PAYMENT":
      return "awaiting payment";
    case "SUBMITTED":
      return "under review";
    case "APPROVED":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "CANCELLED":
      return "cancelled";
    case "EXPIRED":
      return "expired";
  }
}
