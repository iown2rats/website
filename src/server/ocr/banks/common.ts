/**
 * The field extraction every bank shares. Bank parsers call this and then adjust what their layout needs.
 */
import { extractAmount } from "../extract/amount";
import { extractRecipientAccount } from "../extract/account";
import { extractTransactionDate, parseMaldivesDate } from "../extract/date";
import { extractParties } from "../extract/parties";
import { extractMellocrushReference } from "../extract/reference";
import { extractRemarks } from "../extract/remarks";
import { extractStatus } from "../extract/status";
import { extractTransactionId, normalizeTransactionId } from "../extract/transaction-id";
import type { BankCode, ParsedReceipt } from "../types";

export function parseCommon(text: string, bank: BankCode | null, parserVersion: string): ParsedReceipt {
  const status = extractStatus(text);
  const amount = extractAmount(text);
  const txn = extractTransactionId(text);
  const account = extractRecipientAccount(text);
  const parties = extractParties(text);
  const dateRaw = extractTransactionDate(text);
  const thundi = extractMellocrushReference(text);
  return {
    bank,
    parserVersion,
    status: status?.status ?? "UNKNOWN",
    rawStatus: status?.raw ?? null,
    amountMinor: amount?.amountMinor ?? null,
    currency: amount?.currency ?? null,
    // A low-confidence guess is not offered: duplicate detection must never key on a number the bank did not print.
    transactionId: txn && txn.confidence === "high" ? normalizeTransactionId(txn.value) : null,
    transactionDateRaw: dateRaw ?? null,
    transactionAt: parseMaldivesDate(dateRaw),
    senderName: parties.senderName ?? null,
    recipientName: parties.recipientName ?? null,
    recipientAccount: account?.value ?? null,
    remarks: extractRemarks(text) ?? null,
    thundiReference: thundi ? thundi.value : null,
  };
}
