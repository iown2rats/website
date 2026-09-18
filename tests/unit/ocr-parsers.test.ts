/**
 * Bank receipt parsing (docs/ARCHITECTURE.md §12.14): text in, fields out. No engine, no database. Most of this file is
 * about what must NOT be returned, because a receipt is full of numbers and reading the wrong one is worse than none.
 */
import { describe, expect, it } from "vitest";
import { compareAccounts, extractRecipientAccount, normalizeAccount } from "@/server/ocr/extract/account";
import { extractAmount, toMinorUnits } from "@/server/ocr/extract/amount";
import { extractTransactionDate, parseMaldivesDate } from "@/server/ocr/extract/date";
import { extractParties, namesAgree } from "@/server/ocr/extract/parties";
import { compareReferences, extractMellocrushReference } from "@/server/ocr/extract/reference";
import { extractStatus } from "@/server/ocr/extract/status";
import { extractTransactionId, normalizeTransactionId } from "@/server/ocr/extract/transaction-id";
import { detectBank, parseReceiptText } from "@/server/ocr/banks";
import { normalizeOcrText } from "@/server/ocr/text";
import * as F from "../fixtures/receipts";

describe("bank detection", () => {
  it("1 · a BML receipt is detected as BML", () => {
    expect(detectBank(F.BML_SUCCESS)).toBe("BML");
    expect(parseReceiptText(F.BML_SUCCESS).parserVersion).toBe("bml-v1");
    expect(detectBank(F.BML_NOISY)).toBe("BML");
  });
  it("2 · an MIB receipt is detected as MIB, in both the saved-slip and history layouts", () => {
    expect(detectBank(F.MIB_SUCCESS)).toBe("MIB");
    expect(detectBank(F.MIB_PROCESSED)).toBe("MIB");
    expect(parseReceiptText(F.MIB_SUCCESS).parserVersion).toBe("mib-v1");
  });
  it("an unrelated picture is no bank, and the generic parser is used", () => {
    expect(detectBank(F.UNRELATED)).toBeNull();
    expect(parseReceiptText(F.UNRELATED)).toMatchObject({ bank: null, parserVersion: "generic-v1", amountMinor: null, transactionId: null });
  });
});

describe("status normalisation", () => {
  it("3 · BML SUCCESS is COMPLETED; the 'submitted for processing' message line is not a status", () => {
    expect(extractStatus(F.BML_SUCCESS)).toEqual({ status: "COMPLETED", raw: "SUCCESS" });
    expect(extractStatus("Message Thank you. Your request has been submitted for processing.")).toBeUndefined();
    expect(extractStatus("Status Transfer Successful")?.status).toBe("COMPLETED");
  });
  it("4 · MIB Processed is COMPLETED; 'Processed Date' is a date field, not a status", () => {
    expect(extractStatus(F.MIB_PROCESSED)).toEqual({ status: "COMPLETED", raw: "PROCESSED" });
    expect(extractStatus("Processed Date 2026-08-30 23:51:26")).toBeUndefined();
    expect(extractStatus(F.MIB_SUCCESS)).toEqual({ status: "COMPLETED", raw: "SUCCESS" });
  });
  it("5 · pending is not completed", () => {
    expect(extractStatus(F.BML_PENDING)?.status).toBe("PENDING");
    expect(extractStatus("Status: Processing")?.status).toBe("PENDING");
  });
  it("6 · failed is not completed", () => {
    expect(extractStatus(F.BML_FAILED)?.status).toBe("FAILED");
    expect(extractStatus("Status Declined")?.status).toBe("FAILED");
  });
  it("does not treat unrelated words as success", () => {
    expect(extractStatus("Successfully logged in to your account")).toBeUndefined();
    expect(extractStatus(F.UNRELATED)).toBeUndefined();
  });
});

