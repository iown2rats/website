/**
 * The destination account: the one number that says the money went to the right place.
 *
 * A receipt names at least two accounts, and the one the money LEFT is usually printed first and larger. Taking that
 * one and telling a customer they paid the wrong account would be a false alarm about the scariest thing on the
 * screen. So "from" is excluded explicitly, "to" is required, and when the receipt is ambiguous this returns nothing.
 * Both real Maldivian slips put the account on the line BELOW its label ("To / Name / 90101400001151001").
 */
import { normalizeOcrText } from "../text";
import type { CheckState } from "../types";

export interface AccountMatch {
  /** Digits only. */
  value: string;
  label: string;
}

const SOURCE = /^(FROM|SENDER|SOURCE|DEBIT|PAYER|MY)/;
const DESTINATION: Array<{ pattern: RegExp; name: string; weight: number }> = [
  { pattern: /BENEFICIARYACCOUNT/, name: "Beneficiary account", weight: 100 },
  { pattern: /CREDITACCOUNT/, name: "Credit account", weight: 98 },
  { pattern: /RECIPIENTACCOUNT/, name: "Recipient account", weight: 96 },
  { pattern: /TOACCOUNT/, name: "To account", weight: 94 },
  { pattern: /PAYEEACCOUNT/, name: "Payee account", weight: 92 },
  { pattern: /^TO$/, name: "To", weight: 70 },
];
/** Maldivian account numbers run long; short digit runs are dates and amounts. */
const ACCOUNT_DIGITS = /\b(\d{9,20})\b/;
const ROW_SOURCE = /^(FROM|SENDER|SOURCE|DEBIT|PAYER|MY)\b/;
const ROW_DESTINATION: Array<{ pattern: RegExp; name: string; weight: number }> = [
  { pattern: /^BENEFICIARY\b/, name: "Beneficiary", weight: 100 },
  { pattern: /^CREDIT( ACCOUNT)?\b/, name: "Credit account", weight: 98 },
  { pattern: /^RECIPIENT\b/, name: "Recipient", weight: 96 },
  { pattern: /^TO( ACCOUNT)?\b/, name: "To", weight: 94 },
  { pattern: /^PAYEE\b/, name: "Payee", weight: 92 },
];

export function extractRecipientAccount(text: string): AccountMatch | undefined {
  // Blank lines are dropped first: Tesseract separates blocks with empty lines, and "To NAME" followed by a blank line
  // and then the number is still the name's own row.
  const lines = normalizeOcrText(text).split("\n").filter(Boolean);
  let best: { match: AccountMatch; weight: number } | undefined;
  let carried: { label: (typeof ROW_DESTINATION)[number]; from: number } | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line) continue;
    const digits = ACCOUNT_DIGITS.exec(line);
    if (!digits) {
      const label = ROW_SOURCE.test(line) ? undefined : ROW_DESTINATION.find((entry) => entry.pattern.test(line));
      carried = label ? { label, from: index } : undefined;
      continue;
    }
    const before = line.slice(0, digits.index).replace(/[^A-Z]/g, "");
    const own = before && !SOURCE.test(before) ? DESTINATION.find((entry) => entry.pattern.test(before)) : undefined;
    const inherited = !before && carried && carried.from === index - 1 ? carried.label : undefined;
    const label = own ?? inherited;
    carried = undefined;
    if (!label) continue;
    if (best && label.weight <= best.weight) continue;
    best = { match: { value: digits[1]!, label: label.name }, weight: label.weight };
  }
  return best?.match;
}

/** Whitespace, dashes and other separators removed; only the digits are compared. */
export function normalizeAccount(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Exact digits → MATCH. Same length with exactly one differing digit → UNCERTAIN (a plausible OCR misread that a
 * person must look at; it is never called a match). Anything else → MISMATCH. No fuzzier than that, on purpose.
 */
export function compareAccounts(detected: string, expected: string): Exclude<CheckState, "NOT_FOUND" | "NOT_APPLICABLE"> {
  const left = normalizeAccount(detected);
  const right = normalizeAccount(expected);
  if (!left || !right) return "MISMATCH";
  if (left === right) return "MATCH";
  if (left.length !== right.length) return "MISMATCH";
  let differences = 0;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) differences += 1;
  return differences === 1 ? "UNCERTAIN" : "MISMATCH";
}
