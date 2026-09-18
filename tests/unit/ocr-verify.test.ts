/**
 * Comparing a reading with an order (docs/ARCHITECTURE.md §12.14): pure, no engine, no database. The outcome is
 * derived from the per-check states, never from one confidence number.
 */
import { describe, expect, it } from "vitest";
import { parseReceiptText } from "@/server/ocr/banks";
import type { DuplicateSignal, NormalizedTransaction, OrderExpectation } from "@/server/ocr/types";
import { verifyAgainstOrder } from "@/server/ocr/verify";
import * as F from "../fixtures/receipts";

const NOW = new Date("2026-09-18T10:00:00Z");
const ORDER: OrderExpectation = { reference: F.ORDER_REF, amountMinor: 19_900, currency: "MVR", accountNumber: F.BML_ACCOUNT, accountHolder: F.HOLDER, bankName: "Bank of Maldives", createdAt: new Date("2026-09-18T08:00:00Z"), expiresAt: new Date("2026-09-25T08:00:00Z") };
const MIB_ORDER: OrderExpectation = { ...ORDER, accountNumber: F.MIB_ACCOUNT, bankName: "Maldives Islamic Bank" };
const NONE: DuplicateSignal = { kind: "NONE" };

function read(text: string, extra: Partial<NormalizedTransaction> = {}): NormalizedTransaction {
  return { ...parseReceiptText(text), scanned: true, ocrConfidence: 94, engine: "stub", durationMs: 1, ...extra };
}
const states = (r: ReturnType<typeof verifyAgainstOrder>) => Object.fromEntries(Object.entries(r.checks).map(([k, v]) => [k, v.state]));

