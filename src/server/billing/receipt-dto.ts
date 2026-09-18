/**
 * Two views of one receipt check (docs/ARCHITECTURE.md §12.14).
 *
 *  - The customer sees the outcome and a handful of checks with fixed wording, the detected amount/currency/status
 *    and their own order's expected values. Never the sender's name, never another order, never raw OCR text.
 *  - The admin sees every field the parser recovered, every check with its note and metadata, and the history of
 *    attempts. Still never raw OCR text: it is not stored.
 */
import type { ReceiptVerification } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/money";
import type { CheckKey, CheckState, ReceiptChecks, VerificationOutcome } from "@/server/ocr/types";

export interface CustomerCheckDto {
  key: Exclude<CheckKey, "bank" | "transactionId">;
  label: string;
  state: CheckState;
  /** Only for amount, currency and status: what the receipt says, formatted. */
  detected: string | null;
  expected: string | null;
  message: string | null;
}

export interface ReceiptCheckDto {
  outcome: VerificationOutcome;
  title: string;
  summary: string;
  checks: CustomerCheckDto[];
  checkedAt: string;
}

export interface AdminReceiptVerificationDto {
  id: string;
  attempt: number;
  outcome: VerificationOutcome;
  parserVersion: string;
  engine: string;
  detectedBank: string | null;
  transactionStatus: string;
  amountLabel: string | null;
  amountMinor: number | null;
  currency: string | null;
  transactionId: string | null;
  transactionAt: string | null;
  transactionDateRaw: string | null;
  recipientAccount: string | null;
  recipientName: string | null;
  senderName: string | null;
  remarks: string | null;
  checks: ReceiptChecks;
  ocrConfidence: number | null;
  durationMs: number | null;
  triggeredById: string | null;
  createdAt: string;
}

export const OUTCOME_COPY: Record<VerificationOutcome, { title: string; summary: string }> = {
  MATCH: { title: "Transfer details detected", summary: "Everything we could read matches this order. It still goes to our team for confirmation." },
  PARTIAL_MATCH: { title: "Some transfer details detected", summary: "What we could read matches, but not every detail was visible. Our team will confirm the rest." },
  REVIEW_REQUIRED: { title: "This receipt needs a closer look", summary: "Something on the receipt needs to be checked by our team. You can still submit it." },
  MISMATCH: { title: "Receipt doesn't match this order", summary: "A detail on the receipt disagrees with this order. Check it against your bank app, replace the slip, or submit it for review anyway." },
  OCR_FAILED: { title: "We couldn't automatically verify the transfer details", summary: "You can still submit the receipt for review. Our team checks every transfer by hand." },
  UNSUPPORTED_RECEIPT: { title: "This doesn't look like a bank receipt we recognise", summary: "We support Bank of Maldives and Maldives Islamic Bank receipts. You can still submit it for review." },
};

const CUSTOMER_LABELS: Record<CustomerCheckDto["key"], string> = {
  status: "Transfer completed",
  amount: "Amount",
  currency: "Currency",
  recipient: "Recipient",
  reference: "Payment reference",
  duplicate: "Receipt not used before",
  date: "Transfer date",
};

/** Fixed customer-facing wording per check and state. No admin note, no other user's data, ever. */
function customerMessage(key: CustomerCheckDto["key"], state: CheckState): string | null {
  switch (key) {
    case "status":
      return state === "MISMATCH" ? "Your bank shows this transfer did not go through." : state === "UNCERTAIN" ? "Your bank shows this transfer as still pending." : state === "NOT_FOUND" ? "We couldn't read the transfer status." : null;
    case "amount":
      return state === "MISMATCH" ? "The amount on the receipt is not the order amount." : state === "NOT_FOUND" ? "We couldn't read the amount." : null;
    case "currency":
      return state === "MISMATCH" ? "The transfer must be in the order currency." : null;
    case "recipient":
      return state === "MISMATCH" ? "The receipt shows a different destination account." : state === "UNCERTAIN" ? "We couldn't confirm the destination account from the receipt." : state === "NOT_FOUND" ? "We couldn't read the destination account." : null;
    case "reference":
      return state === "MISMATCH" ? "The remark carries a different payment reference." : state === "UNCERTAIN" ? "The reference in the remark is slightly different." : state === "NOT_FOUND" ? "No payment reference was visible in the remark. That's fine if your bank doesn't show it." : null;
    case "duplicate":
      return state === "MISMATCH" ? "This receipt looks like one that was already submitted. Our team will check." : null;
    case "date":
      return state === "MISMATCH" ? "The transfer is dated before this order was created." : state === "UNCERTAIN" ? "We couldn't confirm the transfer date." : null;
    default:
      return null;
  }
}

const CUSTOMER_KEYS: CustomerCheckDto["key"][] = ["status", "amount", "currency", "recipient", "reference", "duplicate", "date"];

export function toCustomerCheckDto(row: Pick<ReceiptVerification, "outcome" | "checks" | "createdAt">): ReceiptCheckDto {
  const checks = row.checks as unknown as ReceiptChecks;
  const copy = OUTCOME_COPY[row.outcome];
  const items: CustomerCheckDto[] = [];
  for (const key of CUSTOMER_KEYS) {
    const c = checks[key];
    if (!c || c.state === "NOT_APPLICABLE") continue;
    // The currency row only earns a place when it disagrees; a match is implied by the amount row.
    if (key === "currency" && c.state !== "MISMATCH") continue;
    if ((key === "duplicate" || key === "date") && c.state !== "MISMATCH" && c.state !== "UNCERTAIN") continue;
    const showValues = key === "amount" || key === "currency" || key === "status";
    items.push({ key, label: CUSTOMER_LABELS[key], state: c.state, detected: showValues ? c.detected ?? null : null, expected: showValues ? c.expected ?? null : null, message: customerMessage(key, c.state) });
  }
  return { outcome: row.outcome, title: copy.title, summary: copy.summary, checks: items, checkedAt: row.createdAt.toISOString() };
}

export function toAdminVerificationDto(row: ReceiptVerification): AdminReceiptVerificationDto {
  return {
    id: row.id,
    attempt: row.attempt,
    outcome: row.outcome,
    parserVersion: row.parserVersion,
    engine: row.engine,
    detectedBank: row.detectedBank,
    transactionStatus: row.transactionStatus,
    amountLabel: row.amountMinor !== null ? formatMoney(row.amountMinor, row.currency && row.currency !== "OTHER" ? row.currency : "") .trim() : null,
    amountMinor: row.amountMinor,
    currency: row.currency,
    transactionId: row.transactionId,
    transactionAt: row.transactionAt?.toISOString() ?? null,
    transactionDateRaw: row.transactionDateRaw,
    recipientAccount: row.recipientAccount,
    recipientName: row.recipientName,
    senderName: row.senderName,
    remarks: row.remarks,
    checks: row.checks as unknown as ReceiptChecks,
    ocrConfidence: row.ocrConfidence,
    durationMs: row.durationMs,
    triggeredById: row.triggeredById,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Whether approving despite this reading must be explained: a material mismatch or a duplicate transaction id. */
export function approvalNeedsReason(row: Pick<ReceiptVerification, "outcome" | "checks"> | null): boolean {
  if (!row) return false;
  if (row.outcome === "MISMATCH") return true;
  const checks = row.checks as unknown as ReceiptChecks;
  return checks.duplicate?.state === "MISMATCH";
}