describe("amount and currency", () => {
  it("7 · Maldivian amount formats parse to integer minor units", () => {
    expect(toMinorUnits("199")).toBe(19_900);
    expect(toMinorUnits("199.00")).toBe(19_900);
    expect(toMinorUnits("1,500.50")).toBe(150_050);
    expect(toMinorUnits("0.1")).toBe(10);
    expect(toMinorUnits("abc")).toBeUndefined();
    expect(extractAmount("Amount MVR 199")).toMatchObject({ amountMinor: 19_900, currency: "MVR" });
    expect(extractAmount("Amount MVR199.00")).toMatchObject({ amountMinor: 19_900, currency: "MVR" });
    expect(extractAmount("199.00 MVR")).toMatchObject({ amountMinor: 19_900, currency: "MVR" });
    expect(extractAmount("Rf 199.00")).toMatchObject({ amountMinor: 19_900, currency: "MVR" });
  });
  it("reads the transferred amount, not a fee, a balance or a limit", () => {
    const text = `Amount MVR 1,500.00\nFee MVR 0.00\nAvailable Balance 24,350.75\nDaily Limit MVR 50,000.00`;
    expect(extractAmount(text)?.amountMinor).toBe(150_000);
    for (const line of ["Available Balance MVR 24,350.75", "Fee MVR 12.00", "Daily Limit MVR 50,000.00", "30/08/2026 14:32", F.BML_ACCOUNT]) expect(extractAmount(line), line).toBeUndefined();
  });
  it("MIB's unlabelled headline amount is read; BML's labelled row beats its split headline", () => {
    expect(extractAmount(F.MIB_SUCCESS)).toMatchObject({ amountMinor: 19_900, currency: "MVR", label: "Headline" });
    expect(extractAmount(F.BML_SUCCESS)).toMatchObject({ amountMinor: 19_900, currency: "MVR", label: "Amount" });
    expect(extractAmount(F.BML_NOISY)?.amountMinor).toBe(19_900);
  });
  it("8/9 · a wrong amount and a foreign currency are read as what they are", () => {
    expect(extractAmount(F.BML_WRONG_AMOUNT)?.amountMinor).toBe(15_000);
    expect(extractAmount(F.MIB_USD)).toMatchObject({ amountMinor: 19_900, currency: "USD" });
  });
});

describe("recipient account", () => {
  it("10 · account numbers are normalised before comparison", () => {
    expect(normalizeAccount("7701 2345 67890")).toBe(F.BML_ACCOUNT);
    expect(normalizeAccount("7701-234-567-890")).toBe(F.BML_ACCOUNT);
    expect(compareAccounts("7701 2345 67890", F.BML_ACCOUNT)).toBe("MATCH");
  });
  it("finds the destination on the line below 'To', never the source account", () => {
    expect(extractRecipientAccount(F.BML_SUCCESS)?.value).toBe(F.BML_ACCOUNT);
    expect(extractRecipientAccount(F.MIB_SUCCESS)?.value).toBe(F.MIB_ACCOUNT);
    const two = `From Account 7730000012345\nTo Account 7701122334455`;
    expect(extractRecipientAccount(two)?.value).toBe("7701122334455");
    expect(extractRecipientAccount("7701122334455")).toBeUndefined();
  });
  it("11 · a materially different account is a mismatch; one digit off is only 'uncertain', never a match", () => {
    expect(compareAccounts("7709876543210", F.BML_ACCOUNT)).toBe("MISMATCH");
    expect(compareAccounts("880099887766", F.BML_ACCOUNT)).toBe("MISMATCH");
    expect(compareAccounts("7701234567891", F.BML_ACCOUNT)).toBe("UNCERTAIN");
    expect(extractRecipientAccount(F.BML_WRONG_RECIPIENT)?.value).toBe("7709876543210");
  });
  it("recipient names are supporting evidence with legal suffixes ignored", () => {
    expect(extractParties(F.MIB_SUCCESS)).toEqual({ senderName: "AISHATH TEST", recipientName: "MELLOCRUSH PVT LTD" });
    expect(namesAgree("MELLOCRUSH PVT LTD", "Mellocrush Private Limited")).toBe(true);
    expect(namesAgree("SOME OTHER SHOP", "Mellocrush Pvt Ltd")).toBe(false);
  });
});