describe("outcomes", () => {
  it("a correct BML receipt is a full MATCH on every check", () => {
    const r = verifyAgainstOrder(read(F.BML_SUCCESS), ORDER, NONE, NOW);
    expect(r.outcome).toBe("MATCH");
    expect(states(r)).toEqual({ bank: "MATCH", status: "MATCH", amount: "MATCH", currency: "MATCH", recipient: "MATCH", reference: "MATCH", transactionId: "MATCH", duplicate: "MATCH", date: "MATCH" });
  });
  it("a correct MIB receipt, saved or from history, is a MATCH (Processed counts as completed)", () => {
    expect(verifyAgainstOrder(read(F.MIB_SUCCESS), MIB_ORDER, NONE, NOW).outcome).toBe("MATCH");
    const hist = verifyAgainstOrder(read(F.MIB_PROCESSED), MIB_ORDER, NONE, NOW);
    expect(hist.outcome).toBe("MATCH");
    expect(hist.checks.status.detected).toBe("Processed");
    // A date without a time is compared as the whole day, so "18 Sep 2026" does not predate an order created that morning.
    expect(hist.checks.date.state).toBe("MATCH");
  });
  it("8 · the wrong amount is a MISMATCH naming both numbers", () => {
    const r = verifyAgainstOrder(read(F.BML_WRONG_AMOUNT), ORDER, NONE, NOW);
    expect(r.outcome).toBe("MISMATCH");
    expect(r.checks.amount).toMatchObject({ state: "MISMATCH", detected: "MVR 150", expected: "MVR 199" });
  });
  it("9 · another currency is CURRENCY_MISMATCH and never converted", () => {
    const r = verifyAgainstOrder(read(F.MIB_USD), MIB_ORDER, NONE, NOW);
    expect(r.outcome).toBe("MISMATCH");
    expect(r.checks.currency).toMatchObject({ state: "MISMATCH", detected: "USD", expected: "MVR" });
  });
  it("11 · the wrong recipient is a MISMATCH; a one-digit misread only asks for review; a name alone is supporting evidence", () => {
    expect(verifyAgainstOrder(read(F.BML_WRONG_RECIPIENT), ORDER, NONE, NOW)).toMatchObject({ outcome: "MISMATCH", checks: { recipient: { state: "MISMATCH", detected: "7709876543210" } } });
    const oneOff = verifyAgainstOrder(read(F.BML_SUCCESS, { recipientAccount: "7701234567891" }), ORDER, NONE, NOW);
    expect(oneOff.outcome).toBe("REVIEW_REQUIRED");
    expect(oneOff.checks.recipient.state).toBe("UNCERTAIN");
    const nameOnly = verifyAgainstOrder(read(F.BML_SUCCESS, { recipientAccount: null }), ORDER, NONE, NOW);
    expect(nameOnly.checks.recipient).toMatchObject({ state: "UNCERTAIN", detected: "THUNDI PVT LTD" });
    expect(nameOnly.outcome).toBe("REVIEW_REQUIRED");
  });
  it("5/6 · pending needs review, failed is a mismatch, even when everything else matches", () => {
    expect(verifyAgainstOrder(read(F.BML_PENDING), ORDER, NONE, NOW)).toMatchObject({ outcome: "REVIEW_REQUIRED", checks: { status: { state: "UNCERTAIN" } } });
    expect(verifyAgainstOrder(read(F.BML_FAILED), ORDER, NONE, NOW)).toMatchObject({ outcome: "MISMATCH", checks: { status: { state: "MISMATCH", detected: "Failed" } } });
  });
  it("12/13/14 · reference: matching is MATCH, missing does not fail, wrong is flagged for review", () => {
    expect(verifyAgainstOrder(read(F.BML_SUCCESS), ORDER, NONE, NOW).checks.reference.state).toBe("MATCH");
    const missing = verifyAgainstOrder(read(F.BML_MISSING_REFERENCE), ORDER, NONE, NOW);
    expect(missing.checks.reference.state).toBe("NOT_FOUND");
    expect(missing.outcome).toBe("MATCH");
    const wrong = verifyAgainstOrder(read(F.BML_WRONG_REFERENCE), ORDER, NONE, NOW);
    expect(wrong.checks.reference).toMatchObject({ state: "MISMATCH", detected: "THU-9XY2QF", expected: F.ORDER_REF });
    expect(wrong.outcome).toBe("REVIEW_REQUIRED");
  });
  it("16 · a duplicate transaction id is a review signal, not a mismatch of the payment itself", () => {
    const r = verifyAgainstOrder(read(F.BML_SUCCESS), ORDER, { kind: "FOUND", note: "Also read on order THU-AAAAAA (approved), a different customer. Possible duplicate transfer.", meta: { orderId: "o1", reference: "THU-AAAAAA", status: "APPROVED", sameCustomer: false, others: "1" } }, NOW);
    expect(r.outcome).toBe("REVIEW_REQUIRED");
    expect(r.checks.duplicate).toMatchObject({ state: "MISMATCH", meta: { reference: "THU-AAAAAA", sameCustomer: false } });
    expect(verifyAgainstOrder(read(F.MIB_NO_TXN_ID), MIB_ORDER, { kind: "NOT_APPLICABLE" }, NOW).checks.duplicate.state).toBe("NOT_APPLICABLE");
  });
  it("19 · a transfer well before the order was created is flagged; a misread future date only asks for review", () => {
    const early = verifyAgainstOrder(read(F.BML_SUCCESS.replace("18/09/2026 14:26", "10/09/2026 09:00")), ORDER, NONE, NOW);
    expect(early.checks.date.state).toBe("MISMATCH");
    expect(early.outcome).toBe("REVIEW_REQUIRED");
    const future = verifyAgainstOrder(read(F.BML_SUCCESS.replace("18/09/2026 14:26", "18/09/2027 14:26")), ORDER, NONE, NOW);
    expect(future.checks.date.state).toBe("UNCERTAIN");
    const unreadable = verifyAgainstOrder(read(F.BML_SUCCESS, { transactionAt: null, transactionDateRaw: "18TH SEPT" }), ORDER, NONE, NOW);
    expect(unreadable.checks.date.state).toBe("UNCERTAIN");
    expect(unreadable.outcome).toBe("MATCH");
  });
  it("20 · an engine that could not look is OCR_FAILED with every check not applicable", () => {
    const r = verifyAgainstOrder(read("", { scanned: false }), ORDER, { kind: "NOT_APPLICABLE" }, NOW);
    expect(r.outcome).toBe("OCR_FAILED");
    expect(new Set(Object.values(states(r)))).toEqual(new Set(["NOT_APPLICABLE"]));
  });
  it("21 · an unrelated picture that was read is UNSUPPORTED_RECEIPT, not a failed payment", () => {
    expect(verifyAgainstOrder(read(F.UNRELATED), ORDER, { kind: "NOT_APPLICABLE" }, NOW).outcome).toBe("UNSUPPORTED_RECEIPT");
  });
  it("a cropped MIB screenshot with amount and status only is a PARTIAL_MATCH; 'Processed' alone proves nothing", () => {
    const r = verifyAgainstOrder(read(F.MIB_INCOMPLETE), MIB_ORDER, { kind: "NOT_APPLICABLE" }, NOW);
    expect(r.outcome).toBe("PARTIAL_MATCH");
    expect(states(r)).toMatchObject({ amount: "MATCH", status: "MATCH", recipient: "NOT_FOUND", transactionId: "NOT_FOUND" });
    const bare = verifyAgainstOrder(read("Processed"), MIB_ORDER, { kind: "NOT_APPLICABLE" }, NOW);
    expect(bare.outcome).not.toBe("MATCH");
    expect(bare.checks.amount.state).toBe("NOT_FOUND");
  });
  it("23 · the outcome never depends on the engine confidence", () => {
    expect(verifyAgainstOrder(read(F.BML_SUCCESS, { ocrConfidence: 12 }), ORDER, NONE, NOW).outcome).toBe("MATCH");
    expect(verifyAgainstOrder(read(F.BML_WRONG_AMOUNT, { ocrConfidence: 99 }), ORDER, NONE, NOW).outcome).toBe("MISMATCH");
  });
});
