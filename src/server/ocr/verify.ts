/**
 * Comparing what the receipt says with what the order asked for (docs/ARCHITECTURE.md §12.14).
 *
 * Pure: a normalised transaction, the order's snapshot and a duplicate signal in; a structured result out. Every check
 * has its own state, and the outcome is derived from the checks, never from one OCR confidence number. The result is
 * advice for a person. A MATCH does not approve anything; a MISMATCH does not stop an admin who has seen the money.
 */
import { formatMoney } from "@/lib/money";
import { compareAccounts } from "./extract/account";
import { namesAgree } from "./extract/parties";
import { compareReferences } from "./extract/reference";
import type { CheckKey, DuplicateSignal, NormalizedTransaction, OrderExpectation, ReceiptCheck, ReceiptChecks, VerificationOutcome, VerificationResult } from "./types";

export const DATE_RULES = {
  /** A transfer this much before the order was created cannot have carried this order's reference. */
  predatesOrderMs: 60 * 60_000,
  /** A transfer this far in the future is a misread date, not a fact. */
  futureToleranceMs: 24 * 3_600_000,
} as const;

const BANK_NAMES: Record<string, string> = { BML: "Bank of Maldives", MIB: "Maldives Islamic Bank" };

function bankCheck(tx: NormalizedTransaction): ReceiptCheck {
  if (!tx.bank) return { state: "NOT_FOUND", detected: null, note: "No supported bank was recognised on the receipt." };
  return { state: "MATCH", detected: `${BANK_NAMES[tx.bank] ?? tx.bank} (${tx.bank})` };
}

function statusCheck(tx: NormalizedTransaction): ReceiptCheck {
  const detected = tx.rawStatus ? tx.rawStatus.charAt(0) + tx.rawStatus.slice(1).toLowerCase() : null;
  switch (tx.status) {
    case "COMPLETED":
      return { state: "MATCH", detected, note: "The bank says the transfer completed." };
    case "FAILED":
      return { state: "MISMATCH", detected, note: "The bank says this transfer did not go through." };
    case "PENDING":
      return { state: "UNCERTAIN", detected, note: "The bank says this transfer has not completed yet." };
    default:
      return { state: "NOT_FOUND", detected: null, note: "No transfer status was read." };
  }
}

function amountCheck(tx: NormalizedTransaction, o: OrderExpectation): ReceiptCheck {
  const expected = formatMoney(o.amountMinor, o.currency);
  if (tx.amountMinor === null) return { state: "NOT_FOUND", detected: null, expected, note: "No amount was read." };
  const detected = formatMoney(tx.amountMinor, tx.currency && tx.currency !== "OTHER" ? tx.currency : o.currency);
  return tx.amountMinor === o.amountMinor ? { state: "MATCH", detected, expected } : { state: "MISMATCH", detected, expected, note: "The amount on the receipt is not the order amount." };
}

function currencyCheck(tx: NormalizedTransaction, o: OrderExpectation): ReceiptCheck {
  if (!tx.currency) return { state: tx.amountMinor === null ? "NOT_APPLICABLE" : "NOT_FOUND", detected: null, expected: o.currency, note: tx.amountMinor === null ? undefined : "The receipt did not name a currency next to the amount." };
  if (tx.currency === o.currency) return { state: "MATCH", detected: tx.currency, expected: o.currency };
  return { state: "MISMATCH", detected: tx.currency, expected: o.currency, note: "Currencies are never converted; the transfer must be in the order currency." };
}

function recipientCheck(tx: NormalizedTransaction, o: OrderExpectation): ReceiptCheck {
  const expected = o.accountNumber;
  if (tx.recipientAccount) {
    const state = compareAccounts(tx.recipientAccount, o.accountNumber);
    if (state === "MATCH") return { state, detected: tx.recipientAccount, expected };
    if (state === "UNCERTAIN") return { state, detected: tx.recipientAccount, expected, note: "One digit differs from the expected account. Compare against the image." };
    return { state: "MISMATCH", detected: tx.recipientAccount, expected, note: "The receipt shows a different destination account." };
  }
  if (tx.recipientName) {
    return namesAgree(tx.recipientName, o.accountHolder)
      ? { state: "UNCERTAIN", detected: tx.recipientName, expected: o.accountHolder, note: "Recipient name matches the account holder, but no account number was read. Supporting evidence only." }
      : { state: "UNCERTAIN", detected: tx.recipientName, expected: o.accountHolder, note: "Recipient name differs from the account holder and no account number was read." };
  }
  return { state: "NOT_FOUND", detected: null, expected, note: "No recipient account or name was read." };
}

