/**
 * OCR-assisted receipt verification: shared vocabulary (docs/ARCHITECTURE.md §12.14).
 *
 * OCR is an assistant, never the source of truth. Nothing in this module can move an order or create a Subscription;
 * it turns a picture into a structured, per-check reading that a customer sees in summary and an admin sees in full.
 */

export type BankCode = "BML" | "MIB";

/** The transfer's own state, normalised across banks. Only COMPLETED means the bank says the money moved. */
export type TransactionStatus = "COMPLETED" | "PENDING" | "FAILED" | "UNKNOWN";

export type CheckState = "MATCH" | "MISMATCH" | "NOT_FOUND" | "UNCERTAIN" | "NOT_APPLICABLE";

export type CheckKey = "bank" | "status" | "amount" | "currency" | "recipient" | "reference" | "transactionId" | "duplicate" | "date";

export interface ReceiptCheck {
  state: CheckState;
  /** What the receipt appears to say, formatted for a person. */
  detected?: string | null;
  /** What the order says. */
  expected?: string | null;
  /** One short sentence of context for the admin. Customers get a fixed message per check instead (§12.14). */
  note?: string;
  /** Admin-only structured detail (e.g. the other order a duplicate was seen on). Stripped from every customer DTO. */
  meta?: Record<string, string | boolean | null>;
}

export type ReceiptChecks = Record<CheckKey, ReceiptCheck>;

export type VerificationOutcome = "MATCH" | "PARTIAL_MATCH" | "REVIEW_REQUIRED" | "MISMATCH" | "OCR_FAILED" | "UNSUPPORTED_RECEIPT";

/** What a bank parser recovers from the text. Every field is optional because no bank prints all of them. */
export interface ParsedReceipt {
  bank: BankCode | null;
  parserVersion: string;
  status: TransactionStatus;
  /** The bank's own word (SUCCESS, PROCESSED, PENDING…) for display; null when none was read. */
  rawStatus: string | null;
  amountMinor: number | null;
  currency: string | null;
  /** The bank's transaction / reference number, normalised (upper-case, no spaces). */
  transactionId: string | null;
  transactionDateRaw: string | null;
  /** Parsed in Maldives time (UTC+5); null when the shape was not recognised. */
  transactionAt: Date | null;
  senderName: string | null;
  recipientName: string | null;
  /** Destination account, digits only. */
  recipientAccount: string | null;
  /** Remark / purpose text as read, trimmed. */
  remarks: string | null;
  /** A Thundi payment reference (THU-XXXXXX) found anywhere on the receipt. */
  thundiReference: string | null;
}

/** A parsed receipt plus what we know about the OCR pass itself. */
export interface NormalizedTransaction extends ParsedReceipt {
  /** The engine ran and returned text. False means we could not even look (engine down, timeout). */
  scanned: boolean;
  /** Whole-document engine confidence 0–100. Diagnostics only; never a threshold. */
  ocrConfidence: number | null;
  engine: string;
  durationMs: number;
}

/** The order's snapshot — the only thing a receipt is compared against. Never the plan's or method's current row. */
export interface OrderExpectation {
  reference: string;
  amountMinor: number;
  currency: string;
  accountNumber: string;
  accountHolder: string;
  bankName: string;
  createdAt: Date;
  expiresAt: Date;
}

/** Whether the transaction id was seen on another payment. Looked up by the billing layer; the verifier only reports it. */
export type DuplicateSignal = { kind: "NOT_APPLICABLE" } | { kind: "NONE" } | { kind: "FOUND"; note: string; meta: Record<string, string | boolean | null> };

export interface VerificationResult {
  outcome: VerificationOutcome;
  checks: ReceiptChecks;
}