describe("Mellocrush reference in the remark", () => {
  it("12 · a matching reference is found, with separators and case tolerated", () => {
    expect(extractMellocrushReference(F.BML_SUCCESS)).toEqual({ value: F.ORDER_REF, wellFormed: true });
    expect(extractMellocrushReference(F.BML_NOISY)?.value).toBe(F.ORDER_REF);
    expect(extractMellocrushReference("remarks thu7k4p2m")?.value).toBe(F.ORDER_REF);
    expect(compareReferences("THU 7K4P2M", F.ORDER_REF)).toBe("MATCH");
  });
  it("13 · a missing reference is simply absent", () => {
    expect(extractMellocrushReference(F.BML_MISSING_REFERENCE)).toBeUndefined();
    expect(extractMellocrushReference(F.MIB_INCOMPLETE)).toBeUndefined();
  });
  it("14 · a different reference is a mismatch; one character off is uncertain", () => {
    expect(compareReferences("THU-9XY2QF", F.ORDER_REF)).toBe("MISMATCH");
    expect(compareReferences("THU-7K4P2N", F.ORDER_REF)).toBe("UNCERTAIN");
    expect(extractMellocrushReference(F.BML_WRONG_REFERENCE)?.value).toBe("THU-9XY2QF");
  });
});

describe("bank transaction number", () => {
  it("15 · extracted on both banks, normalised, and never a Mellocrush reference, an amount, a date or an account", () => {
    expect(extractTransactionId(F.BML_SUCCESS)).toMatchObject({ value: "BLAZ728811340921", confidence: "high" });
    expect(extractTransactionId(F.MIB_SUCCESS)).toMatchObject({ value: "91885003", confidence: "high" });
    expect(extractTransactionId(F.MIB_PROCESSED)?.value).toBe("123456789");
    expect(extractTransactionId(F.BML_NOISY)?.value).toBe("BLAZ728811340921");
    expect(normalizeTransactionId("blaz 7288-11340921")).toBe("BLAZ728811340921");
    expect(extractTransactionId(`Remarks ${F.ORDER_REF}`)).toBeUndefined();
    expect(extractTransactionId("Amount MVR 1,500.00")).toBeUndefined();
    expect(extractTransactionId("Transaction date 18/09/2026 14:26")).toBeUndefined();
    expect(extractTransactionId(F.MIB_NO_TXN_ID)).toBeUndefined();
  });
});

describe("transaction date", () => {
  it("18 · every printed shape parses as Maldives time (UTC+5), day first", () => {
    expect(extractTransactionDate(F.BML_SUCCESS)).toBe("18/09/2026 14:26");
    expect(extractTransactionDate(F.MIB_SUCCESS)).toBe("2026-09-18 14:26:31");
    expect(extractTransactionDate(F.MIB_PROCESSED)).toBe("18 SEP 2026");
    expect(parseMaldivesDate("18/09/2026 14:26")?.toISOString()).toBe("2026-09-18T09:26:00.000Z");
    expect(parseMaldivesDate("2026-09-18 14:26:31")?.toISOString()).toBe("2026-09-18T09:26:31.000Z");
    expect(parseMaldivesDate("18 Sep 2026")?.toISOString()).toBe("2026-09-17T19:00:00.000Z");
    expect(parseMaldivesDate("05/06/2025 13:26")?.toISOString()).toBe("2025-06-05T08:26:00.000Z");
    expect(parseMaldivesDate("31/02/2026")).toBeNull();
    expect(parseMaldivesDate("yesterday")).toBeNull();
  });
  it("prefers the transaction date over the processed date", () => {
    expect(extractTransactionDate("Processed Date 2026-09-19 01:00:00\nTransaction Date 2026-09-18 14:26:31")).toBe("2026-09-18 14:26:31");
  });
});

describe("normalisation", () => {
  it("collapses OCR mess but keeps lines", () => {
    const clean = normalizeOcrText("Ref  No ：  12345678\r\n  Amount |  MVR 1,500.00 ");
    expect(clean.split("\n")).toEqual(["REF NO : 12345678", "AMOUNT MVR 1,500.00"]);
  });
  it("a noisy BML scan still yields every field", () => {
    expect(parseReceiptText(F.BML_NOISY)).toMatchObject({ bank: "BML", status: "COMPLETED", amountMinor: 19_900, currency: "MVR", transactionId: "BLAZ728811340921", recipientAccount: F.BML_ACCOUNT, thundiReference: F.ORDER_REF });
  });
});