function referenceCheck(tx: NormalizedTransaction, o: OrderExpectation): ReceiptCheck {
  if (!tx.thundiReference) return { state: "NOT_FOUND", detected: null, expected: o.reference, note: "No Mellocrush reference was read from the remark. Many receipts do not show remarks; this alone is not a problem." };
  const state = compareReferences(tx.thundiReference, o.reference);
  if (state === "MATCH") return { state, detected: tx.thundiReference, expected: o.reference };
  if (state === "UNCERTAIN") return { state, detected: tx.thundiReference, expected: o.reference, note: "One character differs; likely an OCR misread." };
  return { state: "MISMATCH", detected: tx.thundiReference, expected: o.reference, note: "The remark carries a different Mellocrush reference." };
}

function transactionIdCheck(tx: NormalizedTransaction): ReceiptCheck {
  return tx.transactionId ? { state: "MATCH", detected: tx.transactionId, note: "Bank transaction number read." } : { state: "NOT_FOUND", detected: null, note: "No bank transaction number was read." };
}

function duplicateCheck(tx: NormalizedTransaction, duplicate: DuplicateSignal): ReceiptCheck {
  if (!tx.transactionId || duplicate.kind === "NOT_APPLICABLE") return { state: "NOT_APPLICABLE", note: "Duplicate detection needs a bank transaction number." };
  if (duplicate.kind === "FOUND") return { state: "MISMATCH", detected: tx.transactionId, note: duplicate.note, meta: duplicate.meta };
  return { state: "MATCH", detected: tx.transactionId, note: "This transaction number has not been seen on another payment." };
}

function dateCheck(tx: NormalizedTransaction, o: OrderExpectation, now: Date): ReceiptCheck {
  if (!tx.transactionDateRaw) return { state: "NOT_FOUND", detected: null, note: "No transfer date was read." };
  if (!tx.transactionAt) return { state: "UNCERTAIN", detected: tx.transactionDateRaw, note: "The date was read but its format was not recognised." };
  const detected = tx.transactionDateRaw;
  // A date without a time could be any moment of that day: compare its end, not its midnight.
  const hasTime = /\d{1,2}:\d{2}/.test(tx.transactionDateRaw);
  const latestPossible = tx.transactionAt.getTime() + (hasTime ? 0 : 24 * 3_600_000 - 1);
  if (latestPossible < o.createdAt.getTime() - DATE_RULES.predatesOrderMs) return { state: "MISMATCH", detected, note: "The transfer predates this order; it cannot have carried this order's reference." };
  if (tx.transactionAt.getTime() > now.getTime() + DATE_RULES.futureToleranceMs) return { state: "UNCERTAIN", detected, note: "The transfer date is in the future; probably a misread." };
  if (tx.transactionAt.getTime() > o.expiresAt.getTime()) return { state: "UNCERTAIN", detected, note: "The transfer is dated after the order's payment deadline." };
  return { state: "MATCH", detected };
}

/** Which failed checks are material enough that an admin approving anyway must say why. */
export const MATERIAL_OUTCOMES: readonly VerificationOutcome[] = ["MISMATCH"];

export function deriveOutcome(tx: NormalizedTransaction, checks: ReceiptChecks): VerificationOutcome {
  if (!tx.scanned) return "OCR_FAILED";
  const nothingUsable = tx.amountMinor === null && !tx.transactionId && !tx.recipientAccount && tx.status === "UNKNOWN";
  if (!tx.bank && nothingUsable) return "UNSUPPORTED_RECEIPT";
  if (checks.amount.state === "MISMATCH" || checks.currency.state === "MISMATCH" || checks.recipient.state === "MISMATCH" || checks.status.state === "MISMATCH") return "MISMATCH";
  const review = checks.duplicate.state === "MISMATCH" || checks.status.state === "UNCERTAIN" || checks.reference.state === "MISMATCH" || checks.date.state === "MISMATCH" || checks.recipient.state === "UNCERTAIN" || checks.amount.state === "NOT_FOUND";
  if (review) return "REVIEW_REQUIRED";
  const full = checks.amount.state === "MATCH" && checks.currency.state === "MATCH" && checks.status.state === "MATCH" && checks.recipient.state === "MATCH" && tx.bank !== null;
  if (full) return "MATCH";
  return "PARTIAL_MATCH";
}

export function verifyAgainstOrder(tx: NormalizedTransaction, order: OrderExpectation, duplicate: DuplicateSignal, now: Date = new Date()): VerificationResult {
  const checks: ReceiptChecks = {
    bank: bankCheck(tx),
    status: statusCheck(tx),
    amount: amountCheck(tx, order),
    currency: currencyCheck(tx, order),
    recipient: recipientCheck(tx, order),
    reference: referenceCheck(tx, order),
    transactionId: transactionIdCheck(tx),
    duplicate: duplicateCheck(tx, duplicate),
    date: dateCheck(tx, order, now),
  };
  if (!tx.scanned) {
    for (const key of Object.keys(checks) as CheckKey[]) checks[key] = { state: "NOT_APPLICABLE", note: "The receipt could not be read." };
  }
  return { outcome: deriveOutcome(tx, checks), checks };
}
